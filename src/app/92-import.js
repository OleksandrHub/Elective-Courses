    // ---------- Account import (web app) ----------
    /**
     * Opens the dialog that explains the import bookmarklet used by the web app.
     *
     * A web page cannot read dl.tntu.edu.ua with the student's session, so the
     * bookmarklet runs *on* dl.tntu.edu.ua, reads the account pages there and
     * sends the result back in the URL fragment (see web/import-entry.js).
     * Only shown when the host passes `env.importInfo` (web/main.js).
     */
    function showImportHelp() {
      const info = env.importInfo;
      $("#modal-body").innerHTML = `<div class="doc import-help">
        <h2>Імпорт даних акаунта</h2>
        <p>Застосунок не може сам зайти у ваш акаунт, тому дані переносить <b>закладка</b>: ви натискаєте її на dl.tntu.edu.ua,
          вона читає обов’язкові дисципліни, навчальний план і вибір, і відкриває застосунок уже з ними. Пароль нікуди не передається.</p>
        <h3>На компʼютері</h3>
        <ol>
          <li>Перетягніть кнопку на панель закладок: <a class="bm" href="${esc(info.bookmarklet)}" onclick="event.preventDefault(); alert('Перетягніть цю кнопку на панель закладок, а потім натисніть її на сторінці dl.tntu.edu.ua.')">📥 Імпорт ТНТУ</a></li>
          <li>Відкрийте <a href="https://dl.tntu.edu.ua/" target="_blank" rel="noopener">dl.tntu.edu.ua</a> і увійдіть в акаунт.</li>
          <li>Натисніть закладку «📥 Імпорт ТНТУ». За кілька секунд відкриється цей застосунок з вашими даними.</li>
        </ol>
        <h3>На телефоні</h3>
        <ol>
          <li>Скопіюйте код закладки: <button class="rb-btn" id="bm-copy">⧉ Копіювати код</button></li>
          <li>Додайте в браузері будь-яку закладку, відредагуйте її: назва «Імпорт ТНТУ», а в поле адреси вставте скопійований код.</li>
          <li>Відкрийте dl.tntu.edu.ua, увійдіть, наберіть в адресному рядку «Імпорт ТНТУ» і виберіть закладку зі списку.</li>
        </ol>
        <p class="hint">Повторіть імпорт, коли щось зміниться на сайті (наприклад, після вибору дисциплін).
          ${account ? `Останній імпорт: ${esc(account.at)}.` : ""}</p>
        ${account ? `<div class="row"><button class="ghost" id="import-forget">Видалити імпортовані дані з цього браузера</button></div>` : ""}
      </div>`;
      $("#modal").hidden = false;
      $("#bm-copy").onclick = e => navigator.clipboard.writeText(info.bookmarklet).then(() => { e.target.textContent = "Скопійовано ✓"; });
      const forget = $("#import-forget");
      if (forget) forget.onclick = () => {
        if (!confirm("Видалити імпортовані дані акаунта з цього браузера?")) return;
        info.forget();
        account = null; store.set("account", null); accountState = "error";
        rebuildAccount(); $("#modal").hidden = true; render();
      };
    }
