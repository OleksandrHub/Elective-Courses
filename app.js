const D = window.ELECTIVES;
const COURSES = D.courses;
const BY_ID = new Map(COURSES.map(c => [c.id, c]));
const DEPS = D.options.departments, MAJORS = D.options.majors;
const CONTROL = { exam: "екзамен", credit: "залік", diff_credit: "диф. залік", none: "немає" };
const LANG = { uk: "українська", en: "англійська" };
const KIND = { elective: "вибіркова", mandatory: "обов’язкова (для інших ОП — вибіркова)" };
const $ = s => document.querySelector(s);

// ---------- збереження ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem("el_" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("el_" + k, JSON.stringify(v)); } catch {} }
};
let stars = new Set(store.get("stars", []));
let basket = store.get("basket", []); // [{id, credits, sem}]

// ---------- нормалізація назв ----------
const norm = s => s.toLowerCase().replace(/[’'ʼ`"«»]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const tokens = s => new Set(norm(s).split(" ").filter(w => w.length > 2));
function similarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; A.forEach(t => B.has(t) && inter++);
  return inter / Math.min(A.size, B.size);
}
let mandatoryNames = [];
function blockState(c) {
  const n = norm(c.name);
  let similar = null;
  for (const m of mandatoryNames) {
    const mn = norm(m);
    if (!mn) continue;
    if (mn === n) return { exact: true, match: m };
    if (!similar && ((mn.length >= 6 && (n.includes(mn) || mn.includes(n))) || similarity(m, c.name) >= 0.8)) similar = m;
  }
  return similar ? { similar: true, match: similar } : null;
}

// ---------- семестри ----------
const semNums = c => (c.semesters && c.semesters.length ? c.semesters.map(s => s.semester) : (c.semester ? [c.semester] : [])).filter(Boolean);
function parities(c) {
  const p = new Set(semNums(c).map(n => n % 2 ? "fall" : "spring"));
  return p;
}

// ---------- фільтри ----------
const F = { credits: new Set(), control: new Set(), year: new Set(), sem: new Set(), lang: new Set(), kind: new Set() };
function chipGroup(el, key, items) {
  el.innerHTML = "";
  for (const [val, label] of items) {
    const b = document.createElement("span");
    b.className = "chip"; b.textContent = label; b.dataset.v = val;
    b.onclick = () => { F[key].has(val) ? F[key].delete(val) : F[key].add(val); b.classList.toggle("on"); page = 1; render(); };
    el.appendChild(b);
  }
}
const creditCounts = {}; COURSES.forEach(c => c.credit_options.forEach(v => creditCounts[v] = (creditCounts[v] || 0) + 1));
const allCredits = Object.keys(creditCounts).map(Number).filter(v => creditCounts[v] >= 5).sort((a, b) => a - b);
chipGroup($("#f-credits"), "credits", allCredits.map(v => [v, String(v)]));
chipGroup($("#f-control"), "control", [["exam", "Екзамен"], ["credit", "Залік"], ["diff_credit", "Диф. залік"]]);
chipGroup($("#f-year"), "year", [1, 2, 3, 4, 5, 6].map(y => [y, y + (y > 4 ? " (маг.)" : "")]));
chipGroup($("#f-sem"), "sem", [["fall", "Осінній"], ["spring", "Весняний"], ...[1,2,3,4,5,6,7,8,9,10,11].map(n => [n, n + " сем."])]);
chipGroup($("#f-lang"), "lang", [["uk", "Українська"], ["en", "Англійська"]]);
chipGroup($("#f-kind"), "kind", [["elective", "Вибіркова"], ["mandatory", "Обов’язкова для своєї ОП"]]);

const depCounts = {}; COURSES.forEach(c => c.department && (depCounts[c.department] = (depCounts[c.department] || 0) + 1));
for (const [id, name] of Object.entries(DEPS)) if (depCounts[id]) $("#f-dep").add(new Option(`${name} (${depCounts[id]})`, id));
const specCounts = {}; COURSES.forEach(c => (c.specialities || []).forEach(s => specCounts[s] = (specCounts[s] || 0) + 1));
for (const [id, name] of Object.entries(MAJORS).sort((a, b) => a[1].localeCompare(b[1], "uk"))) {
  if (!specCounts[id]) continue;
  $("#f-spec").add(new Option(`${name} (${specCounts[id]})`, id));
  $("#my-spec").add(new Option(name, id));
}

function matches(c, opts = {}) {
  const q = norm($("#q").value);
  if (q) {
    const hay = norm([c.name, c.lecturer, c.objective, c.prerequisites, c.id].join(" "));
    if (!q.split(" ").every(w => hay.includes(w))) return false;
  }
  if (F.credits.size && !c.credit_options.some(v => F.credits.has(v))) return false;
  if (F.control.size && !(c.controls || []).some(v => F.control.has(v))) return false;
  if (F.year.size && !F.year.has(c.year)) return false;
  if (!opts.ignoreSem && F.sem.size) {
    const nums = semNums(c), par = parities(c);
    if (![...F.sem].some(v => typeof v === "number" ? nums.includes(v) : par.has(v))) return false;
  }
  if (F.lang.size && !F.lang.has(c.lang)) return false;
  if (F.kind.size && !F.kind.has(c.kind)) return false;
  if ($("#f-dep").value && String(c.department) !== $("#f-dep").value && String(c.faculty) !== $("#f-dep").value) return false;
  if ($("#f-spec").value && !(c.specialities || []).includes(+$("#f-spec").value)) return false;
  if ($("#f-nocw").checked && c.termpaper) return false;
  if ($("#f-star").checked && !stars.has(c.id)) return false;
  const b = blockState(c);
  if (b && b.exact && $("#f-hideblocked").checked) return false;
  if (b && b.similar && $("#f-hidesimilar").checked) return false;
  return true;
}

const SORTS = {
  rating: (a, b) => b.rating - a.rating,
  name: (a, b) => a.name.localeCompare(b.name, "uk"),
  credits: (a, b) => a.credits - b.credits || b.rating - a.rating,
  year: (a, b) => (a.year || 9) - (b.year || 9) || b.rating - a.rating,
};

// ---------- рендер списку ----------
const PAGE = 60; let page = 1;
const esc = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
function semLabel(c) {
  const nums = semNums(c);
  if (!nums.length) return "семестр ?";
  return nums.map(n => `${n} сем. (${n % 2 ? "осінь" : "весна"})`).join(", ");
}
function controlTags(c) {
  if (c.semesters && c.semesters.length > 1)
    return c.semesters.map(s => `<span class="tag ${s.control === "exam" ? "exam" : "credit"}">${s.semester} сем.: ${CONTROL[s.control] || s.control}</span>`).join("");
  return (c.controls || []).map(k => `<span class="tag ${k === "exam" ? "exam" : "credit"}">${CONTROL[k] || k}</span>`).join("");
}
function cardHTML(c) {
  const b = blockState(c);
  const inB = basket.some(x => x.id === c.id);
  const sameName = basket.find(x => x.id !== c.id && BY_ID.get(x.id) && norm(BY_ID.get(x.id).name) === norm(c.name));
  const h = c.hours || {};
  const hrs = [["лекції", h.lections], ["практ.", h.practical], ["лаб.", h.lab], ["самост.", h.individual]].filter(x => x[1]).map(x => `${x[0]} ${x[1]}`).join(" · ");
  return `<div class="card ${b && b.exact ? "blocked" : ""} ${inB ? "inbasket" : ""}" data-id="${c.id}">
    <div>
      <div class="title"><a href="https://dl.tntu.edu.ua/mods/syllabus/view.php?sid=${c.sid}" target="_blank" rel="noopener">${esc(c.name)}</a></div>
      <div class="sub">ID ${c.id} · ${esc(c.lecturer_degree)} ${c.cv ? `<a href="${esc(c.cv)}" target="_blank" rel="noopener">${esc(c.lecturer)}</a>` : esc(c.lecturer)} · ${esc(DEPS[c.department] || "")}</div>
      <div class="tags">
        <span class="tag cr">${c.credit_options.join(" / ")} кр.</span>
        ${controlTags(c)}
        <span class="tag">${c.year ? c.year + " рік" : "рік ?"}</span>
        <span class="tag">${semLabel(c)}</span>
        <span class="tag">${LANG[c.lang] || c.lang || ""}</span>
        <span class="tag">рейтинг ${c.rating}</span>
        ${c.termpaper ? `<span class="tag warn">курсова робота</span>` : ""}
        ${b ? `<span class="tag warn">⚠ ${b.exact ? "збігається з" : "схоже на"} обов’язкову «${esc(b.match)}»</span>` : ""}
        ${sameName ? `<span class="tag warn">курс з такою ж назвою вже обрано</span>` : ""}
      </div>
    </div>
    <div class="actions">
      <button class="star ${stars.has(c.id) ? "on" : ""}" data-act="star" title="Цікавить">★</button>
      <button data-act="add" class="${inB ? "" : "primary"}">${inB ? "Прибрати" : "Обрати"}</button>
    </div>
    <details class="more"><summary>Деталі</summary>
      ${c.objective ? `<p><b>Мета:</b> ${esc(c.objective)}</p>` : ""}
      ${c.prerequisites ? `<p><b>Передумови:</b> ${esc(c.prerequisites)}</p>` : ""}
      ${hrs ? `<p><b>Години:</b> ${hrs}</p>` : ""}
      <p><b>Статус:</b> ${KIND[c.kind] || "?"}${c.specialities && c.specialities.length ? ` · <b>Спеціальності:</b> ${c.specialities.map(s => esc(MAJORS[s] || s)).join("; ")}` : ""}</p>
    </details>
  </div>`;
}
function render() {
  const res = COURSES.filter(c => matches(c)).sort(SORTS[$("#sort").value]);
  $("#count").textContent = `Знайдено: ${res.length}`;
  $("#list").innerHTML = res.slice(0, page * PAGE).map(cardHTML).join("") || `<div class="panel muted">Нічого не знайдено — послабте фільтри.</div>`;
  $("#more").style.display = res.length > page * PAGE ? "" : "none";
  renderBasket();
}
$("#list").addEventListener("click", e => {
  const btn = e.target.closest("button[data-act]"); if (!btn) return;
  const id = +btn.closest(".card").dataset.id;
  if (btn.dataset.act === "star") { stars.has(id) ? stars.delete(id) : stars.add(id); store.set("stars", [...stars]); }
  if (btn.dataset.act === "add") toggleBasket(id);
  render();
});
$("#more").onclick = () => { page++; render(); };

// ---------- кошик ----------
function defaultSem(c) {
  const p = parities(c);
  if (p.size === 1) return [...p][0];
  return $("#c-sem").value;
}
function toggleBasket(id, credits, sem) {
  const i = basket.findIndex(x => x.id === id);
  if (i >= 0) basket.splice(i, 1);
  else { const c = BY_ID.get(id); basket.push({ id, credits: credits ?? c.credits, sem: sem ?? defaultSem(c) }); }
  store.set("basket", basket);
}
function renderBasket() {
  const el = $("#basket");
  const targets = { fall: +$("#t-fall").value || 0, spring: +$("#t-spring").value || 0 };
  let html = "";
  for (const sem of ["fall", "spring"]) {
    const items = basket.filter(x => x.sem === sem);
    const sum = items.reduce((s, x) => s + x.credits, 0);
    const t = targets[sem];
    html += `<div class="sum"><span>${sem === "fall" ? "Осінній семестр" : "Весняний семестр"}</span><span>${sum}${t ? " / " + t : ""} кр.</span></div>`;
    if (t) html += `<div class="bar ${sum > t ? "over" : ""}"><div style="width:${Math.min(100, sum / t * 100)}%"></div></div>
      <div class="muted">${sum === t ? "✓ Рівно скільки треба" : sum < t ? `Бракує ${t - sum} кр.` : `Перебір на ${sum - t} кр.`}</div>`;
    for (const x of items) {
      const c = BY_ID.get(x.id); if (!c) continue;
      const wrongSem = !parities(c).has(sem) && parities(c).size;
      const b = blockState(c);
      html += `<div class="basket-item" data-id="${c.id}">
        <div><b>${esc(c.name)}</b><div class="muted">${(c.controls || []).map(k => CONTROL[k]).join(", ")} · ${c.year || "?"} рік · ${esc(c.lecturer)}</div>
        ${wrongSem ? `<div class="tag warn">читається в ${semLabel(c)}</div>` : ""}
        ${b ? `<div class="tag warn">⚠ ${b.exact ? "це ваша обов’язкова" : "схоже на обов’язкову"}</div>` : ""}</div>
        <div class="row" style="flex-direction:column;align-items:end">
          ${c.credit_options.length > 1 ? `<select data-act="cr">${c.credit_options.map(v => `<option ${v === x.credits ? "selected" : ""}>${v}</option>`).join("")}</select>` : `<span>${x.credits} кр.</span>`}
          <select data-act="sem"><option value="fall" ${sem === "fall" ? "selected" : ""}>осінь</option><option value="spring" ${sem === "spring" ? "selected" : ""}>весна</option></select>
          <button class="link" data-act="rm">прибрати</button>
        </div></div>`;
    }
    if (!items.length) html += `<div class="muted" style="margin:4px 0 8px">Порожньо</div>`;
  }
  const exams = basket.filter(x => (BY_ID.get(x.id)?.controls || []).includes("exam")).length;
  if (basket.length) html += `<div class="muted" style="margin-top:8px">Усього: ${basket.length} дисц., з них з екзаменом: ${exams}</div>
    <div class="row" style="margin-top:6px"><button id="copy">Скопіювати список</button><button id="clear">Очистити</button></div>`;
  el.innerHTML = html;
  const cp = $("#copy"); if (cp) cp.onclick = () => {
    const txt = ["fall", "spring"].map(s => (s === "fall" ? "Осінь:\n" : "Весна:\n") + basket.filter(x => x.sem === s).map(x => { const c = BY_ID.get(x.id); return `  ${c.id} — ${c.name} (${x.credits} кр., ${(c.controls || []).map(k => CONTROL[k]).join("/")}, ${c.lecturer})`; }).join("\n")).join("\n");
    navigator.clipboard.writeText(txt).then(() => cp.textContent = "Скопійовано ✓");
  };
  const cl = $("#clear"); if (cl) cl.onclick = () => { if (confirm("Очистити вибір?")) { basket = []; store.set("basket", basket); render(); } };
}
$("#basket").addEventListener("change", e => {
  const it = e.target.closest(".basket-item"); if (!it) return;
  const x = basket.find(b => b.id === +it.dataset.id);
  if (e.target.dataset.act === "cr") x.credits = +e.target.value;
  if (e.target.dataset.act === "sem") x.sem = e.target.value;
  store.set("basket", basket); render();
});
$("#basket").addEventListener("click", e => {
  if (e.target.dataset.act !== "rm") return;
  toggleBasket(+e.target.closest(".basket-item").dataset.id); render();
});

// ---------- комбінації ----------
function runCombos() {
  const sem = $("#c-sem").value;
  const target = +$(sem === "fall" ? "#t-fall" : "#t-spring").value || 0;
  const have = basket.filter(x => x.sem === sem).reduce((s, x) => s + x.credits, 0);
  const need = Math.round((target - have) * 2) / 2;
  const out = $("#combos");
  if (!target) { out.innerHTML = `<p class="muted">Вкажіть вгорі, скільки кредитів треба набрати в цьому семестрі (є в навчальному плані / на вкладці «Обрані мною»).</p>`; return; }
  if (need <= 0) { out.innerHTML = `<p class="muted">У цьому семестрі вже набрано ${have} з ${target} кр.</p>`; return; }

  const takenNames = new Set(basket.map(x => norm(BY_ID.get(x.id).name)));
  let pool = COURSES.filter(c => !basket.some(x => x.id === c.id) && !takenNames.has(norm(c.name))
    && parities(c).has(sem) && !(blockState(c) || {}).exact);
  const starred = pool.filter(c => stars.has(c.id));
  const fromStars = starred.length > 0;
  pool = fromStars ? starred : pool.filter(c => matches(c, { ignoreSem: true }));
  pool = pool.sort((a, b) => b.rating - a.rating).slice(0, 70);

  const maxK = Math.max(1, Math.min(5, +$("#c-max").value || 3));
  const results = [];
  const opts = pool.flatMap(c => c.credit_options.map(v => ({ c, v })));
  (function dfs(start, sum, chosen) {
    if (sum === need) { results.push(chosen.slice()); return; }
    if (chosen.length >= maxK || sum > need || results.length > 4000) return;
    for (let i = start; i < opts.length; i++) {
      const o = opts[i];
      if (sum + o.v > need) continue;
      if (chosen.some(x => x.c.id === o.c.id || norm(x.c.name) === norm(o.c.name))) continue;
      chosen.push(o); dfs(i + 1, sum + o.v, chosen); chosen.pop();
    }
  })(0, 0, []);

  const score = r => r.reduce((s, x) => s + x.c.rating, 0) / r.length;
  results.sort((a, b) => a.length - b.length || score(b) - score(a));
  const top = results.slice(0, 12);
  window._combos = top;
  out.innerHTML = `<p class="muted">Треба дозібрати <b>${need} кр.</b> · кандидатів: ${pool.length} (${fromStars ? "з ★ цікавих" : "з поточного фільтра"}) · варіантів: ${results.length}${results.length > 4000 ? "+" : ""}</p>` +
    (top.length ? top.map((r, i) => `<div class="combo"><b>${r.length} дисц. · ${need} кр. · сер. рейтинг ${score(r).toFixed(1)}</b>
      <ul>${r.map(x => `<li>${esc(x.c.name)} — ${x.v} кр., ${(x.c.controls || []).map(k => CONTROL[k]).join("/")}, ${x.c.year || "?"} рік</li>`).join("")}</ul>
      <button data-combo="${i}">Додати всі</button></div>`).join("")
      : `<p class="muted">Точної комбінації не знайшлося. Спробуйте більше курсів у наборі, позначте більше ★ або послабте фільтри.</p>`);
}
$("#c-run").onclick = runCombos;
$("#combos").addEventListener("click", e => {
  const i = e.target.dataset.combo; if (i == null) return;
  const sem = $("#c-sem").value;
  for (const x of window._combos[i]) if (!basket.some(b => b.id === x.c.id)) toggleBasket(x.c.id, x.v, sem);
  render(); runCombos();
});

// ---------- обов’язкові ----------
function updateMandatory() {
  mandatoryNames = $("#mandatory").value.split("\n").map(s => s.trim()).filter(Boolean);
  store.set("mandatory", $("#mandatory").value);
}
$("#mandatory").value = store.get("mandatory", "");
updateMandatory();
$("#mandatory").addEventListener("input", () => { updateMandatory(); page = 1; render(); });
$("#my-spec").value = store.get("myspec", "");
$("#fill-mandatory").onclick = () => {
  const sp = +$("#my-spec").value; if (!sp) return;
  store.set("myspec", String(sp));
  const names = new Set(mandatoryNames.map(norm));
  const add = [...new Set(COURSES.filter(c => c.kind === "mandatory" && (c.specialities || []).includes(sp)).map(c => c.name))]
    .filter(n => !names.has(norm(n))).sort((a, b) => a.localeCompare(b, "uk"));
  $("#mandatory").value = [$("#mandatory").value.trim(), ...add].filter(Boolean).join("\n");
  updateMandatory(); render();
  alert(`Додано ${add.length} назв. Видаліть зайве, якщо щось у вашому плані не обов’язкове.`);
};

// ---------- решта ----------
for (const k of ["fall", "spring"]) {
  const el = $("#t-" + k); el.value = store.get("t_" + k, "");
  el.addEventListener("input", () => { store.set("t_" + k, el.value); renderBasket(); });
}
["#q"].forEach(s => $(s).addEventListener("input", () => { page = 1; render(); }));
["#sort", "#f-dep", "#f-spec", "#f-nocw", "#f-star", "#f-hideblocked", "#f-hidesimilar"].forEach(s => $(s).addEventListener("change", () => { page = 1; render(); }));
$("#reset").onclick = () => {
  Object.values(F).forEach(s => s.clear());
  document.querySelectorAll(".chip.on").forEach(c => c.classList.remove("on"));
  $("#q").value = ""; $("#f-dep").value = ""; $("#f-spec").value = ""; $("#f-nocw").checked = false; $("#f-star").checked = false;
  page = 1; render();
};
$("#meta").textContent = `${COURSES.length} курсів · дані з dl.tntu.edu.ua станом на ${D.fetched} · оновити: python3 scrape.py`;
render();
