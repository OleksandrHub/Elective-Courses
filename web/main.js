/**
 * @file Bootstrap of the web app (GitHub Pages / PWA).
 *
 * - Consumes an account import passed in the URL fragment (`#import=<packed>`)
 *   by the bookmarklet (see web/import-entry.js), stores it in localStorage and
 *   removes it from the address bar and history.
 * - Loads the course catalog (courses.json) and mounts the shared UI
 *   (`ElectivesApp.mount`) in "live" mode with an import-based `loadAccount`.
 * - Registers the service worker for offline use and installability.
 */
(() => {
  /** localStorage key of the last imported account. */
  const IMPORT_KEY = "tntuel_import";
  /** App version, replaced by build_web.py. */
  const VERSION = "__VERSION__";
  /** Absolute URL of the deployed app directory (ends with "/"). */
  const BASE = new URL(".", location.href).href;

  /**
   * Decodes a packed import: base64url → deflate-raw → JSON.
   * @param {string} packed Value of the `import` fragment parameter.
   * @returns {Promise<Account>} The imported account.
   */
  async function unpack(packed) {
    const b64 = packed.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return JSON.parse(await new Response(stream).text());
  }

  /**
   * Reads `#import=…` if present, saves the account and cleans the URL.
   * @returns {Promise<?string>} Error message if the import could not be read.
   */
  async function consumeImport() {
    const m = location.hash.match(/^#import=([\w-]+)$/);
    if (!m) return null;
    history.replaceState(null, "", location.pathname + location.search);
    try {
      const acc = await unpack(m[1]);
      localStorage.setItem(IMPORT_KEY, JSON.stringify(acc));
      return null;
    } catch (e) {
      return "Не вдалося прочитати імпорт: " + e.message;
    }
  }

  /**
   * `env.loadAccount` for the web app: returns the last imported account.
   * @returns {Promise<Account>}
   * @throws {Error} When nothing has been imported yet.
   */
  async function loadAccount() {
    const raw = localStorage.getItem(IMPORT_KEY);
    if (!raw) throw new Error("Дані акаунта ще не імпортовано");
    return JSON.parse(raw);
  }

  /** Bookmarklet that loads import.js from this deployment onto dl.tntu.edu.ua. */
  const bookmarklet = "javascript:(()=>{const s=document.createElement('script');s.src='" + BASE +
    "import.js?t='+Date.now();s.onerror=()=>alert('Не вдалося завантажити імпорт. Перевірте інтернет.');document.body.appendChild(s)})()";

  (async () => {
    const importError = await consumeImport();
    const root = document.getElementById("app");
    try {
      const data = await fetch("courses.json", { cache: "no-cache" }).then(r => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
      window.ElectivesApp.mount(root, data, {
        live: true,
        version: VERSION,
        loadAccount,
        importInfo: { bookmarklet, appUrl: BASE, forget: () => localStorage.removeItem(IMPORT_KEY) },
      });
      if (importError) alert(importError);
    } catch (e) {
      root.innerHTML = `<div class="loading">Не вдалося завантажити каталог курсів (${e.message}). Перевірте інтернет і оновіть сторінку.</div>`;
    }
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  })();
})();
