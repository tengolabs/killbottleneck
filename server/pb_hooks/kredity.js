/// <reference path="../pb_data/types.d.ts" />
// AI kredity organizace — jedno místo pro převod tokenů na kredity, týdenní
// kvótu a její dělení správci × ostatní (Richard 14. 9. 2026).
//
// 1 kredit = jedna ranní porada s reálnou mapou = průměrný dotaz hodinového
// testu rigu (2 410 tokenů vstup / 454 výstup) při ceníku Kosmik Compute ×2,
// tj. 0,0764 Kč. Zdroj pravdy čísel: ~/Claude_Holly/kb-ai-clenstvi-2026-09-12/
// kalkulace-kreditu.py (13. 9. 2026). Cache tokenů se v logu nerozlišuje →
// počítáme vstup plnou cenou (kredity vychází spíš VÝŠ než skutečný náklad).
// Zatím se počítá jen chat asistenta (ai_chat_log); starší AI funkce v mapě
// tokeny nelogují.
const KOSMIK_IN_USD = 0.35, KOSMIK_OUT_USD = 2.20, KOSMIK_CACHE_USD = 0.09, KURZ = 20.74, NASOBEK = 2;
const UNIT_IN = 2410, UNIT_OUT = 454;
const CENA_IN = KOSMIK_IN_USD * KURZ * NASOBEK / 1e6;   // Kč za token vstupu
const CENA_OUT = KOSMIK_OUT_USD * KURZ * NASOBEK / 1e6;
const CENA_CACHE = KOSMIK_CACHE_USD * KURZ * NASOBEK / 1e6;   // vstup vzatý z cache prefixu (brána účtuje cache za cache cenu, 13. 9.)
const KREDIT_KC = UNIT_IN * CENA_IN + UNIT_OUT * CENA_OUT;
const PODIL_ADMIN_VYCHOZI = 30;

function kreditu(tokensIn, tokensOut, tokensCached) {
  const tin = Number(tokensIn) || 0, tc = Math.min(tin, Number(tokensCached) || 0);
  return ((tin - tc) * CENA_IN + tc * CENA_CACHE + (Number(tokensOut) || 0) * CENA_OUT) / KREDIT_KC;
}
const zaokrouhli = (x) => Math.round(x * 100) / 100;

// pondělí 00:00 UTC aktuálního týdne (kvóta je týdenní, bez přenosu — rozhodnutí 12. 9.)
function zacatekTydne(ts) {
  const d = new Date(ts || Date.now());
  const den = (d.getUTCDay() + 6) % 7;   // po=0 … ne=6
  const po = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - den));
  return po;
}
const sql = (d) => d.toISOString().replace("T", " ").slice(0, 19);

// nastavení: env KB_AI_KVOTA_TYDEN (hosting/tarif) = TVRDÝ STROP — vlastní hodnota správce
// (instance_settings.ai_kredity) ho může jen snížit, nikdy zvednout (panel /checkup 15. 9. 2026:
// dřív byla env jen výchozí a zákazník na tarifu si kvótu zvedl až na 1 000 000). Bez env platí
// vlastní hodnota; 0 = bez vlastního stropu. Podíl správců bez nastavení = 30 %.
function nastaveni(app) {
  const { env, jsonVal } = require(`${__hooks}/helpers.js`);
  let rec = null;
  try { rec = app.findFirstRecordByFilter("instance_settings", "id != ''"); } catch (err) { rec = null; }
  const j = rec ? (jsonVal(rec, "ai_kredity", null) || {}) : {};
  const vlastni = Number(j.kvota_tyden) || 0;
  const strop = parseInt(env("AI_KVOTA_TYDEN"), 10) || 0;
  let kvota, zdroj;
  if (strop > 0) { kvota = vlastni > 0 ? Math.min(vlastni, strop) : strop; zdroj = kvota < strop ? "nastaveni" : "env"; }
  else { kvota = vlastni; zdroj = vlastni > 0 ? "nastaveni" : "none"; }
  let podil = (j.podil_admin === undefined || j.podil_admin === null) ? PODIL_ADMIN_VYCHOZI : Number(j.podil_admin);
  if (!(podil >= 0 && podil <= 100)) podil = PODIL_ADMIN_VYCHOZI;
  return { kvota: kvota, podil_admin: podil, zdroj: zdroj, strop_env: strop, vlastni: vlastni };
}

// spotřeba po lidech od data (SQL nad ai_chat_log)
function spotrebaOd(app, od, doo) {
  const rows = arrayOf(new DynamicModel({ user: "", n: 0, tokens_in: 0, tokens_out: 0, tokens_cached: 0, calls: 0, posledni: "" }));
  try {
    app.db().newQuery("SELECT user, COUNT(*) AS n, COALESCE(SUM(tokens_in),0) AS tokens_in, COALESCE(SUM(tokens_out),0) AS tokens_out, COALESCE(SUM(tokens_cached),0) AS tokens_cached, COALESCE(SUM(calls),0) AS calls, MAX(created) AS posledni FROM ai_chat_log WHERE created >= {:od} AND created < {:do} GROUP BY user")
      .bind({ od: sql(od), do: sql(doo) }).all(rows);
  } catch (err) { /* prázdno */ }
  const out = {};
  for (const r of rows) out[String(r.user)] = { n: Number(r.n) || 0, tokens_in: Number(r.tokens_in) || 0, tokens_out: Number(r.tokens_out) || 0, tokens_cached: Number(r.tokens_cached) || 0, calls: Number(r.calls) || 0, posledni: String(r.posledni || ""), kredity: kreditu(r.tokens_in, r.tokens_out, r.tokens_cached) };
  return out;
}

function lideInstance(app) {
  let users = [];
  try { users = app.findRecordsByFilter("users", "id != ''", "name", 1000, 0); } catch (err) { users = []; }
  return users.map((u) => ({ id: u.id, name: u.getString("name"), email: u.getString("email"), role: u.getString("role") || "user" }));
}

// stav tohoto týdne: skupiny správci × ostatní, lidé, celek
function stavTydne(app, ted, nast) {
  const n = nast || nastaveni(app);
  const od = zacatekTydne(ted);
  const doo = new Date(od.getTime() + 7 * 86400000);
  const sp = spotrebaOd(app, od, doo);
  const lide = lideInstance(app).map((u) => Object.assign({ n: 0, tokens_in: 0, tokens_out: 0, tokens_cached: 0, calls: 0, posledni: "", kredity: 0 }, sp[u.id] || {}, u));
  // spotřeba účtů, které už neexistují, patří skupině „ostatní“ (nezmizí z celku)
  const znami = new Set(lide.map((u) => u.id));
  const skupina = (jeAdmin) => {
    let kr = 0, tin = 0, tout = 0, tc = 0, nn = 0;
    for (const u of lide) if ((u.role === "admin") === jeAdmin) { kr += u.kredity; tin += u.tokens_in; tout += u.tokens_out; tc += u.tokens_cached; nn += u.n; }
    if (!jeAdmin) for (const id of Object.keys(sp)) if (!znami.has(id)) { kr += sp[id].kredity; tin += sp[id].tokens_in; tout += sp[id].tokens_out; tc += sp[id].tokens_cached; nn += sp[id].n; }
    return { kredity: kr, tokens_in: tin, tokens_out: tout, tokens_cached: tc, n: nn, lidi: lide.filter((u) => (u.role === "admin") === jeAdmin).length };
  };
  const admin = skupina(true), ostatni = skupina(false);
  admin.kvota = n.kvota > 0 ? n.kvota * n.podil_admin / 100 : 0;
  ostatni.kvota = n.kvota > 0 ? n.kvota - admin.kvota : 0;
  return {
    tyden_od: od.toISOString(), tyden_do: doo.toISOString(), kvota: n.kvota, podil_admin: n.podil_admin, zdroj: n.zdroj, strop_env: n.strop_env, vlastni: n.vlastni, kredit_kc: KREDIT_KC,
    admin: admin, ostatni: ostatni,
    celkem: { kredity: admin.kredity + ostatni.kredity, tokens_in: admin.tokens_in + ostatni.tokens_in, tokens_out: admin.tokens_out + ostatni.tokens_out, tokens_cached: admin.tokens_cached + ostatni.tokens_cached, n: admin.n + ostatni.n },
    lide: lide.sort((a, b) => b.kredity - a.kredity),
  };
}

// posledních N týdnů (včetně tohoto) — jen celek organizace, JEDEN dotaz (koš = celé týdny od nejstaršího pondělí)
function tydny(app, kolik, ted) {
  const tento = zacatekTydne(ted);
  const od0 = new Date(tento.getTime() - (kolik - 1) * 7 * 86400000);
  const doo = new Date(tento.getTime() + 7 * 86400000);
  const rows = arrayOf(new DynamicModel({ w: 0, n: 0, tokens_in: 0, tokens_out: 0, tokens_cached: 0 }));
  try {
    app.db().newQuery("SELECT CAST((julianday(created) - julianday({:od0})) / 7 AS INTEGER) AS w, COUNT(*) AS n, COALESCE(SUM(tokens_in),0) AS tokens_in, COALESCE(SUM(tokens_out),0) AS tokens_out, COALESCE(SUM(tokens_cached),0) AS tokens_cached FROM ai_chat_log WHERE created >= {:od0} AND created < {:do} GROUP BY w")
      .bind({ od0: sql(od0), do: sql(doo) }).all(rows);
  } catch (err) { /* prázdno */ }
  const podle = {};
  for (const r of rows) podle[Number(r.w)] = r;
  const out = [];
  for (let i = 0; i < kolik; i++) {           // i = 0 tento týden, dál do minulosti
    const w = kolik - 1 - i; const r = podle[w];
    const od = new Date(tento.getTime() - i * 7 * 86400000);
    out.push({ od: od.toISOString(), kredity: r ? zaokrouhli(kreditu(r.tokens_in, r.tokens_out, r.tokens_cached)) : 0, n: r ? Number(r.n) || 0 : 0, tokens_in: r ? Number(r.tokens_in) || 0 : 0, tokens_out: r ? Number(r.tokens_out) || 0 : 0, tokens_cached: r ? Number(r.tokens_cached) || 0 : 0 });
  }
  return out;
}

// brzda před tahem chatu: vrací {status, body} nebo null (vzor chatBrzda — routa píše odpověď).
// Jen součet kreditů JEDNÉ skupiny jedním dotazem (ne celý přehled s ≤1000 uživateli — běží
// na každý tah i potvrzení). Účty bez záznamu v users (smazané) patří k „ostatní“ jako v stavTydne.
// Měkký strop: kontrola je před tahem, spotřeba se zapisuje po něm — poslední tah přestřelí
// a souběžné tahy projdou; pro tarif doplnit in-flight počítadlo ($app.store) jako u hodinového.
function kvotaBrzda(app, auth, L) {
  const { t } = require(`${__hooks}/i18n.js`);
  const { jeAdmin } = require(`${__hooks}/helpers.js`);
  const n = nastaveni(app);
  if (!(n.kvota > 0)) return null;
  const admin = jeAdmin(auth);
  const kvota = admin ? n.kvota * n.podil_admin / 100 : n.kvota - n.kvota * n.podil_admin / 100;
  const od = zacatekTydne(); const doo = new Date(od.getTime() + 7 * 86400000);
  const rows = arrayOf(new DynamicModel({ tin: 0, tout: 0, tc: 0 }));
  try {
    app.db().newQuery("SELECT COALESCE(SUM(l.tokens_in),0) AS tin, COALESCE(SUM(l.tokens_out),0) AS tout, COALESCE(SUM(l.tokens_cached),0) AS tc FROM ai_chat_log l LEFT JOIN users u ON u.id = l.user WHERE l.created >= {:od} AND l.created < {:do} AND (CASE WHEN u.role = 'admin' THEN 1 ELSE 0 END) = {:adm}")
      .bind({ od: sql(od), do: sql(doo), adm: admin ? 1 : 0 }).all(rows);
  } catch (err) { return null; /* bez součtu nebrzdit — chyba logu nesmí zastavit chat */ }
  const pouzito = rows.length ? kreditu(rows[0].tin, rows[0].tout, rows[0].tc) : 0;
  if (pouzito < kvota) return null;
  const klic = admin ? "err.aiKvotaAdmin" : "err.aiKvotaOstatni";
  return { status: 429, body: { error: t(L, klic, { pouzito: zaokrouhli(pouzito), kvota: zaokrouhli(kvota) }), code: "ai_kvota", kvota: zaokrouhli(kvota), pouzito: zaokrouhli(pouzito) } };
}

// zaokrouhlený výstup pro API
function proApi(app, kolikTydnu) {
  const st = stavTydne(app);
  const z = (o) => Object.assign({}, o, { kredity: zaokrouhli(o.kredity), kvota: o.kvota !== undefined ? zaokrouhli(o.kvota) : undefined });
  return {
    tyden_od: st.tyden_od, tyden_do: st.tyden_do, kvota: st.kvota, podil_admin: st.podil_admin, zdroj: st.zdroj, strop_env: st.strop_env, vlastni: st.vlastni, kredit_kc: Math.round(st.kredit_kc * 10000) / 10000,
    admin: z(st.admin), ostatni: z(st.ostatni), celkem: z(st.celkem),
    lide: st.lide.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, kredity: zaokrouhli(u.kredity), n: u.n, calls: u.calls, tokens_in: u.tokens_in, tokens_out: u.tokens_out, tokens_cached: u.tokens_cached, posledni: u.posledni })),
    tydny: tydny(app, Math.min(12, Math.max(1, kolikTydnu || 4))),
  };
}

function ulozNastaveni(app, kvota, podil) {
  let rec;
  try { rec = app.findFirstRecordByFilter("instance_settings", "id != ''"); } catch (err) { rec = new Record(app.findCollectionByNameOrId("instance_settings")); }
  rec.set("ai_kredity", { kvota_tyden: kvota, podil_admin: podil });
  app.save(rec);
}

module.exports = { kreditu, zacatekTydne, nastaveni, stavTydne, kvotaBrzda, proApi, ulozNastaveni, KREDIT_KC, PODIL_ADMIN_VYCHOZI };
