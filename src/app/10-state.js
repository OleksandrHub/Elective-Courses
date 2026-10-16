    root.classList.add("el-app");
    /**
     * Shorthand for `root.querySelector`.
     * @param {string} s CSS selector.
     * @returns {?HTMLElement}
     */
    const $ = s => root.querySelector(s);
    /** Persistent settings under the "tntuel_" localStorage prefix. */
    const store = makeStore("tntuel_");
    root.dataset.theme = store.get("theme", "tntu");
    /** @type {Course[]} */
    const COURSES = D.courses;
    // Lookup tables: course by ID / syllabus ID, department and major names by ID.
    /** @type {Map<number, Course>} */
    const BY_ID = new Map(COURSES.map(c => [c.id, c]));
    /** @type {Map<string, Course>} */
    const BY_SID = new Map(COURSES.map(c => [c.sid, c]));
    const DEP_NAME = Object.fromEntries(D.options.departments.map(d => [d.id, d.name]));
    const MAJOR_NAME = Object.fromEntries(D.options.majors.flatMap(g => g.items.map(i => [i.id, i.name])));

    // ---------- State ----------
    /** Default catalog filter/sort/view settings (also used by "reset all"). */
    const DEFAULTS = { q: "", lang: "", dep: "", major: "", degree: "", sem: "", credits: [], control: [], year: [],
      nocw: false, star: false, rec: false, hideBlocked: true, hideSimilar: false, sort: "smart", view: "list" };
    /** Current catalog filters, sort and view; persisted as "filters2". */
    const S = Object.assign({}, DEFAULTS, store.get("filters2", {}));
    /** Active tab: "catalog" | "report" | "ai". */
    let tab = "catalog";
    let reportSel = store.get("reportSel", null);   // keys of semesters selected for the report; null = default "next year"
    /** IDs of courses starred as interesting. @type {Set<number>} */
    let stars = new Set(store.get("stars", []));
    /** IDs of courses on the AI candidate list. @type {Set<number>} */
    let aiList = new Set(store.get("aiList", []));     // AI candidate list; split into fall/spring by when each course is taught
    // Plan variants: each has its own set of courses; semester targets are shared
    /** @type {PlanVariant[]} */
    let variants = store.get("variants", null) || [{ id: "v1", name: "План A", basket: store.get("basket", []) }];
    /** ID of the currently selected plan variant. */
    let activeVariant = store.get("activeVariant", variants[0].id);
    if (!variants.some(v => v.id === activeVariant)) activeVariant = variants[0].id;
    /**
     * Currently active plan variant.
     * @returns {PlanVariant}
     */
    const curVariant = () => variants.find(v => v.id === activeVariant);
    /** Basket of the active variant (same array object as curVariant().basket). @type {BasketItem[]} */
    let basket = curVariant().basket;                  // [{id, credits, sem: planKey}] of the active variant
    /** Cached student account data from the site, or null. @type {?Account} */
    let account = store.get("account", null);
    /** Account loading state: "off" (standalone) | "idle" | "loading" | "ok" | "error". */
    let accountState = env.live ? "loading" : "off";
    /** Last account loading error message. */
    let accountError = "";
    /** Mandatory course names typed in by the user, one per line. */
    let manualMandatory = store.get("mandatory", "");
    // Saved plan semesters, migrated to always have `num` and `short`.
    /** @type {PlanSemester[]} */
    let plan = (store.get("plan", null) || defaultPlan()).map(p => {
      const num = p.num ?? (+(/^s(\d+)$/.exec(p.key) || [])[1] || null);
      return { ...p, num, short: p.short || (num ? `${num} сем` : p.parity === "fall" ? "Осінь" : "Весна") };
    });
    /** IDs of courses selected for side-by-side comparison (max 4). @type {Set<number>} */
    const compare = new Set();
    // Catalog page counter and last computed credit combinations.
    let page = 1, lastCombos = [];

    /**
     * Default plan: one generic fall and one spring semester without targets.
     * @returns {PlanSemester[]}
     */
    function defaultPlan() {
      return [{ key: "fall", label: "Осінній семестр", short: "Осінь", parity: "fall", target: "" },
              { key: "spring", label: "Весняний семестр", short: "Весна", parity: "spring", target: "" }];
    }
    /**
     * Persists filters, stars, AI list, plan and plan variants (syncing the active basket first).
     */
    const save = () => { store.set("filters2", S); store.set("stars", [...stars]); store.set("aiList", [...aiList]); store.set("plan", plan);
      curVariant().basket = basket; store.set("variants", variants); store.set("activeVariant", activeVariant); };
    /**
     * First unused variant name "План A"…"План Z", else "План <n>".
     * @returns {string}
     */
    function nextVariantName() {
      const used = new Set(variants.map(v => v.name));
      return [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map(l => "План " + l).find(n => !used.has(n)) || `План ${variants.length + 1}`;
    }
    /**
     * Makes another plan variant active and re-renders.
     * @param {string} id Variant ID.
     */
    function switchVariant(id) { save(); activeVariant = id; basket = curVariant().basket; save(); $("#combos").innerHTML = ""; render(); }
    /**
     * Creates a plan variant (copying the given items), activates it and re-renders.
     * @param {BasketItem[]} [items] Initial basket items (copied).
     * @param {string} [name] Variant name; defaults to nextVariantName().
     * @returns {PlanVariant} The new variant.
     */
    function newVariant(items = [], name = nextVariantName()) {
      save();
      const v = { id: "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, basket: items.map(x => ({ ...x })) };
      variants.push(v); activeVariant = v.id; basket = v.basket; save(); render();
      return v;
    }

    // ---------- Account data ----------
    // Derived from `account` + manual list by rebuildAccount(): mandatory IDs/names,
    // courses already selected on the site (id → entry), and IDs recommended by the department.
    let mandatoryIds = new Set(), mandatoryNames = [], siteSelected = new Map(), recommended = new Set();
    let takenIds = new Map(), takenNames = new Map();   // from the curriculum: id / normalized name → semester number
    /**
     * Whether a curriculum row is a term paper/project (excluded from "taken" courses).
     * @param {{control: string}} r Curriculum row.
     * @returns {boolean}
     */
    const isCw = r => r.control === "cw" || r.control === "cp";
    /**
     * Resolves a site course reference to a catalog course ID (by ID, else by syllabus ID).
     * @param {{id?: number, sid?: string}} r
     * @returns {number|undefined}
     */
    const refId = r => r.id && BY_ID.has(r.id) ? r.id : BY_SID.get(r.sid)?.id;
    /**
     * Recomputes account-derived lookups (taken, mandatory, site-selected, recommended)
     * from `account` and `manualMandatory`, and clears the block cache.
     */
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
    /** Memoized blockState() results by course ID. */
    const blockCache = new Map();
    /**
     * Checks whether a course duplicates something the student already has.
     * Exact: already in the curriculum (`taken` = semester) or a mandatory course;
     * similar: name contains/is contained in a mandatory name (≥6 chars) or word similarity ≥ 0.8.
     * @param {Course} c
     * @returns {?{exact?: boolean, similar?: boolean, match: string, taken?: number}} null when not blocked.
     */
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

    // ---------- Semesters ----------
    /**
     * Semester numbers in which the course is taught (from the syllabus).
     * @param {Course} c
     * @returns {number[]}
     */
    const semNums = c => (c.semesters?.length ? c.semesters.map(s => s.semester) : (c.semester ? [c.semester] : [])).filter(Boolean);
    /**
     * Halves of the year when the course runs: site filter data first, else odd → fall, even → spring.
     * @param {Course} c
     * @returns {Set<"fall"|"spring">}
     */
    function parities(c) {
      if (c.site_sems?.length) return new Set(c.site_sems);
      return new Set(semNums(c).map(n => n % 2 ? "fall" : "spring"));
    }
    /**
     * Human-readable parity label, e.g. "осінь / весна" ("?" if unknown).
     * @param {Course} c
     * @returns {string}
     */
    const parityLabel = c => [...parities(c)].map(p => p === "fall" ? "осінь" : "весна").join(" / ") || "?";
    /**
     * Final control type for the course in a semester of the given parity.
     * @param {Course} c
     * @param {"fall"|"spring"} parity
     * @returns {?string} CONTROL key, falling back to the first known control.
     */
    function controlFor(c, parity) {
      const m = (c.semesters || []).find(s => (s.semester % 2 ? "fall" : "spring") === parity);
      return m ? m.control : (c.controls || [])[0] || null;
    }
