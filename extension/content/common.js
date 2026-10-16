/**
 * @file Shared helpers for reading dl.tntu.edu.ua pages. Loaded first among the
 * content scripts. All requests run in the user's existing logged-in session
 * (same-origin, cookies included) and are read-only: nothing on the site is
 * ever modified.
 *
 * Exports on `window.TntuEl`: `clean`, `getDoc`, `abs`, `sidOf`.
 */
(() => {
  const E = (window.TntuEl ||= {});

  /**
   * Collapse all whitespace runs to single spaces and trim.
   * @param {*} s Any value; null/undefined become "".
   * @returns {string} Normalized text.
   */
  const clean = s => String(s || "").replace(/\s+/g, " ").trim();

  /**
   * Fetch a site page with the user's session cookies and parse it as HTML.
   * @param {string} url Absolute or site-relative URL.
   * @returns {Promise<{html: string, doc: Document}>} Raw HTML and the parsed document.
   * @throws {Error} If the request was redirected to login.php (not logged in) or returned a non-2xx status.
   */
  async function getDoc(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (r.redirected && /login\.php/.test(r.url)) throw new Error("ви не увійшли в акаунт на dl.tntu.edu.ua");
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    const html = await r.text();
    return { html, doc: new DOMParser().parseFromString(html, "text/html") };
  }

  /**
   * Resolve a (possibly relative) URL against the current site origin.
   * @param {string} url URL or path.
   * @returns {string} Absolute URL.
   */
  const abs = url => new URL(url, location.origin).href;
  /**
   * Extract the syllabus id (`sid=` query parameter, hex/UUID) from the first matching link inside an element.
   * @param {Element} el Element to search (usually a table row).
   * @returns {?string} The syllabus id, or null if there is no such link.
   */
  const sidOf = el => el.querySelector('a[href*="sid="]')?.getAttribute("href").match(/sid=([0-9a-fA-F-]+)/)?.[1] || null;

  Object.assign(E, { clean, getDoc, abs, sidOf });
})();
