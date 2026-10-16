// Збирає всі дані акаунта для інтерфейсу. Нічого не змінює на сайті.
(() => {
  const E = (window.TntuEl ||= {});
  const { getDoc, clean, parseMandatory, addControls, loadSelected, loadInterested, loadCurriculum } = E;

  async function loadAccount() {
    const { doc } = await getDoc("/mods/elective_courses/mandatory.php");
    const mandatory = parseMandatory(doc);
    const speciality = clean(doc.body.textContent.match(/для спеціальності\s+([^\n]+)/i)?.[1]).replace(/^(\S+)\s+-\s+/, "$1 ");
    if (!mandatory.length) console.warn("[Вибіркові] не знайшов обов’язкових дисциплін на mandatory.php");
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
