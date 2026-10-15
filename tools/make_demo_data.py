"""Write demo/data.json: six weeks of made-up Year 12 study, so every chart has something to show.

    python tools/make_demo_data.py                  ends today
    python tools/make_demo_data.py --end 2026-10-14

Simulates a term: each subject is taught a topic most school days, topics move through
Taught > Notes > Practised > Confident, get rated red/amber/green and re-rated as they
improve, and study sessions and test scores are logged along the way. Seeded, so the
same end date always gives the same data. Standard library only.
"""

import argparse
import datetime as dt
import json
import random
import re
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CURRICULUM = ROOT / "curriculum"
OUT = ROOT / "demo" / "data.json"
TERM_DAYS = 42

# Which courses run side by side in Year 1, in teaching order, and how fast each one is taught.
PLAN = {
    "maths": [("pure", 0.75), ("stats", 0.3), ("mech", 0.3)],
    "further": [("cp1", 0.6), ("d1", 0.35)],
    "physics": [("m1", 0.15), ("m2", 0.5), ("m3", 0.45)],
}
KINDS = ["Questions", "Questions", "Notes", "Study session", "Flashcards / recall", "Review", "Homework", "Past paper"]
NOTES = {
    "Questions": ["Exercise {ex} mixed questions", "Textbook {ex}, odd numbers", "Exam-style questions from the end of the chapter"],
    "Notes": ["Rewrote class notes into one page", "Made a summary sheet", "Notes from the textbook worked examples"],
    "Study session": ["Went back over what we did in class", "Worked through the examples again"],
    "Flashcards / recall": ["Blurted the chapter then checked", "Flashcards on the key formulas"],
    "Review": ["Reviewed the red topics", "Redid questions I got wrong last week"],
    "Homework": ["Set homework", "Homework sheet, all done"],
    "Past paper": ["Topic questions from past papers"],
}
UNIT_NOTES = {
    "further/cp1/matrices": "Ask about the proof for the inverse of a product",
    "maths/pure/y1-quadratics": "Discriminant questions: remember to check the inequality direction",
    "physics/m3/3-1-motion": "Projectiles: split into horizontal and vertical every time",
}


def slug(s):
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", s.lower()))[:64] or "topic"


def load_units():
    """{subject: {course: [(unit key, unit type, [topic keys])]}} for Year 1 units, same keys as the app."""
    manifest = json.loads((CURRICULUM / "manifest.json").read_text(encoding="utf-8"))
    out = {}
    for name in manifest["files"]:
        s = json.loads((CURRICULUM / name).read_text(encoding="utf-8"))
        out[s["id"]] = {}
        for c in s["courses"]:
            units = []
            for u in c["units"]:
                key, seen, topics = f"{s['id']}/{c['id']}/{u['id']}", set(), []
                for t in u.get("topics", []):
                    base = (isinstance(t, dict) and t.get("id")) or slug(t if isinstance(t, str) else t["name"])
                    tid, i = base, 2
                    while tid in seen:
                        tid, i = f"{base}-{i}", i + 1
                    seen.add(tid)
                    topics.append(f"{key}/{tid}")
                units.append({"key": key, "year": u.get("year", 1), "type": u.get("type", "stages"), "topics": topics})
            out[s["id"]][c["id"]] = units
    return out


def ms(day, hour, minute=0):
    return int(time.mktime(dt.datetime.combine(day, dt.time(hour, minute)).timetuple()) * 1000)


def uid(rng, t):
    n, digits = t, ""
    while n:
        n, r = divmod(n, 36)
        digits = "0123456789abcdefghijklmnopqrstuvwxyz"[r] + digits
    return digits + "".join(rng.choice("0123456789abcdefghijklmnopqrstuvwxyz") for _ in range(5))


def progress_pct(topics, state):
    return round(sum(state.get(t, {}).get("stage", 0) for t in topics) / (len(topics) * 4) * 100) if topics else 0


def green_pct(units, state):
    rated = [t for u in units if u["type"] != "checklist" for t in u["topics"] if state.get(t, {}).get("rag")]
    return round(sum(state[t]["rag"] == "green" for t in rated) / len(rated) * 100) if rated else 0


def build(end):
    rng = random.Random(f"study-tracker-demo-{end.isoformat()}")
    subjects = load_units()
    start = end - dt.timedelta(days=TERM_DAYS)
    topics, units, log, scores, trend, activity = {}, {}, [], [], [], {}
    queues = {s: {c: [t for u in subjects[s][c] if u["year"] == 1 for t in u["topics"]] for c, _ in PLAN[s]} for s in PLAN}
    skill = {s: rng.uniform(0.45, 0.8) for s in PLAN}   # how quickly topics in each subject turn green
    taught_units = {s: [] for s in PLAN}

    def touch(day):
        activity[day.isoformat()] = activity.get(day.isoformat(), 0) + 1

    def rate(tkey, subject, now, day):
        p = topics[tkey]
        roll = rng.random() + skill[subject] * 0.3 + p.get("stage", 0) * 0.05 + {"amber": 0.05, "green": 0.2}.get(p.get("rag"), 0)
        p["rag"] = "green" if roll > 1.12 else "amber" if roll > 0.6 else "red"
        p["reviewedAt"] = p["at"] = now
        touch(day)

    def review_due(p):  # same spacing as the app: red 2 days, amber 7, green 21
        return dt.date.fromtimestamp(p["reviewedAt"] / 1000) + dt.timedelta(days={"red": 2, "amber": 7, "green": 21}[p["rag"]])

    for offset in range(TERM_DAYS + 1):
        day = start + dt.timedelta(days=offset)
        school = day.weekday() < 5
        for subject, courses in PLAN.items():
            # class: new topics taught
            for course, rate_per_day in courses:
                q = queues[subject][course]
                if school and q and rng.random() < rate_per_day:
                    tkey = q.pop(0)
                    now = ms(day, rng.randint(9, 14), rng.randint(0, 59))
                    topics[tkey] = {"stage": 1, "at": now, "taughtAt": now}
                    ukey = tkey.rsplit("/", 1)[0]
                    if ukey not in taught_units[subject]:
                        taught_units[subject].append(ukey)
                    touch(day)
            # evening: work on recently taught topics
            mine = [k for k in topics if k.startswith(subject + "/")]
            worked = 0
            for tkey in mine:
                p = topics[tkey]
                if day <= dt.date.fromtimestamp(p["taughtAt"] / 1000):
                    continue
                age = (day - dt.date.fromtimestamp(p["taughtAt"] / 1000)).days
                now = ms(day, rng.randint(17, 21), rng.randint(0, 59))
                if p["stage"] < 4 and rng.random() < (0.35 if age < 10 else 0.12):
                    p["stage"] += 1
                    p["at"] = now
                    touch(day)
                    worked += 1
                    if p["stage"] >= 2 and (not p.get("rag") or p["rag"] != "green" and rng.random() < 0.35):
                        rate(tkey, subject, now, day)
                elif p.get("rag") and day >= review_due(p) and rng.random() < 0.55:
                    rate(tkey, subject, now, day)
                    worked += 1
            # the session behind that work
            if (worked or rng.random() < 0.25) and taught_units[subject]:
                kind = rng.choice(KINDS)
                note = rng.choice(NOTES[kind]).format(ex=f"{rng.randint(1, 9)}{rng.choice('ABCDEFG')}")
                at = ms(day, rng.randint(17, 21), rng.randint(0, 59))
                log.append({"id": uid(rng, at), "date": day.isoformat(), "subject": subject,
                            "unit": rng.choice(taught_units[subject][-3:]), "minutes": rng.choice([20, 25, 30, 40, 45, 60, 60, 75, 90]),
                            "kind": kind, "note": note, "at": at})
        # end-of-chapter tests on Fridays for a chapter that's mostly been taught
        if day.weekday() == 4:
            for subject in PLAN:
                done = [u for u in taught_units[subject] if all(t in topics for t in next(
                    x["topics"] for c in subjects[subject].values() for x in c if x["key"] == u))]
                tested = {s["unit"] for s in scores}
                fresh = [u for u in done if u not in tested]
                if fresh and rng.random() < 0.7:
                    ukey, total = fresh[0], rng.choice([25, 30, 40, 50])
                    got = round(total * min(0.97, rng.uniform(0.45, 0.75) + skill[subject] * 0.25))
                    at = ms(day, 12)
                    scores.append({"id": uid(rng, at), "date": day.isoformat(), "subject": subject, "unit": ukey,
                                   "title": "End of chapter test", "kind": "End-of-chapter test", "got": got, "max": total, "at": at})
        # the daily snapshot the progress chart is drawn from
        s = {}
        for subject in subjects:
            every = [u for c in subjects[subject].values() for u in c]
            s[subject] = [progress_pct([t for u in every if u["year"] == 1 for t in u["topics"]], topics),
                          progress_pct([t for u in every if u["year"] == 2 for t in u["topics"]], topics),
                          progress_pct([t for u in every for t in u["topics"]], topics),
                          green_pct(every, topics)]
        trend.append({"d": day.isoformat(), "s": s})

    for ukey, note in UNIT_NOTES.items():
        if any(k.startswith(ukey + "/") for k in topics):
            units[ukey] = {"notes": note}
    pag = next(u for u in subjects["physics"]["pag"] if u["year"] == 1)
    for tkey in pag["topics"][:1]:
        topics[tkey] = {"stage": 4, "at": ms(start + dt.timedelta(days=20), 14), "taughtAt": ms(start + dt.timedelta(days=20), 14)}

    created = ms(start, 8)
    return {
        "version": 1, "created": created,
        "units": units, "topics": topics, "custom": {"units": [], "topics": {}},
        "log": sorted(log, key=lambda e: e["at"]), "scores": scores, "trend": trend, "activity": activity,
        "trash": [], "links": {},
        "exams": [{"id": uid(rng, created), "name": "Year 12 mocks", "date": f"{end.year + (end.month > 6)}-06-08"},
                  {"id": uid(rng, created + 1), "name": "A-level exams start (estimate)", "date": f"{end.year + 1 + (end.month > 6)}-05-15"}],
        "settings": {"view": "overview", "year": 1, "scope": "current", "open": {}, "collapsed": {}, "timer": None,
                     "hideIntro": True, "dueMode": "chapter", "auto": None},
        "savedAt": ms(end, 21),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--end", type=dt.date.fromisoformat, default=dt.date.today(), help="last day of the demo (YYYY-MM-DD)")
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    data = build(args.end)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    rated = [p["rag"] for p in data["topics"].values() if p.get("rag")]
    print(f"wrote {args.out}: {len(data['topics'])} topics ({rated.count('green')} green, {rated.count('amber')} amber, "
          f"{rated.count('red')} red), {len(data['log'])} sessions, {len(data['scores'])} scores")


if __name__ == "__main__":
    main()
