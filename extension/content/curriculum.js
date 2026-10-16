// «Індивідуальний навчальний план»: усі семестри, дисципліни, контроль, оцінки, практика.
(() => {
  const E = (window.TntuEl ||= {});
  const { clean, getDoc } = E;

  // «Індивідуальний навчальний план»: фрагмент index.php?fetch=true, семестри перемикаються через req=<студент>:<семестр>
  const CONTROL_TEXT = [[/^екз/i, "exam"], [/^диф/i, "diff_credit"], [/^зал/i, "credit"], [/^кр$/i, "cw"], [/^кп$/i, "cp"]];
  const toControl = t => (CONTROL_TEXT.find(([re]) => re.test(clean(t))) || [null, clean(t) || null])[1];
  const toNum = t => { const v = parseFloat(clean(t).replace(",", ".")); return Number.isFinite(v) ? v : null; };

  function parseCurriculum(doc) {
    const info = [...doc.querySelectorAll(".curriculum-info p")].map(p => clean(p.textContent));
    const student = {
      courseYear: +(info.find(t => /\d+\s*курс/.test(t))?.match(/(\d+)\s*курс/)?.[1]) || null,
      group: info.find(t => /груп/i.test(t))?.match(/група\s+(\S+)/i)?.[1] || "",
      level: info.find(t => /Освітній рівень/i.test(t))?.replace(/.*:\s*/, "") || "",
      speciality: info.find(t => /Спеціальність/i.test(t))?.replace(/.*:\s*/, "") || "",
      planName: clean(doc.querySelector(".curriculum-label")?.textContent).match(/Назва навчального плану:\s*([^)]+)/)?.[1] || "",
    };
    const sem = { num: null, total: null, mandatoryCredits: null, electiveCredits: null, rows: [], practice: [] };
    let kind = "mand";
    doc.querySelectorAll(".curriculum-subjects-table tbody tr").forEach(tr => {
      const cells = [...tr.cells];
      const txt = clean(tr.textContent);
      if (cells.length === 1) {
        const m = txt.match(/(\d+)\s*семестр\s*\S\s*([\d.,]+)\s*кредит/i);
        if (m) { sem.num = +m[1]; sem.total = toNum(m[2]); }
        else if (/^Обов/i.test(txt)) { kind = "mand"; sem.mandatoryCredits = toNum(txt.match(/([\d.,]+)\s*кредит/)?.[1] || ""); }
        else if (/^Вибірков/i.test(txt)) { kind = "elec"; sem.electiveCredits = toNum(txt.match(/([\d.,]+)\s*кредит/)?.[1] || ""); }
        return;
      }
      if (cells.length < 8) return;
      const nameCell = cells[1].cloneNode(true);
      nameCell.querySelectorAll(".call-to-enroll-btn").forEach(a => a.remove());
      const ids = [...new Set([...cells[1].textContent.matchAll(/ID\s*(\d+)/g)].map(m => +m[1]))];
      const [hours, credits] = clean(cells[2].textContent).split("/").map(toNum);
      sem.rows.push({
        kind, ids, name: clean(nameCell.textContent).replace(/\(?\s*(ID\s*\d+\s*)+\)?/g, "").trim(),
        hours, credits, lec: toNum(cells[3].textContent), pr: toNum(cells[4].textContent), lab: toNum(cells[5].textContent),
        self: toNum(cells[6].textContent), control: toControl(cells[7].textContent),
        grade: { zvo: clean(cells[8]?.textContent), nat: clean(cells[9]?.textContent), ects: clean(cells[10]?.textContent) },
      });
    });
    doc.querySelectorAll(".curriculum-practica-table tbody tr").forEach(tr => {
      const c = [...tr.cells];
      if (c.length < 3) return;
      sem.practice.push({ name: clean(c[0].textContent), term: clean(c[1].textContent), credits: toNum(c[2].textContent),
        grade: { zvo: clean(c[3]?.textContent), nat: clean(c[4]?.textContent), ects: clean(c[5]?.textContent) } });
    });
    const navs = [...doc.querySelectorAll(".curriculum-nav a[onclick]")].map(a => ({
      req: a.getAttribute("onclick").match(/sem_switch_handler\(\s*event\s*,\s*['"]([^'"]+)['"]/)?.[1],
      num: +clean(a.textContent).match(/^\d+/)?.[0], current: a.closest("li")?.classList.contains("active"),
    })).filter(n => n.req && n.num);
    return { student, sem, navs };
  }

  async function loadCurriculum() {
    const url = "/mods/curriculum/index.php?fetch=true";
    const first = parseCurriculum((await getDoc(url)).doc);
    const current = first.navs.find(n => n.current)?.num || first.sem.num;
    const semesters = new Map(first.sem.num ? [[first.sem.num, first.sem]] : []);
    const queue = first.navs.filter(n => !semesters.has(n.num));
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (queue.length) {
        const n = queue.shift();
        try {
          const { sem } = parseCurriculum((await getDoc(url + "&req=" + encodeURIComponent(n.req))).doc);
          semesters.set(sem.num || n.num, { ...sem, num: sem.num || n.num });
        } catch (e) { console.warn("[Вибіркові] навчальний план, семестр", n.num, e); }
      }
    }));
    return { student: first.student, current, semesters: [...semesters.values()].sort((a, b) => a.num - b.num) };
  }

  Object.assign(E, { loadCurriculum });
})();
