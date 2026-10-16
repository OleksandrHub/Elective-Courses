// Спільні допоміжні функції для читання сторінок dl.tntu.edu.ua у вашій сесії.
(() => {
  const E = (window.TntuEl ||= {});

  const clean = s => String(s || "").replace(/\s+/g, " ").trim();

  async function getDoc(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (r.redirected && /login\.php/.test(r.url)) throw new Error("ви не увійшли в акаунт на dl.tntu.edu.ua");
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    const html = await r.text();
    return { html, doc: new DOMParser().parseFromString(html, "text/html") };
  }

  const abs = url => new URL(url, location.origin).href;
  const sidOf = el => el.querySelector('a[href*="sid="]')?.getAttribute("href").match(/sid=([0-9a-fA-F-]+)/)?.[1] || null;

  Object.assign(E, { clean, getDoc, abs, sidOf });
})();
