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
