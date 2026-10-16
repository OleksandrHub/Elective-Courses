/**
 * @file Gathers all account data needed by the UI by combining the other content
 * scripts (mandatory courses, "Selected by me", "Interested", curriculum). Starts
 * from /mods/elective_courses/mandatory.php. Runs in the user's session and only
 * reads; nothing on the site is modified.
 *
 * Exports on `window.TntuEl`: `loadAccount`.
 * Also defines the account data typedefs referenced across the extension and app.
 */

/**
 * Reference to a course on the site: numeric course id and/or syllabus id.
 * @typedef {Object} CourseRef
 * @property {?number} id Elective course id, or null if only the syllabus id is known.
 * @property {?string} sid Syllabus id (`sid=` parameter), or null.
 */

/**
 * Control forms of a course parsed from its syllabus JSON.
 * @typedef {Object} SyllabusInfo
 * @property {{semester: number, control: string}[]} sems One entry per semester from
 *   `points_distribution`, sorted by semester (0 if unknown); `control` is the syllabus's
 *   `final_assessment_type` (e.g. "exam", "credit", "diff_credit"), defaulting to "exam".
 * @property {boolean} termpaper Whether the syllabus has a term paper enabled.
 */

/**
 * One semester entry of a mandatory course from the "Mandatory courses" tab.
 * @typedef {Object} MandatoryCourse
 * @property {number} id Course id (first table column).
 * @property {string} name Course name.
 * @property {?string} sid Syllabus id, or null if the row has no syllabus link.
 * @property {?number} credits ECTS credits for this semester, or null.
 * @property {?number} semester Semester number from the preceding "N-й семестр" header, or null.
 * @property {?string} [control] Form of control from the syllabus: "exam" | "credit" | "diff_credit" | ...;
 *   null if not determined, absent if the course has no syllabus.
 * @property {boolean} [termpaper] Term-paper flag; set only on the course's last-semester row.
 */

/**
 * A course row of the individual curriculum.
 * @typedef {Object} CurriculumRow
 * @property {"mand"|"elec"} kind Mandatory or elective (from the group header above the row).
 * @property {number[]} ids Unique course ids found as "ID n" in the name cell.
 * @property {string} name Course name without the "ID n" tags.
 * @property {?number} hours Total hours.
 * @property {?number} credits ECTS credits.
 * @property {?number} lec Lecture hours.
 * @property {?number} pr Practical hours.
 * @property {?number} lab Laboratory hours.
 * @property {?number} self Self-study hours.
 * @property {?string} control "exam" | "credit" | "diff_credit" | "cw" (course work) | "cp" (course project),
 *   or the raw cell text if unrecognized, or null if empty.
 * @property {{zvo: string, nat: string, ects: string}} grade Grades: institutional points, national scale, ECTS letter ("" if none).
 */

/**
 * A practice/internship entry of the curriculum.
 * @typedef {Object} CurriculumPractice
 * @property {string} name Practice name.
 * @property {string} term Term/duration text as shown on the site.
 * @property {?number} credits ECTS credits.
 * @property {{zvo: string, nat: string, ects: string}} grade Grades ("" if none).
 */

/**
 * One semester of the individual curriculum.
 * @typedef {Object} CurriculumSemester
 * @property {?number} num Semester number.
 * @property {?number} total Total credits of the semester.
 * @property {?number} mandatoryCredits Credits of the mandatory part.
 * @property {?number} electiveCredits Credits of the elective part.
 * @property {CurriculumRow[]} rows Course rows.
 * @property {CurriculumPractice[]} practice Practice/internship entries.
 */

/**
 * The student's individual curriculum.
 * @typedef {Object} Curriculum
 * @property {{courseYear: ?number, group: string, level: string, speciality: string, planName: string}} student
 *   Year of study, group, education level, speciality and curriculum name.
 * @property {?number} current Number of the semester the site shows by default (the current one).
 * @property {CurriculumSemester[]} semesters All semesters sorted by number.
 */

/**
 * Everything read from the user's account.
 * @typedef {Object} Account
 * @property {string} speciality Speciality as "<code> <name>" (the site's "<code> - <name>" is normalized); from mandatory.php,
 *   falling back to the curriculum; "" if unknown.
 * @property {MandatoryCourse[]} mandatory Mandatory courses with control forms.
 * @property {?Curriculum} curriculum Individual curriculum, or null if it failed to load.
 * @property {{num: number, left: number}[]} plan Elective credits still to choose per semester ("Selected by me").
 * @property {{id: number, semester: number}[]} selected Electives already selected, with their semester.
 * @property {string} selectedTitle Title of the "Selected by me" tab as shown on the site.
 * @property {CourseRef[]} recommended Electives recommended by the graduating department.
 * @property {CourseRef[]} interested Electives the user marked as "I'm interested".
 */

(() => {
  const E = (window.TntuEl ||= {});
  const { getDoc, clean, parseMandatory, addControls, loadSelected, loadInterested, loadCurriculum } = E;

  /**
   * Read all account data. Fetches mandatory.php, then loads "Selected by me",
   * "Interested", the curriculum and syllabus control forms in parallel. Partial
   * failures are logged and replaced with empty defaults so the UI still works.
   * @returns {Promise<Account>} Combined account data.
   * @throws {Error} If mandatory.php itself cannot be loaded (e.g. not logged in).
   */
  async function loadAccount() {
    const { doc } = await getDoc("/mods/elective_courses/mandatory.php");
    const mandatory = parseMandatory(doc);
    const speciality = clean(doc.body.textContent.match(/для спеціальності\s+([^\n]+)/i)?.[1]).replace(/^(\S+)\s+-\s+/, "$1 ");
    if (!mandatory.length) console.warn("[Вибіркові] не знайшов обов’язкових дисциплін на mandatory.php");
    /** Build a catch handler that logs the failed part and yields an empty object. */
    const warn = (what) => e => { console.warn(`[Вибіркові] ${what}:`, e); return {}; };
    const [sel, int, curriculum] = await Promise.all([
      loadSelected(doc).catch(warn("«Обрані мною»")),
      loadInterested(doc).catch(warn("«Мене цікавлять»")),
      loadCurriculum().catch(e => { console.warn("[Вибіркові] навчальний план:", e); return null; }),
      addControls(mandatory),
    ]);
    return { speciality: speciality || curriculum?.student.speciality || "", mandatory, curriculum,
      plan: [], selected: [], selectedTitle: "Обрані мною", recommended: [], interested: [], ...sel, ...int };
  }

  Object.assign(E, { loadAccount });
})();
