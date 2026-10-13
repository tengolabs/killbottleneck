// Návod pro AI agenta (Claude Code, Codex, Cursor…), který si agent stáhne sám:
// uživatel mu v aplikaci zkopíruje JEDEN řádek „Set up killBottleneck for me: fetch and
// follow this guide {instance}/agent-setup.md" (vzor onboardingu Runpod, Richard
// 10. 10. 2026). Návod je veřejný (bez přihlášení): obsahuje jen adresu instance — tu zná
// každý, kdo ho stahuje — a veřejný postup. Žádná tajemství; klíč/OAuth si uživatel
// vyřizuje až v aplikaci. Šablona agent-setup.md leží vedle (Dockerfile kopíruje celé
// pb_hooks, PB načítá jako hooky jen *.pb.js). Adresa instance = tatáž funkce jako OAuth
// metadata (helpers.publicBaseUrlFromRequest), aby návod a discovery říkaly jedno.

function agentSetupMarkdown(e) {
  const { publicBaseUrlFromRequest, readHooksText, env } = require(`${__hooks}/helpers.js`);
  const base = publicBaseUrlFromRequest($app, e).replace(/\/+$/, "");
  const verze = (env("VERSION") || "").trim() || "dev";
  // Claude Code posílá OAuth údaje jen na https:// nebo localhost token endpoint
  // (dokumentace Claude Code, ověřeno 10. 10. 2026) — plain http na LAN adrese
  // dostane rovnou poctivou poznámku, ať agent nezkouší cestu, která nemůže projít.
  const plainHttpMimoLocalhost = /^http:\/\//i.test(base)
    && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(base);
  const authNote = plainHttpMimoLocalhost
    ? "> **Note for this instance:** it is served over plain `http://` at a non-localhost address. "
      + "Claude Code (and most clients) refuse to send OAuth credentials to such an address, so "
      + "**go straight to section B (API key)**. Section A will work once the instance is behind HTTPS."
    : "> This instance is served over HTTPS (or localhost) — **section A (OAuth) is the way to go**; "
      + "section B is only a fallback.";
  let md = readHooksText("agent-setup.md");
  md = md.split("{{BASE_URL}}").join(base)
    .split("{{VERSION}}").join(verze)
    .split("{{AUTH_NOTE}}").join(authNote);
  return md;
}

function agentSetupRoute(e) {
  let md;
  try { md = agentSetupMarkdown(e); } catch (err) {
    // cesta k šabloně patří do logu, ne klientovi
    try { $app.logger().error("agent-setup guide", "err", String(err && err.message || err)); } catch (e2) { /* bez loggeru */ }
    return e.json(500, { error: "agent setup guide unavailable" });
  }
  const h = e.response.header();
  h.set("Content-Type", "text/markdown; charset=utf-8");
  // Obsah závisí na adrese a schématu, přes které klient přišel (Host, X-Forwarded-*,
  // AUTH_NOTE http vs https) → žádná SDÍLENÁ cache (podstrčený X-Forwarded-Host by
  // jinak mohl zasít cizí adresu dalším uživatelům za cachující proxy); klientská stačí.
  h.set("Cache-Control", "private, max-age=300");
  h.set("Vary", "Host, X-Forwarded-Host, X-Forwarded-Proto");
  h.set("X-Robots-Tag", "noindex");
  h.set("Access-Control-Allow-Origin", "*");
  return e.string(200, md);
}

module.exports = { agentSetupMarkdown, agentSetupRoute };
