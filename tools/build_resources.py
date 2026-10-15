"""Build curriculum/resources.json from the saved Maths Genie + PMT pages.

Every link is HTTP-checked; anything that doesn't answer 200/206 is dropped.
"""
import concurrent.futures as cf
import datetime as dt
import difflib
import html
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from urllib.parse import urljoin

HERE = Path(__file__).parent
PAGES = HERE / "pages"
CUR = HERE.parent / "curriculum"
BASE = "https://www.physicsandmathstutor.com/"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}


def slug(s):
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", s.lower()))[:64] or "topic"


def norm(s):
    s = s.replace("\xa0", " ").replace("1D", "one dimension").replace("2D", "two dimensions")
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", s.lower()).split())


def sim(a, b):
    a, b = norm(a), norm(b)
    r = difflib.SequenceMatcher(None, a, b).ratio()
    if a and b and (a in b or b in a):
        r = max(r, 0.8)
    return r


def enc(u):
    return urllib.parse.quote(u, safe=":/%?=&#'(),+~-._!*;@$")


def anchors(glob, base):
    out, seen = [], set()
    for p in sorted(PAGES.glob(glob)):
        page = p.read_text(encoding="utf-8")
        for m in re.finditer(r'<a\b[^>]*href="([^"#]+)"[^>]*>(.*?)</a>', page, re.S | re.I):
            text = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(2)))).replace("\xa0", " ").strip()
            href = urljoin(base, html.unescape(m.group(1)))
            if (href, text) not in seen:
                seen.add((href, text))
                out.append((href, text))
    return out


# ---------------- curriculum model (same topic ids as the app) ----------------
units, by_course = {}, {}
for f in json.loads((CUR / "manifest.json").read_text(encoding="utf-8"))["files"]:
    s = json.loads((CUR / f).read_text(encoding="utf-8"))
    for c in s["courses"]:
        for u in c["units"]:
            key = f"{s['id']}/{c['id']}/{u['id']}"
            seen, topics = set(), []
            for t in u.get("topics", []):
                name = t if isinstance(t, str) else t["name"]
                base = (t.get("id") if isinstance(t, dict) else None) or slug(name)
                tid, i = base, 2
                while tid in seen:
                    tid, i = f"{base}-{i}", i + 1
                seen.add(tid)
                topics.append((f"{key}/{tid}", name))
            units[key] = {"name": u["name"], "id": u["id"], "topics": topics}
            by_course.setdefault((s["id"], c["id"], u.get("year", 1)), []).append(key)


def course_units(subject, course, year=None):
    return [k for (s, c, y), ks in by_course.items() if s == subject and c == course and (year is None or y == year) for k in ks]


R_units, R_topics, report = {}, {}, []


def add(bucket, key, site, label, href, kind):
    url = enc(href)
    items = bucket.setdefault(key, [])
    if all(x["url"] != url for x in items):
        items.append({"site": site, "label": label, "url": url, "kind": kind})


# ---------------- Maths Genie (classic 2017 A-level page) ----------------
for href, text in anchors("*old_mathsgenie_co_uk_newalevel_html*", "https://old.mathsgenie.co.uk/"):
    year = 1 if "a-level-year-1-" in href else 2 if "a-level-year-2-" in href else None
    sec = re.match(r"(\d+)\.(\d+)\s+(.+)", text)
    if sec and year and "questions" not in href:
        chapter, title = int(sec.group(1)), sec.group(3)
        pool = course_units("maths", "pure", year)
        if chapter > len(pool):
            report.append(f"MG: no Year {year} unit for {text}")
            continue
        ukey = pool[chapter - 1]
        best = max(units[ukey]["topics"], key=lambda tp: sim(tp[1], title))
        label = f"{sec.group(1)}.{sec.group(2)} {title}"
        if sim(best[1], title) >= 0.6:
            add(R_topics, best[0], "Maths Genie", label, href, "lesson")
        else:
            add(R_units, ukey, "Maths Genie", label, href, "lesson")
            report.append(f"MG section kept at chapter level: Y{year} {label}")
        continue
    qs = re.match(r"Question Set \d+: (.+)", text)
    if qs:
        title = qs.group(1)
        if "year-1-questions" in href:
            pool = course_units("maths", "pure", 1)
        elif "year-2-questions" in href:
            pool = course_units("maths", "pure", 2)
        elif "stats-questions" in href:
            pool = course_units("maths", "stats")
        elif "mechanics-questions" in href:
            pool = course_units("maths", "mech")
        else:
            continue
        ukey = max(pool, key=lambda k: sim(units[k]["name"], title))
        if sim(units[ukey]["name"], title) >= 0.6:
            add(R_units, ukey, "Maths Genie", f"Question set: {title}", href, "questions")
        else:
            report.append(f"MG question set unmatched: {text} (best: {units[ukey]['name']})")

# ---------------- PMT Edexcel A-level Maths ----------------
AREA = {"Pure": "pure", "Statistics": "stats", "Mechanics": "mech"}
CH_OFFSET = {("mech", 1): 8, ("mech", 2): 4}
QP = {}


def qp(folder, year, names, target):
    for n in names:
        QP[(folder, year, n)] = target


qp("Proof", 1, ["Proof"], "pure/y1-algebraic-methods")
qp("Algebra-and-Functions", 1, ["Factor Theorem"], "pure/y1-algebraic-methods")
qp("Algebra-and-Functions", 1, ["Inequalities"], "pure/y1-equations-inequalities")
qp("Algebra-and-Functions", 1, ["Quadratics"], "pure/y1-quadratics")
qp("Algebra-and-Functions", 1, ["Surds and Indices"], "pure/y1-algebraic-expressions")
qp("Algebra-and-Functions", 1, ["Transformations and Graphs"], "pure/y1-graphs-transformations")
qp("Algebra-and-Functions", 2, ["Composite and Inverse Functions", "Modulus of Functions"], "pure/y2-functions-graphs")
qp("Algebra-and-Functions", 2, ["Partial Fractions"], "pure/y2-algebraic-methods")
qp("Coordinate-Geometry", 1, ["Circles"], "pure/y1-circles")
qp("Coordinate-Geometry", 1, ["Linear Models", "Straight Lines"], "pure/y1-straight-line-graphs")
qp("Coordinate-Geometry", 2, ["Arc Length and Sector Area"], "pure/y2-radians")
qp("Coordinate-Geometry", 2, ["Parametric Equations"], "pure/y2-parametric-equations")
qp("Sequences-and-Series", 1, ["Binomial Expansion"], "pure/y1-binomial-expansion")
qp("Sequences-and-Series", 2, ["Arithmetic Sequences", "Geometric Series", "Sequences and Series"], "pure/y2-sequences-series")
qp("Sequences-and-Series", 2, ["Binomial Expansion"], "pure/y2-binomial-expansion")
qp("Trigonometry", 1, ["Sine and Cosine Rule"], "pure/y1-trig-ratios")
qp("Trigonometry", 1, ["Trigonometric Equations", "Trigonometric Identities"], "pure/y1-trig-identities")
qp("Trigonometry", 2, ["Modelling with Trigonometric Functions", "Trigonometric Equations"], "pure/y2-trig-modelling")
qp("Trigonometry", 2, ["Small Angle Approximation"], "pure/y2-radians")
qp("Trigonometry", 2, ["Trigonometric Identities"], "pure/y2-trig-functions")
qp("Exponentials-and-Logarithms", 1, ["Exponential Equations", "Laws of Logarithms"], "pure/y1-exponentials-logs")
qp("Differentiation", 1, ["Basic Differentiation", "Differentiation from First Principles", "Stationary Points", "Tangents and Normals"], "pure/y1-differentiation")
qp("Differentiation", 2, ["Chain Rule", "Implicit Differentiation", "Parametric Differentiation", "Products and Quotients", "Rates of Change"], "pure/y2-differentiation")
qp("Integration", 1, ["Basic Integration", "Definite Integration", "Finding Area using Integration"], "pure/y1-integration")
qp("Integration", 2, ["Definite Integration", "Finding Area using Integration", "Integration by Parts", "Integration by Substitution",
                      "Parametric Integration", "Solving Differential Equations", "Trapezium Rule"], "pure/y2-integration")
qp("Numerical-Methods", 2, ["Iterative Equations", "Location of Roots", "Newton Raphson"], "pure/y2-numerical-methods")
qp("Vectors", 1, ["Vectors"], "pure/y1-vectors")
qp("Vectors", 2, ["Vectors"], "pure/y2-vectors")
qp("Statistical-Sampling", 1, ["Sampling"], "stats/y1-data-collection")
qp("Statistical-Sampling", 2, ["Sampling"], "skip")
qp("Data-Presentation-and-Interpretation", 1, ["Data Presentation and Interpretation"], ["stats/y1-location-spread", "stats/y1-representations"])
qp("Data-Presentation-and-Interpretation", 1, ["Large data sets"], "stats/y1-data-collection")
qp("Data-Presentation-and-Interpretation", 1, ["Regression and Correlation"], "stats/y1-correlation")
qp("Data-Presentation-and-Interpretation", 2, ["Data Presentation and Interpretation", "Large data sets"], "skip")
qp("Data-Presentation-and-Interpretation", 2, ["Regression and Correlation"], "stats/y2-regression-correlation")
qp("Probability", 1, ["Probability"], "stats/y1-probability")
qp("Probability", 2, ["Conditional Probability"], "stats/y2-conditional-probability")
qp("Probability", 2, ["Probability"], "skip")
qp("Statistical-Distributions", 1, ["Discrete Distributions - Binomial"], "stats/y1-distributions")
qp("Statistical-Distributions", 2, ["Discrete Distributions - Binomial"], "skip")
qp("Statistical-Distributions", 2, ["Normal Distribution"], "stats/y2-normal-distribution")
qp("Hypothesis-Testing", 1, ["Hypothesis Testing - Tests on Binomial"], "stats/y1-hypothesis-testing")
qp("Hypothesis-Testing", 2, ["Hypothesis Testing - Regression"], "stats/y2-regression-correlation")
qp("Hypothesis-Testing", 2, ["Hypothesis Testing - Tests on Binomial"], "skip")
qp("Hypothesis-Testing", 2, ["Hypothesis Testing - Tests on Normal"], "stats/y2-normal-distribution")
qp("Kinematics", 1, ["Kinematics - Problems in Calculus"], "mech/y1-variable-acceleration")
qp("Kinematics", 1, ["Kinematics - Uniform Acceleration Formulae", "Kinematics - by Graphical Methods"], "mech/y1-constant-acceleration")
qp("Kinematics", 2, ["Kinematics - Problems in Calculus"], "mech/y2-further-kinematics")
qp("Kinematics", 2, ["Kinematics - Projectiles"], "mech/y2-projectiles")
qp("Kinematics", 2, ["Kinematics - Uniform Acceleration Formulae", "Kinematics - by Graphical Methods"], "skip")
qp("Forces-and-Newtons-Laws", 1, ["Forces and Newton's Laws of Motion"], "mech/y1-forces-motion")
qp("Forces-and-Newtons-Laws", 2, ["Dynamics - Connected Particles", "Statics"], "mech/y2-applications-forces")
qp("Forces-and-Newtons-Laws", 2, ["Dynamics - F = ma on a slope"], "mech/y2-forces-friction")
qp("Forces-and-Newtons-Laws", 2, ["Forces and Newton's Laws of Motion"], "skip")
qp("Moments", 2, ["Moments"], "mech/y2-moments")

for href, text in anchors("*a_level_edexcel_*", BASE):
    m = re.search(r"/download/Maths/A-level/(Pure|Statistics|Mechanics)/([A-Za-z-]+)-(\d)/", href)
    if not m:
        continue
    area, folder, year = AREA[m.group(1)], m.group(2), int(m.group(3))
    if "Cheat-Sheets-Edexcel" in href:
        c = re.match(r"Ch\.(\d+)\s+(.+)", text)
        if not c:
            continue
        pool = course_units("maths", area, year)
        idx = int(c.group(1)) - CH_OFFSET.get((area, year), 1)
        if not 0 <= idx < len(pool):
            report.append(f"PMT sheet has no unit: {text}")
            continue
        ukey = pool[idx]
        if sim(units[ukey]["name"], c.group(2)) < 0.5:
            report.append(f"PMT sheet name check: {text} -> {units[ukey]['name']}")
        add(R_units, ukey, "PMT", f"Summary sheet: {c.group(2)}", href, "notes")
    elif "/Edexcel-Set-C/QP/" in href:
        name = re.sub(r"\s*QP$", "", text)
        target = QP.get((folder, year, name))
        if target is None:
            report.append(f"PMT question paper unmapped: {folder}-{year} {name}")
            continue
        if target == "skip":
            continue
        for t in [target] if isinstance(target, str) else target:
            add(R_units, f"maths/{t}", "PMT", f"Exam questions: {name}", href, "questions")
            add(R_units, f"maths/{t}", "PMT", f"Mark scheme: {name}", href.replace("/QP/", "/MS/").replace(" QP.pdf", " MS.pdf"), "answers")

# ---------------- PMT Further Maths (Core Pure 1/2, FM1) ----------------
for href, text in anchors("*further_core_pure_*", BASE) + anchors("*further_mechanics_*", BASE):
    m = re.search(r"/Further/(?:Core-Pure|Mechanics)/Edexcel/(CP1|CP2|FM1)/(Cheat-Sheets|Topic-Qs)/", href)
    c = re.match(r"Ch\.(\d+)\s+(.+)", text)
    if not (m and c):
        continue
    pool = course_units("further", m.group(1).lower())
    ukey = max(pool, key=lambda k: sim(units[k]["name"], c.group(2)))
    if sim(units[ukey]["name"], c.group(2)) < 0.6:
        report.append(f"PMT further unmatched: {m.group(1)} {text} (best: {units[ukey]['name']})")
        continue
    if m.group(2) == "Cheat-Sheets":
        add(R_units, ukey, "PMT", f"Summary sheet: {c.group(2)}", href, "notes")
    else:
        add(R_units, ukey, "PMT", f"Topic questions: {c.group(2)}", href, "questions")

# ---------------- PMT Decision 1 (older spec, still useful) ----------------
for href, text in anchors("*a_level_decision_1_*", BASE):
    if "Edexcel%20D1%20Revision%20Sheets" in href or "Edexcel%20D1%20Glossary" in href:
        label = "Revision sheets (older D1 spec)" if "Revision" in href else "Glossary (older D1 spec)"
        for k in course_units("further", "d1"):
            add(R_units, k, "PMT", label, href, "notes")

# ---------------- PMT OCR A Physics ----------------
PAG_UNITS = course_units("physics", "pag")


def section_unit(module, section):
    return next((k for k in course_units("physics", f"m{module}") if units[k]["id"].startswith(f"{module}-{section}-")), None)


PHYS = []
for _mod in range(1, 7):  # flashcard links are relative to each module page, so resolve against it
    PHYS += anchors(f"*a_level_ocr_a_module_{_mod}_*", f"https://www.physicsandmathstutor.com/physics-revision/a-level-ocr-a/module-{_mod}/")
for href, text in PHYS:
    t = text.replace("\u2019", "'")
    pag = re.match(r"PAG (\d+)\.\d+\s*-?\s*(.+)", t)
    if pag and ("/1-Practical-Skills-in-Physics/" in href or href.endswith("-flashcards/")):
        n = int(pag.group(1))
        tkey = next((tk for k in PAG_UNITS for tk, name in units[k]["topics"] if name.startswith(f"PAG {n} ")), None)
        if tkey:
            notes = "/Notes/" in href
            add(R_topics, tkey, "PMT", ("Practical notes: " if notes else "Flashcards: ") + t, href, "notes" if notes else "flashcards")
        else:
            report.append(f"PAG unmapped: {t}")
        continue
    sec = re.match(r"(\d)\.(\d)\.?\s+(.+)", t)
    if sec and "/Notes/OCR-A/" in href and "/Detailed/" in href:
        k = section_unit(sec.group(1), sec.group(2))
        if k:
            add(R_units, k, "PMT", f"Detailed notes: {sec.group(3)}", href, "notes")
    elif sec and href.endswith("-flashcards/"):
        k = section_unit(sec.group(1), sec.group(2))
        if k:
            add(R_units, k, "PMT", f"Flashcards: {sec.group(3)}", href, "flashcards")
    elif sec and "/Topic-Qs/OCR-A/" in href and "/Set-O/" in href and t.endswith(" QP"):
        k = section_unit(sec.group(1), sec.group(2))
        name = re.sub(r"\s*QP$", "", sec.group(3))
        if k:
            add(R_units, k, "PMT", f"Exam questions: {name}", href, "questions")
            add(R_units, k, "PMT", f"Mark scheme: {name}", href.replace(" QP.pdf", " MS.pdf"), "answers")
        else:
            report.append(f"Physics question paper unmapped: {t}")
    elif href.endswith("/Definitions.pdf"):
        module = re.search(r"/OCR-A/(\d)-", href).group(1)
        for k in course_units("physics", f"m{module}"):
            add(R_units, k, "PMT", f"Key definitions (Module {module})", href, "notes")
    elif t == "Summary Notes" and "2-Foundations" in href:
        for k in course_units("physics", "m2"):
            add(R_units, k, "PMT", "Summary notes (Module 2)", href, "notes")
    elif t == "Flashcards" and "foundations-of-physics-flashcards" in href:
        for k in course_units("physics", "m2"):
            add(R_units, k, "PMT", "Flashcards (Module 2)", href, "flashcards")
    elif "/1-Practical-Skills-in-Physics/Development of Practical Skills" in href:
        for k in course_units("physics", "m1"):
            add(R_units, k, "PMT", "Notes: Development of practical skills", href, "notes")
    elif t == "Practical Skills and Applications QP":
        for k in course_units("physics", "m1"):
            add(R_units, k, "PMT", "Exam questions: Practical skills", href, "questions")
            add(R_units, k, "PMT", "Mark scheme: Practical skills", href.replace(" QP.pdf", " MS.pdf"), "answers")

# ---------------- check every link ----------------
urls = sorted({x["url"] for bucket in (R_units, R_topics) for items in bucket.values() for x in items})


def check(url):
    for method in ("HEAD", "GET"):
        headers = dict(UA)
        if method == "GET":
            headers["Range"] = "bytes=0-0"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, method=method, headers=headers), timeout=30) as r:
                if r.status in (200, 206):
                    return url, True
        except urllib.error.HTTPError as e:
            if method == "HEAD" and e.code in (403, 405, 429, 500, 501):
                continue
            return url, False
        except Exception:
            if method == "HEAD":
                continue
            return url, False
    return url, False


print(f"checking {len(urls)} links…", flush=True)
with cf.ThreadPoolExecutor(max_workers=8) as pool:
    status = dict(pool.map(check, urls))
bad = [u for u, ok in status.items() if not ok]

for bucket in (R_units, R_topics):
    for key in list(bucket):
        bucket[key] = [x for x in bucket[key] if status.get(x["url"])]
        if not bucket[key]:
            del bucket[key]

ORDER = {"lesson": 0, "notes": 1, "flashcards": 2, "questions": 3, "answers": 4}
for bucket in (R_units, R_topics):
    for items in bucket.values():
        items.sort(key=lambda x: (x["site"] != "Maths Genie", ORDER.get(x["kind"], 9), x["label"]))

out = {
    "_readme": "Generated by build_resources.py. Every link was checked on the date below; links that didn't load were dropped. "
               "Keys are unit keys (subject/course/unit) and topic keys (unit key/topic id), matching the app.",
    "checked": dt.date.today().isoformat(),
    "units": dict(sorted(R_units.items())),
    "topics": dict(sorted(R_topics.items())),
}
(CUR / "resources.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

# ---------------- report ----------------
print(f"links checked: {len(urls)}  ok: {len(urls) - len(bad)}  dropped: {len(bad)}")
for u in bad[:25]:
    print("  DROPPED", u)
for subject in ("maths", "further", "physics"):
    all_units = [k for k in units if k.startswith(subject + "/")]
    all_topics = [tk for k in all_units for tk, _ in units[k]["topics"]]
    print(f"{subject}: units with links {sum(k in R_units for k in all_units)}/{len(all_units)}, "
          f"topics with own links {sum(tk in R_topics for tk in all_topics)}/{len(all_topics)}")
missing = [units[k]["name"] + f" ({k})" for k in units if k not in R_units and not any(tk in R_topics for tk, _ in units[k]["topics"])]
print("units with no checked links:", len(missing))
for m in missing:
    print("  -", m)
print("notes:")
for r in report:
    print("  ", r)
