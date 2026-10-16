// Інтерфейс підбору вибіркових дисциплін.
// Працює і як окрема сторінка (index.html), і всередині сайту через розширення (content.js).
// ElectivesApp.mount(element, data, env)
//   env.live         — запущено на dl.tntu.edu.ua під акаунтом
//   env.loadAccount  — async () => {speciality, mandatory[], plan[], selected[], selectedTitle, recommended[], interested[]}
//   env.close        — закрити оверлей
//   env.gemini       — {request, keyInfo, setKey}: запити до Gemini через розширення (інакше — напряму з ключем у localStorage)
  const CONTROL = { exam: "екзамен", credit: "залік", diff_credit: "диф. залік", none: "без контролю", cw: "курсова робота", cp: "курсовий проєкт" };
  const CONTROL_SHORT = { exam: "Екз", credit: "Зал", diff_credit: "Диф", none: "—", cw: "КР", cp: "КП" };
  const LANG = { uk: "українська", en: "англійська" };
  const KIND = { elective: "вибіркова", mandatory: "обов’язкова для своєї ОП (для інших — вибіркова)" };
  const DEGREE = { bachelor: "Бакалавр", master: "Магістр", phd: "Доктор філософії" };
  const SEM = { fall: "Осінній", spring: "Весняний" };
  const PAGE = 60;

  const norm = s => String(s || "").toLowerCase().replace(/[’'ʼ`"«»]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const tokens = s => new Set(norm(s).split(" ").filter(w => w.length > 2));
  const esc = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const fmt = n => String(Math.round(n * 100) / 100);
  const ctlClass = k => k === "exam" ? "exam" : k ? "zalik" : "";
  function similarity(a, b) {
    const A = tokens(a), B = tokens(b);
    if (!A.size || !B.size) return 0;
    let inter = 0; A.forEach(t => B.has(t) && inter++);
    return inter / Math.min(A.size, B.size);
  }
  function makeStore(prefix) {
    return {
      get(k, d) { try { const v = localStorage.getItem(prefix + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
      set(k, v) { try { localStorage.setItem(prefix + k, JSON.stringify(v)); } catch {} },
    };
  }

