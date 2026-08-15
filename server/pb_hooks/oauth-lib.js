// OAuth 2.1 server pro MCP konektory (claude.ai web a další OAuth MCP klienti).
// Minimální, ale POCTIVÁ implementace dle MCP Authorization spec:
//   discovery (RFC 8414 + protected resource metadata) → dynamic client
//   registration (RFC 7591, public client bez secretu) → authorization code
//   s POVINNÝM PKCE S256 → token endpoint.
// Access token = záznam v EXISTUJÍCÍ kolekci api_keys (kb_user_…): platí stejný
// apiKeyAuth (scope, rate-limit, audit) a revokace v UI „API klíče" — OAuth
// nepřidává druhý druh tokenů. Refresh tokeny nevydáváme: access token má
// expiraci 90 dní a klient se pak jednoduše připojí znovu.
//
// Všechna logika v modulu (require) — PB JSVM nevidí top-level proměnné
// souborů s routerAdd (viz mcp.pb.js).

const KOD_TTL_MS = 5 * 60 * 1000;      // authorization code platí 5 minut, jednorázově
const TOKEN_DNY = 90;                   // expirace vydaného API klíče
const MAX_KLIENTU = 200;                // strop registrací (nejstarší se uklidí)

function zaklad(e) {
  // absolutní adresa instance: KB_PUBLIC_URL (hosted ji má vždy) → nastavení PB
  // → nouzově z požadavku (self-host bez configu za reverzní proxy)
  const { publicBaseUrl } = require(`${__hooks}/helpers.js`);
  const zCfg = publicBaseUrl($app);
  if (zCfg) return zCfg;
  const host = e.request.header.get("Host") || "localhost";
  const proto = e.request.header.get("X-Forwarded-Proto") || "http";
  return `${proto}://${host}`;
}

function cors(e) {
  // OAuth endpointy volají i browser-based MCP klienti (inspector); žádné
  // cookies se nepoužívají (Bearer + PKCE), takže hvězdička je bezpečná
  e.response.header().set("Access-Control-Allow-Origin", "*");
  e.response.header().set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  e.response.header().set("Access-Control-Allow-Headers", "Authorization, Content-Type, mcp-protocol-version");
}

// hex (výstup $security.sha256) → base64url pro porovnání PKCE S256
function hexToB64url(hex) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += abc[b0 >> 2];
    out += abc[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
    out += b1 === undefined ? "=" : abc[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
    out += b2 === undefined ? "=" : abc[b2 & 63];
  }
  return out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function redirectUriOk(u) {
  // https kamkoli; http JEN na loopback (mcp-remote, vývoj) — OAuth 2.1
  if (/^https:\/\/[^\s]+$/.test(u)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^\s]*)?$/.test(u);
}

// ---------- discovery ----------
function metadataProtectedResource(e) {
  cors(e);
  const base = zaklad(e);
  return e.json(200, {
    resource: base + "/mcp",
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    resource_name: "killBottleneck MCP",
  });
}
function metadataAuthServer(e) {
  cors(e);
  const base = zaklad(e);
  return e.json(200, {
    issuer: base,
    authorization_endpoint: base + "/oauth/authorize",
    token_endpoint: base + "/oauth/token",
    registration_endpoint: base + "/oauth/register",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["read", "read_write"],
  });
}

// ---------- dynamic client registration (RFC 7591) ----------
function register(e) {
  cors(e);
  // brzda: registrace je bez přihlášení (spec) → levný IP limit jako u registrací účtů
  const store = $app.store();
  let ip = "?";
  try { ip = e.realIP(); } catch (err) { /* společný kbelík */ }
  const bucket = Math.floor(Date.now() / 600000);
  const rlKey = "oarl:" + ip;
  const prev = String(store.get(rlKey) || "").split(":");
  const used = Number(prev[0]) === bucket ? Number(prev[1]) || 0 : 0;
  if (used >= 20) return e.json(429, { error: "invalid_client_metadata", error_description: "Too many registrations, try later." });
  store.set(rlKey, bucket + ":" + (used + 1));

  const info = e.requestInfo().body || {};
  const uris = Array.isArray(info.redirect_uris) ? info.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 10 || !uris.every(redirectUriOk)) {
    return e.json(400, { error: "invalid_redirect_uri", error_description: "redirect_uris must be https:// URLs (http only on localhost)." });
  }
  const name = String(info.client_name || "").slice(0, 200);

  // úklid: maž jen NIKDY NEPOUŽITÉ registrace (mrtvé pokusy), nejstarší první.
  // ⚠️ Řadit podle last_used='', ne created bez filtru — jinak by záplava
  // registrací (limit je jen per-IP) vytlačila client_id živého konektoru
  // (claude.ai) a tomu by se rozbilo připojení. Použitý klient (má last_used)
  // se nikdy nesmaže.
  try {
    const nepouzite = $app.findRecordsByFilter("oauth_clients", "last_used = ''", "created", MAX_KLIENTU + 20, 0, {});
    for (let i = 0; i < nepouzite.length - (MAX_KLIENTU - 1); i++) $app.delete(nepouzite[i]);
  } catch (err) { /* úklid je bonus */ }

  const cid = "kbc_" + $security.randomString(24);
  const rec = new Record($app.findCollectionByNameOrId("oauth_clients"));
  rec.set("client_id", cid);
  rec.set("client_name", name);
  rec.set("redirect_uris", JSON.stringify(uris));
  $app.save(rec);
  return e.json(201, {
    client_id: cid,
    client_name: name,
    redirect_uris: uris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
  });
}

// ---------- consent pomůcky ----------
function najdiKlienta(clientId) {
  try {
    return $app.findFirstRecordByFilter("oauth_clients", "client_id = {:c}", { c: String(clientId || "") });
  } catch (err) { return null; }
}
function klientoveUri(rec) {
  try { return JSON.parse(rec.getString("redirect_uris")) || []; } catch (err) { return []; }
}

// veřejné info pro consent obrazovku. Kromě jména vrací i redirect_uris —
// consent MUSÍ ukázat, KAM se přístup předává: client_name si útočník při
// otevřené registraci zadá jakékoli („Claude by Anthropic"), takže sám o sobě
// nic nedokazuje; doména redirect_uri je to jediné, co uživatel může posoudit.
function clientInfo(e) {
  cors(e);
  const rec = najdiKlienta(e.request.url.query().get("client_id"));
  if (!rec) return e.json(404, { error: "unknown_client" });
  return e.json(200, {
    client_name: rec.getString("client_name") || "",
    redirect_uris: klientoveUri(rec),
  });
}

// přihlášený uživatel schválil přístup → vydat authorization code
function approve(e) {
  const info = e.requestInfo().body || {};
  const rec = najdiKlienta(info.client_id);
  if (!rec) return e.json(400, { error: "unknown_client" });
  const redirect = String(info.redirect_uri || "");
  if (!klientoveUri(rec).includes(redirect)) {
    // NIKDY nepřesměrovat na neregistrovanou adresu — kód by odtekl útočníkovi
    return e.json(400, { error: "invalid_redirect_uri" });
  }
  if (String(info.code_challenge_method || "S256") !== "S256") {
    return e.json(400, { error: "invalid_request", error_description: "Only PKCE S256 is supported." });
  }
  const challenge = String(info.code_challenge || "");
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) {
    return e.json(400, { error: "invalid_request", error_description: "Missing/invalid code_challenge (PKCE is required)." });
  }
  // scope: přísný whitelist. Cokoli mimo read/read_write je 400 (fail-closed) —
  // ne tichý povyšovací default na read_write. Frontend posílá volbu uživatele,
  // ta je autoritativní; neznámá hodnota = chyba klienta.
  const scope = info.scope;
  if (scope !== "read" && scope !== "read_write") {
    return e.json(400, { error: "invalid_scope", error_description: "scope must be 'read' or 'read_write'." });
  }

  // opportunistický úklid vypršelých, nikdy nevyměněných kódů (tabulka neroste)
  try {
    const mrtve = $app.findRecordsByFilter("oauth_codes", "expires_at < {:t}", "", 50, 0, { t: new Date().toISOString() });
    for (const c of mrtve) $app.delete(c);
  } catch (err) { /* úklid je bonus */ }

  const kod = "kbac_" + $security.randomString(40);
  const codeRec = new Record($app.findCollectionByNameOrId("oauth_codes"));
  codeRec.set("code_hash", $security.sha256(kod));
  codeRec.set("client_id", rec.getString("client_id"));
  codeRec.set("user", e.auth.id);
  codeRec.set("scope", scope);
  codeRec.set("code_challenge", challenge);
  codeRec.set("redirect_uri", redirect);
  codeRec.set("expires_at", new Date(Date.now() + KOD_TTL_MS).toISOString());
  $app.save(codeRec);
  rec.set("last_used", new Date().toISOString());
  $app.save(rec);

  const oddelovac = redirect.includes("?") ? "&" : "?";
  const state = info.state !== undefined && info.state !== null ? String(info.state) : "";
  return e.json(200, {
    redirect: redirect + oddelovac + "code=" + encodeURIComponent(kod)
      + (state ? "&state=" + encodeURIComponent(state) : ""),
  });
}

// ---------- token endpoint ----------
function token(e) {
  cors(e);
  const info = e.requestInfo().body || {}; // PB parsuje i application/x-www-form-urlencoded
  if (String(info.grant_type || "") !== "authorization_code") {
    return e.json(400, { error: "unsupported_grant_type" });
  }
  let codeRec;
  try {
    codeRec = $app.findFirstRecordByFilter("oauth_codes", "code_hash = {:h}", { h: $security.sha256(String(info.code || "")) });
  } catch (err) {
    return e.json(400, { error: "invalid_grant", error_description: "Unknown or already used code." });
  }
  // jednorázovost: kód smazat HNED, ať ho nejde zkoušet opakovaně
  const platnost = Date.parse(codeRec.getString("expires_at") || 0);
  const clientId = codeRec.getString("client_id");
  const userId = codeRec.getString("user");
  const scope = codeRec.getString("scope") || "read_write";
  const challenge = codeRec.getString("code_challenge");
  const redirect = codeRec.getString("redirect_uri");
  $app.delete(codeRec);

  if (!(platnost > Date.now())) return e.json(400, { error: "invalid_grant", error_description: "Code expired." });
  if (String(info.client_id || "") !== clientId) return e.json(400, { error: "invalid_grant", error_description: "client_id mismatch." });
  if (String(info.redirect_uri || "") !== redirect) return e.json(400, { error: "invalid_grant", error_description: "redirect_uri mismatch." });
  const verifier = String(info.code_verifier || "");
  if (!verifier || hexToB64url($security.sha256(verifier)) !== challenge) {
    return e.json(400, { error: "invalid_grant", error_description: "PKCE verification failed." });
  }

  let user;
  try { user = $app.findRecordById("users", userId); } catch (err) {
    return e.json(400, { error: "invalid_grant", error_description: "User no longer exists." });
  }

  // strop 20 klíčů na účet platí i tady — poctivá chyba místo tichého mazání
  const existing = $app.findRecordsByFilter("api_keys", "owner = {:o}", "", 21, 0, { o: user.id });
  if (existing.length >= 20) {
    return e.json(400, { error: "invalid_grant", error_description: "Account has too many API keys — remove some in the app (user menu → API keys) and reconnect." });
  }

  const klient = najdiKlienta(clientId);
  const jmeno = (klient && klient.getString("client_name")) || "MCP client";
  const accessToken = "kb_user_" + $security.randomString(40);
  const rec = new Record($app.findCollectionByNameOrId("api_keys"));
  rec.set("owner", user.id);
  rec.set("token_hash", $security.sha256(accessToken));
  rec.set("label", ("OAuth: " + jmeno).slice(0, 100));
  rec.set("scope", scope);
  rec.set("expires_at", new Date(Date.now() + TOKEN_DNY * 24 * 3600 * 1000).toISOString());
  rec.set("use_count", 0);
  $app.save(rec);

  return e.json(200, {
    access_token: accessToken,
    token_type: "Bearer",
    scope: scope,
    expires_in: TOKEN_DNY * 24 * 3600,
  });
}

function options(e) {
  cors(e);
  return e.noContent(204);
}

module.exports = { metadataProtectedResource, metadataAuthServer, register, clientInfo, approve, token, options, hexToB64url };
