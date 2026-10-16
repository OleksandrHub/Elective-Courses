// Інтерфейс підбору вибіркових дисциплін.
// Працює і як окрема сторінка (index.html), і всередині сайту через розширення (content.js).
// ElectivesApp.mount(element, data, env)
//   env.live         — запущено на dl.tntu.edu.ua під акаунтом
//   env.loadAccount  — async () => {speciality, mandatory[], plan[], selected[], selectedTitle, recommended[], interested[]}
//   env.close        — закрити оверлей
//   env.gemini       — {request, keyInfo, setKey}: запити до Gemini через розширення (інакше — напряму з ключем у localStorage)
(function () {
  const CONTROL = { exam: "екзамен", credit: "залік", diff_credit: "диф. залік", none: "без контролю", cw: "курсова робота", cp: "курсовий проєкт" };
  const CONTROL_SHORT = { exam: "Екз", credit: "Зал", diff_credit: "Диф", none: "—", cw: "КР", cp: "КП" };
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
    root.dataset.theme = store.get("theme", "tntu");
    const COURSES = D.courses;
    const BY_ID = new Map(COURSES.map(c => [c.id, c]));
    const BY_SID = new Map(COURSES.map(c => [c.sid, c]));
    const DEP_NAME = Object.fromEntries(D.options.departments.map(d => [d.id, d.name]));
    const MAJOR_NAME = Object.fromEntries(D.options.majors.flatMap(g => g.items.map(i => [i.id, i.name])));

    // ---------- стан ----------
    const DEFAULTS = { q: "", lang: "", dep: "", major: "", degree: "", sem: "", credits: [], control: [], year: [],
      nocw: false, star: false, rec: false, hideBlocked: true, hideSimilar: false, sort: "smart", view: "list" };
    const S = Object.assign({}, DEFAULTS, store.get("filters2", {}));
    let tab = "catalog";
    let reportSel = store.get("reportSel", null);   // ключі обраних семестрів звіту; null — «наступний рік» за замовчуванням
    let stars = new Set(store.get("stars", []));
    let aiList = new Set(store.get("aiList", []));     // список кандидатів для ШІ; осінь/весна — за тим, коли курс читається
    // Варіанти плану: у кожного свій набір курсів, ліміти семестрів спільні
    let variants = store.get("variants", null) || [{ id: "v1", name: "План A", basket: store.get("basket", []) }];
    let activeVariant = store.get("activeVariant", variants[0].id);
    if (!variants.some(v => v.id === activeVariant)) activeVariant = variants[0].id;
    const curVariant = () => variants.find(v => v.id === activeVariant);
    let basket = curVariant().basket;                  // [{id, credits, sem: planKey}] активного варіанта
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
    const save = () => { store.set("filters2", S); store.set("stars", [...stars]); store.set("aiList", [...aiList]); store.set("plan", plan);
      curVariant().basket = basket; store.set("variants", variants); store.set("activeVariant", activeVariant); };
    function nextVariantName() {
      const used = new Set(variants.map(v => v.name));
      return [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map(l => "План " + l).find(n => !used.has(n)) || `План ${variants.length + 1}`;
    }
    function switchVariant(id) { save(); activeVariant = id; basket = curVariant().basket; save(); $("#combos").innerHTML = ""; render(); }
    function newVariant(items = [], name = nextVariantName()) {
      save();
      const v = { id: "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, basket: items.map(x => ({ ...x })) };
      variants.push(v); activeVariant = v.id; basket = v.basket; save(); render();
      return v;
    }

    // ---------- дані акаунта ----------
    let mandatoryIds = new Set(), mandatoryNames = [], siteSelected = new Map(), recommended = new Set();
    let takenIds = new Map(), takenNames = new Map();   // з навчального плану: id/назва → семестр
    const isCw = r => r.control === "cw" || r.control === "cp";
    const refId = r => r.id && BY_ID.has(r.id) ? r.id : BY_SID.get(r.sid)?.id;
    function rebuildAccount() {
      const fromAcc = account?.mandatory || [];
      takenIds = new Map(); takenNames = new Map();
      for (const sem of account?.curriculum?.semesters || []) for (const r of sem.rows) {
        if (isCw(r)) continue;
        r.ids.forEach(id => takenIds.has(id) || takenIds.set(id, sem.num));
        takenNames.has(norm(r.name)) || takenNames.set(norm(r.name), sem.num);
      }
      mandatoryIds = new Set(fromAcc.map(m => m.id));
      mandatoryNames = [...new Set([...fromAcc.map(m => m.name),
        ...(account?.curriculum?.semesters || []).flatMap(sem => sem.rows.filter(r => !isCw(r)).map(r => r.name)),
        ...manualMandatory.split("\n").map(s => s.trim()).filter(Boolean)])];
      siteSelected = new Map((account?.selected || []).map(x => [x.id, x]));
      recommended = new Set((account?.recommended || []).map(refId).filter(Boolean));
      blockCache.clear();
    }
    const blockCache = new Map();
    function blockState(c) {
      if (blockCache.has(c.id)) return blockCache.get(c.id);
      let res = null;
      const n = norm(c.name);
      if (takenIds.has(c.id) || takenNames.has(n)) res = { exact: true, match: c.name, taken: takenIds.get(c.id) || takenNames.get(n) };
      else if (mandatoryIds.has(c.id)) res = { exact: true, match: c.name };
      else {
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
          <button role="tab" data-tab="ai">✨ ШІ-підбір</button>
        </nav>
        <div class="top-right">
          <div id="account" class="account"></div>
          <select id="theme" class="theme-sel" aria-label="Тема оформлення" title="Тема оформлення">
            <option value="tntu">Тема: ТНТУ</option><option value="classic">Тема: класична</option>
            <option value="dark">Тема: темна</option><option value="auto">Тема: як у системі</option>
          </select>
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
          <button class="pill quiet" id="all-to-ai" title="Додати всі знайдені курси до списку для ШІ">✨ Знайдені → ШІ</button>
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

      <section id="view-ai" class="content" hidden>
        <div class="ai">
          <div class="report-head"><div><h1>✨ ШІ-підбір</h1>
            <p class="hint">Gemini з вашого Google-акаунта переглядає доступні курси, ваші обов’язкові й побажання та пропонує набори, що закривають кредити семестру.</p></div></div>
          <div class="card-box" id="ai-key"></div>
          <div class="card-box">
            <div class="row"><b>Мій список для ШІ</b><span class="spacer"></span>
              <label class="check" style="margin:0"><input type="checkbox" id="ai-uselist"> Підбирати лише з мого списку</label></div>
            <p class="hint" style="margin:4px 0 10px">Додавайте курси кнопкою ✨ у каталозі. Вони самі розходяться по семестрах за тим, коли читаються; курс, що читається і восени, і навесні, буде в обох.</p>
            <div class="ai-lists" id="ai-lists"></div>
          </div>
          <div class="card-box">
            <label class="lbl" for="ai-wish">Що вам цікаво і чого хочете уникнути</label>
            <textarea id="ai-wish" placeholder="Напр.: цікавлять машинне навчання і стартапи, краще без екзаменів, англійською — теж ок"></textarea>
            <div class="chips rules" id="ai-rules">
              <button class="chip" data-rule="nomand" title="Не пропонувати ваші обов’язкові й курси зі схожими назвами">Без обов’язкових і схожих</button>
              <button class="chip" data-rule="parity" title="Лише курси, що читаються в обраному семестрі (осінь/весна)">Лише ті, що читаються в цьому семестрі</button>
              <button class="chip" data-rule="year" title="Перевага курсам з рекомендованим роком, що відповідає вашому курсу">Бажано мого року навчання</button>
            </div>
            <div class="chips" id="ai-quick">${["Без екзаменів", "Без курсових", "Англійською", "Корисне для роботи в IT", "Найменше навантаження", "Пріоритет рекомендованим кафедрою", "Щось зовсім нове для мене"].map(t => `<button class="chip" data-q="${t}">+ ${t}</button>`).join("")}</div>
            <div class="row" style="margin-top:12px">
              <select id="ai-sem" class="pill" aria-label="Семестр"></select>
              <label class="check" style="margin:0"><input type="checkbox" id="ai-filters"> Лише з поточних фільтрів каталогу</label>
              <span class="spacer"></span>
              <button class="primary big" id="ai-run">✨ Підібрати</button>
            </div>
            <p class="hint" style="margin:10px 0 0">У Google надсилається: спеціальність, назви ваших обов’язкових, побажання і перелік курсів. Логін, пароль та інші особисті дані — ні.</p>
          </div>
          <div id="ai-out"></div>
        </div>
      </section>

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
    $("#theme").value = root.dataset.theme;
    $("#theme").addEventListener("change", e => { root.dataset.theme = e.target.value; store.set("theme", e.target.value); });

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
      if (b) out.push(`<span class="flag warn">${b.taken ? `уже у вашому плані · ${b.taken} сем` : b.exact ? (mandatoryIds.has(c.id) ? "ваша обов’язкова" : "= обов’язкова") : `≈ «${esc(b.match)}»`}</span>`);
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
          <button class="ic ai ${aiList.has(c.id) ? "on" : ""}" data-act="ai" title="${aiList.has(c.id) ? "Прибрати зі списку для ШІ" : `До списку для ШІ (${parityLabel(c)})`}" aria-pressed="${aiList.has(c.id)}">✨</button>
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
          <td class="nowrap"><button class="ic ai ${aiList.has(c.id) ? "on" : ""}" data-act="ai" title="До списку для ШІ" aria-pressed="${aiList.has(c.id)}">✨</button> <button class="ic ${compare.has(c.id) ? "on" : ""}" data-act="cmp" title="Порівняти">⇄</button> <button class="add ${inPlan(c) ? "on" : ""}" data-act="add">${inPlan(c) ? "✓" : "+ План"}</button></td>
        </tr>`).join("")}</tbody></table></div>`;
    }

    function render() {
      $("#view-catalog").hidden = tab !== "catalog";
      $("#view-report").hidden = tab !== "report";
      $("#view-ai").hidden = tab !== "ai";
      $("#rec-pill").hidden = !recommended.size;
      if (tab === "catalog") renderCatalog(); else if (tab === "report") renderReport(); else renderAI();
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
    $("#all-to-ai").addEventListener("click", () => {
      const res = COURSES.filter(c => matches(c));
      if (res.length > 40 && !confirm(`Додати до списку для ШІ ${res.length} курсів? Краще спершу звузити фільтрами.`)) return;
      res.forEach(c => aiList.add(c.id)); save(); render();
    });
    $("#list").addEventListener("click", e => {
      const btn = e.target.closest("button[data-act]"); if (!btn) return;
      act(btn.dataset.act, +btn.closest("[data-id]").dataset.id);
    });
    function act(kind, id) {
      if (kind === "star") stars.has(id) ? stars.delete(id) : stars.add(id);
      if (kind === "ai") aiList.has(id) ? aiList.delete(id) : aiList.add(id);
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
      $("#plan-btn").innerHTML = `<span class="pb-title">${esc(variants.length > 1 ? curVariant().name : "План")}</span>` + plan.map(s => {
        const sum = planSum(s), t = +s.target || 0;
        const st = !t ? "" : sum === t ? "full" : sum > t ? "over" : "";
        return `<span class="pb-sem ${st}"><i>${esc(s.short)}</i>${fmt(sum)}${t ? "/" + fmt(t) : ""}</span>`;
      }).join("");
    }
    function renderPlan() {
      let html = `<div class="variants">
        <div class="vtabs">${variants.map(v => `<button class="vtab ${v.id === activeVariant ? "on" : ""}" data-vsel="${v.id}">${esc(v.name)}<small>${v.basket.length}</small></button>`).join("")}
          <button class="vtab add" data-vnew="empty" title="Новий порожній варіант">+ Новий</button></div>
        <div class="vactions"><button class="link" data-vact="dup">Дублювати</button><button class="link" data-vact="rename">Перейменувати</button>${variants.length > 1 ? `<button class="link" data-vact="del">Видалити</button>` : ""}</div>
      </div>`;
      if (variants.length > 1) html += variantsCompareHTML();
      html += account?.plan?.length ? `<p class="hint">Ліміти — скільки ще лишилось набрати за вкладкою «${esc(account.selectedTitle || "Обрані мною")}». Вони спільні для всіх варіантів.</p>` : "";
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
    function variantsCompareHTML() {
      const stat = (v, s) => {
        const items = v.basket.filter(x => x.sem === s.key);
        const sum = items.reduce((a, x) => a + x.credits, 0);
        const exams = items.filter(x => { const c = BY_ID.get(x.id); return c && controlFor(c, s.parity) === "exam"; }).length;
        const t = +s.target || 0;
        return `<td class="${t && sum === t ? "ok-text" : t && sum > t ? "bad-text" : ""}"><b>${fmt(sum)}${t ? "/" + fmt(t) : ""}</b> <span class="hint">${exams} екз</span></td>`;
      };
      return `<div class="vcmp"><table class="tbl"><thead><tr><th>Варіант</th>${plan.map(s => `<th>${esc(s.short)}</th>`).join("")}</tr></thead>
        <tbody>${variants.map(v => `<tr class="${v.id === activeVariant ? "picked" : ""}" data-vrow="${v.id}"><td><button class="link" data-vsel="${v.id}">${esc(v.name)}</button></td>${plan.map(s => stat(v, s)).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
    $("#plan").addEventListener("click", e => {
      const t = e.target.closest("button"); if (!t) return;
      if (t.dataset.vsel) { switchVariant(t.dataset.vsel); return; }
      if (t.dataset.vnew) { newVariant(); return; }
      if (t.dataset.vact === "dup") { newVariant(basket, curVariant().name + " (копія)"); return; }
      if (t.dataset.vact === "rename") {
        const name = prompt("Назва варіанта:", curVariant().name);
        if (name?.trim()) { curVariant().name = name.trim().slice(0, 40); save(); render(); }
        return;
      }
      if (t.dataset.vact === "del" && confirm(`Видалити варіант «${curVariant().name}»?`)) {
        variants = variants.filter(v => v.id !== activeVariant);
        activeVariant = variants[0].id; basket = curVariant().basket; save(); render();
        return;
      }
      if (t.dataset.pact === "rm") { toggleBasket(+t.closest(".pitem").dataset.id); render(); }
      if (t.id === "copy") {
        const txt = `${curVariant().name}\n` + plan.map(p => `${p.label}:\n` + basket.filter(x => x.sem === p.key).map(x => {
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
          <div class="row"><button data-combo="${i}">+ Додати набір</button><button class="ghost" data-combo-new="${i}" title="Створити новий варіант плану з поточних курсів і цього набору">Як новий варіант</button></div></div>`).join("")
          : `<p class="hint">Точної комбінації немає. Дозвольте більше курсів у наборі, позначте більше ★ або послабте фільтри.</p>`);
    }
    $("#c-run").addEventListener("click", runCombos);
    $("#combos").addEventListener("click", e => {
      const sem = $("#c-sem").value;
      const k = e.target.dataset.comboNew;
      if (k != null) {
        newVariant([...basket, ...lastCombos[k].filter(x => !basket.some(b => b.id === x.c.id)).map(x => ({ id: x.c.id, credits: x.v, sem }))]);
        runCombos(); return;
      }
      const i = e.target.dataset.combo; if (i == null) return;
      for (const x of lastCombos[i]) if (!basket.some(b => b.id === x.c.id)) toggleBasket(x.c.id, x.v, sem);
      render(); runCombos();
    });

    // ---------- звіт ----------
    const curSem = n => (account?.curriculum?.semesters || []).find(x => x.num === n);
    // Семестр плану з номером: 7 → {key: "s7", label: "7 семестр (осінь)", …}
    const semEntry = (num, target = "") => ({ key: "s" + num, num, label: `${num} семестр (${num % 2 ? "осінь" : "весна"})`,
      short: `${num} сем`, parity: num % 2 ? "fall" : "spring", target });
    // Замінити семестри плану й перенести курси всіх варіантів (за ключем, інакше — за осінь/весна)
    function setPlanSemesters(newPlan) {
      const old = plan;
      plan = newPlan;
      curVariant().basket = basket;
      for (const v of variants) v.basket.forEach(x => {
        if (plan.some(p => p.key === x.sem)) return;
        const par = old.find(p => p.key === x.sem)?.parity;
        x.sem = (plan.find(p => p.parity === par) || plan[0]).key;
      });
      save();
    }
    // Якщо «Обрані мною» не дали номерів, беремо наступний навчальний рік з навчального плану:
    // поточний 5 або 6 семестр → обираємо на 7 (осінь) і 8 (весна)
    function numberPlanSemesters() {
      const cur = account?.curriculum?.current;
      if (!cur || plan.every(p => p.num)) return;
      const fall = cur % 2 ? cur + 2 : cur + 1;
      setPlanSemesters(plan.map(p => p.num ? p : semEntry(p.parity === "fall" ? fall : fall + 1, p.target)));
    }
    function reportSemesters() {
      if (account) {
        const cur = account.curriculum;
        const nums = new Set([...(cur?.semesters || []).map(x => x.num), ...(account.mandatory || []).map(m => m.semester),
          ...plan.map(p => p.num), ...(account.selected || []).map(x => x.semester)].filter(Boolean));
        return [...nums].sort((a, b) => a - b).map(n => {
          const p = plan.find(x => x.num === n);
          return { key: p ? p.key : "s" + n, num: n, parity: n % 2 ? "fall" : "spring", label: `${n} семестр`,
            sub: (n % 2 ? "осінь" : "весна") + (cur?.current === n ? " · поточний" : cur?.current > n ? " · завершено" : ""),
            inPlan: !!p, current: cur?.current === n, past: cur?.current > n };
        }).concat(plan.filter(p => !p.num).map(p => ({ key: p.key, num: null, parity: p.parity, label: p.label, sub: "семестр не визначено", inPlan: true })));
      }
      return plan.map(p => ({ key: p.key, num: null, parity: p.parity, label: p.label, sub: "", inPlan: true }));
    }
    const courseUrl = (id, sid) => sid ? `https://dl.tntu.edu.ua/mods/syllabus/view.php?sid=${sid}`
      : BY_ID.get(id)?.sid ? `https://dl.tntu.edu.ua/mods/syllabus/view.php?sid=${BY_ID.get(id).sid}`
      : id ? `https://dl.tntu.edu.ua/bounce.php?course=${id}` : "";
    function reportRows(e) {
      const rows = [], seen = new Set();
      const cs = curSem(e.num);
      if (cs) {
        for (const r of cs.rows) {
          r.ids.forEach(id => seen.add(id));
          rows.push({ type: isCw(r) ? "cw" : r.kind === "elec" ? "celec" : "mand", name: r.name, credits: r.credits || 0, control: r.control,
            url: courseUrl(r.ids[0]), grade: r.grade, hours: r });
        }
        for (const p of cs.practice) rows.push({ type: "prac", name: p.name + (p.term ? ` (${p.term})` : ""), credits: p.credits || 0, control: null, grade: p.grade });
      } else {
        for (const m of account?.mandatory || []) if (m.semester === e.num) {
          seen.add(m.id);
          rows.push({ type: "mand", name: m.name, credits: m.credits || 0, control: m.control, termpaper: !!m.termpaper, url: courseUrl(m.id, m.sid) });
        }
      }
      for (const x of basket.filter(x => x.sem === e.key)) {
        const c = BY_ID.get(x.id); if (!c || seen.has(c.id)) continue;
        seen.add(c.id);
        rows.push({ type: "plan", name: c.name, credits: x.credits, control: controlFor(c, e.parity), termpaper: !!c.termpaper, url: courseUrl(c.id, c.sid) });
      }
      for (const x of account?.selected || []) if (x.semester === e.num && !seen.has(x.id)) {
        const c = BY_ID.get(x.id); if (!c) continue;
        seen.add(c.id);
        rows.push({ type: "site", name: c.name, credits: c.credits, control: controlFor(c, e.parity), termpaper: !!c.termpaper, url: courseUrl(c.id, c.sid) });
      }
      return rows;
    }
    function totals(rows) {
      const t = { n: 0, credits: 0, exam: 0, zalik: 0, diff: 0, cw: 0, unknown: 0, grades: [] };
      rows.forEach(r => {
        t.credits += r.credits || 0;
        const g = parseFloat(r.grade?.zvo);
        if (Number.isFinite(g)) t.grades.push(g);
        if (r.type === "cw") { t.cw++; return; }
        if (r.type === "prac") return;
        t.n++;
        if (r.control === "exam") t.exam++; else if (r.control === "credit") t.zalik++; else if (r.control === "diff_credit") t.diff++; else t.unknown++;
        if (r.termpaper) t.cw++;
      });
      t.avg = t.grades.length ? t.grades.reduce((a, b) => a + b, 0) / t.grades.length : null;
      return t;
    }
    const TYPE = { mand: "Обов’язкова", celec: "Вибіркова · у навч. плані", cw: "Курсова", prac: "Практика", plan: "Вибіркова · мій план", site: "Вибіркова · обрано на сайті" };
    const gradeText = g => g && (g.zvo || g.ects || g.nat) ? [g.zvo, g.ects, g.nat].filter(Boolean).join(" · ") : "";
    function renderReport() {
      const sems = reportSemesters();
      const presets = {
        plan: account ? sems.filter(s => s.inPlan) : [], cur: sems.filter(s => s.current), past: sems.filter(s => s.past), all: sems,
      };
      const chosen = new Set((reportSel || presets.plan.map(s => s.key)).filter(k => sems.some(s => s.key === k)));
      const shownSems = chosen.size ? sems.filter(s => chosen.has(s.key)) : sems;
      const isPreset = k => presets[k].length && presets[k].length === shownSems.length && presets[k].every(s => shownSems.includes(s));
      const blocks = shownSems.map(e => ({ e, rows: reportRows(e) }));
      const all = totals(blocks.flatMap(b => b.rows));
      const st = account?.curriculum?.student;
      const tile = (n, l, cls = "") => `<div class="tile ${cls}"><b>${n}</b><span>${l}</span></div>`;
      const tilesHTML = (t, total) => `${tile(fmt(t.credits), total ? "кредитів разом" : "кредитів")}${tile(t.exam, "екзаменів", "exam")}${tile(t.zalik + t.diff, "заліків" + (t.diff ? ` (${t.diff} диф.)` : ""), "zalik")}${tile(t.cw, "курсових")}${t.avg != null ? tile(t.avg.toFixed(1), "середній бал") : tile(t.n, "дисциплін")}`;
      const preset = (k, l) => presets[k].length ? `<button class="chip preset ${isPreset(k) ? "on" : ""}" data-rpreset="${k}">${l}</button>` : "";
      $("#view-report").innerHTML = `
        <div class="report-head">
          <div><h1>Звіт по семестрах</h1>
            ${variants.length > 1 ? `<div class="vtabs" style="margin:6px 0 4px">${variants.map(v => `<button class="vtab ${v.id === activeVariant ? "on" : ""}" data-vsel="${v.id}">${esc(v.name)}</button>`).join("")}</div>` : ""}
            <p class="hint">${st ? `${esc(st.speciality)} · ${st.courseYear || "?"} курс, група ${esc(st.group)}${st.planName ? ` · план ${esc(st.planName)}` : ""}. Дані з «Індивідуального навчального плану», вкладок вибіркових і вашого плану.`
              : account ? "Обов’язкові — з вашого акаунта, вибіркові — з плану і вкладки «Обрані мною»." : "Тут лише вибіркові з плану. Через розширення на dl.tntu.edu.ua сюди додаються дані з акаунта."}</p></div>
          <div class="row"><button id="rep-copy">Копіювати для Excel</button><button id="rep-print">Друк</button></div>
        </div>
        <div class="semtabs">
          ${preset("plan", "Наступний рік (план)")}${preset("cur", "Поточний семестр")}${preset("past", "Завершені")}${preset("all", "Усі")}
          <span class="sep"></span>
          ${sems.map(s => `<button class="chip sem ${shownSems.includes(s) ? "on" : ""}" data-rsem="${s.key}" aria-pressed="${shownSems.includes(s)}" title="Клік — додати або прибрати семестр">${esc(s.label)}</button>`).join("")}
        </div>
        ${blocks.length > 1 ? `<div class="tiles summary">${tilesHTML(all, true)}</div>` : ""}
        ${blocks.map(({ e, rows }) => {
          const t = totals(rows);
          const p = plan.find(x => x.key === e.key);
          const cs = curSem(e.num);
          const hasGrade = rows.some(r => gradeText(r.grade));
          const hasCw = rows.some(r => r.termpaper);
          return `<section class="rsem ${e.past ? "past" : ""}">
            <div class="rsem-head"><h2>${esc(e.label)}${e.sub ? ` <span>${e.sub}</span>` : ""}</h2>
              <span class="hint">${cs?.total ? `за планом ${fmt(cs.total)} кр.${cs.electiveCredits ? `, з них вибіркових ${fmt(cs.electiveCredits)}` : ""}` : ""}${p && +p.target ? ` · у моєму плані ${fmt(planSum(p))} з ${fmt(+p.target)} кр.` : ""}</span></div>
            <div class="tiles">${tilesHTML(t)}</div>
            ${rows.length ? `<div class="tbl-wrap"><table class="tbl">
              <thead><tr><th>Дисципліна</th><th>Тип</th><th class="num">Кредити</th><th>Контроль</th>${hasCw ? "<th>Курсова</th>" : ""}${hasGrade ? "<th>Оцінка</th>" : ""}</tr></thead>
              <tbody>${rows.map(r => `<tr class="t-${r.type}"><td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)}</td>
                <td><span class="type ${r.type}">${TYPE[r.type]}</span></td><td class="num">${fmt(r.credits)}</td>
                <td>${r.control ? `<span class="ctl ${r.type === "cw" ? "" : ctlClass(r.control)}">${CONTROL[r.control] || esc(r.control)}</span>` : r.type === "prac" ? "" : `<span class="hint">?</span>`}</td>
                ${hasCw ? `<td>${r.termpaper ? "так" : ""}</td>` : ""}${hasGrade ? `<td class="grade">${esc(gradeText(r.grade))}</td>` : ""}</tr>`).join("")}</tbody>
              <tfoot><tr><td>Разом</td><td></td><td class="num">${fmt(t.credits)}</td><td>${t.exam} екз · ${t.zalik + t.diff} зал${t.cw ? ` · ${t.cw} курс.` : ""}${t.unknown ? ` · ${t.unknown} ?` : ""}</td>${hasCw ? "<td></td>" : ""}${hasGrade ? `<td>${t.avg != null ? "сер. " + t.avg.toFixed(1) : ""}</td>` : ""}</tr></tfoot>
            </table></div>` : `<p class="hint">Немає дисциплін.</p>`}
          </section>`;
        }).join("")}`;
      window.__elReport = blocks;
    }
    $("#view-report").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.rpreset || b.dataset.rsem) {
        const sems = reportSemesters();
        const shown = [...b.closest(".semtabs").querySelectorAll(".chip.sem.on")].map(c => c.dataset.rsem);
        if (b.dataset.rpreset) {
          const p = b.dataset.rpreset;
          reportSel = sems.filter(s => p === "all" || (p === "plan" && s.inPlan) || (p === "cur" && s.current) || (p === "past" && s.past)).map(s => s.key);
        } else {
          const k = b.dataset.rsem;
          // якщо показано «усі», перший клік лишає лише цей семестр
          reportSel = shown.length === sems.length ? [k] : shown.includes(k) ? shown.filter(x => x !== k) : [...shown, k];
          if (!reportSel.length) reportSel = [k];
        }
        store.set("reportSel", reportSel); render();
      }
      if (b.dataset.vsel) { switchVariant(b.dataset.vsel); return; }
      const blocks = window.__elReport || [];
      if (b.id === "rep-copy") {
        const lines = ["Семестр\tДисципліна\tТип\tКредити\tКонтроль\tКурсова\tОцінка"];
        blocks.forEach(({ e, rows }) => rows.forEach(r => lines.push([e.label, r.name, TYPE[r.type], String(r.credits).replace(".", ","),
          CONTROL[r.control] || r.control || "", r.termpaper ? "так" : "", gradeText(r.grade)].join("\t"))));
        navigator.clipboard.writeText(lines.join("\n")).then(() => { b.textContent = "Скопійовано ✓"; });
      }
      if (b.id === "rep-print") {
        const w = window.open("", "_blank");
        if (!w) return alert("Браузер заблокував нове вікно для друку.");
        w.document.write(`<!doctype html><meta charset="utf-8"><title>Звіт по семестрах</title>
          <style>body{font:13px system-ui,sans-serif;margin:24px;color:#111}h2{margin:22px 0 4px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:4px 6px;text-align:left}tfoot td{font-weight:700}.s{color:#555;margin:0 0 6px}</style>
          <h1>Звіт по семестрах${account?.speciality ? " — " + esc(account.speciality) : ""}</h1>` +
          blocks.map(({ e, rows }) => { const t = totals(rows); return `<h2>${esc(e.label)}${e.sub ? " (" + e.sub + ")" : ""}</h2>
            <p class="s">${fmt(t.credits)} кредитів · ${t.exam} екзаменів · ${t.zalik + t.diff} заліків · ${t.cw} курсових${t.avg != null ? ` · середній бал ${t.avg.toFixed(1)}` : ""}</p>
            <table><tr><th>Дисципліна</th><th>Тип</th><th>Кредити</th><th>Контроль</th><th>Оцінка</th></tr>
            ${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${TYPE[r.type]}</td><td>${fmt(r.credits)}</td><td>${CONTROL[r.control] || r.control || ""}${r.termpaper ? " + курсова" : ""}</td><td>${esc(gradeText(r.grade))}</td></tr>`).join("")}
            <tfoot><tr><td>Разом</td><td></td><td>${fmt(t.credits)}</td><td>${t.exam} екз / ${t.zalik + t.diff} зал / ${t.cw} курс.</td><td>${t.avg != null ? t.avg.toFixed(1) : ""}</td></tr></tfoot></table>`; }).join(""));
        w.document.close(); w.focus(); w.print();
      }
    });

    // ---------- ШІ-підбір (Gemini) ----------
    const API = "https://generativelanguage.googleapis.com/v1beta/";
    const gem = env.gemini || {
      async request(url, method, body) {
        const key = store.get("geminiKey", "");
        if (!key) return { ok: false, status: 401, body: "Не вказано API-ключ Gemini" };
        try {
          const r = await fetch(url, { method: method || "GET", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body });
          return { ok: r.ok, status: r.status, body: await r.text() };
        } catch (e) { return { ok: false, status: 0, body: String(e) }; }
      },
      async keyInfo() { const k = store.get("geminiKey", ""); return { hasKey: !!k, hint: k ? "…" + k.slice(-4) : "" }; },
      async setKey(k) { store.set("geminiKey", k || ""); return true; },
    };
    const aiRules = Object.assign({ nomand: true, parity: true, year: true }, store.get("aiRules", {}));
    const syncRules = () => root.querySelectorAll("[data-rule]").forEach(b => { b.classList.toggle("on", !!aiRules[b.dataset.rule]); b.setAttribute("aria-pressed", !!aiRules[b.dataset.rule]); });
    root.querySelectorAll("[data-rule]").forEach(b => b.addEventListener("click", () => {
      aiRules[b.dataset.rule] = !aiRules[b.dataset.rule]; store.set("aiRules", aiRules); syncRules();
    }));
    syncRules();
    // рік навчання для семестру плану: 5 семестр → 3 курс
    const studyYear = s => s.num ? Math.ceil(s.num / 2) : null;
    let aiModel = store.get("aiModel", ""), aiModels = store.get("aiModels", []), aiResult = null, aiBusy = false, aiError = "";
    function apiError(res) {
      let msg = res.body;
      try { msg = JSON.parse(res.body).error?.message || msg; } catch {}
      if (res.status === 400 && /api key/i.test(msg)) return "Ключ не прийнято — перевірте, що скопіювали його повністю.";
      if (res.status === 429) return "Вичерпано ліміт запитів Gemini. Зачекайте хвилину або оберіть іншу модель.";
      if (res.status === 401 || res.status === 403) return "Немає доступу до Gemini: " + msg;
      return `Помилка Gemini (${res.status || "мережа"}): ${String(msg).slice(0, 300)}`;
    }
    async function loadModels() {
      const res = await gem.request(API + "models?pageSize=200");
      if (!res.ok) throw new Error(apiError(res));
      const list = (JSON.parse(res.body).models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes("generateContent") && /gemini/i.test(m.name) && !/(tts|image|embedding|live|audio|robotics|computer)/i.test(m.name))
        .map(m => ({ id: m.name.replace(/^models\//, ""), label: m.displayName || m.name }));
      const ver = id => parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
      const rank = id => ver(id) * 10 + (/flash/.test(id) && !/lite/.test(id) ? 3 : /pro/.test(id) ? 2 : 1) - (/preview|exp/.test(id) ? 4 : 0);
      list.sort((a, b) => rank(b.id) - rank(a.id));
      aiModels = list; store.set("aiModels", list);
      if (!list.some(m => m.id === aiModel)) { aiModel = list[0]?.id || ""; store.set("aiModel", aiModel); }
    }

    async function renderAIKey() {
      const info = await gem.keyInfo();
      const el = $("#ai-key");
      if (!info.hasKey) {
        el.innerHTML = `<b>Підключіть свій Gemini</b>
          <ol class="steps"><li>Відкрийте <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> під своїм Google-акаунтом.</li>
          <li>Натисніть «Create API key» — це безкоштовно.</li><li>Вставте ключ сюди. Він зберігається лише ${env.gemini ? "в розширенні у вашому браузері" : "у цьому браузері"}.</li></ol>
          <div class="row"><input type="password" id="ai-key-in" placeholder="AIza…" autocomplete="off" style="flex:1;min-width:200px"><button class="primary" id="ai-key-save">Зберегти</button></div>
          <div id="ai-key-msg" class="hint"></div>`;
      } else {
        if (!aiModels.length) { try { await loadModels(); } catch (e) { aiError = e.message; } }
        el.innerHTML = `<div class="row"><span>🔑 Gemini підключено <span class="hint">(ключ ${esc(info.hint)})</span></span><span class="spacer"></span>
          <label class="hint">Модель <select id="ai-model" class="pill quiet">${aiModels.map(m => `<option value="${esc(m.id)}" ${m.id === aiModel ? "selected" : ""}>${esc(m.label)}</option>`).join("") || `<option value="">—</option>`}</select></label>
          <button class="ghost" id="ai-key-del">Відключити</button></div>`;
      }
      $("#ai-run").disabled = !info.hasKey || aiBusy;
    }
    $("#ai-key").addEventListener("click", async e => {
      if (e.target.id === "ai-key-save") {
        const key = $("#ai-key-in").value.trim();
        if (!key) return;
        $("#ai-key-msg").textContent = "Перевіряю ключ…";
        await gem.setKey(key);
        try { await loadModels(); aiError = ""; renderAIKey(); }
        catch (err) { await gem.setKey(""); $("#ai-key-msg").textContent = err.message; }
      }
      if (e.target.id === "ai-key-del" && confirm("Відключити Gemini і видалити ключ з браузера?")) {
        await gem.setKey(""); aiModels = []; store.set("aiModels", []); renderAIKey();
      }
    });
    $("#ai-key").addEventListener("change", e => { if (e.target.id === "ai-model") { aiModel = e.target.value; store.set("aiModel", aiModel); } });
    $("#ai-quick").addEventListener("click", e => {
      const q = e.target.dataset.q; if (!q) return;
      const t = $("#ai-wish");
      t.value = (t.value.trim() ? t.value.trim().replace(/[.,;]?$/, "; ") : "") + q.toLowerCase();
      store.set("aiWish", t.value);
    });
    $("#ai-wish").value = store.get("aiWish", "");
    $("#ai-wish").addEventListener("input", e => store.set("aiWish", e.target.value));

    function renderAI() {
      const cur = $("#ai-sem").value;
      $("#ai-sem").innerHTML = plan.map(p => { const t = +p.target || 0, left = t - planSum(p);
        return `<option value="${p.key}">${esc(p.label)}${t ? ` — бракує ${fmt(Math.max(0, left))} кр.` : ""}</option>`; }).join("");
      if (plan.some(p => p.key === cur)) $("#ai-sem").value = cur;
      renderAIKey();
      renderAILists();
      renderAIResult();
    }
    const listFor = parity => [...aiList].map(id => BY_ID.get(id)).filter(c => c && parities(c).has(parity)).sort(SORTS.smart);
    $("#ai-uselist").checked = store.get("aiUseList", true);
    $("#ai-uselist").addEventListener("change", e => store.set("aiUseList", e.target.checked));
    function renderAILists() {
      const sel = plan.find(p => p.key === $("#ai-sem").value);
      $("#ai-lists").innerHTML = ["fall", "spring"].map(par => {
        const items = listFor(par), sum = items.reduce((a, c) => a + c.credits, 0);
        return `<div class="ai-list ${sel?.parity === par ? "active" : ""}">
          <div class="ai-list-head"><b>${par === "fall" ? "Осінь" : "Весна"}</b><span class="hint">${items.length} курс. · від ${fmt(sum)} кр.</span></div>
          ${items.map(c => `<div class="ai-li"><span class="ctl ${ctlClass(controlFor(c, par))}">${CONTROL_SHORT[controlFor(c, par)] || "?"}</span>
            <a href="${syllabusUrl(c)}" target="_blank" rel="noopener">${esc(c.name)}</a><b>${c.credit_options.join("/")}</b>
            <button class="ghost" data-ai-rm="${c.id}" title="Прибрати">✕</button></div>`).join("") || `<p class="hint">Порожньо — тоді ШІ обирає з усіх доступних курсів.</p>`}
        </div>`;
      }).join("") + (aiList.size ? `<div class="row"><button class="ghost" id="ai-list-clear">Очистити список</button></div>` : "");
    }
    $("#ai-lists").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.aiRm) aiList.delete(+b.dataset.aiRm);
      if (b.id === "ai-list-clear" && !confirm("Очистити список для ШІ?")) return;
      if (b.id === "ai-list-clear") aiList.clear();
      save(); renderAILists();
    });
    $("#ai-sem").addEventListener("change", renderAILists);

    const usingList = s => $("#ai-uselist").checked && listFor(s.parity).length > 0;
    function aiPool(s) {
      const takenNames = new Set(basket.map(x => norm(BY_ID.get(x.id)?.name)));
      if (usingList(s))   // свій список: лише курси цього семестру (осінь/весна), без уже обраних і вивчених
        return listFor(s.parity).filter(c => !inPlan(c) && !siteSelected.has(c.id) && !takenNames.has(norm(c.name)) && !blockState(c)?.exact);
      let pool = COURSES.filter(c => !inPlan(c) && !siteSelected.has(c.id) && !takenNames.has(norm(c.name))
        && (!aiRules.parity || parities(c).has(s.parity))
        && !blockState(c)?.exact);
      if ($("#ai-filters").checked) pool = pool.filter(c => matches(c, { ignoreSem: true }));
      else if (S.major) pool = pool.filter(c => c.majors.includes(+S.major));   // лише доступні вашій спеціальності
      const y = aiRules.year ? studyYear(s) : null;
      const yearFirst = (a, b) => y ? (b.year === y) - (a.year === y) : 0;
      // схожі на обов’язкові — не викидаємо, а ставимо в кінець
      const similarLast = (a, b) => aiRules.nomand ? !!blockState(a)?.similar - !!blockState(b)?.similar : 0;
      return pool.sort((a, b) => similarLast(a, b) || yearFirst(a, b) || SORTS.smart(a, b)).slice(0, 260);
    }
    async function runAI() {
      const s = plan.find(p => p.key === $("#ai-sem").value) || plan[0];
      const target = +s.target || 0, have = planSum(s);
      const need = Math.round((target - have) * 2) / 2;
      if (!target) { aiError = "Спершу вкажіть у «План» ліміт кредитів для цього семестру."; aiResult = null; return renderAIResult(); }
      if (need <= 0) { aiError = `У цьому семестрі вже набрано ${fmt(have)} з ${fmt(target)} кр.`; aiResult = null; return renderAIResult(); }
      const pool = aiPool(s);
      if (!pool.length) { aiError = usingList(s) ? "У вашому списку для ШІ на цей семестр усі курси вже в плані або вивчені — додайте ще кнопкою ✨." : "Немає доступних курсів для цього семестру — послабте фільтри."; aiResult = null; return renderAIResult(); }
      aiBusy = true; aiError = ""; aiResult = null; $("#ai-run").disabled = true; renderAIResult();
      try {
        if (!aiModel) await loadModels();
        const line = c => [c.id, c.name, `кредити: ${c.credit_options.join(" або ")}`, `контроль: ${CONTROL[controlFor(c, s.parity)] || "?"}`,
          `рік: ${c.year || "?"}`, `рейтинг: ${Math.round(c.rating)}`, recommended.has(c.id) ? "РЕКОМЕНДУЄ ВИПУСКОВА КАФЕДРА" : "", stars.has(c.id) ? "студент позначив ★" : "",
          c.termpaper ? "є курсова" : "", blockState(c)?.similar ? `схоже на обов’язкову «${blockState(c).match}»` : "", c.lang === "en" ? "мова: англійська" : "", DEP_NAME[c.department] || "", c.objective ? "мета: " + c.objective.slice(0, 170) : ""].filter(Boolean).join(" | ");
        const planned = basket.filter(x => x.sem === s.key).map(x => `${BY_ID.get(x.id).name} (${x.credits} кр.)`);
        const mand = mandatoryNames;
        const y = studyYear(s);
        const rules = [
          aiRules.nomand && "Уникай курсів з позначкою «схоже на обов’язкову» і тих, що за змістом повторюють обов’язкові; бери їх лише якщо без них не вийде потрібна сума кредитів або вони явно відповідають побажанням.",
          aiRules.parity && `Пропонуй лише курси, що читаються в цьому семестрі (${s.parity === "fall" ? "осінньому" : "весняному"}) — у переліку саме такі.`,
          aiRules.year && y && `Студент буде на ${y} курсі: бажано обирати курси з рекомендованим роком навчання ${y}; інші — лише якщо без них не вийде потрібна сума кредитів або вони значно краще підходять.`,
        ].filter(Boolean);
        const prompt = `Студент ТНТУ обирає вибіркові дисципліни.
Спеціальність: ${account?.speciality || "не вказано"}.
Семестр: ${s.label}. Треба добрати рівно ${fmt(need)} кредитів ЄКТС.
${planned.length ? `Уже в плані цього семестру: ${planned.join("; ")}.` : ""}
Обов’язкові й уже вивчені дисципліни студента (не пропонуй курси, що дублюють їхній зміст): ${[...new Set(mand)].slice(0, 120).join("; ") || "невідомо"}.
Побажання студента: ${$("#ai-wish").value.trim() || "немає, обери найкорисніше для спеціальності"}.
${rules.length ? "Обов’язкові правила:\n- " + rules.join("\n- ") : ""}

${usingList(s) ? "Студент сам відібрав ці курси для цього семестру — обирай лише з них.\n" : ""}Доступні курси (ID | назва | параметри):
${pool.map(line).join("\n")}`;
        const body = {
          systemInstruction: { parts: [{ text: `Ти — академічний радник. Запропонуй 3 різні варіанти наборів вибіркових дисциплін.
Правила: використовуй лише ID з переліку; сума кредитів у кожному варіанті має дорівнювати рівно потрібній кількості; для курсу з кількома варіантами кредитів обери один із них; не більше 5 курсів у варіанті; без двох курсів з однаковою назвою.
Враховуй побажання студента, користь для спеціальності, рекомендації кафедри і позначки ★; уникай дублювання обов’язкових.
Пиши українською, коротко: title до 6 слів, why до 30 слів, reason до 18 слів.` }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.5, responseMimeType: "application/json",
            responseSchema: { type: "OBJECT", required: ["summary", "options"], properties: {
              summary: { type: "STRING" },
              options: { type: "ARRAY", items: { type: "OBJECT", required: ["title", "why", "picks"], properties: {
                title: { type: "STRING" }, why: { type: "STRING" },
                picks: { type: "ARRAY", items: { type: "OBJECT", required: ["id", "credits", "reason"], properties: {
                  id: { type: "INTEGER" }, credits: { type: "NUMBER" }, reason: { type: "STRING" } } } } } } } } },
          },
        };
        const res = await gem.request(API + `models/${encodeURIComponent(aiModel)}:generateContent`, "POST", JSON.stringify(body));
        if (!res.ok) throw new Error(apiError(res));
        const data = JSON.parse(res.body);
        const cand = data.candidates?.[0];
        if (!cand) throw new Error("Gemini не дав відповіді" + (data.promptFeedback?.blockReason ? ` (${data.promptFeedback.blockReason})` : ""));
        const text = (cand.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("").replace(/^```(?:json)?|```$/g, "").trim();
        const out = JSON.parse(text);
        const poolIds = new Set(pool.map(c => c.id));
        out.options = (out.options || []).map(o => {
          const seen = new Set();
          const picks = (o.picks || []).filter(p => poolIds.has(p.id) && !seen.has(p.id) && seen.add(p.id)).map(p => {
            const c = BY_ID.get(p.id);
            const credits = c.credit_options.includes(p.credits) ? p.credits : c.credit_options.reduce((a, v) => Math.abs(v - p.credits) < Math.abs(a - p.credits) ? v : a);
            return { ...p, credits };
          });
          return { ...o, picks, sum: picks.reduce((a, p) => a + p.credits, 0) };
        }).filter(o => o.picks.length);
        aiResult = { sem: s.key, parity: s.parity, need, model: aiModel, ...out };
      } catch (e) {
        aiError = e.message || String(e);
      }
      aiBusy = false;
      renderAI();
    }
    $("#ai-run").addEventListener("click", runAI);

    function renderAIResult() {
      const out = $("#ai-out");
      if (aiBusy) { out.innerHTML = `<div class="card-box ai-wait"><span class="spin"></span>Gemini підбирає курси… зазвичай 5–30 секунд</div>`; return; }
      if (aiError) { out.innerHTML = `<div class="card-box ai-err">${esc(aiError)}</div>`; return; }
      if (!aiResult) { out.innerHTML = ""; return; }
      const r = aiResult;
      out.innerHTML = `${r.summary ? `<p class="ai-summary">${esc(r.summary)}</p>` : ""}
        ${r.options.length ? r.options.map((o, i) => {
          const allIn = o.picks.every(p => inPlan(BY_ID.get(p.id)));
          const st = o.sum === r.need ? `<span class="flag ok">✓ рівно ${fmt(o.sum)} кр.</span>` : `<span class="flag warn">${fmt(o.sum)} з ${fmt(r.need)} кр.</span>`;
          return `<article class="ai-opt">
            <div class="ai-opt-head"><div><span class="ai-n">${i + 1}</span><b>${esc(o.title)}</b></div>${st}</div>
            <p class="hint">${esc(o.why)}</p>
            ${o.picks.map((p, j) => { const c = BY_ID.get(p.id), ctl = controlFor(c, r.parity), added = inPlan(c);
              return `<div class="ai-pick">
                <span class="ctl ${ctlClass(ctl)}">${CONTROL_SHORT[ctl] || "?"}</span>
                <div><a href="${syllabusUrl(c)}" target="_blank" rel="noopener"><b>${esc(c.name)}</b></a>${recommended.has(c.id) ? " 🎓" : ""}
                  <div class="hint">${esc(p.reason)}</div></div>
                <b class="ai-cr">${p.credits}</b>
                <button class="ic ${added ? "on" : ""}" data-ai-pick="${i}:${j}" title="${added ? "У плані" : "Додати в план"}">${added ? "✓" : "+"}</button>
              </div>`; }).join("")}
            <div class="row" style="margin-top:10px"><button class="add ${allIn ? "on" : ""}" data-ai-add="${i}" ${allIn ? "disabled" : ""}>${allIn ? "✓ Набір у плані" : "+ Додати весь набір"}</button><button class="ghost" data-ai-variant="${i}" title="Новий варіант плану: поточні курси + цей набір">Як новий варіант</button></div>
          </article>`;
        }).join("") : `<div class="card-box">Gemini не запропонував коректних варіантів. Спробуйте ще раз або змініть побажання.</div>`}
        <p class="hint">Модель: ${esc(r.model)}. ШІ може помилятись — перевіряйте силабуси перед заявою.</p>`;
    }
    $("#ai-out").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b || !aiResult) return;
      const add = p => { const c = BY_ID.get(p.id); if (c && !inPlan(c)) toggleBasket(c.id, p.credits, aiResult.sem); };
      if (b.dataset.aiAdd != null) aiResult.options[+b.dataset.aiAdd].picks.forEach(add);
      if (b.dataset.aiVariant != null) {
        const o = aiResult.options[+b.dataset.aiVariant];
        newVariant([...basket, ...o.picks.filter(p => !basket.some(x => x.id === p.id)).map(p => ({ id: p.id, credits: p.credits, sem: aiResult.sem }))],
          `ШІ: ${o.title}`.slice(0, 40));
        return;
      }
      if (b.dataset.aiPick) {
        const [i, j] = b.dataset.aiPick.split(":").map(Number), p = aiResult.options[i].picks[j];
        inPlan(BY_ID.get(p.id)) ? toggleBasket(p.id) : add(p);
      }
      render();
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
        if (account.plan?.length) setPlanSemesters(account.plan.map(p => semEntry(p.num, String(p.left))));
        else numberPlanSemesters();
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
    numberPlanSemesters();
    syncControls();
    render();
    if (env.live) loadAccount();
  }

  window.ElectivesApp = { mount };
})();
