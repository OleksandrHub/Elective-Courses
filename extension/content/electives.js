// Вкладки «Мене цікавлять та пропозиції кафедри» і «Обрані мною».
(() => {
  const E = (window.TntuEl ||= {});
  const { clean, getDoc, abs, sidOf } = E;

  // Посилання з рядка таблиці: ID у першій клітинці, у onclick або sid силабуса
  function rowRef(tr) {
    const cells = [...tr.cells];
    if (!cells.length) return null;
    const first = clean(cells[0].textContent);
    const oc = tr.innerHTML.match(/electives\w*\(\s*['"]?(\d+)/)?.[1];
    const id = /^\d+$/.test(first) ? +first : oc ? +oc : null;
    const sid = sidOf(tr);
    return id || sid ? { id, sid } : null;
  }

  // Вкладка «Мене цікавлять та пропозиції кафедри»: рекомендовані випусковою кафедрою і «Мене цікавлять»
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

  // Вкладка «Обрані мною»: скільки кредитів лишилось у кожному семестрі і що вже обрано
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
