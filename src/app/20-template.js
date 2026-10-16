    // ---------- Markup ----------
    // Credit values offered by at least 5 courses become credit filter chips.
    const creditCounts = {};
    COURSES.forEach(c => c.credit_options.forEach(v => creditCounts[v] = (creditCounts[v] || 0) + 1));
    const creditValues = Object.keys(creditCounts).map(Number).filter(v => creditCounts[v] >= 5).sort((a, b) => a - b);
    /**
     * Markup for a group of toggle chips bound to a filter key in S.
     * @param {string} key Filter key in S (array-valued, e.g. "credits").
     * @param {Array<[string|number, string]>} items [value, label] pairs.
     * @returns {string} HTML.
     */
    const chipsHTML = (key, items) => `<div class="chips" data-chips="${key}">${items.map(([v, l]) => `<button class="chip" data-v="${v}">${l}</button>`).join("")}</div>`;

    // Static app shell; dynamic parts are filled in by render*() functions.
    root.innerHTML = `
      <header class="top">
        <div class="brand"><span class="logo">В</span><div><b>Вибіркові</b><small id="meta"></small></div></div>
        <nav class="tabs" role="tablist">
          <button role="tab" data-tab="catalog">Каталог</button>
          <button role="tab" data-tab="report">Звіт по семестрах</button>
          <button role="tab" data-tab="ai">✨ ШІ-підбір</button>
        </nav>
        <div class="top-right">
          <div id="account" class="account"></div>
          <details class="pop right theme-pop">
            <summary class="top-ic" title="Тема оформлення" aria-label="Тема оформлення"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></svg></summary>
            <div class="pop-panel theme-menu" role="menu">
              <div class="lbl">Тема оформлення</div>
              ${[["tntu", "ТНТУ", "світла, як сайт"], ["classic", "Класична", "теплий світлий фон"], ["dark", "Темна", "завжди темна"], ["auto", "Як у системі", "світла або темна"]]
                .map(([v, l, d]) => `<button class="theme-opt" data-theme-set="${v}" role="menuitemradio"><span class="sw sw-${v}"></span><span><b>${l}</b><small>${d}</small></span></button>`).join("")}
            </div>
          </details>
          <button id="plan-btn" class="plan-btn" title="Мій план і підбір комбінацій"></button>
          ${env.close ? `<button id="close" class="top-ic" title="Закрити (Esc)" aria-label="Закрити">✕</button>` : ""}
        </div>
      </header>

      <section id="view-catalog">
        <div class="filterbar"><div class="fb-inner">
          <div class="fb-search">
            <div class="search"><span aria-hidden="true">⌕</span><input id="q" type="search" placeholder="Назва, викладач, зміст…" autocomplete="off"><kbd>/</kbd></div>
            <button class="fb-toggle" id="fb-toggle" aria-expanded="false" aria-controls="fb-pills">Фільтри<span id="fb-count"></span></button>
          </div>
          <div class="pills" id="fb-pills"><div class="pill-row">
            <select id="f-lang" class="pill" aria-label="Мова викладання"><option value="">Мова викладання</option><option value="uk">Українська</option><option value="en">Англійська</option></select>
            <select id="f-dep" class="pill" aria-label="Підрозділ, кафедра, відділ, центр"><option value="">Підрозділ, кафедра</option>${D.options.departments.map(d => `<option value="${d.id}">${d.sub ? "   " : ""}${esc(d.name)}</option>`).join("")}</select>
            <select id="f-major" class="pill" aria-label="Галузь знань і спеціальність"><option value="">Галузь знань і спеціальність</option>${D.options.majors.map(g => `<optgroup label="${esc(g.label)}">${g.items.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join("")}</optgroup>`).join("")}</select>
            <select id="f-degree" class="pill" aria-label="Ступінь освіти"><option value="">Ступінь освіти</option>${Object.entries(DEGREE).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
            <select id="f-sem" class="pill" aria-label="Семестр, в якому читається"><option value="">Семестр</option>${Object.entries(SEM).map(([k, v]) => `<option value="${k}">${v} (${k === "fall" ? "непарний" : "парний"})</option>`).join("")}</select>
            </div><div class="pill-row">
            <details class="pop" data-pop="credits"><summary class="pill">Кредити</summary><div class="pop-panel">${chipsHTML("credits", creditValues.map(v => [v, v]))}</div></details>
            <details class="pop" data-pop="control"><summary class="pill">Контроль</summary><div class="pop-panel">${chipsHTML("control", [["exam", "Екзамен"], ["credit", "Залік"], ["diff_credit", "Диф. залік"]])}</div></details>
            <details class="pop" data-pop="year"><summary class="pill">Рік навчання</summary><div class="pop-panel">${chipsHTML("year", [1, 2, 3, 4, 5, 6].map(y => [y, y + (y > 4 ? " (маг.)" : "") + " рік"]))}</div></details>
            <button class="pill toggle" data-toggle="rec" id="rec-pill" hidden>🎓 Рекомендовані кафедрою</button>
            <button class="pill toggle" data-toggle="star">★ Цікаві</button>
            <button class="pill toggle" data-toggle="nocw">Без курсової</button>
            <details class="pop right" data-pop="mand"><summary class="pill">Обов’язкові</summary><div class="pop-panel wide">
              <label class="check"><input type="checkbox" id="f-hideBlocked"> Ховати мої обов’язкові</label>
              <label class="check"><input type="checkbox" id="f-hideSimilar"> Ховати й курси зі схожими назвами</label>
              <div id="mand-account"></div>
              <label class="lbl" for="mandatory">${env.live ? "Додати назви вручну" : "Мої обов’язкові (по одній на рядок)"}</label>
              <textarea id="mandatory" placeholder="Вища математика&#10;Програмування"></textarea>
            </div></details>
          </div></div>
        </div></div>
        <div class="resultbar">
          <div class="rb-main">
            <span class="count" id="count"></span>
            <span class="spacer"></span>
            <button class="rb-btn" id="all-to-ai" title="Додати всі знайдені курси до списку для ШІ">✨ Знайдені → у список ШІ</button>
            <label class="rb-sort"><span>Сортувати</span>
              <select id="sort" class="pill" aria-label="Сортування">
                <option value="smart">рекомендовані спершу</option><option value="rating">рейтинг</option>
                <option value="name">назва</option><option value="credits">кредити</option><option value="year">рік навчання</option>
              </select></label>
            <div class="seg" role="group" aria-label="Вигляд"><button data-view="list" title="Список" aria-label="Список">☰</button><button data-view="table" title="Таблиця" aria-label="Таблиця">▦</button></div>
          </div>
          <div id="active" class="active-chips"></div>
        </div>
        <div id="list" class="content"></div>
        <button class="more-btn" id="more"></button>
      </section>

      <section id="view-report" class="content" hidden></section>

      <section id="view-ai" class="content" hidden>
        <div class="ai">
          <div class="report-head"><div><h1>✨ ШІ-підбір</h1>
            <p class="hint">Gemini з вашого Google-акаунта переглядає доступні курси, ваші обов’язкові й побажання та пропонує набори, що закривають кредити семестру.</p></div></div>
          <div class="card-box" id="ai-key"></div>
          <div class="card-box">
            <div class="row"><b>Мій список для ШІ</b><span class="spacer"></span>
              <label class="check" style="margin:0"><input type="checkbox" id="ai-uselist"> Підбирати лише з мого списку</label></div>
            <p class="hint" style="margin:4px 0 10px">Додавайте курси кнопкою ✨ у каталозі. Вони самі розходяться по семестрах за тим, коли читаються; курс, що читається і восени, і навесні, буде в обох.</p>
            <div class="ai-lists" id="ai-lists"></div>
          </div>
          <div class="card-box">
            <label class="lbl" for="ai-wish">Що вам цікаво і чого хочете уникнути</label>
            <textarea id="ai-wish" placeholder="Напр.: цікавлять машинне навчання і стартапи, краще без екзаменів, англійською — теж ок"></textarea>
            <div class="chips rules" id="ai-rules">
              <button class="chip" data-rule="nomand" title="Не пропонувати ваші обов’язкові й курси зі схожими назвами">Без обов’язкових і схожих</button>
              <button class="chip" data-rule="parity" title="Лише курси, що читаються в обраному семестрі (осінь/весна)">Лише ті, що читаються в цьому семестрі</button>
              <button class="chip" data-rule="year" title="Перевага курсам з рекомендованим роком, що відповідає вашому курсу">Бажано мого року навчання</button>
            </div>
            <div class="chips" id="ai-quick">${["Без екзаменів", "Без курсових", "Англійською", "Корисне для роботи в IT", "Найменше навантаження", "Пріоритет рекомендованим кафедрою", "Щось зовсім нове для мене"].map(t => `<button class="chip" data-q="${t}">+ ${t}</button>`).join("")}</div>
            <div class="row" style="margin-top:12px">
              <select id="ai-sem" class="pill" aria-label="Семестр"></select>
              <label class="check" style="margin:0"><input type="checkbox" id="ai-filters"> Лише з поточних фільтрів каталогу</label>
              <span class="spacer"></span>
              <button class="primary big" id="ai-run">✨ Підібрати</button>
            </div>
            <p class="hint" style="margin:10px 0 0">У Google надсилається: спеціальність, назви ваших обов’язкових, побажання і перелік курсів. Логін, пароль та інші особисті дані — ні.</p>
          </div>
          <div id="ai-out"></div>
        </div>
      </section>

      <div id="drawer-back" class="drawer-back" hidden></div>
      <aside id="drawer" class="drawer" aria-label="Мій план">
        <div class="drawer-head"><h2>Мій план</h2><button class="ghost" id="drawer-x" title="Закрити">✕</button></div>
        <div id="plan"></div>
        <div class="combos-box">
          <h3>Дозібрати кредити</h3>
          <p class="hint">Набори курсів, що дають рівно потрібну суму. Беру ★ цікаві, якщо вони є, інакше — поточний список з фільтрами. Рекомендовані кафедрою йдуть вище.</p>
          <div class="row"><select id="c-sem" class="pill quiet"></select>
            <label class="hint">до <input type="number" id="c-max" value="3" min="1" max="5"> курсів</label>
            <button class="primary" id="c-run">Підібрати</button></div>
          <div id="combos"></div>
        </div>
      </aside>

      <footer class="foot">
        <div>© 2026 <a href="https://github.com/OleksandrHub" target="_blank" rel="noopener">Олександр Кліщ</a>. Усі авторські права належать автору.</div>
        <div class="foot-links">
          <a href="https://github.com/OleksandrHub" target="_blank" rel="noopener">GitHub · OleksandrHub</a>
          <button class="link" data-doc="license">Ліцензія MIT</button>
          <button class="link" data-doc="terms">Умови користування</button>
          ${env.version ? `<span>v${esc(env.version)}</span>` : ""}
        </div>
        <div class="foot-note">Неофіційний інструмент, не пов’язаний з ТНТУ. Перед поданням заяви перевіряйте дані на dl.tntu.edu.ua.</div>
      </footer>

      <div id="comparebar" class="comparebar" hidden></div>
      <div id="modal" class="modal" hidden><div class="modal-box" role="dialog" aria-modal="true"><button class="ghost modal-x" title="Закрити">✕</button><div id="modal-body"></div></div></div>`;
