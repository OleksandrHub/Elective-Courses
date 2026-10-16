    // ---------- AI picker (Gemini) ----------
    /** Base URL of the Gemini REST API. @type {string} */
    const API = "https://generativelanguage.googleapis.com/v1beta/";
    /**
     * Gemini transport. The extension passes its own bridge in `env.gemini`
     * (key kept in extension storage, requests made from the background);
     * otherwise this fallback stores the key in `store` and calls the API via fetch.
     * @type {GeminiBridge}
     */
    const gem = env.gemini || {
      /**
       * Sends a request to the Gemini API with the stored key. Never throws.
       * @param {string} url Full API URL.
       * @param {string} [method="GET"] HTTP method.
       * @param {string} [body] JSON request body.
       * @returns {Promise<{ok: boolean, status: number, body: string}>} Status 0 = network error.
       */
      async request(url, method, body) {
        const key = store.get("geminiKey", "");
        if (!key) return { ok: false, status: 401, body: "Не вказано API-ключ Gemini" };
        try {
          const r = await fetch(url, { method: method || "GET", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body });
          return { ok: r.ok, status: r.status, body: await r.text() };
        } catch (e) { return { ok: false, status: 0, body: String(e) }; }
      },
      /** @returns {Promise<{hasKey: boolean, hint: string}>} Whether a key is set, and its last 4 chars. */
      async keyInfo() { const k = store.get("geminiKey", ""); return { hasKey: !!k, hint: k ? "…" + k.slice(-4) : "" }; },
      /** Saves (or clears, with an empty value) the API key. @param {string} k @returns {Promise<boolean>} */
      async setKey(k) { store.set("geminiKey", k || ""); return true; },
    };
    /**
     * @typedef {Object} AiRules
     * @property {boolean} nomand Avoid courses similar to mandatory ones (and sort them last in the pool).
     * @property {boolean} parity Only courses taught in the target semester's parity.
     * @property {boolean} year Prefer courses recommended for the student's study year.
     */
    /** AI rule toggles (persisted as "aiRules"), all on by default. @type {AiRules} */
    const aiRules = Object.assign({ nomand: true, parity: true, year: true }, store.get("aiRules", {}));
    /** Syncs the [data-rule] toggle buttons' "on" class and aria-pressed with `aiRules`. */
    const syncRules = () => root.querySelectorAll("[data-rule]").forEach(b => { b.classList.toggle("on", !!aiRules[b.dataset.rule]); b.setAttribute("aria-pressed", !!aiRules[b.dataset.rule]); });
    root.querySelectorAll("[data-rule]").forEach(b => b.addEventListener("click", () => {
      aiRules[b.dataset.rule] = !aiRules[b.dataset.rule]; store.set("aiRules", aiRules); syncRules();
    }));
    syncRules();
    /**
     * Study year for a plan semester: semester 5 → year 3.
     * @param {PlanSemester} s Plan semester.
     * @returns {?number} Year, or null if the semester is unnumbered.
     */
    const studyYear = s => s.num ? Math.ceil(s.num / 2) : null;
    // AI state: selected model ID and cached model list (both persisted),
    // last result (AiResult), request-in-flight flag, and last error message
    let aiModel = store.get("aiModel", ""), aiModels = store.get("aiModels", []), aiResult = null, aiBusy = false, aiError = "";
    /**
     * Turns a failed Gemini response into a user-facing (Ukrainian) message:
     * invalid key, rate limit (429), access denied (401/403), or a generic error.
     * @param {{status: number, body: string}} res Failed response.
     * @returns {string} Error message.
     */
    function apiError(res) {
      let msg = res.body;
      try { msg = JSON.parse(res.body).error?.message || msg; } catch {}
      if (res.status === 400 && /api key/i.test(msg)) return "Ключ не прийнято — перевірте, що скопіювали його повністю.";
      if (res.status === 429) return "Вичерпано ліміт запитів Gemini. Зачекайте хвилину або оберіть іншу модель.";
      if (res.status === 401 || res.status === 403) return "Немає доступу до Gemini: " + msg;
      return `Помилка Gemini (${res.status || "мережа"}): ${String(msg).slice(0, 300)}`;
    }
    /**
     * Fetches available models and stores them in `aiModels` (persisted).
     * Keeps only Gemini text models supporting generateContent (drops TTS, image,
     * embedding, live, audio, robotics, computer-use). Ranks by version × 10,
     * plus a bonus favoring non-lite Flash (3) over Pro (2) over others (1),
     * minus 4 for preview/experimental builds — so the newest stable Flash comes
     * first. If the saved `aiModel` is no longer listed, selects the top one.
     * @returns {Promise<void>}
     * @throws {Error} With a user-facing message when the request fails.
     */
    async function loadModels() {
      const res = await gem.request(API + "models?pageSize=200");
      if (!res.ok) throw new Error(apiError(res));
      const list = (JSON.parse(res.body).models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes("generateContent") && /gemini/i.test(m.name) && !/(tts|image|embedding|live|audio|robotics|computer)/i.test(m.name))
        .map(m => ({ id: m.name.replace(/^models\//, ""), label: m.displayName || m.name }));
      // Numeric version from the ID ("gemini-2.5-flash" → 2.5) and the ranking score
      const ver = id => parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
      const rank = id => ver(id) * 10 + (/flash/.test(id) && !/lite/.test(id) ? 3 : /pro/.test(id) ? 2 : 1) - (/preview|exp/.test(id) ? 4 : 0);
      list.sort((a, b) => rank(b.id) - rank(a.id));
      aiModels = list; store.set("aiModels", list);
      if (!list.some(m => m.id === aiModel)) { aiModel = list[0]?.id || ""; store.set("aiModel", aiModel); }
    }

    /**
     * Renders the Gemini connection box (#ai-key): setup instructions and key
     * input when no key is set; otherwise the key hint, model selector (loading
     * models on first use) and disconnect button. Enables #ai-run accordingly.
     * @returns {Promise<void>}
     */
    async function renderAIKey() {
      const info = await gem.keyInfo();
      const el = $("#ai-key");
      if (!info.hasKey) {
        el.innerHTML = `<b>Підключіть свій Gemini</b>
          <ol class="steps"><li>Відкрийте <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> під своїм Google-акаунтом.</li>
          <li>Натисніть «Create API key» — це безкоштовно.</li><li>Вставте ключ сюди. Він зберігається лише ${env.gemini ? "в розширенні у вашому браузері" : "у цьому браузері"}.</li></ol>
          <div class="row"><input type="password" id="ai-key-in" placeholder="AIza…" autocomplete="off" style="flex:1;min-width:200px"><button class="primary" id="ai-key-save">Зберегти</button></div>
          <div id="ai-key-msg" class="hint"></div>`;
      } else {
        if (!aiModels.length) { try { await loadModels(); } catch (e) { aiError = e.message; } }
        el.innerHTML = `<div class="row"><span>🔑 Gemini підключено <span class="hint">(ключ ${esc(info.hint)})</span></span><span class="spacer"></span>
          <label class="hint">Модель <select id="ai-model" class="pill quiet">${aiModels.map(m => `<option value="${esc(m.id)}" ${m.id === aiModel ? "selected" : ""}>${esc(m.label)}</option>`).join("") || `<option value="">—</option>`}</select></label>
          <button class="ghost" id="ai-key-del">Відключити</button></div>`;
      }
      $("#ai-run").disabled = !info.hasKey || aiBusy;
    }
    // Save key (validated by loading the model list; reverted on failure) / disconnect
    $("#ai-key").addEventListener("click", async e => {
      if (e.target.id === "ai-key-save") {
        const key = $("#ai-key-in").value.trim();
        if (!key) return;
        $("#ai-key-msg").textContent = "Перевіряю ключ…";
        await gem.setKey(key);
        try { await loadModels(); aiError = ""; renderAIKey(); }
        catch (err) { await gem.setKey(""); $("#ai-key-msg").textContent = err.message; }
      }
      if (e.target.id === "ai-key-del" && confirm("Відключити Gemini і видалити ключ з браузера?")) {
        await gem.setKey(""); aiModels = []; store.set("aiModels", []); renderAIKey();
      }
    });
    $("#ai-key").addEventListener("change", e => { if (e.target.id === "ai-model") { aiModel = e.target.value; store.set("aiModel", aiModel); } });
    // Quick-wish chips append their text to the wishes field ("; "-separated)
    $("#ai-quick").addEventListener("click", e => {
      const q = e.target.dataset.q; if (!q) return;
      const t = $("#ai-wish");
      t.value = (t.value.trim() ? t.value.trim().replace(/[.,;]?$/, "; ") : "") + q.toLowerCase();
      store.set("aiWish", t.value);
    });
    // Persist the free-text wishes between sessions
    $("#ai-wish").value = store.get("aiWish", "");
    $("#ai-wish").addEventListener("input", e => store.set("aiWish", e.target.value));
