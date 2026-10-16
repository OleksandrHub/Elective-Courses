// Фоновий воркер: запити до Gemini API і зберігання ключа поза сторінкою сайту.
const GEMINI = "https://generativelanguage.googleapis.com/";

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
