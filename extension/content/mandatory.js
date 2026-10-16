/**
 * @file Reads the "Mandatory courses" tab (/mods/elective_courses/mandatory.php)
 * and enriches each course with its form of control and term-paper flag taken
 * from the course syllabus (/mods/syllabus/view.php?json=1). Runs in the user's
 * session and only reads; nothing on the site is modified.
 *
 * Exports on `window.TntuEl`: `parseMandatory`, `addControls`.
 */
(() => {
  const E = (window.TntuEl ||= {});
  const { clean, sidOf } = E;

  /**
   * Parse the mandatory-courses table. Single/two-cell rows like "N-й семестр"
   * set the current semester; rows with a numeric first cell and at least three
   * cells are courses (ID, name, credits, ...).
   * @param {Document} doc Parsed mandatory.php page.
   * @returns {MandatoryCourse[]} Courses in page order; `control` and `termpaper`
   *   are not set yet (see {@link addControls}). A course spanning several
   *   semesters appears once per semester with the same id.
   */
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

  /**
   * Load per-semester forms of control and the term-paper flag from a syllabus.
   * The result is cached in the site's localStorage under `tntuel_syl_<sid>`
   * (syllabi rarely change), so each syllabus is fetched only once per browser.
   * @param {string} sid Syllabus id.
   * @returns {Promise<SyllabusInfo>} Parsed (or cached) syllabus info.
   */
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

  /**
   * Fill `control` (and `termpaper`) on mandatory courses in place using their syllabi.
   * Rows are grouped by course id and sorted by semester; each row then gets
   * the syllabus entry with the same semester number, or, failing that, the
   * entry at the same position when the syllabus lists as many semesters as
   * there are rows, or the only entry when the syllabus has just one. The
   * term-paper flag is put on the last semester's row only. Up to 4 syllabi
   * are fetched concurrently; failures are logged and leave `control` unset.
   * @param {MandatoryCourse[]} mandatory Courses from {@link parseMandatory}; mutated.
   * @returns {Promise<void>}
   */
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
