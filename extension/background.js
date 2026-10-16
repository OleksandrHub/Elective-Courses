/**
 * @file MV3 background service worker. Proxies Gemini API requests for the
 * content scripts and keeps the API key out of the site's page context.
 *
 * Handled messages:
 * - `{type: "gemini-fetch", url, method, body}`: performs the request with the
 *   stored key in the `x-goog-api-key` header; replies `{ok, status, body}`
 *   (body is response text or an error message). Only URLs under
 *   https://generativelanguage.googleapis.com/ are allowed; no key gives status 401.
 * - `{type: "gemini-key-get"}`: replies `{hasKey, hint}` where hint is "…" plus
 *   the key's last 4 characters (the key itself is never returned).
 * - `{type: "gemini-key-set", key}`: stores the key, or removes it if empty;
 *   replies `true`.
 *
 * The key is stored in `chrome.storage.local` under `geminiKey`.
 */

/** Only allowed URL prefix for proxied requests. */
const GEMINI = "https://generativelanguage.googleapis.com/";

/**
 * Message handler; returns true for handled async messages to keep `send` alive.
 * @param {{type: string, url?: string, method?: string, body?: string, key?: string}} msg Incoming message.
 * @param {chrome.runtime.MessageSender} sender Message sender (unused).
 * @param {(response: *) => void} send Reply callback.
 * @returns {boolean|undefined} true if a reply will be sent asynchronously.
 */
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (msg?.type === "gemini-fetch") {
    if (typeof msg.url !== "string" || !msg.url.startsWith(GEMINI)) { send({ ok: false, status: 0, body: "Заборонена адреса" }); return; }
    chrome.storage.local.get("geminiKey").then(({ geminiKey }) => {
      if (!geminiKey) return send({ ok: false, status: 401, body: "Не вказано API-ключ Gemini" });
      const headers = { "Content-Type": "application/json", "x-goog-api-key": geminiKey };
      return fetch(msg.url, { method: msg.method || "GET", headers, body: msg.body })
        .then(async r => send({ ok: r.ok, status: r.status, body: await r.text() }));
    }).catch(e => send({ ok: false, status: 0, body: String(e) }));
    return true;
  }
  if (msg?.type === "gemini-key-get") {
    chrome.storage.local.get("geminiKey").then(({ geminiKey }) => send({ hasKey: !!geminiKey, hint: geminiKey ? "…" + geminiKey.slice(-4) : "" }));
    return true;
  }
  if (msg?.type === "gemini-key-set") {
    (msg.key ? chrome.storage.local.set({ geminiKey: msg.key }) : chrome.storage.local.remove("geminiKey")).then(() => send(true));
    return true;
  }
});
