    /**
     * @typedef {Object} AiPick
     * @property {number} id Course ID (always from the pool after validation).
     * @property {number} credits Credits, snapped to one of the course's credit options.
     * @property {string} reason Short justification from the model.
     */
    /**
     * @typedef {Object} AiOption
     * @property {string} title Short set title.
     * @property {string} why Why this set fits.
     * @property {AiPick[]} picks Validated picks (non-empty).
     * @property {number} sum Actual credit sum of the picks (may differ from `need`).
     */
    /**
     * @typedef {Object} AiResult
     * @property {string} sem Plan semester key the result is for.
     * @property {"fall"|"spring"} parity Semester parity.
     * @property {number} need Credits that were requested.
     * @property {string} model Gemini model ID used.
     * @property {string} [summary] Overall comment from the model.
     * @property {AiOption[]} options Proposed course sets.
     */

    /**
     * Asks Gemini for 3 alternative course sets covering exactly the missing
     * credits of the selected semester (#ai-sem), and stores the outcome in
     * `aiResult` / `aiError`.
     *
     * Prompt: specialty, semester, needed credits, courses already planned,
     * mandatory/studied course names (to avoid duplicates), the student's wishes,
     * enabled AiRules as mandatory rules, and the candidate pool (aiPool), one
     * "ID | name | params" line per course (credit options, control form, year,
     * rating, recommendation/star/term-paper/similarity/language flags,
     * department, objective). A system instruction sets the advisor role and the
     * hard constraints (IDs from the list only, exact credit sum, ≤5 courses,
     * no same-named courses, short Ukrainian text).
     *
     * Output is forced to JSON via responseMimeType + responseSchema
     * ({summary, options[{title, why, picks[{id, credits, reason}]}]}).
     * Validation: thought parts and code fences are stripped before parsing;
     * picks with IDs outside the pool or repeated within an option are dropped;
     * credits not among the course's options are snapped to the nearest one;
     * each option's real `sum` is recomputed and empty options removed. The sum
     * is not forced to equal `need` — the UI flags mismatches instead.
     * @returns {Promise<void>}
     */
    async function runAI() {
      const s = plan.find(p => p.key === $("#ai-sem").value) || plan[0];
      const target = +s.target || 0, have = planSum(s);
      // Missing credits, rounded to 0.5 to avoid floating-point drift
      const need = Math.round((target - have) * 2) / 2;
      if (!target) { aiError = "Спершу вкажіть у «План» ліміт кредитів для цього семестру."; aiResult = null; return renderAIResult(); }
      if (need <= 0) { aiError = `У цьому семестрі вже набрано ${fmt(have)} з ${fmt(target)} кр.`; aiResult = null; return renderAIResult(); }
      const pool = aiPool(s);
      if (!pool.length) { aiError = usingList(s) ? "У вашому списку для ШІ на цей семестр усі курси вже в плані або вивчені — додайте ще кнопкою ✨." : "Немає доступних курсів для цього семестру — послабте фільтри."; aiResult = null; return renderAIResult(); }
      aiBusy = true; aiError = ""; aiResult = null; $("#ai-run").disabled = true; renderAIResult();
      try {
        if (!aiModel) await loadModels();
        // One pool line for the prompt: "ID | name | params…" (empty fields skipped)
        const line = c => [c.id, c.name, `кредити: ${c.credit_options.join(" або ")}`, `контроль: ${CONTROL[controlFor(c, s.parity)] || "?"}`,
          `рік: ${c.year || "?"}`, `рейтинг: ${Math.round(c.rating)}`, recommended.has(c.id) ? "РЕКОМЕНДУЄ ВИПУСКОВА КАФЕДРА" : "", stars.has(c.id) ? "студент позначив ★" : "",
          c.termpaper ? "є курсова" : "", blockState(c)?.similar ? `схоже на обов’язкову «${blockState(c).match}»` : "", c.lang === "en" ? "мова: англійська" : "", DEP_NAME[c.department] || "", c.objective ? "мета: " + c.objective.slice(0, 170) : ""].filter(Boolean).join(" | ");
        const planned = basket.filter(x => x.sem === s.key).map(x => `${BY_ID.get(x.id).name} (${x.credits} кр.)`);
        const mand = mandatoryNames;
        const y = studyYear(s);
        // Enabled AiRules rendered as prompt instructions
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
        // generateContent request: system instruction + user prompt, JSON output constrained by schema
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
        // Join non-thought text parts and strip a possible ```json fence
        const text = (cand.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("").replace(/^```(?:json)?|```$/g, "").trim();
        const out = JSON.parse(text);
        // Validate options: keep unique pool IDs, snap credits to valid options, recompute sums
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

    /**
     * Renders the AI output area (#ai-out): a spinner while busy, the error if
     * any, or the summary and option cards (exact/short sum flag, per-pick add
     * toggles, "add whole set" and "as new variant" buttons).
     */
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
    // Add a whole AI set, create a new variant from it, or toggle a single pick
    $("#ai-out").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b || !aiResult) return;
      // Add a pick to the result's semester unless it is already planned
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
