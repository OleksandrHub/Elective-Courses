    // ---------- Keyboard ----------
    /*
     * Global shortcuts (ignored while the app is detached or its overlay is hidden):
     * - "/" (when not typing in a field): switch to the catalog tab and focus search.
     * - Escape: on the terms gate closes the overlay; otherwise closes, in order of
     *   priority, the modal, open popovers, the drawer, blurs the focused field,
     *   or finally closes the overlay.
     * composedPath()[0] is used to see the real target inside the shadow DOM.
     */
    document.addEventListener("keydown", e => {
      if (!root.isConnected || root.getRootNode().host?.style.display === "none") return;
      const t = e.composedPath()[0];
      const typing = t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
      if (e.key === "/" && !typing) { e.preventDefault(); tab = "catalog"; syncControls(); render(); $("#q").focus(); }
      if (e.key === "Escape" && root.querySelector(".gate")) { if (env.close) env.close(); return; }
      if (e.key === "Escape") {
        if (!$("#modal").hidden) $("#modal").hidden = true;
        else if (root.querySelector("details.pop[open]")) root.querySelectorAll("details.pop[open]").forEach(d => d.open = false);
        else if ($("#drawer").classList.contains("open")) openDrawer(false);
        else if (typing) t.blur();
        else if (env.close) env.close();
      }
    });

    // Initial render; then ask for terms consent or read the account.
    $("#meta").textContent = `ТНТУ · ${COURSES.length} курсів · ${D.fetched.slice(0, 10)}`;
    rebuildAccount();
    numberPlanSemesters();
    syncControls();
    render();
    if (!termsAccepted()) showTermsGate();
    else if (env.live) loadAccount();
