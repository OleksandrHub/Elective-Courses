// Запускається на сторінках вибіркових дисциплін dl.tntu.edu.ua.
// Додає кнопку «Розумний підбір», відкриває інтерфейс поверх сайту і читає
// дані акаунта (обов’язкові, «Обрані мною») через вашу поточну сесію. Нічого не змінює на сайті.
// Дані акаунта читають скрипти з content/ (див. manifest.json), тут — кнопка й оверлей.
(() => {
  if (window.__tntuElectives) return;
  window.__tntuElectives = true;
  const { loadAccount } = window.TntuEl;

  // Gemini: запити йдуть через фоновий воркер, ключ лежить у сховищі розширення (сайт його не бачить)
  const gemini = {
    request: (url, method, body) => chrome.runtime.sendMessage({ type: "gemini-fetch", url, method, body }),
    keyInfo: () => chrome.runtime.sendMessage({ type: "gemini-key-get" }),
    setKey: key => chrome.runtime.sendMessage({ type: "gemini-key-set", key }),
  };

  // ---------- оверлей ----------
  let host = null;
  const prevOverflow = document.documentElement.style.overflow;

  function close() {
    if (!host) return;
    host.style.display = "none";
    document.documentElement.style.overflow = prevOverflow;
    if (location.hash === "#smart") history.replaceState(null, "", location.pathname + location.search);
  }

  async function open() {
    document.documentElement.style.overflow = "hidden";
    if (host) { host.style.display = "block"; return; }
    host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:2147483000;overflow:auto;display:block";
    const shadow = host.attachShadow({ mode: "open" });
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("css/index.css");
    const app = document.createElement("div");
    app.className = "el-app";
    app.innerHTML = `<div class="loading">Завантажую курси…</div>`;
    shadow.append(link, app);
    document.body.appendChild(host);
    try {
      const data = await fetch(chrome.runtime.getURL("courses.json")).then(r => r.json());
      window.ElectivesApp.mount(app, data, { live: true, loadAccount, close, gemini, version: chrome.runtime.getManifest().version });
    } catch (e) {
      app.innerHTML = `<div class="loading">Не вдалося завантажити дані: ${e.message}</div>`;
    }
  }

  const btn = document.createElement("button");
  btn.textContent = "🔎 Розумний підбір";
  btn.title = "Підбір вибіркових з фільтрами за кредитами, контролем, роком; з урахуванням ваших обов’язкових";
  btn.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147482999;padding:12px 18px;border:none;border-radius:999px;" +
    "background:#b3261e;color:#fff;font:600 15px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer";
  btn.addEventListener("click", open);
  document.body.appendChild(btn);

  if (location.hash === "#smart") open();
})();
