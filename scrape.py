#!/usr/bin/env python3
"""Збирає всі вибіркові дисципліни ТНТУ разом з даними із силабусів.

Результат: courses.json і data.js (для index.html).
Запуск: python3 scrape.py
"""
import html as htmllib
import json
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE = "https://dl.tntu.edu.ua"
LIST_URL = BASE + "/mods/elective_courses/all.php?&l=any&department=-1&major=0&degree=all&semester=all&search=&fetch-all=1&p={}"
SYL_URL = BASE + "/mods/syllabus/view.php?json=1&sid={}"
OUT = Path(__file__).resolve().parent
CACHE = OUT / "cache"


def get(url, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 electives-helper"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode("utf-8")
        except Exception as e:
            if i == retries - 1:
                raise
            time.sleep(2 * (i + 1))


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


def fetch_list():
    first = json.loads(get(LIST_URL.format(1)))
    total = first["num_total"]
    pages = max(int(p) for p in re.findall(r"p=(\d+)", first["html"]) or ["1"])
    rows = parse_rows(first["html"])
    for p in range(2, pages + 1):
        rows += parse_rows(json.loads(get(LIST_URL.format(p)))["html"])
        print(f"  сторінка {p}/{pages}", file=sys.stderr)
    print(f"Курсів у списку: {len(rows)} (сайт каже {total})", file=sys.stderr)
    return rows


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
    """Назви кафедр і спеціальностей із фільтрів сторінки."""
    page = get(BASE + "/mods/elective_courses/all.php")
    def opts(name):
        m = re.search(r'<select name="%s".*?</select>' % name, page, re.S)
        return {int(v): text(t) for v, t in re.findall(r'<option value="(\d+)"[^>]*>(.*?)</option>', m.group(0))} if m else {}
    return {"departments": opts("department"), "majors": opts("major")}


def main():
    rows = fetch_list()
    sids = [r["sid"] for r in rows if r["sid"]]
    print(f"Завантажую {len(sids)} силабусів…", file=sys.stderr)
    with ThreadPoolExecutor(max_workers=6) as ex:
        syl = dict(zip(sids, ex.map(fetch_syllabus, sids)))
    courses = [enrich(r, syl.get(r["sid"])) for r in rows]
    data = {"fetched": time.strftime("%Y-%m-%d %H:%M"), "options": fetch_options(), "courses": courses}
    (OUT / "courses.json").write_text(json.dumps(data, ensure_ascii=False, indent=1))
    (OUT / "data.js").write_text("window.ELECTIVES = " + json.dumps(data, ensure_ascii=False) + ";\n")
    print(f"Готово: {len(courses)} курсів → courses.json, data.js", file=sys.stderr)


if __name__ == "__main__":
    main()
