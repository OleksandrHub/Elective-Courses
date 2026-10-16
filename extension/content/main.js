/**
 * @file Entry content script, loaded last on the dl.tntu.edu.ua elective-course
 * pages. Adds a floating "Smart pick" button and opens the app UI as a
 * full-screen overlay on top of the site (also automatically when the URL hash is
 * `#smart`). Account data is read by the other content scripts (see manifest.json)
 * through the user's current session; nothing on the site is modified. Guarded
 * by `window.__tntuElectives` so it runs only once per page.
 *
 * Reads `loadAccount` from `window.TntuEl` and passes it to `window.ElectivesApp.mount`.
 */
(() => {
  if (window.__tntuElectives) return;
  window.__tntuElectives = true;
  const { loadAccount } = window.TntuEl;

  /**
   * Bridge to the Gemini API via the background service worker. The API key
   * stays in the extension's storage and is never exposed to the site.
   * @type {{
   *   request: (url: string, method: string, body?: string) => Promise<{ok: boolean, status: number, body: string}>,
   *   keyInfo: () => Promise<{hasKey: boolean, hint: string}>,
   *   setKey: (key: string) => Promise<true>
   * }}
   */
  const gemini = {
    request: (url, method, body) => chrome.runtime.sendMessage({ type: "gemini-fetch", url, method, body }),
    keyInfo: () => chrome.runtime.sendMessage({ type: "gemini-key-get" }),
    setKey: key => chrome.runtime.sendMessage({ type: "gemini-key-set", key }),
  };

  // ---------- Overlay ----------
  /** @type {?HTMLDivElement} Shadow-DOM host of the overlay; created on first open. */
  let host = null;
  /** Page scroll style to restore when the overlay closes. */
  const prevOverflow = document.documentElement.style.overflow;

  /**
   * Hide the overlay (it is kept for reuse), restore page scrolling and drop
   * the `#smart` hash from the URL.
   * @returns {void}
   */
  function close() {
    if (!host) return;
    host.style.display = "none";
    document.documentElement.style.overflow = prevOverflow;
    if (location.hash === "#smart") history.replaceState(null, "", location.pathname + location.search);
  }

  /**
   * Show the overlay, creating it on first call: a fixed full-screen host with
   * an open shadow root (isolating styles from the site) that loads the
   * extension's css/index.css, fetches the bundled courses.json and mounts
   * `ElectivesApp` with the live environment (loadAccount, close, gemini bridge,
   * extension version). Later calls just un-hide it. Page scrolling is locked
   * while open. A loading error is shown inside the overlay.
   * @returns {Promise<void>}
   */
  async function open() {
    document.documentElement.style.overflow = "hidden";
    if (host) { host.style.display = "block"; return; }
    host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:2147483000;overflow:hidden;display:block";
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
