/**
 * @file Reads two elective-course tabs: "Interested & department suggestions"
 * (interested.php) and "Selected by me" (selected.php). Both pages load their
 * lists through AJAX fragments, which are fetched here as well. Runs in the
 * user's session and only reads; nothing on the site is modified.
 *
 * Exports on `window.TntuEl`: `loadInterested`, `loadSelected`.
 */
(() => {
  const E = (window.TntuEl ||= {});
  const { clean, getDoc, abs, sidOf } = E;

  /**
   * Extract a course reference from a table row. The id is taken from a purely
   * numeric first cell, otherwise from the first numeric argument of an
   * `electives*(...)` call in the row's markup (e.g. onclick); the syllabus id
   * comes from a `sid=` link.
   * @param {HTMLTableRowElement} tr Table row.
   * @returns {?CourseRef} Reference, or null if neither id nor sid was found.
   */
  function rowRef(tr) {
    const cells = [...tr.cells];
    if (!cells.length) return null;
    const first = clean(cells[0].textContent);
    const oc = tr.innerHTML.match(/electives\w*\(\s*['"]?(\d+)/)?.[1];
    const id = /^\d+$/.test(first) ? +first : oc ? +oc : null;
    const sid = sidOf(tr);
    return id || sid ? { id, sid } : null;
  }

  /**
   * Read the "Interested & department suggestions" tab. The tab URL is taken
   * from the matching link on mandatory.php (falls back to interested.php); the
   * list fragment URL from `electivesInitInterestedList(...)` is fetched with
   * `fetch-interested=1` and appended to the page HTML. Headings, captions,
   * panel titles and rows are then walked in document order: a short heading
   * containing "рекомендован" starts the department-recommended section, one
   * containing "цікав" starts the "I'm interested" section, and course rows
   * are assigned to the current section (rows before any section are ignored).
   * @param {Document} mandatoryDoc Parsed mandatory.php page (used to find the tab link).
   * @returns {Promise<{recommended: CourseRef[], interested: CourseRef[]}>}
   */
  async function loadInterested(mandatoryDoc) {
    const link = [...mandatoryDoc.querySelectorAll("a")].find(a => /Мене цікав/i.test(a.textContent));
    const { html } = await getDoc(abs(link?.getAttribute("href") || "/mods/elective_courses/interested.php"));
    const src = html.match(/electivesInitInterestedList\([^,]+,\s*["'`]([^"'`]+)["'`]/)?.[1];
    let full = html;
    if (src) {
      const r = await fetch(src + "&" + new URLSearchParams({ "fetch-interested": 1 }), { credentials: "same-origin" });
      if (r.ok) full += "\n" + await r.text();
    }
    const doc = new DOMParser().parseFromString(full, "text/html");
    const recommended = [], interested = [];
    let section = null;
    doc.querySelectorAll("h1,h2,h3,h4,h5,h6,caption,legend,.panel-title,.panel-heading,.card-header,tr").forEach(el => {
      const ref = el.tagName === "TR" ? rowRef(el) : null;
      if (ref) { if (section) (section === "rec" ? recommended : interested).push(ref); return; }
      const txt = clean(el.textContent);
      if (txt.length > 200) return;
      if (/рекомендован/i.test(txt)) section = "rec";
      else if (/цікав/i.test(txt)) section = "int";
    });
    return { recommended, interested };
  }

  /**
   * Read the "Selected by me" tab: credits still to choose per semester and
   * the electives already selected. The page lists one block per semester
   * (`[data-type="electives__selected_list"]` with `data-sid`); each block's
   * fragment is fetched sequentially from the `electivesInitSelectedList(...)`
   * URL with `fetch-selected=1&sid=<sid>`. In the combined HTML:
   * - `electivesAddToSelectedModal(<x>, <semester>, <creditsLeft>)` calls give
   *   the remaining credits per semester (last occurrence wins);
   * - `electivesRemoveSelectedItem(<courseId>, <x>, <semester>)` calls give the
   *   selected courses.
   * @param {Document} mandatoryDoc Parsed mandatory.php page (used to find the tab link and its title).
   * @returns {Promise<{selectedTitle: string, plan: {num: number, left: number}[], selected: {id: number, semester: number}[]}>}
   *   Tab title as shown on the site, remaining credits sorted by semester, and selected courses.
   */
  async function loadSelected(mandatoryDoc) {
    const link = [...mandatoryDoc.querySelectorAll("a")].find(a => /Обрані мною/i.test(a.textContent));
    const title = link ? clean(link.textContent) : "Обрані мною";
    const url = link?.getAttribute("href") || "/mods/elective_courses/selected.php";
    const { html, doc } = await getDoc(abs(url));

    const src = html.match(/electivesInitSelectedList\([^,]+,\s*["'`]([^"'`]+)["'`]/)?.[1] || "/mods/elective_courses/selected.php?";
    const sids = [...doc.querySelectorAll('[data-type="electives__selected_list"]')].map(el => el.dataset.sid).filter(Boolean);
    let body = html;
    for (const sid of sids) {
      const r = await fetch(src + "&" + new URLSearchParams({ "fetch-selected": 1, sid }), { credentials: "same-origin" });
      if (r.ok) body += "\n" + await r.text();
    }

    const plan = new Map();
    for (const m of body.matchAll(/electivesAddToSelectedModal\(\s*['"]?[^,'"]*['"]?\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]?(-?[\d.,]+)['"]?\s*\)/g))
      plan.set(+m[1], parseFloat(m[2].replace(",", ".")));
    const selected = [];
    for (const m of body.matchAll(/electivesRemoveSelectedItem\(\s*['"]?(\d+)['"]?\s*,\s*['"]?[^,'"]*['"]?\s*,\s*['"]?(\d+)['"]?\s*\)/g))
      selected.push({ id: +m[1], semester: +m[2] });
    return {
      selectedTitle: title,
      plan: [...plan].sort((a, b) => a[0] - b[0]).map(([num, left]) => ({ num, left })),
      selected,
    };
  }

  Object.assign(E, { loadInterested, loadSelected });
})();
