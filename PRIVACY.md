# Політика конфіденційності / Privacy Policy

**Вибіркові ТНТУ — розумний підбір** · автор: Олександр Кліщ ([OleksandrHub](https://github.com/OleksandrHub)) · чинна з 17.10.2026

## Українською

### Які дані обробляються
Розширення працює лише на сторінках `dl.tntu.edu.ua/mods/elective_courses/*` і лише після того, як ви погодитеся з [умовами користування](TERMS.md). Тоді воно відкриває у вашій уже відкритій сесії такі сторінки:
- «Обов'язкові дисципліни», «Обрані мною», «Мене цікавлять та пропозиції кафедри»;
- «Індивідуальний навчальний план»: дисципліни, кредити, форма контролю й оцінки;
- силабуси курсів.

Логін і пароль розширення не бачить і не зберігає.

У вебзастосунку те саме робить **закладка-імпорт**, яку ви самі натискаєте на dl.tntu.edu.ua. Вона передає прочитані дані в застосунок через частину посилання після `#`. Ця частина не надсилається ні на GitHub, ні на жоден інший сервер.

### Де зберігаються дані
Усе, що читає розширення, і все, що ви робите в ньому (план, варіанти, ★, налаштування), зберігається **лише у вашому браузері** (localStorage сайту та `chrome.storage.local` розширення). Автор не має сервера і **нічого не отримує**. Дані не продаються й не передаються третім особам, за винятком випадку нижче.

### Gemini (необов'язково)
Якщо ви самі вставите свій API-ключ Google Gemini і натиснете «Підібрати», у Google Gemini API (`generativelanguage.googleapis.com`) надсилаються:
- ваша спеціальність;
- назви обов'язкових і вже вивчених дисциплін;
- текст ваших побажань;
- перелік доступних курсів.

Оцінки, ПІБ, логін і пароль **не надсилаються**. Ці запити обробляє Google за [умовами Gemini API](https://ai.google.dev/gemini-api/terms). Ключ зберігається лише у вашому браузері.

### Видалення даних
Видаліть розширення або очистіть дані сайту dl.tntu.edu.ua у браузері. Ключ Gemini можна видалити кнопкою «Відключити» на вкладці ШІ-підбору.

### Контакти
Питання: https://github.com/OleksandrHub

## English

The extension runs only on `dl.tntu.edu.ua/mods/elective_courses/*`, and only after the user accepts the terms of use. It reads, inside the user's existing logged-in session, these pages of their own account:
- mandatory courses, selected courses and courses of interest;
- the individual curriculum (courses, credits, assessment type, grades);
- course syllabi.

It never sees or stores credentials.

All data stays **in the user's browser** (site localStorage and the extension's `chrome.storage.local`). The developer runs no server, receives no data, and never sells or shares data.

**Optional Gemini feature.** It is used only if the user supplies their own Google Gemini API key and clicks "Pick". In that case the following are sent to the Google Gemini API:
- the user's speciality;
- names of mandatory and completed courses;
- the user's free-text wishes;
- the list of available courses.

Grades, name, login and password are never sent. These requests are governed by Google's Gemini API terms. The key is stored only locally.

To delete data, remove the extension or clear site data for dl.tntu.edu.ua; the Gemini key can be removed with the "Disconnect" button.

Contact: https://github.com/OleksandrHub
