    // ---------- Filtering ----------
    /**
     * Whether a course passes the current catalog filters (S), including hiding blocked/similar ones.
     * Caches the normalized search text on the course as `_hay`.
     * @param {Course} c
     * @param {{ignoreSem?: boolean}} [opts] ignoreSem: skip the semester-parity filter.
     * @returns {boolean}
     */
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
    /** Catalog comparators by S.sort; "smart" puts department-recommended first, then by rating. */
    const SORTS = {
      smart: (a, b) => recommended.has(b.id) - recommended.has(a.id) || b.rating - a.rating,
      rating: (a, b) => b.rating - a.rating,
      name: (a, b) => a.name.localeCompare(b.name, "uk"),
      credits: (a, b) => a.credits - b.credits || b.rating - a.rating,
      year: (a, b) => (a.year || 9) - (b.year || 9) || b.rating - a.rating,
    };
    /**
     * Removable chips describing the active filters.
     * @returns {{label: string, clear: () => void}[]} `clear` resets that filter in S (caller then calls update()).
     */
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

    // ---------- Catalog ----------
    /**
     * Syllabus page URL on dl.tntu.edu.ua.
     * @param {Course} c
     * @returns {string}
     */
    const syllabusUrl = c => `https://dl.tntu.edu.ua/mods/syllabus/view.php?sid=${c.sid}`;
    /**
     * Whether the course is in the active plan variant.
     * @param {Course} c
     * @returns {boolean}
     */
    const inPlan = c => basket.some(x => x.id === c.id);
    /** Highest rating in the catalog (≥1), used to scale rating bars. */
    const MAX_RATING = Math.max(1, ...COURSES.map(c => c.rating || 0));
    /**
     * Credit value, or "min–max" range when several options exist.
     * @param {Course} c
     * @returns {string}
     */
    const creditsLabel = c => c.credit_options.length > 1 ? `${c.credit_options[0]}–${c.credit_options[c.credit_options.length - 1]}` : String(c.credit_options[0]);
    /**
     * Rating bar markup (relative to MAX_RATING) with the numeric rating.
     * @param {Course} c
     * @returns {string} HTML.
     */
    const ratingHTML = c => `<span class="rating" title="Рейтинг курсу на сайті"><span class="rbar"><i style="width:${Math.round((c.rating || 0) / MAX_RATING * 100)}%"></i></span>${Math.round(c.rating || 0)}</span>`;
    /**
     * Status badges: recommended, selected on the site, taken/mandatory/similar, duplicate name in plan, term paper.
     * @param {Course} c
     * @returns {string} HTML (empty when no flags).
     */
    function flags(c) {
      const b = blockState(c), out = [];
      if (recommended.has(c.id)) out.push(`<span class="flag rec">🎓 рекомендує кафедра</span>`);
      if (siteSelected.has(c.id)) out.push(`<span class="flag ok">✓ обрано на сайті</span>`);
      if (b) out.push(`<span class="flag warn">${b.taken ? `уже у вашому плані · ${b.taken} сем` : b.exact ? (mandatoryIds.has(c.id) ? "ваша обов’язкова" : "= обов’язкова") : `≈ «${esc(b.match)}»`}</span>`);
      if (basket.some(x => x.id !== c.id && norm(BY_ID.get(x.id)?.name) === norm(c.name))) out.push(`<span class="flag warn">така назва вже в плані</span>`);
      if (c.termpaper) out.push(`<span class="flag">курсова</span>`);
      return out.join("");
    }
    /**
     * Control-type badges; per semester when the course spans several semesters.
     * @param {Course} c
     * @returns {string} HTML.
     */
    function controlsHTML(c) {
      if (c.semesters?.length > 1) return c.semesters.map(s => `<span class="ctl ${ctlClass(s.control)}">${CONTROL[s.control] || s.control}<i>${s.semester} сем</i></span>`).join("");
      return (c.controls || []).map(k => `<span class="ctl ${ctlClass(k)}">${CONTROL[k] || k}</span>`).join("");
    }
    /**
     * Catalog card for list view.
     * @param {Course} c
     * @returns {string} HTML.
     */
    function itemHTML(c) {
      const b = blockState(c), main = (c.controls || [])[0];
      const h = c.hours || {};
      const fl = flags(c);
      return `<article class="item ${ctlClass(main)} ${b?.exact ? "dim" : ""} ${inPlan(c) ? "picked" : ""}" data-id="${c.id}">
        <div class="coin"><b>${creditsLabel(c)}</b><small>${plural(c.credit_options[c.credit_options.length - 1], "кредит", "кредити", "кредитів")}</small></div>
        <div class="body">
          <div class="name"><a href="${syllabusUrl(c)}" target="_blank" rel="noopener">${esc(c.name)}</a></div>
          <div class="who">${esc(c.lecturer)}${DEP_NAME[c.department] ? ` · ${esc(DEP_NAME[c.department])}` : ""}</div>
          <div class="meta">${controlsHTML(c)}<span class="dot">${c.year ? c.year + " рік" : "рік ?"}</span><span class="dot">${parityLabel(c)}</span>${c.lang === "en" ? `<span class="dot">англ.</span>` : ""}<span class="dot">${ratingHTML(c)}</span></div>
          ${fl ? `<div class="flags">${fl}</div>` : ""}
          <details class="more"><summary>Про курс</summary>
            ${c.objective ? `<p>${esc(c.objective)}</p>` : ""}
            ${c.prerequisites ? `<p><b>Передумови:</b> ${esc(c.prerequisites)}</p>` : ""}
            <p class="hint">Лекції ${h.lections || 0} · практичні ${h.practical || 0} · лабораторні ${h.lab || 0} · самостійна ${h.individual || 0} год · ${KIND[c.kind] || ""} · ID ${c.id}${c.credit_options.length > 1 ? ` · варіанти: ${c.credit_options.join(" / ")} кр.` : ""}</p>
          </details>
        </div>
        <div class="acts">
          <button class="add ${inPlan(c) ? "on" : ""}" data-act="add">${inPlan(c) ? "✓ У плані" : "+ У план"}</button>
          <div class="acts-ic">
            <button class="ic star ${stars.has(c.id) ? "on" : ""}" data-act="star" title="${stars.has(c.id) ? "Прибрати з цікавих" : "Цікавить"}" aria-label="Цікавить" aria-pressed="${stars.has(c.id)}">${stars.has(c.id) ? "★" : "☆"}</button>
            <button class="ic ai ${aiList.has(c.id) ? "on" : ""}" data-act="ai" title="${aiList.has(c.id) ? "Прибрати зі списку для ШІ" : `До списку для ШІ (${parityLabel(c)})`}" aria-label="Список для ШІ" aria-pressed="${aiList.has(c.id)}">✨</button>
            <button class="ic ${compare.has(c.id) ? "on" : ""}" data-act="cmp" title="Порівняти" aria-label="Порівняти" aria-pressed="${compare.has(c.id)}">⇄</button>
          </div>
        </div>
      </article>`;
    }
    /**
     * Catalog table for table view.
     * @param {Course[]} rows Courses to show.
     * @returns {string} HTML.
     */
    function tableHTML(rows) {
      return `<div class="tbl-wrap"><table class="tbl cat">
        <thead><tr><th></th><th>Назва</th><th class="num">Кредити</th><th>Контроль</th><th class="num">Рік</th><th>Семестр</th><th>Рейтинг</th><th>Викладач</th><th></th></tr></thead>
        <tbody>${rows.map(c => `<tr data-id="${c.id}" class="${blockState(c)?.exact ? "dim" : ""} ${inPlan(c) ? "picked" : ""}">
          <td><button class="ic star ${stars.has(c.id) ? "on" : ""}" data-act="star" aria-pressed="${stars.has(c.id)}">${stars.has(c.id) ? "★" : "☆"}</button></td>
          <td><a href="${syllabusUrl(c)}" target="_blank" rel="noopener">${esc(c.name)}</a><div class="meta">${flags(c)}</div></td>
          <td class="num"><b>${c.credit_options.join("/")}</b></td>
          <td>${(c.controls || []).map(k => `<span class="ctl ${ctlClass(k)}">${CONTROL[k]}</span>`).join(" ")}</td>
          <td class="num">${c.year || "?"}</td><td class="nowrap">${parityLabel(c)}</td><td class="nowrap">${ratingHTML(c)}</td>
          <td class="lect">${esc(c.lecturer)}</td>
          <td class="nowrap"><button class="ic ai ${aiList.has(c.id) ? "on" : ""}" data-act="ai" title="До списку для ШІ" aria-pressed="${aiList.has(c.id)}">✨</button> <button class="ic ${compare.has(c.id) ? "on" : ""}" data-act="cmp" title="Порівняти">⇄</button> <button class="add ${inPlan(c) ? "on" : ""}" data-act="add">${inPlan(c) ? "✓" : "+ План"}</button></td>
        </tr>`).join("")}</tbody></table></div>`;
    }

    /**
     * Re-renders the active tab plus the always-visible parts (plan drawer, plan button, compare bar, account).
     */
    function render() {
      $("#view-catalog").hidden = tab !== "catalog";
      $("#view-report").hidden = tab !== "report";
      $("#view-ai").hidden = tab !== "ai";
      $("#rec-pill").hidden = !recommended.size;
      if (tab === "catalog") renderCatalog(); else if (tab === "report") renderReport(); else renderAI();
      renderPlan(); renderPlanBtn(); renderCompareBar(); renderAccount();
    }
    /**
     * Renders the filtered, sorted, paginated catalog with the result count and active-filter chips.
     */
    function renderCatalog() {
      const res = COURSES.filter(c => matches(c)).sort(SORTS[S.sort] || SORTS.smart);
      $("#count").innerHTML = `<b>${res.length}</b> ${plural(res.length, "курс", "курси", "курсів")}`;
      const chips = activeChips();
      const nFilters = chips.length - (S.q ? 1 : 0);
      $("#fb-count").textContent = nFilters ? String(nFilters) : "";
      $("#active").innerHTML = chips.map((c, i) => `<button class="achip" data-i="${i}" title="Прибрати">${esc(c.label)}<span>✕</span></button>`).join("")
        + (chips.length > 1 ? `<button class="link" id="clear-all">Скинути все</button>` : "");
      const shown = res.slice(0, page * PAGE);
      $("#list").classList.toggle("anim", animateNext.list);
      animateNext.list = false;
      $("#list").innerHTML = !res.length
        ? `<div class="empty"><div class="big">∅</div><b>Нічого не знайшлось</b><p>Приберіть частину фільтрів${S.star ? " або вимкніть «★ Цікаві»" : ""}.</p></div>`
        : S.view === "table" ? tableHTML(shown) : `<div class="items">${shown.map(itemHTML).join("")}</div>`;
      $("#more").hidden = res.length <= page * PAGE;
      $("#more").textContent = `Показати ще ${Math.min(PAGE, res.length - page * PAGE)} з ${res.length - page * PAGE}`;
    }
    // Active-filter chips: remove one, or reset all filters (keeping sort and view)
    $("#active").addEventListener("click", e => {
      if (e.target.id === "clear-all") { Object.assign(S, DEFAULTS, { sort: S.sort, view: S.view }); update(); return; }
      const b = e.target.closest(".achip"); if (!b) return;
      activeChips()[+b.dataset.i].clear(); update();
    });
    $("#more").addEventListener("click", () => { page++; render(); });
    $("#fb-toggle").addEventListener("click", e => {
      const open = root.querySelector(".filterbar").classList.toggle("open");
      e.currentTarget.setAttribute("aria-expanded", open);
    });
    // Add all filtered courses to the AI list (confirm when more than 40)
    $("#all-to-ai").addEventListener("click", () => {
      const res = COURSES.filter(c => matches(c));
      if (res.length > 40 && !confirm(`Додати до списку для ШІ ${res.length} курсів? Краще спершу звузити фільтрами.`)) return;
      res.forEach(c => aiList.add(c.id)); save(); render();
    });
    $("#list").addEventListener("click", e => {
      const btn = e.target.closest("button[data-act]"); if (!btn) return;
      act(btn.dataset.act, +btn.closest("[data-id]").dataset.id);
    });
    /**
     * Handles a course action button, then persists and re-renders.
     * @param {"star"|"ai"|"add"|"cmp"} kind star: toggle interest; ai: toggle AI list; add: toggle in plan; cmp: toggle compare (max 4).
     * @param {number} id Course ID.
     */
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
      // Feedback on the button that was clicked (the list was re-rendered).
      if (kind === "star" || kind === "ai") replayAnim(root.querySelector(`#list [data-id="${id}"] [data-act="${kind}"]`), "pop");
    }
