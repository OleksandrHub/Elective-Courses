// Інтерфейс підбору вибіркових дисциплін.
// Працює і як окрема сторінка (index.html), і всередині сайту через розширення (content.js).
// ElectivesApp.mount(element, data, env)
//   env.live         — запущено на dl.tntu.edu.ua під акаунтом
//   env.loadAccount  — async () => {speciality, mandatory[], plan[], selected[], selectedTitle, recommended[], interested[]}
//   env.close        — закрити оверлей
(function () {
  const CONTROL = { exam: "екзамен", credit: "залік", diff_credit: "диф. залік", none: "без контролю" };
  const CONTROL_SHORT = { exam: "Екз", credit: "Зал", diff_credit: "Диф", none: "—" };
  const LANG = { uk: "українська", en: "англійська" };
  const KIND = { elective: "вибіркова", mandatory: "обов’язкова для своєї ОП (для інших — вибіркова)" };
  const DEGREE = { bachelor: "Бакалавр", master: "Магістр", phd: "Доктор філософії" };
  const SEM = { fall: "Осінній", spring: "Весняний" };
  const PAGE = 60;

  const norm = s => String(s || "").toLowerCase().replace(/[’'ʼ`"«»]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const tokens = s => new Set(norm(s).split(" ").filter(w => w.length > 2));
  const esc = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const fmt = n => String(Math.round(n * 100) / 100);
  const ctlClass = k => k === "exam" ? "exam" : k ? "zalik" : "";
  function similarity(a, b) {
    const A = tokens(a), B = tokens(b);
    if (!A.size || !B.size) return 0;
    let inter = 0; A.forEach(t => B.has(t) && inter++);
    return inter / Math.min(A.size, B.size);
  }
  function makeStore(prefix) {
    return {
      get(k, d) { try { const v = localStorage.getItem(prefix + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
      set(k, v) { try { localStorage.setItem(prefix + k, JSON.stringify(v)); } catch {} },
    };
  }

  function mount(root, D, env = {}) {
    root.classList.add("el-app");
    const $ = s => root.querySelector(s);
    const store = makeStore("tntuel_");
    const COURSES = D.courses;
    const BY_ID = new Map(COURSES.map(c => [c.id, c]));
    const BY_SID = new Map(COURSES.map(c => [c.sid, c]));
    const DEP_NAME = Object.fromEntries(D.options.departments.map(d => [d.id, d.name]));
    const MAJOR_NAME = Object.fromEntries(D.options.majors.flatMap(g => g.items.map(i => [i.id, i.name])));

    // ---------- стан ----------
    const DEFAULTS = { q: "", lang: "", dep: "", major: "", degree: "", sem: "", credits: [], control: [], year: [],
      nocw: false, star: false, rec: false, hideBlocked: true, hideSimilar: false, sort: "smart", view: "list" };
    const S = Object.assign({}, DEFAULTS, store.get("filters2", {}));
    let tab = "catalog", reportSem = store.get("reportSem", "plan");
    let stars = new Set(store.get("stars", []));
    let basket = store.get("basket", []);              // [{id, credits, sem: planKey}]
    let account = store.get("account", null);
    let accountState = env.live ? "loading" : "off";
    let accountError = "";
    let manualMandatory = store.get("mandatory", "");
    let plan = (store.get("plan", null) || defaultPlan()).map(p => {
      const num = p.num ?? (+(/^s(\d+)$/.exec(p.key) || [])[1] || null);
      return { ...p, num, short: p.short || (num ? `${num} сем` : p.parity === "fall" ? "Осінь" : "Весна") };
    });
    const compare = new Set();
    let page = 1, lastCombos = [];

    function defaultPlan() {
      return [{ key: "fall", label: "Осінній семестр", short: "Осінь", parity: "fall", target: "" },
              { key: "spring", label: "Весняний семестр", short: "Весна", parity: "spring", target: "" }];
    }
    const save = () => { store.set("filters2", S); store.set("stars", [...stars]); store.set("basket", basket); store.set("plan", plan); };

    // ---------- дані акаунта ----------
    let mandatoryIds = new Set(), mandatoryNames = [], siteSelected = new Map(), recommended = new Set();
    const refId = r => r.id && BY_ID.has(r.id) ? r.id : BY_SID.get(r.sid)?.id;
    function rebuildAccount() {
      const fromAcc = account?.mandatory || [];
      mandatoryIds = new Set(fromAcc.map(m => m.id));
      mandatoryNames = [...new Set([...fromAcc.map(m => m.name), ...manualMandatory.split("\n").map(s => s.trim()).filter(Boolean)])];
      siteSelected = new Map((account?.selected || []).map(x => [x.id, x]));
      recommended = new Set((account?.recommended || []).map(refId).filter(Boolean));
      blockCache.clear();
    }
    const blockCache = new Map();
    function blockState(c) {
      if (blockCache.has(c.id)) return blockCache.get(c.id);
      let res = null;
      if (mandatoryIds.has(c.id)) res = { exact: true, match: c.name };
      else {
        const n = norm(c.name);
        for (const m of mandatoryNames) {
          const mn = norm(m);
          if (!mn) continue;
          if (mn === n) { res = { exact: true, match: m }; break; }
          if (!res && ((mn.length >= 6 && (n.includes(mn) || mn.includes(n))) || similarity(m, c.name) >= 0.8)) res = { similar: true, match: m };
        }
      }
      blockCache.set(c.id, res);
      return res;
    }

    // ---------- семестри ----------
    const semNums = c => (c.semesters?.length ? c.semesters.map(s => s.semester) : (c.semester ? [c.semester] : [])).filter(Boolean);
    function parities(c) {
      if (c.site_sems?.length) return new Set(c.site_sems);
      return new Set(semNums(c).map(n => n % 2 ? "fall" : "spring"));
    }
    const parityLabel = c => [...parities(c)].map(p => p === "fall" ? "осінь" : "весна").join(" / ") || "?";
    function controlFor(c, parity) {
      const m = (c.semesters || []).find(s => (s.semester % 2 ? "fall" : "spring") === parity);
      return m ? m.control : (c.controls || [])[0] || null;
    }

    // ---------- розмітка ----------
    const creditCounts = {};
    COURSES.forEach(c => c.credit_options.forEach(v => creditCounts[v] = (creditCounts[v] || 0) + 1));
    const creditValues = Object.keys(creditCounts).map(Number).filter(v => creditCounts[v] >= 5).sort((a, b) => a - b);
    const chipsHTML = (key, items) => `<div class="chips" data-chips="${key}">${items.map(([v, l]) => `<button class="chip" data-v="${v}">${l}</button>`).join("")}</div>`;

    root.innerHTML = `
      <header class="top">
        <div class="brand"><span class="logo">В</span><div><b>Вибіркові</b><small id="meta"></small></div></div>
        <nav class="tabs" role="tablist">
          <button role="tab" data-tab="catalog">Каталог</button>
          <button role="tab" data-tab="report">Звіт по семестрах</button>
        </nav>
        <div class="top-right">
          <div id="account" class="account"></div>
          <button id="plan-btn" class="plan-btn" title="Мій план і підбір комбінацій"></button>
          ${env.close ? `<button id="close" class="ghost-ink" title="Закрити (Esc)">✕</button>` : ""}
        </div>
      </header>

      <section id="view-catalog">
        <div class="filterbar">
          <div class="search"><span aria-hidden="true">⌕</span><input id="q" type="search" placeholder="Назва, викладач, зміст…" autocomplete="off"><kbd>/</kbd></div>
          <div class="pills">
            <select id="f-lang" class="pill" aria-label="Мова викладання"><option value="">Мова викладання</option><option value="uk">Українська</option><option value="en">Англійська</option></select>
            <select id="f-dep" class="pill" aria-label="Підрозділ, кафедра, відділ, центр"><option value="">Підрозділ, кафедра</option>${D.options.departments.map(d => `<option value="${d.id}">${d.sub ? "   " : ""}${esc(d.name)}</option>`).join("")}</select>
            <select id="f-major" class="pill" aria-label="Галузь знань і спеціальність"><option value="">Галузь знань і спеціальність</option>${D.options.majors.map(g => `<optgroup label="${esc(g.label)}">${g.items.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join("")}</optgroup>`).join("")}</select>
            <select id="f-degree" class="pill" aria-label="Ступінь освіти"><option value="">Ступінь освіти</option>${Object.entries(DEGREE).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
            <select id="f-sem" class="pill" aria-label="Семестр, в якому читається"><option value="">Семестр</option>${Object.entries(SEM).map(([k, v]) => `<option value="${k}">${v} (${k === "fall" ? "непарний" : "парний"})</option>`).join("")}</select>
            <span class="sep"></span>
            <details class="pop" data-pop="credits"><summary class="pill">Кредити</summary><div class="pop-panel">${chipsHTML("credits", creditValues.map(v => [v, v]))}</div></details>
            <details class="pop" data-pop="control"><summary class="pill">Контроль</summary><div class="pop-panel">${chipsHTML("control", [["exam", "Екзамен"], ["credit", "Залік"], ["diff_credit", "Диф. залік"]])}</div></details>
            <details class="pop" data-pop="year"><summary class="pill">Рік навчання</summary><div class="pop-panel">${chipsHTML("year", [1, 2, 3, 4, 5, 6].map(y => [y, y + (y > 4 ? " (маг.)" : "") + " рік"]))}</div></details>
            <button class="pill toggle" data-toggle="rec" id="rec-pill" hidden>🎓 Рекомендовані кафедрою</button>
            <button class="pill toggle" data-toggle="star">★ Цікаві</button>
            <button class="pill toggle" data-toggle="nocw">Без курсової</button>
            <details class="pop right" data-pop="mand"><summary class="pill">Обов’язкові</summary><div class="pop-panel wide">
              <label class="check"><input type="checkbox" id="f-hideBlocked"> Ховати мої обов’язкові</label>
              <label class="check"><input type="checkbox" id="f-hideSimilar"> Ховати й курси зі схожими назвами</label>
              <div id="mand-account"></div>
              <label class="lbl" for="mandatory">${env.live ? "Додати назви вручну" : "Мої обов’язкові (по одній на рядок)"}</label>
              <textarea id="mandatory" placeholder="Вища математика&#10;Програмування"></textarea>
            </div></details>
          </div>
        </div>
        <div class="resultbar">
          <span class="count" id="count"></span>
          <div id="active" class="active-chips"></div>
          <span class="spacer"></span>
          <select id="sort" class="pill quiet" aria-label="Сортування">
            <option value="smart">Рекомендовані, потім рейтинг</option><option value="rating">За рейтингом</option>
            <option value="name">За назвою</option><option value="credits">За кредитами</option><option value="year">За роком навчання</option>
          </select>
          <div class="seg" role="group" aria-label="Вигляд"><button data-view="list" title="Список">☰</button><button data-view="table" title="Таблиця">▦</button></div>
        </div>
        <div id="list" class="content"></div>
        <button class="more-btn" id="more"></button>
      </section>

      <section id="view-report" class="content" hidden></section>

      <div id="drawer-back" class="drawer-back" hidden></div>
      <aside id="drawer" class="drawer" aria-label="Мій план">
        <div class="drawer-head"><h2>Мій план</h2><button class="ghost" id="drawer-x" title="Закрити">✕</button></div>
        <div id="plan"></div>
        <div class="combos-box">
          <h3>Дозібрати кредити</h3>
          <p class="hint">Набори курсів, що дають рівно потрібну суму. Беру ★ цікаві, якщо вони є, інакше — поточний список з фільтрами. Рекомендовані кафедрою йдуть вище.</p>
          <div class="row"><select id="c-sem" class="pill quiet"></select>
            <label class="hint">до <input type="number" id="c-max" value="3" min="1" max="5"> курсів</label>
            <button class="primary" id="c-run">Підібрати</button></div>
          <div id="combos"></div>
        </div>
      </aside>

      <div id="comparebar" class="comparebar" hidden></div>
      <div id="modal" class="modal" hidden><div class="modal-box" role="dialog" aria-modal="true"><button class="ghost modal-x" title="Закрити">✕</button><div id="modal-body"></div></div></div>`;

    // ---------- синхронізація полів ----------
    const selects = { lang: "#f-lang", dep: "#f-dep", major: "#f-major", degree: "#f-degree", sem: "#f-sem", sort: "#sort" };
    function syncControls() {
      for (const [k, sel] of Object.entries(selects)) { $(sel).value = S[k]; $(sel).classList.toggle("set", !!S[k] && k !== "sort"); }
      $("#f-hideBlocked").checked = S.hideBlocked; $("#f-hideSimilar").checked = S.hideSimilar;
      $("#q").value = S.q;
      root.querySelectorAll("[data-chips]").forEach(group => {
        const key = group.dataset.chips;
        group.querySelectorAll(".chip").forEach(ch => ch.classList.toggle("on", S[key].map(String).includes(ch.dataset.v)));
        const sum = group.closest(".pop").querySelector("summary");
        sum.classList.toggle("set", S[key].length > 0);
        sum.dataset.n = S[key].length || "";
      });
      root.querySelectorAll("[data-toggle]").forEach(b => b.classList.toggle("set", !!S[b.dataset.toggle]));
      root.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === S.view));
      root.querySelectorAll("[data-tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === tab));
    }
    const update = () => { page = 1; save(); syncControls(); render(); };
    for (const [k, sel] of Object.entries(selects)) $(sel).addEventListener("change", e => { S[k] = e.target.value; update(); });
    for (const k of ["hideBlocked", "hideSimilar"]) $("#f-" + k).addEventListener("change", e => { S[k] = e.target.checked; update(); });
    let qTimer;
    $("#q").addEventListener("input", e => { clearTimeout(qTimer); qTimer = setTimeout(() => { S.q = e.target.value; page = 1; save(); render(); }, 120); });
    root.querySelectorAll("[data-chips]").forEach(group => group.addEventListener("click", e => {
      const ch = e.target.closest(".chip"); if (!ch) return;
      const key = group.dataset.chips;
      const v = key === "control" ? ch.dataset.v : +ch.dataset.v;
      S[key] = S[key].includes(v) ? S[key].filter(x => x !== v) : [...S[key], v];
      update();
    }));
    root.querySelectorAll("[data-toggle]").forEach(b => b.addEventListener("click", () => { S[b.dataset.toggle] = !S[b.dataset.toggle]; update(); }));
    root.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => { S.view = b.dataset.view; update(); }));
    root.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => { tab = b.dataset.tab; syncControls(); render(); }));
    // закривати поповери кліком поза ними
    root.addEventListener("click", e => {
      const path = e.composedPath();
      root.querySelectorAll("details.pop[open]").forEach(d => { if (!path.includes(d)) d.open = false; });
    });
    root.querySelectorAll("details.pop").forEach(d => d.addEventListener("toggle", () => {
      if (d.open) root.querySelectorAll("details.pop[open]").forEach(o => o !== d && (o.open = false));
    }));
    $("#mandatory").value = manualMandatory;
    $("#mandatory").addEventListener("input", e => {
      manualMandatory = e.target.value; store.set("mandatory", manualMandatory);
      rebuildAccount(); render();
    });
    if (env.close) $("#close").addEventListener("click", env.close);

    // ---------- шухляда плану ----------
    const openDrawer = (v = true) => { $("#drawer").classList.toggle("open", v); $("#drawer-back").hidden = !v; };
    $("#plan-btn").addEventListener("click", () => openDrawer(!$("#drawer").classList.contains("open")));
    $("#drawer-x").addEventListener("click", () => openDrawer(false));
    $("#drawer-back").addEventListener("click", () => openDrawer(false));

    // ---------- фільтрація ----------
    function matches(c, { ignoreSem = false } = {}) {
      if (S.q) {
        const hay = c._hay || (c._hay = norm([c.name, c.lecturer, c.objective, c.prerequisites, c.id].join(" ")));
        if (!norm(S.q).split(" ").every(w => hay.includes(w))) return false;
      }
      if (S.lang && !c.site_lang.includes(S.lang)) return false;
      if (S.dep && !c.deps.includes(+S.dep)) return false;
      if (S.major && !c.majors.includes(+S.major)) return false;
      if (S.degree && !c.degrees.includes(S.degree)) return false;
      if (!ignoreSem && S.sem && !parities(c).has(S.sem)) return false;
      if (S.credits.length && !c.credit_options.some(v => S.credits.includes(v))) return false;
      if (S.control.length && !(c.controls || []).some(v => S.control.includes(v))) return false;
      if (S.year.length && !S.year.includes(c.year)) return false;
      if (S.nocw && c.termpaper) return false;
      if (S.star && !stars.has(c.id)) return false;
      if (S.rec && recommended.size && !recommended.has(c.id)) return false;
      const b = blockState(c);
      if (b?.exact && S.hideBlocked) return false;
      if (b?.similar && S.hideSimilar) return false;
      return true;
    }
    const SORTS = {
      smart: (a, b) => recommended.has(b.id) - recommended.has(a.id) || b.rating - a.rating,
      rating: (a, b) => b.rating - a.rating,
      name: (a, b) => a.name.localeCompare(b.name, "uk"),
      credits: (a, b) => a.credits - b.credits || b.rating - a.rating,
      year: (a, b) => (a.year || 9) - (b.year || 9) || b.rating - a.rating,
    };
    function activeChips() {
      const chips = [];
      const add = (label, clear) => chips.push({ label, clear });
      if (S.q) add(`«${S.q}»`, () => S.q = "");
      if (S.lang) add(LANG[S.lang], () => S.lang = "");
      if (S.dep) add(DEP_NAME[S.dep], () => S.dep = "");
      if (S.major) add(MAJOR_NAME[S.major], () => S.major = "");
      if (S.degree) add(DEGREE[S.degree], () => S.degree = "");
      if (S.sem) add(SEM[S.sem] + " семестр", () => S.sem = "");
      S.credits.forEach(v => add(`${v} кр.`, () => S.credits = S.credits.filter(x => x !== v)));
      S.control.forEach(v => add(CONTROL[v], () => S.control = S.control.filter(x => x !== v)));
      S.year.forEach(v => add(`${v} рік`, () => S.year = S.year.filter(x => x !== v)));
      if (S.rec) add("рекомендовані кафедрою", () => S.rec = false);
      if (S.star) add("★ цікаві", () => S.star = false);
      if (S.nocw) add("без курсової", () => S.nocw = false);
      return chips;
    }

    // ---------- каталог ----------
    const syllabusUrl = c => `https://dl.tntu.edu.ua/mods/syllabus/view.php?sid=${c.sid}`;
    const inPlan = c => basket.some(x => x.id === c.id);
    function flags(c) {
      const b = blockState(c), out = [];
      if (recommended.has(c.id)) out.push(`<span class="flag rec">🎓 рекомендує кафедра</span>`);
      if (siteSelected.has(c.id)) out.push(`<span class="flag ok">✓ обрано на сайті</span>`);
      if (b) out.push(`<span class="flag warn">${b.exact ? (mandatoryIds.has(c.id) ? "ваша обов’язкова" : "= обов’язкова") : `≈ «${esc(b.match)}»`}</span>`);
      if (basket.some(x => x.id !== c.id && norm(BY_ID.get(x.id)?.name) === norm(c.name))) out.push(`<span class="flag warn">така назва вже в плані</span>`);
      if (c.termpaper) out.push(`<span class="flag">курсова</span>`);
      return out.join("");
    }
    function controlsHTML(c) {
      if (c.semesters?.length > 1) return c.semesters.map(s => `<span class="ctl ${ctlClass(s.control)}">${CONTROL[s.control] || s.control}<i>${s.semester} сем</i></span>`).join("");
      return (c.controls || []).map(k => `<span class="ctl ${ctlClass(k)}">${CONTROL[k] || k}</span>`).join("");
    }
    function itemHTML(c) {
      const b = blockState(c), main = (c.controls || [])[0];
      const h = c.hours || {};
      return `<article class="item ${ctlClass(main)} ${b?.exact ? "dim" : ""} ${inPlan(c) ? "picked" : ""}" data-id="${c.id}">
        <div class="coin"><b>${c.credit_options.length > 1 ? `${c.credit_options[0]}–${c.credit_options[c.credit_options.length - 1]}` : c.credit_options[0]}</b><small>кредитів</small></div>
        <div class="body">
          <div class="name"><a href="${syllabusUrl(c)}" target="_blank" rel="noopener">${esc(c.name)}</a></div>
          <div class="who">${esc(c.lecturer)}${DEP_NAME[c.department] ? ` · ${esc(DEP_NAME[c.department])}` : ""}</div>
          <div class="meta">${controlsHTML(c)}<span class="dot">${c.year ? c.year + " рік" : "рік ?"}</span><span class="dot">${parityLabel(c)}</span>${c.lang === "en" ? `<span class="dot">EN</span>` : ""}${flags(c)}</div>
          <details class="more"><summary>Про курс</summary>
            ${c.objective ? `<p>${esc(c.objective)}</p>` : ""}
            ${c.prerequisites ? `<p><b>Передумови:</b> ${esc(c.prerequisites)}</p>` : ""}
            <p class="hint">Лекції ${h.lections || 0} · практичні ${h.practical || 0} · лабораторні ${h.lab || 0} · самостійна ${h.individual || 0} год · ${KIND[c.kind] || ""} · ID ${c.id}${c.credit_options.length > 1 ? ` · варіанти: ${c.credit_options.join(" / ")} кр.` : ""}</p>
          </details>
        </div>
        <div class="score" title="Рейтинг на сайті"><b>${Math.round(c.rating)}</b><small>рейтинг</small></div>
        <div class="acts">
          <button class="ic star ${stars.has(c.id) ? "on" : ""}" data-act="star" title="Цікавить" aria-pressed="${stars.has(c.id)}">${stars.has(c.id) ? "★" : "☆"}</button>
          <button class="ic ${compare.has(c.id) ? "on" : ""}" data-act="cmp" title="Порівняти">⇄</button>
          <button class="add ${inPlan(c) ? "on" : ""}" data-act="add">${inPlan(c) ? "✓ У плані" : "+ План"}</button>
        </div>
      </article>`;
    }
    function tableHTML(rows) {
      return `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th></th><th>Назва</th><th class="num">Кр.</th><th>Контроль</th><th class="num">Рік</th><th>Семестр</th><th class="num">Рейт.</th><th>Викладач</th><th></th></tr></thead>
        <tbody>${rows.map(c => `<tr data-id="${c.id}" class="${blockState(c)?.exact ? "dim" : ""} ${inPlan(c) ? "picked" : ""}">
          <td><button class="ic star ${stars.has(c.id) ? "on" : ""}" data-act="star" aria-pressed="${stars.has(c.id)}">${stars.has(c.id) ? "★" : "☆"}</button></td>
          <td><a href="${syllabusUrl(c)}" target="_blank" rel="noopener">${esc(c.name)}</a><div class="meta">${flags(c)}</div></td>
          <td class="num"><b>${c.credit_options.join("/")}</b></td>
          <td>${(c.controls || []).map(k => `<span class="ctl ${ctlClass(k)}">${CONTROL[k]}</span>`).join(" ")}</td>
          <td class="num">${c.year || "?"}</td><td>${parityLabel(c)}</td><td class="num">${Math.round(c.rating)}</td>
          <td>${esc(c.lecturer)}</td>
          <td class="nowrap"><button class="ic ${compare.has(c.id) ? "on" : ""}" data-act="cmp" title="Порівняти">⇄</button> <button class="add ${inPlan(c) ? "on" : ""}" data-act="add">${inPlan(c) ? "✓" : "+ План"}</button></td>
        </tr>`).join("")}</tbody></table></div>`;
    }

    function render() {
      $("#view-catalog").hidden = tab !== "catalog";
      $("#view-report").hidden = tab !== "report";
      $("#rec-pill").hidden = !recommended.size;
      if (tab === "catalog") renderCatalog(); else renderReport();
      renderPlan(); renderPlanBtn(); renderCompareBar(); renderAccount();
    }
    function renderCatalog() {
      const res = COURSES.filter(c => matches(c)).sort(SORTS[S.sort] || SORTS.smart);
      $("#count").innerHTML = `<b>${res.length}</b> курсів`;
      const chips = activeChips();
      $("#active").innerHTML = chips.map((c, i) => `<button class="achip" data-i="${i}" title="Прибрати">${esc(c.label)}<span>✕</span></button>`).join("")
        + (chips.length > 1 ? `<button class="link" id="clear-all">Скинути все</button>` : "");
      const shown = res.slice(0, page * PAGE);
      $("#list").innerHTML = !res.length
        ? `<div class="empty"><div class="big">∅</div><b>Нічого не знайшлось</b><p>Приберіть частину фільтрів${S.star ? " або вимкніть «★ Цікаві»" : ""}.</p></div>`
        : S.view === "table" ? tableHTML(shown) : `<div class="items">${shown.map(itemHTML).join("")}</div>`;
      $("#more").hidden = res.length <= page * PAGE;
      $("#more").textContent = `Показати ще ${Math.min(PAGE, res.length - page * PAGE)} з ${res.length - page * PAGE}`;
    }
    $("#active").addEventListener("click", e => {
      if (e.target.id === "clear-all") { Object.assign(S, DEFAULTS, { sort: S.sort, view: S.view }); update(); return; }
      const b = e.target.closest(".achip"); if (!b) return;
      activeChips()[+b.dataset.i].clear(); update();
    });
    $("#more").addEventListener("click", () => { page++; render(); });
    $("#list").addEventListener("click", e => {
      const btn = e.target.closest("button[data-act]"); if (!btn) return;
      act(btn.dataset.act, +btn.closest("[data-id]").dataset.id);
    });
    function act(kind, id) {
      if (kind === "star") stars.has(id) ? stars.delete(id) : stars.add(id);
      if (kind === "add") toggleBasket(id);
      if (kind === "cmp") {
        if (compare.has(id)) compare.delete(id);
        else if (compare.size < 4) compare.add(id);
        else alert("Порівнювати можна до 4 курсів.");
      }
      save(); render();
    }

    // ---------- план ----------
    function planFor(c) {
      const p = parities(c);
      return (plan.find(s => p.has(s.parity)) || plan[0]).key;
    }
    function toggleBasket(id, credits, sem) {
      const i = basket.findIndex(x => x.id === id);
      if (i >= 0) basket.splice(i, 1);
      else { const c = BY_ID.get(id); basket.push({ id, credits: credits ?? c.credits, sem: sem ?? planFor(c) }); }
      save();
    }
    const planSum = s => basket.filter(x => x.sem === s.key).reduce((a, x) => a + x.credits, 0);
    function renderPlanBtn() {
      $("#plan-btn").innerHTML = `<span class="pb-title">План</span>` + plan.map(s => {
        const sum = planSum(s), t = +s.target || 0;
        const st = !t ? "" : sum === t ? "full" : sum > t ? "over" : "";
        return `<span class="pb-sem ${st}"><i>${esc(s.short)}</i>${fmt(sum)}${t ? "/" + fmt(t) : ""}</span>`;
      }).join("");
    }
    function renderPlan() {
      let html = account?.plan?.length ? `<p class="hint">Ліміти — скільки ще лишилось набрати за вкладкою «${esc(account.selectedTitle || "Обрані мною")}».</p>` : "";
      for (const s of plan) {
        const items = basket.filter(x => x.sem === s.key);
        const sum = planSum(s), t = +s.target || 0;
        html += `<div class="psem">
          <div class="psem-head"><b>${esc(s.label)}</b><label class="hint">ліміт <input type="number" step="0.5" min="0" data-target="${s.key}" value="${esc(s.target)}"> кр.</label></div>
          <div class="gauge ${t && sum > t ? "over" : t && sum === t ? "full" : ""}"><div style="width:${t ? Math.min(100, sum / t * 100) : 0}%"></div></div>
          <div class="psem-sum"><b>${fmt(sum)}${t ? ` з ${fmt(t)}` : ""} кр.</b><span>${!t ? "вкажіть ліміт" : sum === t ? "✓ рівно" : sum < t ? `бракує ${fmt(t - sum)}` : `перебір ${fmt(sum - t)}`}</span></div>
          ${items.map(x => {
            const c = BY_ID.get(x.id); if (!c) return "";
            const wrong = parities(c).size && !parities(c).has(s.parity);
            const ctl = controlFor(c, s.parity);
            return `<div class="pitem" data-id="${c.id}">
              <span class="ctl ${ctlClass(ctl)}">${CONTROL_SHORT[ctl] || "?"}</span>
              <div class="pitem-name"><a href="${syllabusUrl(c)}" target="_blank" rel="noopener">${esc(c.name)}</a>
                ${wrong ? `<div class="flag warn">читається: ${parityLabel(c)}</div>` : ""}${blockState(c) ? `<div class="flag warn">обов’язкова/схожа</div>` : ""}</div>
              <div class="pitem-ctl">
                ${c.credit_options.length > 1 ? `<select data-pact="cr" aria-label="Кредити">${c.credit_options.map(v => `<option ${v === x.credits ? "selected" : ""}>${v}</option>`).join("")}</select>` : `<b>${x.credits}</b>`}
                ${plan.length > 1 ? `<select data-pact="sem" aria-label="Семестр">${plan.map(p => `<option value="${p.key}" ${p.key === s.key ? "selected" : ""}>${esc(p.short)}</option>`).join("")}</select>` : ""}
                <button class="ghost" data-pact="rm" title="Прибрати">✕</button>
              </div></div>`;
          }).join("") || `<div class="hint pempty">Порожньо — додайте курси кнопкою «+ План»</div>`}
        </div>`;
      }
      if (basket.length) html += `<div class="row"><button id="copy">Скопіювати список</button><button id="to-report">Звіт →</button><button class="ghost" id="clear">Очистити</button></div>`;
      $("#plan").innerHTML = html;
      const cur = $("#c-sem").value;
      $("#c-sem").innerHTML = plan.map(p => `<option value="${p.key}">${esc(p.label)}</option>`).join("");
      if (plan.some(p => p.key === cur)) $("#c-sem").value = cur;
    }
    $("#plan").addEventListener("input", e => {
      const k = e.target.dataset.target; if (!k) return;
      plan.find(p => p.key === k).target = e.target.value; save(); renderPlanBtn();
    });
    $("#plan").addEventListener("change", e => {
      if (e.target.dataset.target) { render(); return; }
      const it = e.target.closest(".pitem"); if (!it) return;
      const x = basket.find(b => b.id === +it.dataset.id);
      if (e.target.dataset.pact === "cr") x.credits = +e.target.value;
      if (e.target.dataset.pact === "sem") x.sem = e.target.value;
      save(); render();
    });
    $("#plan").addEventListener("click", e => {
      const t = e.target.closest("button"); if (!t) return;
      if (t.dataset.pact === "rm") { toggleBasket(+t.closest(".pitem").dataset.id); render(); }
      if (t.id === "copy") {
        const txt = plan.map(p => `${p.label}:\n` + basket.filter(x => x.sem === p.key).map(x => {
          const c = BY_ID.get(x.id); return `  ${c.id} — ${c.name} (${x.credits} кр., ${CONTROL[controlFor(c, p.parity)] || "?"}, ${c.lecturer})`;
        }).join("\n")).join("\n");
        navigator.clipboard.writeText(txt).then(() => { t.textContent = "Скопійовано ✓"; });
      }
      if (t.id === "to-report") { tab = "report"; openDrawer(false); syncControls(); render(); }
      if (t.id === "clear" && confirm("Очистити весь план?")) { basket = []; save(); render(); }
    });

    // ---------- комбінації ----------
    function runCombos() {
      const s = plan.find(p => p.key === $("#c-sem").value) || plan[0];
      const target = +s.target || 0, have = planSum(s);
      const need = Math.round((target - have) * 2) / 2;
      const out = $("#combos");
      if (!target) { out.innerHTML = `<p class="hint">Спершу вкажіть ліміт кредитів для цього семестру вгорі.</p>`; return; }
      if (need <= 0) { out.innerHTML = `<p class="ok-text">Уже набрано ${fmt(have)} з ${fmt(target)} кр.</p>`; return; }
      const takenNames = new Set(basket.map(x => norm(BY_ID.get(x.id).name)));
      let pool = COURSES.filter(c => !inPlan(c) && !siteSelected.has(c.id) && !takenNames.has(norm(c.name))
        && parities(c).has(s.parity) && !blockState(c)?.exact);
      const starred = pool.filter(c => stars.has(c.id));
      const fromStars = starred.length > 0;
      pool = (fromStars ? starred : pool.filter(c => matches(c, { ignoreSem: true }))).sort(SORTS.smart).slice(0, 70);
      const maxK = Math.max(1, Math.min(5, +$("#c-max").value || 3));
      const results = [];
      const opts = pool.flatMap(c => c.credit_options.map(v => ({ c, v })));
      (function dfs(start, sum, chosen) {
        if (sum === need) { results.push(chosen.slice()); return; }
        if (chosen.length >= maxK || results.length > 4000) return;
        for (let i = start; i < opts.length; i++) {
          const o = opts[i];
          if (sum + o.v > need) continue;
          if (chosen.some(x => x.c.id === o.c.id || norm(x.c.name) === norm(o.c.name))) continue;
          chosen.push(o); dfs(i + 1, sum + o.v, chosen); chosen.pop();
        }
      })(0, 0, []);
      const score = r => r.reduce((a, x) => a + x.c.rating, 0) / r.length;
      const recN = r => r.filter(x => recommended.has(x.c.id)).length;
      results.sort((a, b) => a.length - b.length || recN(b) - recN(a) || score(b) - score(a));
      lastCombos = results.slice(0, 12);
      out.innerHTML = `<p class="hint">Треба ${fmt(need)} кр. · кандидатів ${pool.length} (${fromStars ? "★ цікаві" : "з фільтрів"}) · знайдено ${results.length}${results.length > 4000 ? "+" : ""}</p>` +
        (lastCombos.length ? lastCombos.map((r, i) => `<div class="combo">
          <ul>${r.map(x => `<li><span class="ctl ${ctlClass(controlFor(x.c, s.parity))}">${CONTROL_SHORT[controlFor(x.c, s.parity)] || "?"}</span><span>${esc(x.c.name)}${recommended.has(x.c.id) ? " 🎓" : ""}</span><b>${x.v}</b></li>`).join("")}</ul>
          <button data-combo="${i}">+ Додати набір</button></div>`).join("")
          : `<p class="hint">Точної комбінації немає. Дозвольте більше курсів у наборі, позначте більше ★ або послабте фільтри.</p>`);
    }
    $("#c-run").addEventListener("click", runCombos);
    $("#combos").addEventListener("click", e => {
      const i = e.target.dataset.combo; if (i == null) return;
      const sem = $("#c-sem").value;
      for (const x of lastCombos[i]) if (!basket.some(b => b.id === x.c.id)) toggleBasket(x.c.id, x.v, sem);
      render(); runCombos();
    });

    // ---------- звіт ----------
    function reportSemesters() {
      if (account) {
        const nums = new Set([...(account.mandatory || []).map(m => m.semester), ...plan.map(p => p.num), ...(account.selected || []).map(x => x.semester)].filter(Boolean));
        return [...nums].sort((a, b) => a - b).map(n => {
          const p = plan.find(x => x.num === n);
          return { key: p ? p.key : "s" + n, num: n, parity: n % 2 ? "fall" : "spring", label: `${n} семестр`, sub: n % 2 ? "осінь" : "весна", inPlan: !!p };
        });
      }
      return plan.map(p => ({ key: p.key, num: null, parity: p.parity, label: p.label, sub: "", inPlan: true }));
    }
    function reportRows(e) {
      const rows = [];
      for (const m of account?.mandatory || []) if (m.semester === e.num)
        rows.push({ type: "mand", name: m.name, credits: m.credits || 0, control: m.control, termpaper: !!m.termpaper, sid: m.sid });
      for (const x of basket.filter(x => x.sem === e.key)) {
        const c = BY_ID.get(x.id); if (!c) continue;
        rows.push({ type: "plan", name: c.name, credits: x.credits, control: controlFor(c, e.parity), termpaper: !!c.termpaper, sid: c.sid });
      }
      for (const x of account?.selected || []) if (x.semester === e.num && !basket.some(b => b.id === x.id)) {
        const c = BY_ID.get(x.id); if (!c) continue;
        rows.push({ type: "site", name: c.name, credits: c.credits, control: controlFor(c, e.parity), termpaper: !!c.termpaper, sid: c.sid });
      }
      return rows;
    }
    function totals(rows) {
      const t = { n: rows.length, credits: 0, exam: 0, zalik: 0, diff: 0, cw: 0, unknown: 0 };
      rows.forEach(r => {
        t.credits += r.credits || 0;
        if (r.control === "exam") t.exam++; else if (r.control === "credit") t.zalik++; else if (r.control === "diff_credit") t.diff++; else t.unknown++;
        if (r.termpaper) t.cw++;
      });
      return t;
    }
    const TYPE = { mand: "Обов’язкова", plan: "Вибіркова · план", site: "Вибіркова · обрано на сайті" };
    function renderReport() {
      const sems = reportSemesters();
      const sel = reportSem === "all" ? sems : reportSem === "plan" ? sems.filter(s => s.inPlan) : sems.filter(s => s.key === reportSem);
      const shownSems = sel.length ? sel : sems;
      const blocks = shownSems.map(e => ({ e, rows: reportRows(e) }));
      const all = totals(blocks.flatMap(b => b.rows));
      const tile = (n, l, cls = "") => `<div class="tile ${cls}"><b>${n}</b><span>${l}</span></div>`;
      $("#view-report").innerHTML = `
        <div class="report-head">
          <div><h1>Звіт по семестрах</h1>
            <p class="hint">${account ? "Обов’язкові — з вашого акаунта, вибіркові — з плану і вкладки «Обрані мною»." : "Тут лише вибіркові з плану. Через розширення на dl.tntu.edu.ua сюди додаються обов’язкові з акаунта."}</p></div>
          <div class="row"><button id="rep-copy">Копіювати для Excel</button><button id="rep-print">Друк</button></div>
        </div>
        <div class="semtabs">
          ${sems.some(s => s.inPlan) && account ? `<button class="chip ${reportSem === "plan" ? "on" : ""}" data-rsem="plan">Наступний рік (план)</button>` : ""}
          <button class="chip ${reportSem === "all" || (!account && reportSem === "plan") ? "on" : ""}" data-rsem="all">Усі семестри</button>
          ${sems.map(s => `<button class="chip ${reportSem === s.key ? "on" : ""}" data-rsem="${s.key}">${esc(s.label)}</button>`).join("")}
        </div>
        ${blocks.length > 1 ? `<div class="tiles summary">${tile(fmt(all.credits), "кредитів разом")}${tile(all.exam, "екзаменів", "exam")}${tile(all.zalik + all.diff, "заліків" + (all.diff ? ` (${all.diff} диф.)` : ""), "zalik")}${tile(all.cw, "курсових")}${tile(all.n, "дисциплін")}</div>` : ""}
        ${blocks.map(({ e, rows }) => {
          const t = totals(rows);
          const p = plan.find(x => x.key === e.key);
          return `<section class="rsem">
            <div class="rsem-head"><h2>${esc(e.label)}${e.sub ? ` <span>${e.sub}</span>` : ""}</h2>
              ${p && +p.target ? `<span class="hint">вибіркових ${fmt(planSum(p))} з ${fmt(+p.target)} кр.</span>` : ""}</div>
            <div class="tiles">${tile(fmt(t.credits), "кредитів")}${tile(t.exam, "екзаменів", "exam")}${tile(t.zalik + t.diff, "заліків" + (t.diff ? ` (${t.diff} диф.)` : ""), "zalik")}${tile(t.cw, "курсових")}${tile(t.n, "дисциплін")}</div>
            ${rows.length ? `<div class="tbl-wrap"><table class="tbl">
              <thead><tr><th>Дисципліна</th><th>Тип</th><th class="num">Кредити</th><th>Контроль</th><th>Курсова</th></tr></thead>
              <tbody>${rows.map(r => `<tr class="t-${r.type}"><td><a href="https://dl.tntu.edu.ua/mods/syllabus/view.php?sid=${esc(r.sid)}" target="_blank" rel="noopener">${esc(r.name)}</a></td>
                <td><span class="type ${r.type}">${TYPE[r.type]}</span></td><td class="num">${fmt(r.credits)}</td>
                <td>${r.control ? `<span class="ctl ${ctlClass(r.control)}">${CONTROL[r.control]}</span>` : `<span class="hint">?</span>`}</td>
                <td>${r.termpaper ? "так" : ""}</td></tr>`).join("")}</tbody>
              <tfoot><tr><td>Разом</td><td></td><td class="num">${fmt(t.credits)}</td><td>${t.exam} екз · ${t.zalik + t.diff} зал${t.unknown ? ` · ${t.unknown} ?` : ""}</td><td>${t.cw || ""}</td></tr></tfoot>
            </table></div>` : `<p class="hint">Немає дисциплін.</p>`}
          </section>`;
        }).join("")}`;
      window.__elReport = blocks;
    }
    $("#view-report").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.rsem) { reportSem = b.dataset.rsem; store.set("reportSem", reportSem); render(); }
      const blocks = window.__elReport || [];
      if (b.id === "rep-copy") {
        const lines = ["Семестр\tДисципліна\tТип\tКредити\tКонтроль\tКурсова"];
        blocks.forEach(({ e, rows }) => rows.forEach(r => lines.push([e.label, r.name, TYPE[r.type], String(r.credits).replace(".", ","), CONTROL[r.control] || "", r.termpaper ? "так" : ""].join("\t"))));
        navigator.clipboard.writeText(lines.join("\n")).then(() => { b.textContent = "Скопійовано ✓"; });
      }
      if (b.id === "rep-print") {
        const w = window.open("", "_blank");
        if (!w) return alert("Браузер заблокував нове вікно для друку.");
        w.document.write(`<!doctype html><meta charset="utf-8"><title>Звіт по семестрах</title>
          <style>body{font:13px system-ui,sans-serif;margin:24px;color:#111}h2{margin:22px 0 4px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:4px 6px;text-align:left}tfoot td{font-weight:700}.s{color:#555;margin:0 0 6px}</style>
          <h1>Звіт по семестрах${account?.speciality ? " — " + esc(account.speciality) : ""}</h1>` +
          blocks.map(({ e, rows }) => { const t = totals(rows); return `<h2>${esc(e.label)}${e.sub ? " (" + e.sub + ")" : ""}</h2>
            <p class="s">${fmt(t.credits)} кредитів · ${t.exam} екзаменів · ${t.zalik + t.diff} заліків · ${t.cw} курсових</p>
            <table><tr><th>Дисципліна</th><th>Тип</th><th>Кредити</th><th>Контроль</th><th>Курсова</th></tr>
            ${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${TYPE[r.type]}</td><td>${fmt(r.credits)}</td><td>${CONTROL[r.control] || "?"}</td><td>${r.termpaper ? "так" : ""}</td></tr>`).join("")}
            <tfoot><tr><td>Разом</td><td></td><td>${fmt(t.credits)}</td><td>${t.exam} екз / ${t.zalik + t.diff} зал</td><td>${t.cw}</td></tr></tfoot></table>`; }).join(""));
        w.document.close(); w.focus(); w.print();
      }
    });

    // ---------- порівняння ----------
    function renderCompareBar() {
      const bar = $("#comparebar");
      bar.hidden = !compare.size;
      if (!compare.size) return;
      bar.innerHTML = `<span class="hint">Порівняння</span>${[...compare].map(id => `<span class="achip">${esc(BY_ID.get(id).name)}<button class="link" data-uncmp="${id}" aria-label="Прибрати">✕</button></span>`).join("")}
        <span class="spacer"></span><button class="primary" id="cmp-open" ${compare.size < 2 ? "disabled" : ""}>Порівняти ${compare.size}</button><button class="ghost" id="cmp-clear">✕</button>`;
    }
    $("#comparebar").addEventListener("click", e => {
      if (e.target.dataset.uncmp) { compare.delete(+e.target.dataset.uncmp); render(); }
      if (e.target.id === "cmp-clear") { compare.clear(); render(); }
      if (e.target.id === "cmp-open") openCompare();
    });
    function openCompare() {
      const cs = [...compare].map(id => BY_ID.get(id));
      const rows = [
        ["Кредити", c => c.credit_options.join(" / ")],
        ["Контроль", c => controlsHTML(c)],
        ["Рік навчання", c => c.year || "?"],
        ["Семестр", c => parityLabel(c)],
        ["Рейтинг", c => c.rating],
        ["Викладач", c => `${esc(c.lecturer_degree)} ${esc(c.lecturer)}`],
        ["Кафедра", c => esc(DEP_NAME[c.department] || "")],
        ["Години", c => { const h = c.hours || {}; return `лек ${h.lections || 0} · пр ${h.practical || 0} · лаб ${h.lab || 0} · сам ${h.individual || 0}`; }],
        ["Курсова", c => c.termpaper ? "так" : "ні"],
        ["Кафедра рекомендує", c => recommended.has(c.id) ? "🎓 так" : "—"],
        ["Мета", c => esc(c.objective)],
        ["Передумови", c => esc(c.prerequisites)],
        ["", c => `<button data-act="add" data-id="${c.id}" class="add ${inPlan(c) ? "on" : ""}">${inPlan(c) ? "✓ У плані" : "+ План"}</button>`],
      ];
      $("#modal-body").innerHTML = `<h2>Порівняння</h2><div class="tbl-wrap"><table class="tbl cmp">
        <thead><tr><th></th>${cs.map(c => `<th><a href="${syllabusUrl(c)}" target="_blank" rel="noopener">${esc(c.name)}</a></th>`).join("")}</tr></thead>
        <tbody>${rows.map(([l, f]) => `<tr><th>${l}</th>${cs.map(c => `<td>${f(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      $("#modal").hidden = false;
    }
    $("#modal").addEventListener("click", e => {
      if (e.target.id === "modal" || e.target.closest(".modal-x")) { $("#modal").hidden = true; return; }
      const b = e.target.closest("button[data-act]");
      if (b) { act(b.dataset.act, +b.dataset.id); openCompare(); }
    });

    // ---------- акаунт ----------
    function renderAccount() {
      const el = $("#account");
      if (!env.live) el.innerHTML = "";
      else if (accountState === "loading" && !account) el.innerHTML = `<span class="acc muted">Читаю акаунт…</span>`;
      else if (accountState === "error" && !account) el.innerHTML = `<button class="acc bad" id="acc-refresh" title="${esc(accountError)}">Акаунт не прочитано — ще раз</button>`;
      else if (account) el.innerHTML = `<button class="acc" id="acc-refresh" title="Оновлено ${esc(account.at)}. Натисніть, щоб оновити.">
          <span class="ava">👤</span><span>${esc(account.speciality || "Акаунт")}</span><small>${accountState === "loading" ? "оновлюю…" : accountState === "error" ? "помилка" : "↻"}</small></button>`;
      const r = $("#acc-refresh"); if (r) r.onclick = loadAccount;

      const ma = $("#mand-account");
      if (account?.mandatory?.length) {
        const bySem = {};
        account.mandatory.forEach(m => (bySem[m.semester || "?"] ||= []).push(m));
        ma.innerHTML = `<details><summary>З акаунта: ${account.mandatory.length} обов’язкових</summary>
          ${Object.entries(bySem).map(([s, ms]) => `<div class="mand-sem"><b>${s} семестр</b><ul>${ms.map(m => `<li>${esc(m.name)}</li>`).join("")}</ul></div>`).join("")}</details>`;
      } else ma.innerHTML = "";
    }
    function guessMajor(spec) {
      const code = (spec || "").match(/^\s*([A-ZА-Я]?\d+(?:\.\d+)?)/i)?.[1];
      if (!code) return null;
      const items = D.options.majors.flatMap(g => g.items).filter(i => i.name.startsWith(code + " "));
      const masterish = (account?.mandatory || []).some(m => m.semester > 8);
      return (items.find(i => i.name.includes(masterish ? "(магістр)" : "(бакалавр)")) || items[0])?.id || null;
    }
    async function loadAccount() {
      if (!env.loadAccount) return;
      accountState = "loading"; renderAccount();
      try {
        const acc = await env.loadAccount();
        const first = !account;
        account = { ...acc, at: new Date().toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" }) };
        account.majorId = guessMajor(account.speciality);
        store.set("account", account);
        if (account.plan?.length) {
          const old = plan;
          plan = account.plan.map(p => ({ key: "s" + p.num, num: p.num, label: `${p.num} семестр (${p.num % 2 ? "осінь" : "весна"})`,
            short: `${p.num} сем`, parity: p.num % 2 ? "fall" : "spring", target: String(p.left) }));
          basket.forEach(x => {
            if (plan.some(p => p.key === x.sem)) return;
            const par = old.find(p => p.key === x.sem)?.parity;
            x.sem = (plan.find(p => p.parity === par) || plan[0]).key;
          });
        }
        // «Мене цікавлять» з сайту → ★ (лише нові, щоб не повертати те, що ви прибрали)
        const imported = new Set(store.get("importedInterested", []));
        for (const r of account.interested || []) { const id = refId(r); if (id && !imported.has(id)) { stars.add(id); imported.add(id); } }
        store.set("importedInterested", [...imported]);
        if (first && account.majorId && !S.major) S.major = String(account.majorId);
        accountState = "ok";
        rebuildAccount(); save(); syncControls();
      } catch (e) {
        accountState = "error"; accountError = e.message || String(e);
      }
      render();
    }

    // ---------- клавіатура ----------
    document.addEventListener("keydown", e => {
      if (!root.isConnected || root.getRootNode().host?.style.display === "none") return;
      const t = e.composedPath()[0];
      const typing = t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
      if (e.key === "/" && !typing) { e.preventDefault(); tab = "catalog"; syncControls(); render(); $("#q").focus(); }
      if (e.key === "Escape") {
        if (!$("#modal").hidden) $("#modal").hidden = true;
        else if (root.querySelector("details.pop[open]")) root.querySelectorAll("details.pop[open]").forEach(d => d.open = false);
        else if ($("#drawer").classList.contains("open")) openDrawer(false);
        else if (typing) t.blur();
        else if (env.close) env.close();
      }
    });

    $("#meta").textContent = `ТНТУ · ${COURSES.length} курсів · ${D.fetched.slice(0, 10)}`;
    rebuildAccount();
    syncControls();
    render();
    if (env.live) loadAccount();
  }

  window.ElectivesApp = { mount };
})();
