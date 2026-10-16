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
