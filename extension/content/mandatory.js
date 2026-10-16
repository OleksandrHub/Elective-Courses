// Вкладка «Обов’язкові дисципліни» і форма контролю з їхніх силабусів.
(() => {
  const E = (window.TntuEl ||= {});
  const { clean, sidOf } = E;

  // Таблиця на «Обов’язкові дисципліни»: рядки-заголовки «N-й семестр» і рядки курсів (ID, назва, кредити, …)
  function parseMandatory(doc) {
    const out = [];
    let sem = null;
    doc.querySelectorAll("tr").forEach(tr => {
      const cells = [...tr.cells];
      const txt = clean(tr.textContent);
      const m = txt.match(/^(\d+)\s*-?\s*[ийі]?й?\s*семестр/i);
      if (m && cells.length <= 2) { sem = +m[1]; return; }
      const id = clean(cells[0]?.textContent);
      if (cells.length >= 3 && /^\d+$/.test(id)) {
        out.push({ id: +id, name: clean(cells[1].textContent), sid: sidOf(tr),
          credits: parseFloat(clean(cells[2].textContent).replace(",", ".")) || null, semester: sem });
      }
    });
    return out;
  }

  // Форма контролю й курсова з силабуса (кешується, бо силабуси змінюються рідко)
  async function syllabusInfo(sid) {
    const key = "tntuel_syl_" + sid;
    try { const c = JSON.parse(localStorage.getItem(key)); if (c) return c; } catch {}
    const s = await fetch(`/mods/syllabus/view.php?json=1&sid=${sid}`, { credentials: "same-origin" }).then(r => r.json());
    const pd = Array.isArray(s.points_distribution) ? s.points_distribution : [];
    const info = {
      sems: pd.map(x => ({ semester: +x.semester || 0, control: x.final_assessment_type || "exam" })).sort((a, b) => a.semester - b.semester),
      termpaper: s.termpaper__enable === true || s.termpaper__enable === "1" || s.termpaper__enable === "true",
    };
    try { localStorage.setItem(key, JSON.stringify(info)); } catch {}
    return info;
  }

  async function addControls(mandatory) {
    const groups = new Map();
    mandatory.forEach(m => groups.has(m.id) ? groups.get(m.id).push(m) : groups.set(m.id, [m]));
    const queue = [...groups.values()].filter(rows => rows[0].sid);
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const rows = queue.shift().sort((a, b) => (a.semester || 0) - (b.semester || 0));
        try {
          const info = await syllabusInfo(rows[0].sid);
          rows.forEach((row, i) => {
            let ctl = info.sems.find(x => x.semester === row.semester)?.control;
            if (!ctl && info.sems.length === rows.length) ctl = info.sems[i].control;
            if (!ctl && info.sems.length === 1) ctl = info.sems[0].control;
            row.control = ctl || null;
          });
          rows[rows.length - 1].termpaper = info.termpaper;
        } catch (e) { console.warn("[Вибіркові] силабус", rows[0].name, e); }
      }
    }));
  }

  Object.assign(E, { parseMandatory, addControls });
})();
