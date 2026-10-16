    // ---------- License & terms ----------
    /**
     * Static legal documents (Ukrainian HTML) shown in the terms gate and in the
     * modal opened from footer links with `data-doc="license"|"terms"`.
     * @type {{license: string, terms: string}}
     */
    const DOCS = {
      license: `<h2>Ліцензія MIT</h2>
        <p>© 2026 Олександр Кліщ (<a href="https://github.com/OleksandrHub" target="_blank" rel="noopener">OleksandrHub</a>). Авторські права належать автору.</p>
        <p>Дозволяється безкоштовно користуватися, копіювати, змінювати, об’єднувати, публікувати, поширювати, субліцензувати та продавати копії програми за умови, що в усіх копіях або значущих частинах збережено це повідомлення про авторські права та дозвіл.</p>
        <p>Програма надається «як є», без жодних гарантій, явних чи неявних. Автор не несе відповідальності за будь-які претензії, збитки чи інші наслідки використання програми.</p>
        <p class="hint">Повний офіційний текст англійською — у файлі LICENSE поруч з розширенням.</p>`,
      terms: `<h2>Умови користування</h2>
        <p class="hint">Чинні з 17.10.2026 · автор Олександр Кліщ</p>
        <h3>1. Що це</h3><p>Неофіційний допоміжний інструмент для пошуку й порівняння вибіркових дисциплін на dl.tntu.edu.ua. <b>Не є продуктом ТНТУ</b> і не пов’язаний з університетом.</p>
        <h3>2. Ваші дані</h3><ul>
          <li>Розширення читає сторінки сайту у вашій уже відкритій сесії (обов’язкові, «Обрані мною», «Мене цікавлять», навчальний план). Логін і пароль воно не бачить і не зберігає.</li>
          <li>План, варіанти, ★ і налаштування зберігаються <b>лише у вашому браузері</b>. Автор їх не отримує.</li>
          <li>Розширення <b>нічого не змінює</b> у вашому акаунті й не подає заяв від вашого імені.</li></ul>
        <h3>3. ШІ-підбір (Gemini)</h3><ul>
          <li>Працює лише з вашим власним API-ключем Gemini, який зберігається у вашому браузері.</li>
          <li>У Google надсилаються: спеціальність, назви обов’язкових і вивчених дисциплін, побажання і перелік курсів. Оцінки, ПІБ, логін і пароль — ні.</li>
          <li>Запити обробляє Google за <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener">умовами Gemini API</a>. Відповіді ШІ можуть бути неточними.</li></ul>
        <h3>4. Без гарантій</h3><p>Дані про курси беруться з силабусів і сторінок сайту та можуть бути застарілими. <b>Перед поданням заяви перевіряйте все на dl.tntu.edu.ua і в деканаті.</b> Остаточний вибір, строки й правильність заяви — ваша відповідальність. Інструмент надається «як є».</p>
        <h3>5. Допустиме використання</h3><p>Користуйтеся лише зі своїм акаунтом і за правилами dl.tntu.edu.ua, без масових автоматичних запитів до сайту.</p>
        <h3>6. Ліцензія та контакти</h3><p>Код поширюється за ліцензією MIT. Питання й пропозиції — на <a href="https://github.com/OleksandrHub" target="_blank" rel="noopener">github.com/OleksandrHub</a>.</p>`,
    };
    /**
     * Current terms revision. Users must accept the terms before first use; bumping
     * this value asks everyone to accept again.
     * @type {string}
     */
    const TERMS_VERSION = "2026-10-17";
    /**
     * Whether the user has accepted the current terms revision.
     * @returns {boolean}
     */
    const termsAccepted = () => store.get("termsAccepted", "") === TERMS_VERSION;
    /**
     * Show the blocking terms-of-use dialog. Account reading is suspended until
     * the user ticks the checkbox and clicks "start", which stores the accepted
     * version and (in live mode) loads the account. "Not now" (shown only when
     * the host provides `env.close`) closes the overlay.
     * @returns {void}
     */
    function showTermsGate() {
      const g = document.createElement("div");
      g.className = "gate";
      g.innerHTML = `<div class="gate-box" role="dialog" aria-modal="true" aria-labelledby="gate-title">
        <div class="gate-intro"><span class="logo">В</span><div><b id="gate-title">Перед початком прочитайте умови користування</b>
          <div class="hint">Це займе хвилину: тут про те, які дані читає розширення, що надсилається в Gemini і чому дані перед заявою треба перевіряти.</div></div></div>
        <div class="gate-doc doc">${DOCS.terms}</div>
        <div class="gate-actions">
          <label class="check"><input type="checkbox" id="gate-ok"> Умови прочитано, погоджуюсь з ними</label>
          <span class="spacer"></span>
          ${env.close ? `<button class="ghost" id="gate-no">Не зараз</button>` : ""}
          <button class="primary" id="gate-yes" disabled>Почати користуватися</button>
        </div></div>`;
      root.append(g);
      accountState = "idle";      // do not read the account until the terms are accepted
      if (!account) $("#account").innerHTML = "";
      g.querySelector("#gate-ok").addEventListener("change", e => { g.querySelector("#gate-yes").disabled = !e.target.checked; });
      g.querySelector("#gate-yes").addEventListener("click", () => {
        store.set("termsAccepted", TERMS_VERSION);
        g.remove();
        if (env.live) loadAccount();
      });
      g.querySelector("#gate-no")?.addEventListener("click", () => env.close());
      g.querySelector("#gate-ok").focus();
    }
    // Footer links with data-doc open the matching document in the modal.
    root.querySelector(".foot").addEventListener("click", e => {
      const d = e.target.closest("[data-doc]"); if (!d) return;
      $("#modal-body").innerHTML = `<div class="doc">${DOCS[d.dataset.doc]}</div>`;
      $("#modal").hidden = false;
    });
