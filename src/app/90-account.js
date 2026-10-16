    // ---------- Account ----------
    /**
     * Render the account widget in the header (loading / error-with-retry /
     * speciality button that re-reads the account; empty outside live mode) and
     * the collapsible list of mandatory courses from the account grouped by semester.
     * @returns {void}
     */
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
    /**
     * Guess the catalog major from the account speciality: takes the leading
     * speciality code (e.g. "121", "F2", "122.1") and finds majors whose name starts
     * with "<code> ". If several match, prefers "(магістр)" when any mandatory
     * course is beyond semester 8, otherwise "(бакалавр)"; falls back to the first match.
     * @param {string} spec Speciality text (see Account.speciality).
     * @returns {?number} Major id from `D.options.majors`, or null.
     */
    function guessMajor(spec) {
      const code = (spec || "").match(/^\s*([A-ZА-Я]?\d+(?:\.\d+)?)/i)?.[1];
      if (!code) return null;
      const items = D.options.majors.flatMap(g => g.items).filter(i => i.name.startsWith(code + " "));
      const masterish = (account?.mandatory || []).some(m => m.semester > 8);
      return (items.find(i => i.name.includes(masterish ? "(магістр)" : "(бакалавр)")) || items[0])?.id || null;
    }
    /**
     * Read the account via `env.loadAccount` (the content script's loader; no-op
     * if absent) and apply it: stamps the read time, guesses the major (selected
     * automatically on the first load if none is chosen), caches the account in
     * the store, sets plan semesters from the remaining credits on the site,
     * imports new "Interested" courses as stars, then rebuilds and re-renders.
     * Errors are kept in `accountError` and shown by {@link renderAccount}.
     * @returns {Promise<void>}
     */
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
        // Site "Interested" list → ★ (only ones not imported before, so stars the user removed do not come back)
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
