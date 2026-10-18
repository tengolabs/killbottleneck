// Vlastní doména hostované instance (KB Cloud Pro / AI Agent, 13. 10. 2026).
//
// Správce zadá doménu (např. ukoly.firma.cz) ve Správě organizace, dostane hotové DNS
// záznamy ke zkopírování a tlačítko „Zkontrolovat". Instance sama NIC nepřepíná — na to
// nemá práva (Caddy, certifikát, adresa instance) a nemá to dělat: žádost pošle pod svým
// zákaznickým tokenem na bránu provozovatele (/v1/domain), centrála ověří DNS znovu
// (autoritativně) a server přepne. Tady je jen předkontrola, aby správce viděl, co mu
// chybí, dřív než žádost odejde.
//
// Logika v modulu (require) — PB JSVM nevidí top-level funkce souborů s routerAdd.

// jen předkontrola — závazný seznam drží centrála (cloud/auto/vlastni_domena.py), sem patří jen domény tohoto produktu
const ZAKAZANE = ["killbottleneck.com", "killbottleneck.cz"];
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

function env(k) { return String($os.getenv("KB_" + k) || "").trim(); }

// Je samoobslužná vlastní doména na téhle instanci vůbec k dispozici? Jen tam, kde
// provisioning připravil cíl CNAME (vlastní server Pro / AI Agent).
function dostupna() { return env("HOSTED") === "1" && env("CUSTOM_DOMAIN_TARGET") !== ""; }

// Normalizace + validace: malá písmena, bez tečky na konci, jen LDH jméno (IDN musí
// přijít jako punycode — prohlížeč ho z adresního řádku dává tak jako tak).
function normalizuj(d) {
  const x = String(d || "").trim().toLowerCase().replace(/\.$/, "");
  if (!DOMAIN_RE.test(x)) return "";
  for (const z of ZAKAZANE) if (x === z || x.endsWith("." + z)) return "";
  return x;
}

// Apex (firma.cz) neumí CNAME → A záznam na IP serveru. Podle počtu částí: přesnou
// hranici registrované domény (co.uk…) bez seznamu přípon neznáme, takže se ptáme jen
// na nejčastější případ; UI u A záznamu varuje, že se při stěhování serveru musí upravit.
function jeApex(d) { return d.split(".").length === 2; }

function zaznamy(d) {
  const cil = env("CUSTOM_DOMAIN_TARGET");
  const ip = env("SERVER_IP");
  const hlavni = jeApex(d)
    ? { name: d, type: "A", value: ip }
    : { name: d, type: "CNAME", value: cil };
  return [hlavni, { name: "agent." + d, type: "CNAME", value: cil }];
}

// Překlad jména přes veřejný DNS-over-HTTPS (Cloudflare + Google — oba musí souhlasit,
// jinak by předkontrola prošla podle cache jednoho resolveru). Vrací A adresy nebo null.
function prelozDoh(jmeno, server) {
  try {
    const res = $http.send({
      url: server + "?name=" + encodeURIComponent(jmeno) + "&type=A",
      method: "GET", headers: { Accept: "application/dns-json" }, timeout: 8,
    });
    if (res.statusCode !== 200) return null;
    const j = res.json || {};
    return (j.Answer || []).filter((a) => a.type === 1).map((a) => String(a.data));
  } catch (err) {
    return null;
  }
}

function kontrola(d) {
  const ip = env("SERVER_IP");
  const servery = (env("DOH_URLS") || "https://cloudflare-dns.com/dns-query,https://dns.google/resolve")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const z of zaznamy(d)) {
    const nalezeno = {};
    let chyba = "";
    for (const srv of servery) {
      const a = prelozDoh(z.name, srv);
      if (a === null) { chyba = "dns_unavailable"; continue; }
      for (const x of a) nalezeno[x] = true;
      if (!a.length) chyba = chyba || "missing";
      else if (a.some((x) => x !== ip)) chyba = chyba || "wrong_target";
    }
    const adresy = Object.keys(nalezeno);
    if (!chyba && !adresy.length) chyba = "missing";
    out.push({ name: z.name, type: z.type, value: z.value, ok: !chyba, error: chyba, found: adresy });
  }
  return out;
}

// Brzda „Zkontrolovat": nejvýš 1× za 10 s a 30× za hodinu na instanci (každá kontrola
// = 4 dotazy na veřejné resolvery a případně žádost na bránu).
function brzda() {
  const store = $app.store();
  const ted = Date.now();
  const posl = Number(store.get("vdom:posl") || 0);
  if (ted - posl < 10000) return false;
  const hod = Math.floor(ted / 3600000);
  const prev = String(store.get("vdom:hod") || "").split(":");
  const used = Number(prev[0]) === hod ? Number(prev[1]) || 0 : 0;
  if (used >= 30) return false;
  store.set("vdom:posl", ted);
  store.set("vdom:hod", hod + ":" + (used + 1));
  return true;
}

// Kanál na bránu provozovatele — stejný jako objednávky převodem (/order-transfer).
function branaUrl() {
  const { aiConfig } = require(`${__hooks}/helpers.js`);
  const cfg = aiConfig($app);
  const url = String(cfg.url || "").replace(/\/v1\/advisor\/?$/, "/v1/domain");
  if (cfg.provider !== "api" || !url.endsWith("/v1/domain") || !cfg.token) return null;
  return { url: url, token: cfg.token };
}

function brana(method, body) {
  const b = branaUrl();
  if (!b) return { status: 503, json: { error: "gateway_unavailable" } };
  try {
    const res = $http.send({
      url: b.url, method: method,
      body: body ? JSON.stringify(body) : "",
      headers: { "Content-Type": "application/json", "X-KB-Token": b.token },
      timeout: 15,
    });
    return { status: res.statusCode, json: res.json || {} };
  } catch (err) {
    return { status: 502, json: { error: "gateway_error" } };
  }
}

// Stav pro sekci ve Správě organizace.
function stav() {
  const aktivni = env("CUSTOM_DOMAIN");
  const g = brana("GET");
  const zadost = (g.status === 200 && g.json.request) || null;
  // doména, o kterou jde: rozpracovaná/selhaná žádost, jinak aktivní
  let d = aktivni;
  if (zadost && zadost.action === "set" && zadost.status !== "removed") d = zadost.domain;
  return {
    available: dostupna(),
    active: aktivni,
    slug_domain: env("SLUG_DOMAIN"),
    target: env("CUSTOM_DOMAIN_TARGET"),
    ip: env("SERVER_IP"),
    domain: d,
    apex: d ? jeApex(d) : false,
    records: d ? zaznamy(d) : [],
    request: zadost,
    gateway_ok: g.status === 200,
  };
}

module.exports = { dostupna, normalizuj, jeApex, zaznamy, kontrola, brzda, brana, stav };
