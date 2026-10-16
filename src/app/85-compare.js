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
