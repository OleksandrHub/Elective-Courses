# Матеріали для Chrome Web Store / Edge Add-ons

Скопіюйте ці тексти у відповідні поля форми. Завантажте архів `dist/vybirkovi-tntu-<версія>.zip` (команда `python3 package.py`).

## Файли

| Поле магазину | Файл |
|---|---|
| Пакет | `dist/vybirkovi-tntu-<версія>.zip` |
| Іконка 128×128 | `extension/icons/icon-128.png` |
| Скріншоти 1280×800 (1–5) | `store/screenshots/1-catalog.png` … `5-compare.png` |
| Мала промо-плитка 440×280 | `store/promo-small-440x280.png` |
| Велика промо-плитка 1400×560 (необов'язково) | `store/promo-marquee-1400x560.png` |
| Політика конфіденційності (URL) | посилання на `PRIVACY.md` у вашому публічному репозиторії GitHub (наприклад `https://github.com/OleksandrHub/<репо>/blob/main/PRIVACY.md`) |

Скріншоти зроблені на тестових даних (без справжнього акаунта). Імена викладачів і назви курсів — з публічного каталогу сайту.

---

## Основне

- **Назва** (до 75 символів): `Вибіркові ТНТУ — розумний підбір`
- **Категорія:** Освіта (Education)
- **Мова:** українська
- **Сайт:** https://github.com/OleksandrHub

### Короткий опис (до 132 символів)

**UK:** Підбір вибіркових дисциплін ТНТУ: кредити, екзамен/залік і рік у каталозі, план семестрів, звіт і ШІ-підбір через Gemini.

**EN:** Pick TNTU elective courses: credits, exam/credit and year in one catalog, semester plan, report and Gemini-based suggestions.

### Повний опис — українською

```
Неофіційний помічник для вибору вибіркових дисциплін на dl.tntu.edu.ua.

На сайті кредити, форму контролю чи рекомендований рік видно лише в силабусі кожного курсу. Розширення показує все це одразу в каталозі й допомагає скласти план.

МОЖЛИВОСТІ
• Каталог з фільтрами сайту (мова, підрозділ, спеціальність, ступінь, семестр) і додатковими: кредити, екзамен/залік, рік навчання, без курсової.
• Ваші обов'язкові та вже вивчені дисципліни (з індивідуального навчального плану) ховаються, схожі за назвою — позначаються.
• Рекомендації випускової кафедри й вкладка «Мене цікавлять» підтягуються автоматично.
• План по семестрах з лімітом кредитів, кілька варіантів плану та їх порівняння.
• Підбір комбінацій курсів, що дають рівно потрібну суму кредитів.
• ШІ-підбір через Google Gemini з вашим власним ключем (необов'язково).
• Звіт по семестрах: кількість екзаменів, заліків і курсових, оцінки, середній бал; копіювання в Excel і друк.
• Порівняння до 4 курсів поруч, тема в стилі сайту ТНТУ, темна тема, адаптивний інтерфейс.

ЯК КОРИСТУВАТИСЯ
Відкрийте dl.tntu.edu.ua → «Вибіркові дисципліни» і натисніть кнопку «🔎 Розумний підбір» унизу праворуч.

КОНФІДЕНЦІЙНІСТЬ
Розширення працює у вашій уже відкритій сесії й нічого не змінює в акаунті. Усі дані зберігаються лише у вашому браузері. Автор нічого не отримує. У Google надсилаються дані лише тоді, коли ви самі користуєтеся ШІ-підбором зі своїм ключем.

Неофіційний інструмент, не пов'язаний з ТНТУ. Перед поданням заяви перевіряйте дані на сайті й у деканаті.
Код відкритий за ліцензією MIT.
```

### Повний опис — англійською (для англомовної версії сторінки)

```
Unofficial helper for choosing elective courses at Ternopil Ivan Puluj National Technical University (dl.tntu.edu.ua).

The site shows credits, assessment type and recommended year only inside each course syllabus. This extension puts them into one searchable catalog and helps you build your plan.

FEATURES
• Catalog with the site's own filters plus credits, exam/credit, year of study and "no term paper".
• Your mandatory and already-completed courses (from your curriculum) are hidden; similar names are flagged.
• Department recommendations and your "interested" list are imported automatically.
• Semester plan with credit limits, multiple plan variants and comparison.
• Finds course combinations that add up to exactly the credits you need.
• Optional Google Gemini suggestions with your own API key.
• Per-semester report: exams, credits, term papers, grades and average; copy to Excel or print.
• Side-by-side comparison, TNTU-style and dark themes, responsive UI.

PRIVACY
Works inside your existing session and never changes anything in your account. All data stays in your browser; the developer receives nothing. Data is sent to Google only when you use the optional Gemini feature with your own key.

Not affiliated with TNTU. Always double-check on the official site before submitting your application. Open source, MIT license.
```

---

## Вкладка «Конфіденційність» (Privacy practices)

### Single purpose / Єдина мета
**EN:** Helps TNTU students find, compare and plan elective courses on dl.tntu.edu.ua by showing syllabus data (credits, assessment type, year) in one catalog and taking their own mandatory courses and curriculum into account.

### Обґрунтування дозволів

- **storage**
  **EN:** Stores the user's optional Google Gemini API key in chrome.storage.local so the key is never exposed to the website's page context.
- **Host permission `https://generativelanguage.googleapis.com/*`**
  **EN:** Used only by the optional "AI picker" feature: when the user clicks "Pick", the background worker sends the request to the Google Gemini API with the user's own key. No other hosts are contacted.
- **Content scripts on `https://dl.tntu.edu.ua/mods/elective_courses/*`**
  **EN:** Adds the "Smart picker" button and overlay on the university's elective-courses pages and reads the student's own course pages (mandatory courses, selections, curriculum, syllabi) in their existing session to filter the catalog. Nothing on the site is modified.

### Remote code / Віддалений код
**No, I am not using remote code.** Усі скрипти входять у пакет. Gemini API повертає лише дані (JSON), а не код.

### Data usage / Використання даних

Позначте:
- **Website content** (вміст сайту): так. Якщо користувач сам запускає ШІ-підбір, назви курсів і спеціальність надсилаються в Google Gemini API.
- Решта категорій (PII, health, financial, authentication, personal communications, location, web history, user activity): ні. Оцінки й навчальний план обробляються лише локально й нікуди не передаються.

> Я трактую «збір» як передачу даних за межі пристрою. Якщо модератор вважатиме, що оцінки з навчального плану теж треба декларувати, додайте категорію «Personally identifiable information» або «Other». Оцінки при цьому все одно не залишають браузер.

Поставте всі три підтвердження:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** посилання на `PRIVACY.md` у публічному репозиторії.

---

## Нотатки для модератора (Test instructions)

```
The extension works on https://dl.tntu.edu.ua/mods/elective_courses/all.php — this catalog page is public, no login needed.
1. Open the page; click "🔎 Розумний підбір" (bottom-right).
2. Accept the terms dialog.
3. Without a student account, the catalog, filters, plan, combinations, report and comparison all work; reading the student's own mandatory courses/curriculum requires a TNTU student login and simply shows an "account not read" state otherwise.
4. The AI picker is optional and needs the tester's own Google Gemini API key (aistudio.google.com/apikey).
```
