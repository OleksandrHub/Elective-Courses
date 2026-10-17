/**
 * @file Entry point of import.js — the script the bookmarklet loads onto
 * dl.tntu.edu.ua. build_web.py prepends the account readers from
 * extension/content/ (common, mandatory, electives, curriculum, account),
 * which register `window.TntuEl.loadAccount`.
 *
 * Flow: check we are on dl.tntu.edu.ua → read the account in the student's
 * own session → pack it (JSON → deflate-raw → base64url) → navigate to the web
 * app with `#import=<packed>`. The URL fragment is never sent to any server.
 * Nothing on dl.tntu.edu.ua is modified.
 */
(() => {
  /** Web app URL: the directory this script was loaded from. */
  const APP_URL = new URL(".", document.currentScript?.src || "https://invalid/").href;

  /**
   * Shows a small status box on the TNTU page.
   * @param {string} text Message.
   * @param {boolean} [error] Red style for errors.
   * @returns {HTMLElement} The box (reused for later messages).
   */
  function toast(text, error = false) {
    let box = document.getElementById("tntuel-import-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "tntuel-import-toast";
      box.style.cssText = "position:fixed;left:50%;top:20px;transform:translateX(-50%);z-index:2147483647;max-width:90vw;" +
        "padding:14px 20px;border-radius:12px;font:600 15px system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.3);color:#fff";
      document.body.appendChild(box);
    }
    box.style.background = error ? "#c0392b" : "#405d72";
    box.textContent = text;
    return box;
  }

  /**
   * Compresses a JSON-serialisable value for the URL fragment.
   * @param {*} value Data to pack.
   * @returns {Promise<string>} base64url string.
   */
  async function pack(value) {
    const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  (async () => {
    if (!/(^|\.)dl\.tntu\.edu\.ua$/.test(location.hostname)) {
      alert("Відкрийте dl.tntu.edu.ua, увійдіть в акаунт і натисніть закладку «Імпорт ТНТУ» там.");
      return;
    }
    toast("📥 Читаю дані вашого акаунта… (5–20 секунд)");
    try {
      const acc = await window.TntuEl.loadAccount();
      acc.at = new Date().toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" });
      const parts = [`${acc.mandatory?.length || 0} обов’язкових`];
      if (acc.curriculum?.semesters?.length) parts.push(`навч. план: ${acc.curriculum.semesters.length} сем.`);
      toast(`✓ Прочитано (${parts.join(", ")}). Відкриваю застосунок…`);
      location.href = APP_URL + "#import=" + await pack(acc);
    } catch (e) {
      toast("Не вдалося прочитати акаунт: " + (e.message || e) + ". Переконайтеся, що ви увійшли на dl.tntu.edu.ua.", true);
    }
  })();
})();
