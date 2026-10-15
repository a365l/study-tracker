"""Fetch index pages and dump their links (href + text) so we can map them to topics."""
import html
import re
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urljoin

OUT = Path(__file__).parent / "pages"
OUT.mkdir(exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.status, r.geturl(), r.read().decode("utf-8", "replace")


def links(base, page):
    out = []
    for m in re.finditer(r'<a\b[^>]*href="([^"#]+)"[^>]*>(.*?)</a>', page, re.S | re.I):
        text = re.sub(r"<[^>]+>", " ", m.group(2))
        text = html.unescape(re.sub(r"\s+", " ", text)).strip()
        out.append((urljoin(base, html.unescape(m.group(1))), text))
    return out


for i, url in enumerate(sys.argv[1:]):
    try:
        status, final, page = fetch(url)
    except Exception as e:  # noqa: BLE001
        print(f"\n### {url}\nERROR {e}")
        continue
    name = re.sub(r"[^a-z0-9]+", "_", final.lower())[-80:]
    (OUT / f"{name}.html").write_text(page, encoding="utf-8")
    ls = links(final, page)
    print(f"\n### {url} -> {final} [{status}] {len(ls)} links (saved {name}.html)")
    for href, text in ls:
        print(f"  {text[:70]!r:74} {href}")
