// GET /p/{token} — VEŘEJNÁ stránka asistenta (stranky.js), bez přihlášení, pro kohokoli s odkazem.
// Explicitní routa má přednost před SPA fallbackem (jako /agent-setup.md). PB JSVM nevidí
// top-level proměnné souborů s routerAdd → logika v modulu, tady jen hlavičky.
//
// Stránku napsal model nebo cizí agent → běží v SANDBOXU: CSP `sandbox` dělá z dokumentu cizí
// původ, takže skript ve stránce nedosáhne na localStorage/cookies/API instance (přihlášení
// aplikace je v localStorage téhož hostu). `allow-popups-to-escape-sandbox`: odkazy z prezentace
// otevřou normální okno (popup je cizí dokument, k našemu původu se nedostane). Bez
// `allow-same-origin` — NIKDY (test to hlídá řetězcem). no-store: zrušený odkaz zhasne hned.
routerAdd("GET", "/p/{token}", (e) => {
  const S = require(`${__hooks}/stranky.js`);
  const { minuteLimitHit } = require(`${__hooks}/helpers.js`);
  const h = e.response.header();
  h.set("X-Robots-Tag", "noindex, nofollow");
  h.set("Cache-Control", "private, no-store");
  if (minuteLimitHit($app.store(), "pubpage:" + e.realIP(), 60)) return e.string(429, "Too many requests");
  const rec = S.limity().zapnuto ? S.podleTokenu($app, e.request.pathValue("token")) : null;
  if (!rec) return e.string(404, "Not found");
  h.set("Content-Type", "text/html; charset=utf-8");
  // sandbox chrání aplikaci (cizí původ); form-action/connect-src 'none' chrání NÁVŠTĚVNÍKA — stránka od agenta nemůže odeslat
  // formulář ani fetch na cizí server (phishing uvnitř domény); frame-ancestors: cizí web ji nevloží do svého rámce (/checkup 25. 10. 2026)
  h.set("Content-Security-Policy", "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-popups-to-escape-sandbox; form-action 'none'; connect-src 'none'; frame-ancestors 'none'");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return e.html(200, rec.getString("html"));
});
