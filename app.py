"""Study Tracker desktop app.

Runs a small local-only web server (127.0.0.1, random port, secret token)
and opens the UI in a Microsoft Edge "app" window with no address bar.
Everything is stored in data/data.json next to this file, with a daily
backup in data/backups/. If the data folder has a sync.json, the data is also
pushed to the phone connector (connector/) and edits made there are pulled
back in. Standard library only.

    python app.py                 normal use (opens the window)
    python app.py --no-window --port 8765 --token preview --data-dir <dir>
                                  serve only, for testing in a browser
    python app.py --demo          open with made-up sample data ending today (a throwaway copy)
"""

import argparse
import datetime as dt
import json
import mimetypes
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.request
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

BASE = Path(__file__).resolve().parent
WEB_DIR = (BASE / "web").resolve()
CURRICULUM_DIR = BASE / "curriculum"
STATE_DIR = Path(os.environ.get("LOCALAPPDATA", str(BASE))) / "StudyTracker"
INSTANCE_FILE = STATE_DIR / "instance.json"
LOG_FILE = STATE_DIR / "app.log"
KEEP_DAILY_BACKUPS = 30
PREFERRED_PORT = 47815  # fixed, so the window keeps the same origin (and its local recovery copy) between launches
BACKUP_NAME = re.compile(r"^[\w.\-]+\.json$")
POINTER = BASE / "data-location.txt"      # optional: put the data folder somewhere else, e.g. OneDrive
PUSH_DELAY = 5                            # seconds of quiet after a save before pushing to the connector

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/json", ".json")


def log(message):
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{dt.datetime.now():%Y-%m-%d %H:%M:%S}] {message}\n")
    except OSError:
        pass


def resolve_data_dir():
    """Where the data lives. data-location.txt moves it elsewhere (OneDrive), migrating it once."""
    local = BASE / "data"
    if not POINTER.exists():
        return str(local)
    try:
        target = Path(POINTER.read_text(encoding="utf-8").strip())
        if not target.name:
            return str(local)
        if local.exists() and not (target / "data.json").exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(local), str(target))
            log(f"moved the data folder to {target}")
        target.mkdir(parents=True, exist_ok=True)
        return str(target)
    except OSError:
        log(traceback.format_exc())
        return str(local)


def stamp():
    return dt.datetime.now().strftime("%Y-%m-%d_%H%M%S")


def write_json_atomic(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


_dialog_lock = threading.Lock()


def file_dialog(kind, **options):
    """Native open/save dialog via tkinter. Returns a path, None if cancelled, or raises."""
    import tkinter as tk
    from tkinter import filedialog

    with _dialog_lock:
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        try:
            ask = filedialog.asksaveasfilename if kind == "save" else filedialog.askopenfilename
            return ask(parent=root, **options) or None
        finally:
            root.destroy()


def load_curriculum():
    manifest = json.loads((CURRICULUM_DIR / "manifest.json").read_text(encoding="utf-8"))
    return [json.loads((CURRICULUM_DIR / name).read_text(encoding="utf-8")) for name in manifest["files"]]


class Store:
    def __init__(self, data_dir):
        self.data_dir = Path(data_dir)
        self.data_file = self.data_dir / "data.json"
        self.backup_dir = self.data_dir / "backups"
        self.export_dir = self.data_dir / "exports"
        self.sync_file = self.data_dir / "sync.json"   # {"url": ..., "token": ...} for the phone connector
        self._lock = threading.Lock()
        self._push_lock = threading.Lock()   # guards the timer
        self._push_io = threading.Lock()     # one upload at a time
        self._push_timer = None

    # ---------- loading ----------
    def ping(self):
        return {"ok": True}

    def load(self):
        curriculum = load_curriculum()
        data, warning = None, None
        if self.data_file.exists():
            try:
                data = json.loads(self.data_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                broken = self.data_dir / f"data.corrupt-{stamp()}.json"
                shutil.copy2(self.data_file, broken)
                warning = (
                    f"Your data file couldn't be read, so a copy was kept as {broken.name}. "
                    "Restore a backup from Settings."
                )
                log(f"corrupt data file copied to {broken}")
        resources, resources_file = {}, CURRICULUM_DIR / "resources.json"
        if resources_file.exists():
            try:
                resources = json.loads(resources_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                log(traceback.format_exc())
        self._schedule_push()
        return {"curriculum": curriculum, "resources": resources, "data": data, "warning": warning,
                "dataPath": str(self.data_file)}

    # ---------- saving + backups ----------
    def save(self, data):
        if not isinstance(data, dict) or "units" not in data:
            raise ValueError("Refusing to save data that isn't Study Tracker data.")
        with self._lock:
            self._daily_backup()
            write_json_atomic(self.data_file, data)
        self._schedule_push()
        return {"ok": True}

    def _daily_backup(self):
        if not self.data_file.exists():
            return
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        today = self.backup_dir / f"daily-{dt.date.today().isoformat()}.json"
        if not today.exists():
            shutil.copy2(self.data_file, today)
            for old in sorted(self.backup_dir.glob("daily-*.json"))[:-KEEP_DAILY_BACKUPS]:
                old.unlink(missing_ok=True)

    def _snapshot(self, label):
        if self.data_file.exists():
            self.backup_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(self.data_file, self.backup_dir / f"{label}-{stamp()}.json")

    def backup_now(self):
        with self._lock:
            self._snapshot("manual")
        return self.list_backups()

    def list_backups(self):
        if not self.backup_dir.exists():
            return []
        files = sorted(self.backup_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        return [{"name": p.name, "size": p.stat().st_size, "modified": int(p.stat().st_mtime * 1000)} for p in files]

    def restore_backup(self, name):
        if not BACKUP_NAME.match(name or ""):
            return {"ok": False, "error": "Invalid backup name."}
        src = self.backup_dir / name
        if not src.is_file():
            return {"ok": False, "error": "That backup no longer exists."}
        try:
            data = json.loads(src.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"ok": False, "error": "That backup file is damaged."}
        with self._lock:
            self._snapshot("before-restore")
            write_json_atomic(self.data_file, data)
        self._schedule_push()
        return {"ok": True, "data": data}

    # ---------- phone connector ----------
    def _sync_config(self):
        try:
            cfg = json.loads(self.sync_file.read_text(encoding="utf-8"))
            return cfg if cfg.get("url") and cfg.get("token") else None
        except (OSError, ValueError, AttributeError):
            return None

    def _sync_request(self, cfg, method, path, body=None):
        req = urllib.request.Request(
            cfg["url"].rstrip("/") + path, method=method,
            data=None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={"Authorization": f"Bearer {cfg['token']}", "Content-Type": "application/json",
                     "User-Agent": "StudyTracker"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read() or b"{}")

    def sync_pull(self, after=0):
        """Edits made through the connector that this app hasn't applied yet. The UI applies them."""
        cfg = self._sync_config()
        if not cfg:
            return {"ok": False, "disabled": True}
        try:
            return {"ok": True, "ops": self._sync_request(cfg, "GET", f"/sync/ops?after={int(after)}").get("ops", [])}
        except Exception as exc:
            log(f"sync pull failed: {exc}")
            return {"ok": False, "error": str(exc)}

    def _schedule_push(self):
        if not self._sync_config():
            return
        with self._push_lock:
            if self._push_timer:
                self._push_timer.cancel()
            self._push_timer = threading.Timer(PUSH_DELAY, self.push_now)
            self._push_timer.daemon = True
            self._push_timer.start()

    def push_now(self):
        """Send the saved data to the connector. It includes data.sync.appliedSeq, which clears the edits already applied."""
        with self._push_lock:
            if self._push_timer:
                self._push_timer.cancel()
                self._push_timer = None
        cfg = self._sync_config()
        if not cfg or not self.data_file.exists():
            return
        with self._push_io:
            try:
                data = json.loads(self.data_file.read_text(encoding="utf-8"))
                self._sync_request(cfg, "POST", "/sync/push", {"data": data, "curriculum": load_curriculum()})
            except Exception as exc:
                log(f"sync push failed: {exc}")

    def flush_push(self):
        if self._push_timer:
            self.push_now()

    # ---------- files ----------
    def open_data_folder(self):
        self.data_dir.mkdir(parents=True, exist_ok=True)
        os.startfile(self.data_dir)  # Windows only
        return {"ok": True}

    def open_url(self, url):
        """Open a web link in the user's normal browser (never inside the tracker window)."""
        if not isinstance(url, str) or len(url) > 2000 or not re.match(r"^https?://", url, re.I):
            return {"ok": False, "error": "Only web links can be opened."}
        webbrowser.open(url, new=2)
        return {"ok": True}

    def export_data(self, data):
        filename = f"study-tracker-export-{dt.date.today().isoformat()}.json"
        try:
            path = file_dialog("save", initialfile=filename, defaultextension=".json",
                               filetypes=[("JSON files", "*.json")])
            if not path:
                return {"ok": False, "cancelled": True}
        except Exception:  # no tkinter or dialog failed: fall back to the exports folder
            log(traceback.format_exc())
            path = self.export_dir / filename
        write_json_atomic(Path(path), data)
        return {"ok": True, "path": str(path)}

    def pick_import_file(self):
        try:
            path = file_dialog("open", filetypes=[("JSON files", "*.json")])
        except Exception:
            log(traceback.format_exc())
            return {"ok": False, "error": "The file picker isn't available on this PC."}
        if not path:
            return {"ok": False, "cancelled": True}
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"ok": False, "error": "That file isn't valid JSON."}
        if not isinstance(data, dict) or "units" not in data or "topics" not in data:
            return {"ok": False, "error": "That file isn't a Study Tracker export."}
        with self._lock:
            self._snapshot("before-import")
        return {"ok": True, "data": data, "path": str(path)}


API = {
    name: getattr(Store, name)
    for name in ("ping", "load", "save", "backup_now", "list_backups", "restore_backup",
                 "open_data_folder", "open_url", "export_data", "pick_import_file", "sync_pull")
}


class Handler(BaseHTTPRequestHandler):
    server_version = "StudyTracker"

    def log_message(self, fmt, *args):
        pass

    def _host_ok(self):
        port = self.server.server_port
        return self.headers.get("Host", "") in (f"127.0.0.1:{port}", f"localhost:{port}")

    def _send(self, status, body=b"", ctype="application/json; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self._host_ok():
            return self._send(HTTPStatus.FORBIDDEN)
        path = urlsplit(self.path).path
        target = (WEB_DIR / ("index.html" if path == "/" else path.lstrip("/"))).resolve()
        if WEB_DIR not in target.parents or not target.is_file():
            return self._send(HTTPStatus.NOT_FOUND, b"Not found", "text/plain; charset=utf-8")
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype == "application/json":
            ctype += "; charset=utf-8"
        self._send(HTTPStatus.OK, target.read_bytes(), ctype)

    def do_POST(self):
        if not self._host_ok():
            return self._send(HTTPStatus.FORBIDDEN)
        parts = urlsplit(self.path)
        match = re.fullmatch(r"/api/(\w+)", parts.path)
        token = self.headers.get("X-Token") or parse_qs(parts.query).get("t", [""])[0]
        if not match or not secrets.compare_digest(token, self.server.token):
            return self._send(HTTPStatus.FORBIDDEN, b'{"error": "forbidden"}')
        fn = API.get(match.group(1))
        if fn is None:
            return self._send(HTTPStatus.NOT_FOUND, b'{"error": "unknown call"}')
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length)) if length else {}
            self.server.last_ping = time.monotonic()
            result = fn(self.server.store, *payload.get("args", []))
            self._send(HTTPStatus.OK, json.dumps(result, ensure_ascii=False).encode("utf-8"))
        except Exception as exc:
            log(traceback.format_exc())
            self._send(HTTPStatus.INTERNAL_SERVER_ERROR, json.dumps({"error": str(exc)}).encode("utf-8"))


# ---------- window + single instance ----------
def find_browser():
    roots = [os.environ.get(k) for k in ("PROGRAMFILES(X86)", "PROGRAMFILES", "LOCALAPPDATA")]
    candidates = [Path(r) / "Microsoft/Edge/Application/msedge.exe" for r in roots if r]
    candidates += [Path(r) / "Google/Chrome/Application/chrome.exe" for r in roots if r]
    return next((c for c in candidates if c.exists()), None)


def open_window(port, token):
    url = f"http://127.0.0.1:{port}/#{token}"
    browser = find_browser()
    if browser is None:
        webbrowser.open(url)
        return None
    return subprocess.Popen([
        str(browser), f"--app={url}", f"--user-data-dir={STATE_DIR / 'window-profile'}",
        "--window-size=1320,880", "--no-first-run", "--no-default-browser-check", "--disable-sync",
    ])


def window_open():
    """True if a top-level Edge/Chrome window titled "Study Tracker" exists. Minimised windows count."""
    try:
        import ctypes
        from ctypes import wintypes

        user32, kernel32 = ctypes.windll.user32, ctypes.windll.kernel32
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel32.QueryFullProcessImageNameW.argtypes = [
            wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        found = False

        def owned_by_browser(hwnd):
            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            handle = kernel32.OpenProcess(0x1000, False, pid.value)  # PROCESS_QUERY_LIMITED_INFORMATION
            if not handle:
                return False
            try:
                buf, size = ctypes.create_unicode_buffer(512), wintypes.DWORD(512)
                if not kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
                    return False
                return buf.value.lower().endswith(("msedge.exe", "chrome.exe"))
            finally:
                kernel32.CloseHandle(handle)

        @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        def check(hwnd, _):
            nonlocal found
            length = user32.GetWindowTextLengthW(hwnd)
            if length:
                buf = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buf, length + 1)
                if buf.value.startswith("Study Tracker") and owned_by_browser(hwnd):
                    found = True
                    return False
            return True

        user32.EnumWindows(check, 0)
        return found
    except Exception:
        log(traceback.format_exc())
        return True  # if we can't tell, keep serving rather than risk failed saves


def wait_for_windows_to_close(server):
    """Serve until the tracker window has really gone.

    Pings alone aren't reliable: Edge pauses minimised and background windows, so a quiet
    window may still be open. Stop only when no tracker window exists and nothing has
    pinged for a while.
    """
    started, gone_since = time.monotonic(), None
    while True:
        time.sleep(5)
        now = time.monotonic()
        if window_open() or now - server.last_ping < 30 or now - started < 60:
            gone_since = None
        elif gone_since is None:
            gone_since = now
        elif now - gone_since > 20:
            return


def make_server(port):
    try:
        return ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError:
        if port == 0:
            raise
        log(f"port {port} busy, using a random port")
        return ThreadingHTTPServer(("127.0.0.1", 0), Handler)


def running_instance():
    try:
        inst = json.loads(INSTANCE_FILE.read_text(encoding="utf-8"))
        req = urllib.request.Request(
            f"http://127.0.0.1:{inst['port']}/api/ping", data=b"{}", method="POST",
            headers={"X-Token": inst["token"], "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=1.5) as r:
            return inst if r.status == 200 else None
    except Exception:
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-window", action="store_true")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--token")
    parser.add_argument("--data-dir", default=None)
    parser.add_argument("--demo", action="store_true")
    args = parser.parse_args()
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    if args.demo:  # own port and data, so it never touches the real tracker or its recovery copy
        args.data_dir = tempfile.mkdtemp(prefix="study-tracker-demo-")
        subprocess.run([sys.executable, str(BASE / "tools" / "make_demo_data.py"),
                        "--out", str(Path(args.data_dir) / "data.json")], check=True, capture_output=True)

    if not args.no_window and not args.demo:
        existing = running_instance()
        if existing:
            open_window(existing["port"], existing["token"])
            return

    server = make_server(args.port or (0 if args.no_window or args.demo else PREFERRED_PORT))
    server.daemon_threads = True
    server.token = args.token or secrets.token_urlsafe(24)
    server.store = Store(args.data_dir or resolve_data_dir())
    server.last_ping = time.monotonic()
    threading.Thread(target=server.serve_forever, daemon=True).start()

    if args.no_window:
        print(f"Study Tracker serving at http://127.0.0.1:{server.server_port}/#{server.token}", flush=True)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            return

    if not args.demo:
        INSTANCE_FILE.write_text(json.dumps({"port": server.server_port, "token": server.token}), encoding="utf-8")
    try:
        open_window(server.server_port, server.token)
        wait_for_windows_to_close(server)
    finally:
        server.shutdown()
        server.store.flush_push()
        try:
            if json.loads(INSTANCE_FILE.read_text(encoding="utf-8")).get("token") == server.token:
                INSTANCE_FILE.unlink()
        except (OSError, ValueError):
            pass


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
        raise
