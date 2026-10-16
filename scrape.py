#!/usr/bin/env python3
"""Збирає всі вибіркові дисципліни ТНТУ разом з даними із силабусів.

Результат: extension/courses.json (для розширення) і extension/data.js (для index.html).
Стандартні фільтри сайту (мова, підрозділ, спеціальність, ступінь, семестр) знімаються
запитами до самого сайту, тож працюють так само, як там.
Запуск: python3 scrape.py
"""
import html as htmllib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE = "https://dl.tntu.edu.ua"
LIST_PARAMS = {"l": "any", "department": "-1", "major": "0", "degree": "all", "semester": "all", "search": ""}
SYL_URL = BASE + "/mods/syllabus/view.php?json=1&sid={}"
ROOT = Path(__file__).resolve().parent
OUT = ROOT / "extension"
CACHE = ROOT / "cache"


def get(url, retries=6):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 electives-helper"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode("utf-8")
        except Exception as e:
            if i == retries - 1:
                raise
            time.sleep(3 * (i + 1))


def text(s):
    return re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


ROW_RE = re.compile(r"<tr>(.*?)</tr>", re.S)
TD_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S)


def parse_rows(page_html):
    rows = []
    for tr in ROW_RE.findall(page_html):
        tds = TD_RE.findall(tr)
        if len(tds) < 6:
            continue
        sid = re.search(r"sid=([0-9a-fA-F-]+)", tr)
        cv = re.search(r"href=\"?([^\" >]+cv/view\.php[^\" >]*)", tds[4])
        lect = re.search(r"<a[^>]*>(.*?)</a>", tds[4], re.S)
        row = {
            "id": int(text(tds[0])),
            "name": text(tds[1]),
            "credit_options": sorted({float(x) for x in re.findall(r"\d+(?:[.,]\d+)?", text(tds[2]).replace(",", "."))}),
            "rating": num(text(tds[3])) or 0,
            "lecturer": text(lect.group(1)) if lect else text(tds[4]),
            "lecturer_degree": text(tds[4].split("<br")[0]) if "<br" in tds[4] else "",
            "cv": cv.group(1) if cv else None,
            "sid": sid.group(1) if sid else None,
        }
        row["credits"] = row["credit_options"][0] if row["credit_options"] else 0
        rows.append(row)
    return rows


def list_url(page, **filters):
    params = {**LIST_PARAMS, **filters, "fetch-all": 1, "p": page}
    return BASE + "/mods/elective_courses/all.php?&" + urllib.parse.urlencode(params)


def fetch_list(**filters):
    """Усі рядки списку з урахуванням фільтрів сайту."""
    first = json.loads(get(list_url(1, **filters)))
    pages = max([int(p) for p in re.findall(r"p=(\d+)", first["html"])] or [1])
    rows = parse_rows(first["html"])
    for p in range(2, pages + 1):
        rows += parse_rows(json.loads(get(list_url(p, **filters)))["html"])
    return rows, first["num_total"]


def filter_ids(param, value):
    """ID курсів, які сайт показує для одного значення фільтра (з кешем)."""
    f = CACHE / "filters" / f"{param}={value}.json"
    if f.exists():
        return json.loads(f.read_text())
    rows, _ = fetch_list(**{param: value})
    ids = [r["id"] for r in rows]
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(ids))
    return ids


def fetch_syllabus(sid):
    CACHE.mkdir(exist_ok=True)
    f = CACHE / f"{sid}.json"
    if f.exists():
        return json.loads(f.read_text())
    try:
        raw = get(SYL_URL.format(sid))
        data = json.loads(raw)
    except Exception as e:
        print(f"  ! {sid}: {e}", file=sys.stderr)
        return None
    f.write_text(json.dumps(data, ensure_ascii=False))
    return data


def num(v):
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return None


def enrich(row, s):
    if not s or not isinstance(s, dict):
        return row
    pd = s.get("points_distribution") if isinstance(s.get("points_distribution"), list) else []
    sems = []
    for x in pd:
        if isinstance(x, dict):
            sems.append({"semester": int(num(x.get("semester")) or 0),
                         "control": x.get("final_assessment_type") or "exam"})
    sem = int(num(s.get("general_info__course_semesters__semester")) or 0)
    if not sems and sem:
        sems = [{"semester": sem, "control": "exam"}]
    specs = []
    for sp in s.get("head__speciality") or []:
        if isinstance(sp, dict) and sp.get("speciality_id"):
            specs.append(int(sp["speciality_id"]))
    row.update({
        "year": int(num(s.get("general_info__course_semesters__year")) or 0) or None,
        "semester": sem or None,
        "semesters": sems,
        "controls": sorted({x["control"] for x in sems}),
        "kind": s.get("general_info__course_semesters__type"),
        "lang": s.get("head__laguage"),
        "faculty": int(num(s.get("head__faculty")) or 0) or None,
        "department": int(num(s.get("head__department")) or 0) or None,
        "specialities": specs,
        "program_type": (s.get("head__edu_program_type") or [None])[0] if isinstance(s.get("head__edu_program_type"), list) else s.get("head__edu_program_type"),
        "hours": {k: num(s.get("general_info__course_hours__" + k)) for k in ("lections", "practical", "lab", "individual")},
        "syl_credits": num(s.get("general_info__course_hours__credits")),
        "termpaper": bool(s.get("termpaper__enable")) and s.get("termpaper__enable") not in ("0", "false", "False"),
        "objective": text(str(s.get("general_info__course_objective") or ""))[:600],
        "prerequisites": text(str(s.get("general_info__course_prerequisites") or ""))[:300],
    })
    return row


def fetch_options():
    """Значення стандартних фільтрів сайту, з тією ж структурою, що й там."""
    page = get(BASE + "/mods/elective_courses/all.php")

    def select(name):
        m = re.search(r'<select name="%s".*?</select>' % name, page, re.S)
        return m.group(0) if m else ""

    departments = []
    for v, t in re.findall(r'<option value="(\d+)"[^>]*>(.*?)</option>', select("department")):
        departments.append({"id": int(v), "name": text(t), "sub": t.startswith("&nbsp;")})
    majors = []
    for label, body in re.findall(r'<optgroup label="([^"]*)">(.*?)</optgroup>', select("major"), re.S):
        items = [{"id": int(v), "name": text(t)} for v, t in re.findall(r'<option value="(\d+)"[^>]*>(.*?)</option>', body)]
        majors.append({"label": htmllib.unescape(label), "items": items})
    return {"departments": departments, "majors": majors}


def site_filters(options):
    """Для кожного курсу: за яких значень стандартних фільтрів сайт його показує."""
    jobs = [("l", "uk"), ("l", "en"), ("degree", "bachelor"), ("degree", "master"), ("degree", "phd"),
            ("semester", "fall"), ("semester", "spring")]
    jobs += [("department", d["id"]) for d in options["departments"]]
    jobs += [("major", m["id"]) for g in options["majors"] for m in g["items"]]
    print(f"Знімаю стандартні фільтри сайту ({len(jobs)} значень)…", file=sys.stderr)
    with ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(lambda j: filter_ids(*j), jobs))
    key = {"l": "site_lang", "degree": "degrees", "semester": "site_sems", "department": "deps", "major": "majors"}
    per_course = {}
    for (param, value), ids in zip(jobs, results):
        for cid in ids:
            per_course.setdefault(cid, {}).setdefault(key[param], []).append(value)
    return per_course


def main():
    rows, total = fetch_list()
    print(f"Курсів у списку: {len(rows)} (сайт каже {total})", file=sys.stderr)
    sids = [r["sid"] for r in rows if r["sid"]]
    print(f"Завантажую {len(sids)} силабусів…", file=sys.stderr)
    with ThreadPoolExecutor(max_workers=6) as ex:
        syl = dict(zip(sids, ex.map(fetch_syllabus, sids)))
    courses = [enrich(r, syl.get(r["sid"])) for r in rows]
    options = fetch_options()
    sf = site_filters(options)
    for c in courses:
        c.update({"site_lang": [], "degrees": [], "site_sems": [], "deps": [], "majors": [], **sf.get(c["id"], {})})
    data = {"fetched": time.strftime("%Y-%m-%d %H:%M"), "options": options, "courses": courses}
    OUT.mkdir(exist_ok=True)
    (OUT / "courses.json").write_text(json.dumps(data, ensure_ascii=False))
    (OUT / "data.js").write_text("window.ELECTIVES = " + json.dumps(data, ensure_ascii=False) + ";\n")
    print(f"Готово: {len(courses)} курсів → extension/courses.json, extension/data.js", file=sys.stderr)


if __name__ == "__main__":
    main()
