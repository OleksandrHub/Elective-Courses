    // ---------- Control sync ----------
    /** Filter key in S → <select> selector. */
    const selects = { lang: "#f-lang", dep: "#f-dep", major: "#f-major", degree: "#f-degree", sem: "#f-sem", sort: "#sort" };
    /**
     * Reflects the state (S, tab) into all filter inputs, chips, toggles, view and tab buttons.
     */
    function syncControls() {
      for (const [k, sel] of Object.entries(selects)) { $(sel).value = S[k]; $(sel).classList.toggle("set", !!S[k] && k !== "sort"); }
      $("#f-hideBlocked").checked = S.hideBlocked; $("#f-hideSimilar").checked = S.hideSimilar;
      $("#q").value = S.q;
      root.querySelectorAll("[data-chips]").forEach(group => {
        const key = group.dataset.chips;
        group.querySelectorAll(".chip").forEach(ch => ch.classList.toggle("on", S[key].map(String).includes(ch.dataset.v)));
        const sum = group.closest(".pop").querySelector("summary");
        sum.classList.toggle("set", S[key].length > 0);
        sum.dataset.n = S[key].length || "";
      });
      root.querySelectorAll("[data-toggle]").forEach(b => b.classList.toggle("set", !!S[b.dataset.toggle]));
      root.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === S.view));
      root.querySelectorAll("[data-tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === tab));
    }
    /**
     * Applies a filter change: resets paging, persists, syncs controls and re-renders.
     */
    const update = () => { page = 1; animateNext.list = true; save(); syncControls(); render(); };
    for (const [k, sel] of Object.entries(selects)) $(sel).addEventListener("change", e => { S[k] = e.target.value; update(); });
    for (const k of ["hideBlocked", "hideSimilar"]) $("#f-" + k).addEventListener("change", e => { S[k] = e.target.checked; update(); });
    // Debounced search input.
    let qTimer;
    $("#q").addEventListener("input", e => { clearTimeout(qTimer); qTimer = setTimeout(() => { S.q = e.target.value; page = 1; save(); render(); }, 120); });
    root.querySelectorAll("[data-chips]").forEach(group => group.addEventListener("click", e => {
      const ch = e.target.closest(".chip"); if (!ch) return;
      const key = group.dataset.chips;
      const v = key === "control" ? ch.dataset.v : +ch.dataset.v;
      S[key] = S[key].includes(v) ? S[key].filter(x => x !== v) : [...S[key], v];
      update();
    }));
    root.querySelectorAll("[data-toggle]").forEach(b => b.addEventListener("click", () => { S[b.dataset.toggle] = !S[b.dataset.toggle]; update(); }));
    root.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => { S.view = b.dataset.view; update(); }));
    root.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => { tab = b.dataset.tab; syncControls(); render(); }));
    // Close popovers on click outside them
    root.addEventListener("click", e => {
      const path = e.composedPath();
      root.querySelectorAll("details.pop[open]").forEach(d => { if (!path.includes(d)) d.open = false; });
    });
    // Only one popover open at a time
    root.querySelectorAll("details.pop").forEach(d => d.addEventListener("toggle", () => {
      if (d.open) root.querySelectorAll("details.pop[open]").forEach(o => o !== d && (o.open = false));
    }));
    // Manually entered mandatory course names
    $("#mandatory").value = manualMandatory;
    $("#mandatory").addEventListener("input", e => {
      manualMandatory = e.target.value; store.set("mandatory", manualMandatory);
      rebuildAccount(); render();
    });
    if (env.close) $("#close").addEventListener("click", env.close);
    /**
     * Marks the active theme option in the theme menu.
     */
    const syncTheme = () => root.querySelectorAll("[data-theme-set]").forEach(b => {
      b.classList.toggle("on", b.dataset.themeSet === root.dataset.theme); b.setAttribute("aria-checked", b.dataset.themeSet === root.dataset.theme);
    });
    root.querySelector(".theme-menu").addEventListener("click", e => {
      const b = e.target.closest("[data-theme-set]"); if (!b) return;
      root.dataset.theme = b.dataset.themeSet; store.set("theme", b.dataset.themeSet); syncTheme();
      b.closest("details").open = false;
    });
    syncTheme();

    // ---------- Plan drawer ----------
    /**
     * Opens or closes the plan drawer and its backdrop.
     * @param {boolean} [v=true] true to open, false to close.
     */
    const openDrawer = (v = true) => { $("#drawer").classList.toggle("open", v); $("#drawer-back").hidden = !v; };
    $("#plan-btn").addEventListener("click", () => openDrawer(!$("#drawer").classList.contains("open")));
    $("#drawer-x").addEventListener("click", () => openDrawer(false));
    $("#drawer-back").addEventListener("click", () => openDrawer(false));
