    // ---------- акаунт ----------
    function renderAccount() {
      const el = $("#account");
      if (!env.live) el.innerHTML = "";
      else if (accountState === "loading" && !account) el.innerHTML = `<span class="acc muted">Читаю акаунт…</span>`;
      else if (accountState === "error" && !account) el.innerHTML = `<button class="acc bad" id="acc-refresh" title="${esc(accountError)}">Акаунт не прочитано — ще раз</button>`;
      else if (account) el.innerHTML = `<button class="acc" id="acc-refresh" title="Оновлено ${esc(account.at)}. Натисніть, щоб оновити.">
          <span class="ava">👤</span><span class="acc-name">${esc(account.speciality || "Акаунт")}</span><small class="acc-st ${accountState === "loading" ? "spinning" : ""}">${accountState === "error" ? "!" : "↻"}</small></button>`;
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
