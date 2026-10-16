    root.classList.add("el-app");
    const $ = s => root.querySelector(s);
    const store = makeStore("tntuel_");
    root.dataset.theme = store.get("theme", "tntu");
    const COURSES = D.courses;
    const BY_ID = new Map(COURSES.map(c => [c.id, c]));
    const BY_SID = new Map(COURSES.map(c => [c.sid, c]));
    const DEP_NAME = Object.fromEntries(D.options.departments.map(d => [d.id, d.name]));
    const MAJOR_NAME = Object.fromEntries(D.options.majors.flatMap(g => g.items.map(i => [i.id, i.name])));

    // ---------- стан ----------
    const DEFAULTS = { q: "", lang: "", dep: "", major: "", degree: "", sem: "", credits: [], control: [], year: [],
      nocw: false, star: false, rec: false, hideBlocked: true, hideSimilar: false, sort: "smart", view: "list" };
    const S = Object.assign({}, DEFAULTS, store.get("filters2", {}));
    let tab = "catalog";
    let reportSel = store.get("reportSel", null);   // ключі обраних семестрів звіту; null — «наступний рік» за замовчуванням
    let stars = new Set(store.get("stars", []));
    let aiList = new Set(store.get("aiList", []));     // список кандидатів для ШІ; осінь/весна — за тим, коли курс читається
    // Варіанти плану: у кожного свій набір курсів, ліміти семестрів спільні
    let variants = store.get("variants", null) || [{ id: "v1", name: "План A", basket: store.get("basket", []) }];
    let activeVariant = store.get("activeVariant", variants[0].id);
    if (!variants.some(v => v.id === activeVariant)) activeVariant = variants[0].id;
    const curVariant = () => variants.find(v => v.id === activeVariant);
    let basket = curVariant().basket;                  // [{id, credits, sem: planKey}] активного варіанта
    let account = store.get("account", null);
    let accountState = env.live ? "loading" : "off";
    let accountError = "";
    let manualMandatory = store.get("mandatory", "");
    let plan = (store.get("plan", null) || defaultPlan()).map(p => {
      const num = p.num ?? (+(/^s(\d+)$/.exec(p.key) || [])[1] || null);
      return { ...p, num, short: p.short || (num ? `${num} сем` : p.parity === "fall" ? "Осінь" : "Весна") };
    });
    const compare = new Set();
    let page = 1, lastCombos = [];

    function defaultPlan() {
      return [{ key: "fall", label: "Осінній семестр", short: "Осінь", parity: "fall", target: "" },
              { key: "spring", label: "Весняний семестр", short: "Весна", parity: "spring", target: "" }];
    }
    const save = () => { store.set("filters2", S); store.set("stars", [...stars]); store.set("aiList", [...aiList]); store.set("plan", plan);
      curVariant().basket = basket; store.set("variants", variants); store.set("activeVariant", activeVariant); };
    function nextVariantName() {
      const used = new Set(variants.map(v => v.name));
      return [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map(l => "План " + l).find(n => !used.has(n)) || `План ${variants.length + 1}`;
    }
    function switchVariant(id) { save(); activeVariant = id; basket = curVariant().basket; save(); $("#combos").innerHTML = ""; render(); }
    function newVariant(items = [], name = nextVariantName()) {
      save();
      const v = { id: "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, basket: items.map(x => ({ ...x })) };
      variants.push(v); activeVariant = v.id; basket = v.basket; save(); render();
      return v;
    }

    // ---------- дані акаунта ----------
    let mandatoryIds = new Set(), mandatoryNames = [], siteSelected = new Map(), recommended = new Set();
    let takenIds = new Map(), takenNames = new Map();   // з навчального плану: id/назва → семестр
    const isCw = r => r.control === "cw" || r.control === "cp";
    const refId = r => r.id && BY_ID.has(r.id) ? r.id : BY_SID.get(r.sid)?.id;
    function rebuildAccount() {
      const fromAcc = account?.mandatory || [];
      takenIds = new Map(); takenNames = new Map();
      for (const sem of account?.curriculum?.semesters || []) for (const r of sem.rows) {
        if (isCw(r)) continue;
        r.ids.forEach(id => takenIds.has(id) || takenIds.set(id, sem.num));
        takenNames.has(norm(r.name)) || takenNames.set(norm(r.name), sem.num);
      }
      mandatoryIds = new Set(fromAcc.map(m => m.id));
      mandatoryNames = [...new Set([...fromAcc.map(m => m.name),
        ...(account?.curriculum?.semesters || []).flatMap(sem => sem.rows.filter(r => !isCw(r)).map(r => r.name)),
        ...manualMandatory.split("\n").map(s => s.trim()).filter(Boolean)])];
      siteSelected = new Map((account?.selected || []).map(x => [x.id, x]));
      recommended = new Set((account?.recommended || []).map(refId).filter(Boolean));
      blockCache.clear();
    }
    const blockCache = new Map();
    function blockState(c) {
      if (blockCache.has(c.id)) return blockCache.get(c.id);
      let res = null;
      const n = norm(c.name);
      if (takenIds.has(c.id) || takenNames.has(n)) res = { exact: true, match: c.name, taken: takenIds.get(c.id) || takenNames.get(n) };
      else if (mandatoryIds.has(c.id)) res = { exact: true, match: c.name };
      else {
        for (const m of mandatoryNames) {
          const mn = norm(m);
          if (!mn) continue;
          if (mn === n) { res = { exact: true, match: m }; break; }
          if (!res && ((mn.length >= 6 && (n.includes(mn) || mn.includes(n))) || similarity(m, c.name) >= 0.8)) res = { similar: true, match: m };
        }
      }
      blockCache.set(c.id, res);
      return res;
    }

    // ---------- семестри ----------
    const semNums = c => (c.semesters?.length ? c.semesters.map(s => s.semester) : (c.semester ? [c.semester] : [])).filter(Boolean);
    function parities(c) {
      if (c.site_sems?.length) return new Set(c.site_sems);
      return new Set(semNums(c).map(n => n % 2 ? "fall" : "spring"));
    }
    const parityLabel = c => [...parities(c)].map(p => p === "fall" ? "осінь" : "весна").join(" / ") || "?";
    function controlFor(c, parity) {
      const m = (c.semesters || []).find(s => (s.semester % 2 ? "fall" : "spring") === parity);
      return m ? m.control : (c.controls || [])[0] || null;
    }
