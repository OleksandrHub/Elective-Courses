    // ---------- клавіатура ----------
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

    $("#meta").textContent = `ТНТУ · ${COURSES.length} курсів · ${D.fetched.slice(0, 10)}`;
    rebuildAccount();
    numberPlanSemesters();
    syncControls();
    render();
    if (!termsAccepted()) showTermsGate();
    else if (env.live) loadAccount();
