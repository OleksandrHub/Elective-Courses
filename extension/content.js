// Запускається на сторінках вибіркових дисциплін dl.tntu.edu.ua.
// Додає кнопку «Розумний підбір», відкриває інтерфейс поверх сайту і читає
// дані акаунта (обов’язкові, «Обрані мною») через вашу поточну сесію. Нічого не змінює на сайті.
(() => {
  if (window.__tntuElectives) return;
  window.__tntuElectives = true;

  const clean = s => String(s || "").replace(/\s+/g, " ").trim();

  async function getDoc(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (r.redirected && /login\.php/.test(r.url)) throw new Error("ви не увійшли в акаунт на dl.tntu.edu.ua");
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    const html = await r.text();
    return { html, doc: new DOMParser().parseFromString(html, "text/html") };
  }

  const abs = url => new URL(url, location.origin).href;
  const sidOf = el => el.querySelector('a[href*="sid="]')?.getAttribute("href").match(/sid=([0-9a-fA-F-]+)/)?.[1] || null;

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

  async function loadAccount() {
    const { doc } = await getDoc("/mods/elective_courses/mandatory.php");
    const mandatory = parseMandatory(doc);
    const speciality = clean(doc.body.textContent.match(/для спеціальності\s+([^\n]+)/i)?.[1]).replace(/^(\S+)\s+-\s+/, "$1 ");
    if (!mandatory.length) console.warn("[Вибіркові] не знайшов обов’язкових дисциплін на mandatory.php");
    const warn = (what) => e => { console.warn(`[Вибіркові] ${what}:`, e); return {}; };
    const [sel, int] = await Promise.all([
      loadSelected(doc).catch(warn("«Обрані мною»")),
      loadInterested(doc).catch(warn("«Мене цікавлять»")),
      addControls(mandatory),
    ]);
    return { speciality, mandatory, plan: [], selected: [], selectedTitle: "Обрані мною", recommended: [], interested: [], ...sel, ...int };
  }

  // Gemini: запити йдуть через фоновий воркер, ключ лежить у сховищі розширення (сайт його не бачить)
  const gemini = {
    request: (url, method, body) => chrome.runtime.sendMessage({ type: "gemini-fetch", url, method, body }),
    keyInfo: () => chrome.runtime.sendMessage({ type: "gemini-key-get" }),
    setKey: key => chrome.runtime.sendMessage({ type: "gemini-key-set", key }),
  };

  // ---------- оверлей ----------
  let host = null;
  const prevOverflow = document.documentElement.style.overflow;

  function close() {
    if (!host) return;
    host.style.display = "none";
    document.documentElement.style.overflow = prevOverflow;
    if (location.hash === "#smart") history.replaceState(null, "", location.pathname + location.search);
  }

  async function open() {
    document.documentElement.style.overflow = "hidden";
    if (host) { host.style.display = "block"; return; }
    host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:2147483000;overflow:auto;display:block";
    const shadow = host.attachShadow({ mode: "open" });
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("style.css");
    const app = document.createElement("div");
    app.className = "el-app";
    app.innerHTML = `<div class="loading">Завантажую курси…</div>`;
    shadow.append(link, app);
    document.body.appendChild(host);
    try {
      const data = await fetch(chrome.runtime.getURL("courses.json")).then(r => r.json());
      window.ElectivesApp.mount(app, data, { live: true, loadAccount, close, gemini });
    } catch (e) {
      app.innerHTML = `<div class="loading">Не вдалося завантажити дані: ${e.message}</div>`;
    }
  }

  const btn = document.createElement("button");
  btn.textContent = "🔎 Розумний підбір";
  btn.title = "Підбір вибіркових з фільтрами за кредитами, контролем, роком; з урахуванням ваших обов’язкових";
  btn.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147482999;padding:12px 18px;border:none;border-radius:999px;" +
    "background:#b3261e;color:#fff;font:600 15px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer";
  btn.addEventListener("click", open);
  document.body.appendChild(btn);

  if (location.hash === "#smart") open();
})();
