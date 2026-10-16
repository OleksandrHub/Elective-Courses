/**
 * @file Elective-course picker UI for TNTU (Ternopil Ivan Puluj National Technical University).
 *
 * Runs both as a standalone page (index.html, data from data.js) and inside
 * dl.tntu.edu.ua through the browser extension (content/main.js), where it
 * also reads the student's account and talks to Gemini via the background worker.
 *
 * Public API: `window.ElectivesApp.mount(element, data, env)` — see {@link AppEnv}.
 *
 * GENERATED into extension/app.js by build.py: edit the parts in src/app/ instead.
 * This part (00-helpers.js) holds constants and pure helpers placed outside mount().
 */

  /**
   * A single elective course, as produced by scrape.py (list row + syllabus + site filters).
   * Syllabus-derived fields may be missing/null when the syllabus could not be fetched.
   * @typedef {Object} Course
   * @property {number} id Course ID on dl.tntu.edu.ua.
   * @property {?string} sid Syllabus UUID (used in syllabus URLs).
   * @property {string} name Course title.
   * @property {number} credits Default (smallest) ECTS credit value.
   * @property {number[]} credit_options All allowed credit values, ascending.
   * @property {number} rating Course rating shown on the site.
   * @property {string} lecturer Lecturer name.
   * @property {string} lecturer_degree Lecturer's academic degree/position text.
   * @property {?string} cv Link to the lecturer's CV page.
   * @property {?number} year Recommended year of study.
   * @property {?number} semester Primary semester number from the syllabus.
   * @property {{semester: number, control: string}[]} semesters Per-semester final control (CONTROL keys).
   * @property {string[]} controls Distinct control types across semesters (CONTROL keys).
   * @property {?string} kind "elective" or "mandatory" (mandatory for its own programme; see KIND).
   * @property {?string} lang Teaching language from the syllabus ("uk" / "en").
   * @property {?number} faculty Faculty ID.
   * @property {?number} department Department ID (key into options.departments).
   * @property {number[]} specialities Speciality IDs listed in the syllabus header.
   * @property {?string} program_type Educational programme type from the syllabus.
   * @property {{lections: ?number, practical: ?number, lab: ?number, individual: ?number}} hours Contact/self-study hours.
   * @property {?number} syl_credits Credits as stated in the syllabus.
   * @property {boolean} termpaper Whether the course includes a term paper.
   * @property {string} objective Course objective (plain text, up to 600 chars).
   * @property {string} prerequisites Prerequisites (plain text, up to 300 chars).
   * @property {string[]} site_lang Language filter values ("uk"/"en") under which the site lists the course.
   * @property {string[]} degrees Degree filter values (DEGREE keys) under which the site lists it.
   * @property {string[]} site_sems Semester filter values ("fall"/"spring") under which the site lists it.
   * @property {number[]} deps Department filter IDs under which the site lists it.
   * @property {number[]} majors Speciality (major) filter IDs under which the site lists it.
   * @property {string} [_hay] Cached normalized search text (added at runtime by matches()).
   */

  /**
   * Catalog payload (extension/courses.json, or window.ELECTIVES from data.js).
   * @typedef {Object} CatalogData
   * @property {string} fetched Scrape timestamp, "YYYY-MM-DD HH:MM".
   * @property {{departments: {id: number, name: string, sub: boolean}[], majors: {label: string, items: {id: number, name: string}[]}[]}} options
   *   Values of the site's standard filters (departments flat with `sub` marking nested ones; majors grouped by field).
   * @property {Course[]} courses All elective courses.
   */

  /**
   * A semester slot in the user's plan.
   * @typedef {Object} PlanSemester
   * @property {string} key Unique slot key ("fall", "spring" or "s<num>").
   * @property {?number} num Absolute semester number (1, 2, …) or null for a generic fall/spring slot.
   * @property {string} label Full display label.
   * @property {string} short Short display label.
   * @property {"fall"|"spring"} parity Which half of the academic year the semester falls in.
   * @property {number|string} target Credit target for electives in this semester ("" when unset).
   */

  /**
   * A course placed into a plan variant.
   * @typedef {Object} BasketItem
   * @property {number} id Course ID.
   * @property {number} credits Chosen credit value.
   * @property {string} sem Key of the PlanSemester it belongs to.
   */

  /**
   * A named alternative plan; semester slots/targets are shared, only the basket differs.
   * @typedef {Object} PlanVariant
   * @property {string} id Variant ID.
   * @property {string} name Display name ("План A", …).
   * @property {BasketItem[]} basket Courses in this variant.
   */

  /**
   * Bridge for Gemini API calls. In the extension it proxies through the background
   * worker (key kept in chrome.storage); standalone, a fallback uses fetch with a key in localStorage.
   * @typedef {Object} GeminiBridge
   * @property {(url: string, method?: string, body?: string) => Promise<{ok: boolean, status: number, body: string}>} request
   *   Performs an authenticated request to the Gemini API.
   * @property {() => Promise<{hasKey: boolean, hint: string}>} keyInfo Whether a key is stored, plus a masked hint.
   * @property {(key: string) => Promise<boolean>} setKey Stores (or clears, with "") the API key.
   */

  /**
   * Host environment passed to mount().
   * @typedef {Object} AppEnv
   * @property {boolean} [live] True when running on dl.tntu.edu.ua under a logged-in account.
   * @property {() => Promise<Account>} [loadAccount] Loads the student's account data from the site.
   * @property {() => void} [close] Closes the overlay (extension only).
   * @property {GeminiBridge} [gemini] Gemini bridge; when absent a direct-fetch fallback is used.
   * @property {string} [version] Extension version shown in the footer.
   */

  // Display labels for site codes (UI text, Ukrainian).
  /** Final-control type → full label. */
  const CONTROL = { exam: "екзамен", credit: "залік", diff_credit: "диф. залік", none: "без контролю", cw: "курсова робота", cp: "курсовий проєкт" };
  /** Final-control type → short label for compact views. */
  const CONTROL_SHORT = { exam: "Екз", credit: "Зал", diff_credit: "Диф", none: "—", cw: "КР", cp: "КП" };
  /** Teaching language code → label. */
  const LANG = { uk: "українська", en: "англійська" };
  /** Course kind → label. */
  const KIND = { elective: "вибіркова", mandatory: "обов’язкова для своєї ОП (для інших — вибіркова)" };
  /** Degree code → label. */
  const DEGREE = { bachelor: "Бакалавр", master: "Магістр", phd: "Доктор філософії" };
  /** Semester parity → label. */
  const SEM = { fall: "Осінній", spring: "Весняний" };
  /** Catalog page size (courses per "show more" step). */
  const PAGE = 60;

  /**
   * Normalizes text for matching: lowercases, drops quotes/apostrophes, collapses non-alphanumerics to spaces.
   * @param {*} s Any value (null/undefined → "").
   * @returns {string}
   */
  const norm = s => String(s || "").toLowerCase().replace(/[’'ʼ`"«»]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  /**
   * Set of normalized words longer than 2 characters.
   * @param {*} s
   * @returns {Set<string>}
   */
  const tokens = s => new Set(norm(s).split(" ").filter(w => w.length > 2));
  /**
   * Escapes text for safe insertion into HTML (text and double-quoted attributes).
   * @param {*} s
   * @returns {string}
   */
  const esc = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  /**
   * Formats a number with at most two decimals.
   * @param {number} n
   * @returns {string}
   */
  const fmt = n => String(Math.round(n * 100) / 100);
  /**
   * Picks the Ukrainian plural form for a count.
   * @param {number} n Count.
   * @param {string} one Form for 1, 21, 31… (e.g. "курс").
   * @param {string} few Form for 2–4, 22–24… (e.g. "курси").
   * @param {string} many Form for 0, 5–20… (e.g. "курсів").
   * @returns {string}
   */
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  };
  /**
   * CSS class for a control type: "exam" for exams, "zalik" for any other control, "" when none.
   * @param {?string} k CONTROL key.
   * @returns {string}
   */
  const ctlClass = k => k === "exam" ? "exam" : k ? "zalik" : "";
  /**
   * Word-overlap similarity of two titles: shared tokens / size of the smaller token set.
   * @param {string} a
   * @param {string} b
   * @returns {number} 0..1 (0 if either has no tokens).
   */
  function similarity(a, b) {
    const A = tokens(a), B = tokens(b);
    if (!A.size || !B.size) return 0;
    let inter = 0; A.forEach(t => B.has(t) && inter++);
    return inter / Math.min(A.size, B.size);
  }
  /**
   * JSON wrapper around localStorage with a key prefix; errors (quota, private mode) are swallowed.
   * @param {string} prefix Key prefix.
   * @returns {{get: (k: string, d?: *) => *, set: (k: string, v: *) => void}} `get` returns `d` when missing or unreadable.
   */
  function makeStore(prefix) {
    return {
      get(k, d) { try { const v = localStorage.getItem(prefix + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
      set(k, v) { try { localStorage.setItem(prefix + k, JSON.stringify(v)); } catch {} },
    };
  }

