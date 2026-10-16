// Інтерфейс підбору вибіркових дисциплін.
// Працює і як окрема сторінка (index.html), і всередині сайту через розширення (content.js).
// ElectivesApp.mount(element, data, env)
//   env.live         — запущено на dl.tntu.edu.ua під акаунтом
//   env.loadAccount  — async () => {speciality, mandatory[], plan[], selected[], selectedTitle}
//   env.close        — закрити оверлей
(function () {
  const CONTROL = { exam: "екзамен", credit: "залік", diff_credit: "диф. залік", none: "немає" };
  const LANG = { uk: "українська", en: "англійська" };
  const KIND = { elective: "вибіркова", mandatory: "обов’язкова для своєї ОП (для інших — вибіркова)" };
  const DEGREE = { bachelor: "Бакалавр", master: "Магістр", phd: "Доктор філософії" };
  const SEM = { fall: "Осінній (непарний)", spring: "Весняний (парний)" };
  const PAGE = 60;

  const norm = s => String(s || "").toLowerCase().replace(/[’'ʼ`"«»]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const tokens = s => new Set(norm(s).split(" ").filter(w => w.length > 2));
  const esc = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const fmt = n => String(Math.round(n * 100) / 100);
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
    const DEP_NAME = Object.fromEntries(D.options.departments.map(d => [d.id, d.name]));
    const MAJOR_NAME = Object.fromEntries(D.options.majors.flatMap(g => g.items.map(i => [i.id, i.name])));

    // ---------- стан ----------
    const DEFAULTS = { q: "", lang: "", dep: "", major: "", degree: "", sem: "", credits: [], control: [], year: [],
      nocw: false, star: false, hideBlocked: true, hideSimilar: false, sort: "rating", view: "cards" };
    const S = Object.assign({}, DEFAULTS, store.get("filters", {}));
    let stars = new Set(store.get("stars", []));
    let basket = store.get("basket", []);              // [{id, credits, sem: planKey}]
    let account = store.get("account", null);          // дані з акаунта (лише в розширенні)
    let accountState = env.live ? "loading" : "off";
    let accountError = "";
    let manualMandatory = store.get("mandatory", "");
    let plan = store.get("plan", null) || defaultPlan();
    const compare = new Set();
    let page = 1;
    let lastCombos = [];

    function defaultPlan() {
      return [{ key: "fall", label: "Осінній семестр", parity: "fall", target: "" },
              { key: "spring", label: "Весняний семестр", parity: "spring", target: "" }];
    }
    const save = () => { store.set("filters", S); store.set("stars", [...stars]); store.set("basket", basket); store.set("plan", plan); };

    // ---------- обов’язкові ----------
    let mandatoryIds = new Set(), mandatoryNames = [], siteSelected = new Map();
    function rebuildMandatory() {
      const fromAcc = account?.mandatory || [];
      mandatoryIds = new Set(fromAcc.map(m => m.id));
      mandatoryNames = [...new Set([...fromAcc.map(m => m.name), ...manualMandatory.split("\n").map(s => s.trim()).filter(Boolean)])];
      siteSelected = new Map((account?.selected || []).map(x => [x.id, x]));
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
    function semLabel(c) {
      const nums = semNums(c);
      return nums.length ? nums.map(n => `${n} сем.`).join(", ") : "сем. ?";
    }
    const parityLabel = c => [...parities(c)].map(p => p === "fall" ? "осінь" : "весна").join(" / ") || "?";

    // ---------- розмітка ----------
    const creditCounts = {};
    COURSES.forEach(c => c.credit_options.forEach(v => creditCounts[v] = (creditCounts[v] || 0) + 1));
    const creditValues = Object.keys(creditCounts).map(Number).filter(v => creditCounts[v] >= 5).sort((a, b) => a - b);

    root.innerHTML = `
      <header class="el-header">
        <div class="brand"><b>Вибіркові дисципліни ТНТУ</b><span class="muted" id="meta"></span></div>
        <div id="account" class="account"></div>
        <button id="toggle-filters" class="only-narrow">☰ Фільтри</button>
        ${env.close ? `<button id="close" class="icon-btn" title="Закрити (Esc)">✕</button>` : ""}
      </header>
      <div class="layout">
        <aside class="left" id="filters">
          <section class="panel">
            <div class="panel-head"><h2>Фільтри</h2><button class="link" id="reset">Скинути все</button></div>
            <details open><summary>Як на сайті</summary>
              <label class="f" for="f-lang">Мова викладання</label>
              <select id="f-lang"><option value="">Усі</option><option value="uk">Українська</option><option value="en">Англійська</option></select>
              <label class="f" for="f-dep">Підрозділ, кафедра, відділ, центр</label>
              <select id="f-dep"><option value="">Усі</option>${D.options.departments.map(d => `<option value="${d.id}">${d.sub ? "    " : ""}${esc(d.name)}</option>`).join("")}</select>
              <label class="f" for="f-major">Галузь знань і спеціальність <button class="link small" id="my-major" hidden>← моя</button></label>
              <select id="f-major"><option value="">Усі</option>${D.options.majors.map(g => `<optgroup label="${esc(g.label)}">${g.items.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join("")}</optgroup>`).join("")}</select>
              <label class="f" for="f-degree">Ступінь освіти</label>
              <select id="f-degree"><option value="">Усі</option>${Object.entries(DEGREE).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
              <label class="f" for="f-sem">Семестр, в якому читається</label>
              <select id="f-sem"><option value="">Усі</option>${Object.entries(SEM).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
            </details>
            <details open><summary>Додатково</summary>
              <label class="f">Кредити ЄКТС</label>
              <div class="chips" data-chips="credits">${creditValues.map(v => `<button class="chip" data-v="${v}">${v}</button>`).join("")}</div>
              <label class="f">Підсумковий контроль</label>
              <div class="chips" data-chips="control">${[["exam", "Екзамен"], ["credit", "Залік"], ["diff_credit", "Диф. залік"]].map(([v, l]) => `<button class="chip" data-v="${v}">${l}</button>`).join("")}</div>
              <label class="f">Рекомендований рік навчання</label>
              <div class="chips" data-chips="year">${[1, 2, 3, 4, 5, 6].map(y => `<button class="chip" data-v="${y}">${y}${y > 4 ? " (маг.)" : ""}</button>`).join("")}</div>
              <label class="check"><input type="checkbox" id="f-nocw"> Без курсової роботи</label>
              <label class="check"><input type="checkbox" id="f-star"> Лише ★ цікаві</label>
              <label class="check"><input type="checkbox" id="f-hideBlocked"> Ховати мої обов’язкові</label>
              <label class="check"><input type="checkbox" id="f-hideSimilar"> Ховати й схожі назви</label>
            </details>
          </section>
          <section class="panel">
            <h2>Мої обов’язкові дисципліни</h2>
            <div id="mand-account"></div>
            <details ${env.live ? "" : "open"} id="mand-manual-wrap"><summary>${env.live ? "Додати вручну" : "Список"}</summary>
              <div class="muted">По одній назві на рядок. Такі ж назви буде приховано, схожі позначено ⚠.</div>
              <textarea id="mandatory" placeholder="Вища математика&#10;Програмування"></textarea>
            </details>
          </section>
        </aside>

        <main class="main">
          <div class="searchbar">
            <input id="q" type="search" placeholder="Пошук за назвою, викладачем, змістом курсу…   ( / )" autocomplete="off">
          </div>
          <div class="toolbar">
            <span class="count" id="count"></span>
            <div id="active" class="active-chips"></div>
            <span class="spacer"></span>
            <select id="sort" aria-label="Сортування">
              <option value="rating">За рейтингом</option><option value="name">За назвою</option>
              <option value="credits">За кредитами</option><option value="year">За роком навчання</option>
            </select>
            <div class="seg" role="group" aria-label="Вигляд">
              <button data-view="cards">Картки</button><button data-view="table">Таблиця</button>
            </div>
          </div>
          <div id="list"></div>
          <button class="more-btn" id="more">Показати ще</button>
        </main>

        <aside class="right">
          <section class="panel">
            <h2>Мій план</h2>
            <div id="plan"></div>
          </section>
          <section class="panel">
            <h2>Підібрати комбінацію</h2>
            <div class="muted">Шукає набори курсів, що точно дозбирають кредити. Кандидати — ★ цікаві (якщо є), інакше поточний список з фільтрами.</div>
            <div class="row" style="margin-top:8px">
              <select id="c-sem" style="width:auto"></select>
              <label class="muted">до <input type="number" id="c-max" value="3" min="1" max="5" style="width:52px"> курсів</label>
              <button class="primary" id="c-run">Підібрати</button>
            </div>
            <div id="combos"></div>
          </section>
        </aside>
      </div>
      <div id="comparebar" class="comparebar" hidden></div>
      <div id="modal" class="modal" hidden><div class="modal-box" role="dialog" aria-modal="true"><button class="icon-btn modal-x" title="Закрити">✕</button><div id="modal-body"></div></div></div>`;

    // ---------- синхронізація полів ----------
    const selects = { lang: "#f-lang", dep: "#f-dep", major: "#f-major", degree: "#f-degree", sem: "#f-sem", sort: "#sort" };
    const checks = ["nocw", "star", "hideBlocked", "hideSimilar"];
    function syncControls() {
      for (const [k, sel] of Object.entries(selects)) $(sel).value = S[k];
      for (const k of checks) $("#f-" + k).checked = S[k];
      $("#q").value = S.q;
      root.querySelectorAll("[data-chips]").forEach(group => {
        const key = group.dataset.chips;
        group.querySelectorAll(".chip").forEach(ch => ch.classList.toggle("on", S[key].includes(+ch.dataset.v) || S[key].includes(ch.dataset.v)));
      });
      root.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === S.view));
    }
    const update = () => { page = 1; save(); render(); };
    for (const [k, sel] of Object.entries(selects)) $(sel).addEventListener("change", e => { S[k] = e.target.value; update(); });
    for (const k of checks) $("#f-" + k).addEventListener("change", e => { S[k] = e.target.checked; update(); });
    let qTimer;
    $("#q").addEventListener("input", e => { clearTimeout(qTimer); qTimer = setTimeout(() => { S.q = e.target.value; update(); }, 120); });
    root.querySelectorAll("[data-chips]").forEach(group => group.addEventListener("click", e => {
      const ch = e.target.closest(".chip"); if (!ch) return;
      const key = group.dataset.chips;
      const v = key === "control" ? ch.dataset.v : +ch.dataset.v;
      S[key] = S[key].includes(v) ? S[key].filter(x => x !== v) : [...S[key], v];
      syncControls(); update();
    }));
    root.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => { S.view = b.dataset.view; syncControls(); save(); render(); }));
    $("#reset").addEventListener("click", () => {
      Object.assign(S, DEFAULTS, { sort: S.sort, view: S.view });
      syncControls(); update();
    });
    $("#toggle-filters").addEventListener("click", () => root.classList.toggle("filters-open"));
    $("#mandatory").value = manualMandatory;
    $("#mandatory").addEventListener("input", e => {
      manualMandatory = e.target.value; store.set("mandatory", manualMandatory);
      rebuildMandatory(); blockCache.clear(); render();
    });
    if (env.close) $("#close").addEventListener("click", env.close);

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
      const b = blockState(c);
      if (b?.exact && S.hideBlocked) return false;
      if (b?.similar && S.hideSimilar) return false;
      return true;
    }
    const SORTS = {
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
      if (S.sem) add(SEM[S.sem], () => S.sem = "");
      S.credits.forEach(v => add(`${v} кр.`, () => S.credits = S.credits.filter(x => x !== v)));
      S.control.forEach(v => add(CONTROL[v], () => S.control = S.control.filter(x => x !== v)));
      S.year.forEach(v => add(`${v} рік`, () => S.year = S.year.filter(x => x !== v)));
      if (S.nocw) add("без курсової", () => S.nocw = false);
      if (S.star) add("лише ★", () => S.star = false);
      return chips;
    }

    // ---------- картки й таблиця ----------
    function controlTags(c) {
      if (c.semesters?.length > 1)
        return c.semesters.map(s => `<span class="tag ${s.control === "exam" ? "exam" : "credit"}">${s.semester} сем.: ${CONTROL[s.control] || s.control}</span>`).join("");
      return (c.controls || []).map(k => `<span class="tag ${k === "exam" ? "exam" : "credit"}">${CONTROL[k] || k}</span>`).join("");
    }
    function warnTags(c) {
      const b = blockState(c);
      const out = [];
      if (b) out.push(`<span class="tag warn">⚠ ${b.exact ? (mandatoryIds.has(c.id) ? "ваша обов’язкова" : "збігається з обов’язковою") : `схоже на обов’язкову «${esc(b.match)}»`}</span>`);
      if (siteSelected.has(c.id)) out.push(`<span class="tag ok">✓ уже обрано на сайті</span>`);
      const same = basket.find(x => x.id !== c.id && BY_ID.get(x.id) && norm(BY_ID.get(x.id).name) === norm(c.name));
      if (same) out.push(`<span class="tag warn">курс з такою назвою вже у плані</span>`);
      if (c.termpaper) out.push(`<span class="tag warn">курсова робота</span>`);
      return out.join("");
    }
    const syllabusUrl = c => `https://dl.tntu.edu.ua/mods/syllabus/view.php?sid=${c.sid}`;
    function actionsHTML(c, compact) {
      const inB = basket.some(x => x.id === c.id);
      return `<button class="star ${stars.has(c.id) ? "on" : ""}" data-act="star" title="${stars.has(c.id) ? "Прибрати з цікавих" : "Цікавить"}" aria-pressed="${stars.has(c.id)}">★</button>
        <button data-act="cmp" class="${compact ? "small" : ""} ${compare.has(c.id) ? "on" : ""}" title="Додати до порівняння">⇄${compact ? "" : " Порівняти"}</button>
        <button data-act="add" class="${compact ? "small" : ""} ${inB ? "" : "primary"}">${inB ? "✓ У плані" : "+ У план"}</button>`;
    }
    function cardHTML(c) {
      const b = blockState(c);
      const h = c.hours || {};
      const hrs = [["лекції", h.lections], ["практичні", h.practical], ["лабораторні", h.lab], ["самостійна", h.individual]].filter(x => x[1]).map(x => `${x[0]} ${x[1]} год`).join(" · ");
      return `<article class="card ${b?.exact ? "blocked" : ""} ${basket.some(x => x.id === c.id) ? "inplan" : ""}" data-id="${c.id}">
        <div class="card-main">
          <h3 class="title"><a href="${syllabusUrl(c)}" target="_blank" rel="noopener">${esc(c.name)}</a></h3>
          <div class="sub">${esc(c.lecturer_degree)} ${c.cv ? `<a href="${esc(c.cv)}" target="_blank" rel="noopener">${esc(c.lecturer)}</a>` : esc(c.lecturer)}${DEP_NAME[c.department] ? ` · ${esc(DEP_NAME[c.department])}` : ""}</div>
          <div class="facts">
            <span class="fact big">${c.credit_options.join(" / ")} <small>кр.</small></span>
            ${controlTags(c)}
            <span class="tag">${c.year ? c.year + " рік" : "рік ?"}</span>
            <span class="tag">${parityLabel(c)} · ${semLabel(c)}</span>
            ${c.lang === "en" ? `<span class="tag">англійська</span>` : ""}
            <span class="tag muted-tag" title="Рейтинг на сайті">★ ${c.rating}</span>
            ${warnTags(c)}
          </div>
        </div>
        <div class="actions">${actionsHTML(c)}</div>
        <details class="more"><summary>Деталі</summary>
          ${c.objective ? `<p><b>Мета:</b> ${esc(c.objective)}</p>` : ""}
          ${c.prerequisites ? `<p><b>Передумови:</b> ${esc(c.prerequisites)}</p>` : ""}
          ${hrs ? `<p><b>Години (денна):</b> ${hrs}</p>` : ""}
          <p><b>Статус у силабусі:</b> ${KIND[c.kind] || "?"} · ID ${c.id}</p>
        </details>
      </article>`;
    }
    function tableHTML(rows) {
      return `<div class="table-wrap"><table class="tbl">
        <thead><tr><th></th><th>Назва</th><th>Кр.</th><th>Контроль</th><th>Рік</th><th>Семестр</th><th>Рейт.</th><th>Викладач</th><th></th></tr></thead>
        <tbody>${rows.map(c => `<tr data-id="${c.id}" class="${blockState(c)?.exact ? "blocked" : ""} ${basket.some(x => x.id === c.id) ? "inplan" : ""}">
          <td><button class="star ${stars.has(c.id) ? "on" : ""}" data-act="star" aria-pressed="${stars.has(c.id)}">★</button></td>
          <td><a href="${syllabusUrl(c)}" target="_blank" rel="noopener">${esc(c.name)}</a><div class="facts">${warnTags(c)}</div></td>
          <td class="num"><b>${c.credit_options.join("/")}</b></td>
          <td>${(c.controls || []).map(k => CONTROL[k]).join(", ")}</td>
          <td class="num">${c.year || "?"}</td>
          <td>${parityLabel(c)}</td>
          <td class="num">${c.rating}</td>
          <td>${esc(c.lecturer)}</td>
          <td class="nowrap">${actionsHTML(c, true).replace(/<button class="star[^]*?<\/button>/, "")}</td>
        </tr>`).join("")}</tbody></table></div>`;
    }

    function render() {
      const res = COURSES.filter(c => matches(c)).sort(SORTS[S.sort]);
      $("#count").textContent = `Знайдено: ${res.length}`;
      $("#active").innerHTML = activeChips().map((c, i) => `<button class="achip" data-i="${i}" title="Прибрати фільтр">${esc(c.label)} ✕</button>`).join("");
      const shown = res.slice(0, page * PAGE);
      $("#list").innerHTML = !res.length
        ? `<div class="empty"><b>Нічого не знайдено.</b><br>Спробуйте прибрати частину фільтрів${S.star ? " або вимкнути «Лише ★»" : ""}.</div>`
        : S.view === "table" ? tableHTML(shown) : `<div class="cards">${shown.map(cardHTML).join("")}</div>`;
      $("#more").hidden = res.length <= page * PAGE;
      $("#more").textContent = `Показати ще (${res.length - page * PAGE})`;
      renderPlan(); renderCompareBar(); renderAccount();
    }
    $("#active").addEventListener("click", e => {
      const b = e.target.closest(".achip"); if (!b) return;
      activeChips()[+b.dataset.i].clear(); syncControls(); update();
    });
    $("#more").addEventListener("click", () => { page++; render(); });
    $("#list").addEventListener("click", e => {
      const btn = e.target.closest("button[data-act]"); if (!btn) return;
      const id = +btn.closest("[data-id]").dataset.id;
      act(btn.dataset.act, id);
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
    function renderPlan() {
      let html = "";
      if (account?.plan?.length) html += `<div class="note">Ліміти взято з вкладки «${esc(account.selectedTitle || "Обрані мною")}» — це скільки ще лишилось набрати.</div>`;
      for (const s of plan) {
        const items = basket.filter(x => x.sem === s.key);
        const sum = items.reduce((a, x) => a + x.credits, 0);
        const t = +s.target || 0;
        html += `<div class="plan-sem" data-key="${s.key}">
          <div class="plan-head"><b>${esc(s.label)}</b>
            <label class="muted">треба <input type="number" step="0.5" min="0" data-target="${s.key}" value="${esc(s.target)}" style="width:64px"> кр.</label></div>
          <div class="sum"><span>${fmt(sum)}${t ? " / " + fmt(t) : ""} кр.</span>
            <span class="${t && sum === t ? "ok-text" : t && sum > t ? "bad-text" : "muted"}">${!t ? "вкажіть ліміт" : sum === t ? "✓ рівно" : sum < t ? `бракує ${fmt(t - sum)}` : `перебір ${fmt(sum - t)}`}</span></div>
          ${t ? `<div class="bar ${sum > t ? "over" : ""}"><div style="width:${Math.min(100, sum / t * 100)}%"></div></div>` : ""}
          ${items.map(x => {
            const c = BY_ID.get(x.id); if (!c) return "";
            const wrong = parities(c).size && !parities(c).has(s.parity);
            return `<div class="plan-item" data-id="${c.id}">
              <div><a href="${syllabusUrl(c)}" target="_blank" rel="noopener">${esc(c.name)}</a>
                <div class="muted">${(c.controls || []).map(k => CONTROL[k]).join(", ")} · ${c.year || "?"} рік · ${esc(c.lecturer)}</div>
                ${wrong ? `<span class="tag warn">читається: ${parityLabel(c)}</span>` : ""}
                ${blockState(c) ? `<span class="tag warn">⚠ обов’язкова/схожа</span>` : ""}</div>
              <div class="plan-ctl">
                ${c.credit_options.length > 1 ? `<select data-pact="cr" aria-label="Кредити">${c.credit_options.map(v => `<option ${v === x.credits ? "selected" : ""}>${v}</option>`).join("")}</select>` : `<span>${x.credits} кр.</span>`}
                ${plan.length > 1 ? `<select data-pact="sem" aria-label="Семестр">${plan.map(p => `<option value="${p.key}" ${p.key === s.key ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select>` : ""}
                <button class="link" data-pact="rm">прибрати</button>
              </div></div>`;
          }).join("") || `<div class="muted empty-sem">Ще нічого не обрано</div>`}
        </div>`;
      }
      const exams = basket.filter(x => (BY_ID.get(x.id)?.controls || []).includes("exam")).length;
      if (basket.length) html += `<div class="muted" style="margin-top:8px">Усього ${basket.length} дисц., з екзаменом: ${exams}</div>
        <div class="row" style="margin-top:6px"><button id="copy">Скопіювати список</button><button id="clear">Очистити</button></div>`;
      $("#plan").innerHTML = html;
      const cur = $("#c-sem").value;
      $("#c-sem").innerHTML = plan.map(p => `<option value="${p.key}">${esc(p.label)}</option>`).join("");
      if (plan.some(p => p.key === cur)) $("#c-sem").value = cur;
    }
    $("#plan").addEventListener("input", e => {
      const k = e.target.dataset.target; if (!k) return;
      plan.find(p => p.key === k).target = e.target.value; save();
    });
    $("#plan").addEventListener("change", e => {
      if (e.target.dataset.target) { render(); return; }
      const it = e.target.closest(".plan-item"); if (!it) return;
      const x = basket.find(b => b.id === +it.dataset.id);
      if (e.target.dataset.pact === "cr") x.credits = +e.target.value;
      if (e.target.dataset.pact === "sem") x.sem = e.target.value;
      save(); render();
    });
    $("#plan").addEventListener("click", e => {
      if (e.target.dataset.pact === "rm") { toggleBasket(+e.target.closest(".plan-item").dataset.id); render(); }
      if (e.target.id === "copy") {
        const txt = plan.map(p => `${p.label}:\n` + basket.filter(x => x.sem === p.key).map(x => {
          const c = BY_ID.get(x.id); return `  ${c.id} — ${c.name} (${x.credits} кр., ${(c.controls || []).map(k => CONTROL[k]).join("/")}, ${c.lecturer})`;
        }).join("\n")).join("\n");
        navigator.clipboard.writeText(txt).then(() => { e.target.textContent = "Скопійовано ✓"; });
      }
      if (e.target.id === "clear" && confirm("Очистити весь план?")) { basket = []; save(); render(); }
    });

    // ---------- комбінації ----------
    function runCombos() {
      const s = plan.find(p => p.key === $("#c-sem").value) || plan[0];
      const target = +s.target || 0;
      const have = basket.filter(x => x.sem === s.key).reduce((a, x) => a + x.credits, 0);
      const need = Math.round((target - have) * 2) / 2;
      const out = $("#combos");
      if (!target) { out.innerHTML = `<p class="muted">Вкажіть у «Мій план», скільки кредитів треба набрати в цьому семестрі.</p>`; return; }
      if (need <= 0) { out.innerHTML = `<p class="ok-text">У цьому семестрі вже набрано ${fmt(have)} з ${fmt(target)} кр.</p>`; return; }

      const takenNames = new Set(basket.map(x => norm(BY_ID.get(x.id).name)));
      let pool = COURSES.filter(c => !basket.some(x => x.id === c.id) && !siteSelected.has(c.id) && !takenNames.has(norm(c.name))
        && parities(c).has(s.parity) && !blockState(c)?.exact);
      const starred = pool.filter(c => stars.has(c.id));
      const fromStars = starred.length > 0;
      pool = (fromStars ? starred : pool.filter(c => matches(c, { ignoreSem: true }))).sort((a, b) => b.rating - a.rating).slice(0, 70);

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
      results.sort((a, b) => a.length - b.length || score(b) - score(a));
      lastCombos = results.slice(0, 12);
      out.innerHTML = `<p class="muted">Дозібрати <b>${fmt(need)} кр.</b> · кандидатів ${pool.length} (${fromStars ? "★ цікаві" : "з фільтрів"}) · варіантів ${results.length}${results.length > 4000 ? "+" : ""}</p>` +
        (lastCombos.length ? lastCombos.map((r, i) => `<div class="combo"><div class="combo-head"><b>${r.length} дисц.</b><span class="muted">сер. рейтинг ${score(r).toFixed(1)}</span></div>
          <ul>${r.map(x => `<li>${esc(x.c.name)} <span class="muted">— ${x.v} кр., ${(x.c.controls || []).map(k => CONTROL[k]).join("/")}, ${x.c.year || "?"} рік</span></li>`).join("")}</ul>
          <button data-combo="${i}">+ Додати всі в план</button></div>`).join("")
          : `<p class="muted">Точної комбінації немає. Збільште кількість курсів у наборі, позначте більше ★ або послабте фільтри.</p>`);
    }
    $("#c-run").addEventListener("click", runCombos);
    $("#combos").addEventListener("click", e => {
      const i = e.target.dataset.combo; if (i == null) return;
      const sem = $("#c-sem").value;
      for (const x of lastCombos[i]) if (!basket.some(b => b.id === x.c.id)) toggleBasket(x.c.id, x.v, sem);
      render(); runCombos();
    });

    // ---------- порівняння ----------
    function renderCompareBar() {
      const bar = $("#comparebar");
      bar.hidden = !compare.size;
      if (!compare.size) return;
      bar.innerHTML = `<span>Порівняння:</span>${[...compare].map(id => `<span class="achip">${esc(BY_ID.get(id).name)} <button class="link" data-uncmp="${id}" aria-label="Прибрати">✕</button></span>`).join("")}
        <span class="spacer"></span><button class="primary" id="cmp-open" ${compare.size < 2 ? "disabled" : ""}>Порівняти (${compare.size})</button><button id="cmp-clear">Очистити</button>`;
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
        ["Контроль", c => (c.controls || []).map(k => CONTROL[k]).join(", ")],
        ["Рік навчання", c => c.year || "?"],
        ["Семестр", c => `${parityLabel(c)} (${semLabel(c)})`],
        ["Рейтинг", c => c.rating],
        ["Викладач", c => `${esc(c.lecturer_degree)} ${esc(c.lecturer)}`],
        ["Кафедра", c => esc(DEP_NAME[c.department] || "")],
        ["Години", c => { const h = c.hours || {}; return `лек ${h.lections || 0} · пр ${h.practical || 0} · лаб ${h.lab || 0} · сам ${h.individual || 0}`; }],
        ["Курсова", c => c.termpaper ? "так" : "ні"],
        ["Мова", c => LANG[c.lang] || ""],
        ["Мета", c => esc(c.objective)],
        ["Передумови", c => esc(c.prerequisites)],
        ["", c => `<button data-act="add" data-id="${c.id}" class="${basket.some(x => x.id === c.id) ? "" : "primary"}">${basket.some(x => x.id === c.id) ? "✓ У плані" : "+ У план"}</button>`],
      ];
      $("#modal-body").innerHTML = `<h2>Порівняння</h2><div class="table-wrap"><table class="tbl cmp">
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
      if (!env.live) {
        el.innerHTML = `<span class="muted">Обов’язкові — вручну. Через розширення на dl.tntu.edu.ua вони підтягуються з акаунта.</span>`;
      } else if (accountState === "loading" && !account) {
        el.innerHTML = `<span class="muted">Завантажую дані вашого акаунта…</span>`;
      } else if (accountState === "error" && !account) {
        el.innerHTML = `<span class="bad-text">Не вдалося прочитати акаунт: ${esc(accountError)}</span> <button class="small" id="acc-refresh">Спробувати ще</button>`;
      } else if (account) {
        const planTxt = (account.plan || []).map(p => `${p.num} сем. — ${fmt(p.left)} кр.`).join(", ");
        el.innerHTML = `<span class="acc-pill">👤 ${esc(account.speciality || "акаунт")}</span>
          <span class="muted">${account.mandatory.length} обов’язкових${planTxt ? ` · лишилось: ${planTxt}` : ""} · ${accountState === "loading" ? "оновлюю…" : "оновлено " + esc(account.at)}</span>
          ${accountState === "error" ? `<span class="bad-text" title="${esc(accountError)}">помилка оновлення</span>` : ""}
          <button class="small" id="acc-refresh">Оновити</button>`;
      }
      const r = $("#acc-refresh"); if (r) r.onclick = loadAccount;

      const ma = $("#mand-account");
      if (account?.mandatory?.length) {
        const bySem = {};
        account.mandatory.forEach(m => (bySem[m.semester || "?"] ||= []).push(m));
        ma.innerHTML = `<details><summary>З акаунта: ${account.mandatory.length} дисциплін</summary>
          ${Object.entries(bySem).map(([s, ms]) => `<div class="mand-sem"><b>${s} семестр</b><ul>${ms.map(m => `<li>${esc(m.name)} <span class="muted">${m.credits ?? ""}</span></li>`).join("")}</ul></div>`).join("")}</details>`;
      } else ma.innerHTML = "";

      const mm = $("#my-major");
      mm.hidden = !account?.majorId || String(account.majorId) === S.major;
      mm.onclick = () => { S.major = String(account.majorId); syncControls(); update(); };
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
          plan = account.plan.map(p => ({ key: "s" + p.num, label: `${p.num} семестр (${p.num % 2 ? "осінь" : "весна"})`,
            parity: p.num % 2 ? "fall" : "spring", target: String(p.left) }));
          basket.forEach(x => {
            if (plan.some(p => p.key === x.sem)) return;
            const par = old.find(p => p.key === x.sem)?.parity;
            x.sem = (plan.find(p => p.parity === par) || plan[0]).key;
          });
        }
        if (first && account.majorId && !S.major) { S.major = String(account.majorId); syncControls(); }
        accountState = "ok";
        rebuildMandatory(); blockCache.clear(); save();
      } catch (e) {
        accountState = "error"; accountError = e.message || String(e);
      }
      render();
    }

    // ---------- клавіатура ----------
    const onKey = e => {
      if (!root.isConnected || root.getRootNode().host?.style.display === "none") return;
      const t = e.composedPath()[0];
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
      if (e.key === "/" && !typing) { e.preventDefault(); $("#q").focus(); }
      if (e.key === "Escape") {
        if (!$("#modal").hidden) $("#modal").hidden = true;
        else if (root.classList.contains("filters-open")) root.classList.remove("filters-open");
        else if (typing) t.blur();
        else if (env.close) env.close();
      }
    };
    document.addEventListener("keydown", onKey);

    $("#meta").textContent = `${COURSES.length} курсів · дані від ${D.fetched}`;
    rebuildMandatory();
    syncControls();
    render();
    if (env.live) loadAccount();
  }

  window.ElectivesApp = { mount };
})();
