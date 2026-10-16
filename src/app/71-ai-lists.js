    /**
     * Renders the whole AI tab: the semester selector (with missing credits per
     * semester, preserving the selection), key/model box, candidate lists and result.
     */
    function renderAI() {
      const cur = $("#ai-sem").value;
      $("#ai-sem").innerHTML = plan.map(p => { const t = +p.target || 0, left = t - planSum(p);
        return `<option value="${p.key}">${esc(p.label)}${t ? ` — бракує ${fmt(Math.max(0, left))} кр.` : ""}</option>`; }).join("");
      if (plan.some(p => p.key === cur)) $("#ai-sem").value = cur;
      renderAIKey();
      renderAILists();
      renderAIResult();
    }
    /**
     * Courses from the user's AI candidate list (`aiList`) taught in the given parity.
     * @param {"fall"|"spring"} parity Semester parity.
     * @returns {Course[]} Courses sorted "smart".
     */
    const listFor = parity => [...aiList].map(id => BY_ID.get(id)).filter(c => c && parities(c).has(parity)).sort(SORTS.smart);
    // "Use my list" checkbox (persisted, on by default)
    $("#ai-uselist").checked = store.get("aiUseList", true);
    $("#ai-uselist").addEventListener("change", e => store.set("aiUseList", e.target.checked));
    /**
     * Renders the fall and spring AI candidate lists (#ai-lists), highlighting
     * the one matching the selected semester, with remove and clear buttons.
     */
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
    // Remove one course from the AI list, or clear it after confirmation
    $("#ai-lists").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.aiRm) aiList.delete(+b.dataset.aiRm);
      if (b.id === "ai-list-clear" && !confirm("Очистити список для ШІ?")) return;
      if (b.id === "ai-list-clear") aiList.clear();
      save(); renderAILists();
    });
    $("#ai-sem").addEventListener("change", renderAILists);

    /**
     * Whether the AI should pick only from the user's list for this semester
     * (checkbox on and the list has courses of this parity).
     * @param {PlanSemester} s Plan semester.
     * @returns {boolean}
     */
    const usingList = s => $("#ai-uselist").checked && listFor(s.parity).length > 0;
    /**
     * Candidate courses sent to Gemini for a semester. Always excludes courses
     * already planned, selected on the site, same-named as a basket course, or
     * exact duplicates of mandatory/taken ones. With the user's list in use,
     * returns that list as is. Otherwise: catalog courses (parity-filtered if the
     * rule is on), narrowed by the catalog filters or, if those are off, by the
     * selected major; sorted similar-to-mandatory last (rule "nomand"), then
     * study-year match first (rule "year"), then "smart"; capped at 260.
     * @param {PlanSemester} s Plan semester.
     * @returns {Course[]}
     */
    function aiPool(s) {
      const takenNames = new Set(basket.map(x => norm(BY_ID.get(x.id)?.name)));
      if (usingList(s))   // own list: only this semester's (fall/spring) courses, minus already chosen or studied
        return listFor(s.parity).filter(c => !inPlan(c) && !siteSelected.has(c.id) && !takenNames.has(norm(c.name)) && !blockState(c)?.exact);
      let pool = COURSES.filter(c => !inPlan(c) && !siteSelected.has(c.id) && !takenNames.has(norm(c.name))
        && (!aiRules.parity || parities(c).has(s.parity))
        && !blockState(c)?.exact);
      if ($("#ai-filters").checked) pool = pool.filter(c => matches(c, { ignoreSem: true }));
      else if (S.major) pool = pool.filter(c => c.majors.includes(+S.major));   // only courses available to the selected major
      const y = aiRules.year ? studyYear(s) : null;
      const yearFirst = (a, b) => y ? (b.year === y) - (a.year === y) : 0;
      // courses similar to mandatory ones are not dropped, just moved to the end
      const similarLast = (a, b) => aiRules.nomand ? !!blockState(a)?.similar - !!blockState(b)?.similar : 0;
      return pool.sort((a, b) => similarLast(a, b) || yearFirst(a, b) || SORTS.smart(a, b)).slice(0, 260);
    }
