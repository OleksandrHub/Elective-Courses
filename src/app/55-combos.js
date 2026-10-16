    // ---------- Combinations ----------
    /**
     * Finds sets of courses whose credits add up exactly to the credits still
     * missing in the selected plan semester (#c-sem) and renders them into #combos.
     *
     * Candidate pool: courses not already planned/selected on the site, not
     * same-named as a basket course, taught in the semester's parity and not an
     * exact duplicate of a mandatory/taken course. If any of them are starred,
     * only starred ones are used; otherwise the current catalog filters apply.
     * The pool is sorted "smart" and capped at 70 courses.
     *
     * Search: every (course, credit option) pair becomes an option; a bounded
     * DFS over options in index order (so each set is found once) collects all
     * subsets with sum === need, pruning branches that overshoot, reuse a course
     * (by ID or normalized name), exceed maxK courses (#c-max, clamped 1..5), or
     * once more than 4000 results are collected. Results are ranked by fewer
     * courses, then more department-recommended courses, then higher mean rating;
     * the top 12 are kept in `lastCombos` for the add buttons.
     */
    function runCombos() {
      const s = plan.find(p => p.key === $("#c-sem").value) || plan[0];
      const target = +s.target || 0, have = planSum(s);
      // Missing credits, rounded to 0.5 to avoid floating-point drift
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
      // Bounded DFS over opts[start..]: chosen is the current partial set, sum its credits
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
      // Ranking helpers: mean rating and number of department-recommended courses
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
    // Add a found set to the current plan, or create a new variant = current basket + the set
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
