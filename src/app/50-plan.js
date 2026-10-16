    // ---------- Plan ----------
    /**
     * Picks the default plan semester for a course: the first plan semester whose
     * parity (fall/spring) the course is taught in, falling back to the first one.
     * @param {Course} c Catalog course.
     * @returns {string} Key of the plan semester (e.g. "s7").
     */
    function planFor(c) {
      const p = parities(c);
      return (plan.find(s => p.has(s.parity)) || plan[0]).key;
    }
    /**
     * Adds a course to the active variant's basket, or removes it if already there,
     * then persists state. Does not re-render.
     * @param {number} id Course ID.
     * @param {number} [credits] Credit option to use; defaults to the course's default credits.
     * @param {string} [sem] Plan semester key; defaults to {@link planFor}.
     */
    function toggleBasket(id, credits, sem) {
      const i = basket.findIndex(x => x.id === id);
      if (i >= 0) basket.splice(i, 1);
      else { const c = BY_ID.get(id); basket.push({ id, credits: credits ?? c.credits, sem: sem ?? planFor(c) }); }
      save();
    }
    /**
     * Total credits planned in the active basket for one plan semester.
     * @param {PlanSemester} s Plan semester.
     * @returns {number} Sum of credits.
     */
    const planSum = s => basket.filter(x => x.sem === s.key).reduce((a, x) => a + x.credits, 0);
    /**
     * Renders the header "Plan" button: active variant name, per-semester
     * sum/limit badges and an overall total, colored "full" (exact) or "over".
     */
    function renderPlanBtn() {
      // CSS state for a sum vs. its limit: "full" when exact, "over" when exceeded
      const state = (sum, t) => !t ? "" : sum === t ? "full" : sum > t ? "over" : "";
      const all = plan.reduce((a, s) => a + planSum(s), 0), allT = plan.reduce((a, s) => a + (+s.target || 0), 0);
      const okAll = plan.every(s => !+s.target || planSum(s) === +s.target);
      $("#plan-btn").innerHTML = `<span class="pb-title">${esc(variants.length > 1 ? curVariant().name : "План")}</span>`
        + `<span class="pb-sems">${plan.map(s => {
          const sum = planSum(s), t = +s.target || 0;
          return `<span class="pb-sem ${state(sum, t)}"><i>${esc(s.short)}</i>${fmt(sum)}${t ? "/" + fmt(t) : ""}</span>`;
        }).join("")}</span>`
        + `<span class="pb-sem pb-total ${allT ? (okAll && all === allT ? "full" : all > allT ? "over" : "") : ""}">${fmt(all)}${allT ? "/" + fmt(allT) : ""}</span>`;
    }
    /**
     * Renders the plan drawer: variant tabs and actions, the variant comparison
     * table, and per-semester blocks with limit input, credit gauge and planned
     * courses (credit/semester selectors, parity and duplicate warnings).
     * Also refreshes the semester selector of the combinations tool (#c-sem).
     */
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
    // Live edit of a semester credit limit: update only the header button while typing
    $("#plan").addEventListener("input", e => {
      const k = e.target.dataset.target; if (!k) return;
      plan.find(p => p.key === k).target = e.target.value; save(); renderPlanBtn();
    });
    // Committed limit change, or per-item credit / semester change
    $("#plan").addEventListener("change", e => {
      if (e.target.dataset.target) { render(); return; }
      const it = e.target.closest(".pitem"); if (!it) return;
      const x = basket.find(b => b.id === +it.dataset.id);
      if (e.target.dataset.pact === "cr") x.credits = +e.target.value;
      if (e.target.dataset.pact === "sem") x.sem = e.target.value;
      save(); render();
    });
    /**
     * Builds a table comparing all plan variants: for each semester, the credit
     * sum vs. limit and the number of exams.
     * @returns {string} HTML markup.
     */
    function variantsCompareHTML() {
      // One table cell: credits (vs. limit) and exam count of variant v in semester s
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
    // Plan drawer buttons: variant switch/new/duplicate/rename/delete, remove item,
    // copy as text, go to report, clear plan
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
