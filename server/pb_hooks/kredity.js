/// <reference path="../pb_data/types.d.ts" />
// AI kredity organizace — jedno místo pro převod tokenů na kredity, týdenní
// kvótu a její dělení správci × ostatní (Richard 14. 9. 2026).
//
// 1 KREDIT = 1 REFERENČNÍ TAH = průměrný tah skutečného provozu (Richard 4. 10. 2026: „kredity podle
// tokenů zůstávají, jednotku přepočítat“). Čísla (ceny AKI DeepSeek V4.1, kurz, referenční tah, seznam
// lokálních modelů) jsou v kredity-ceny.json — JEDINÝ zdroj i pro cloud/admin/app.py a testy.
// VŠECHNA volání se účtují „jako bychom je kupovali“ za ceny AKI — i lokální modely na vlastním hardwaru:
// Richard 5. 10. 2026 („vše jako koupeno — ano“): co odvede náš hardware, je naše viditelná rezerva, ne sleva
// rozdávaná automaticky. Zahozený pokus lehkého modelu (+predano), chybový tah a potvrzení karty bez modelu (#app)
// se nepočítají (práce, kterou uživatel nedostal). Kredity se počítají při zápisu řádku
// (ai_chat_log.kredity) z rozpadu po voláních (ai_chat_log.volani); součty jsou pak jen SUM(kredity).
// Historie do 4. 10. 2026: 1 kredit = „ranní porada“ (2 410/454 tokenů, Kosmik ×2, 0,0764 Kč) — skutečná
// zpráva stála ~2 kredity, web přitom slibuje „tahy“.
// Zatím se počítá jen chat asistenta (ai_chat_log); starší AI funkce v mapě tokeny nelogují.
const CENY_VYCHOZI = { eur_kc: 24.3, aki: { in: 0.25, cache: 0.10, out: 1.00 }, lokalni: ["gpt-oss", "gptoss", "rig", "qwen", "gemma4:", "ollama", "llama", "m-local"], referencni_tah: { in: 17618, cached: 11452, out: 284 }, prepis: { usd_min: 0.006, usd_kc: 20.8 } };
function nactiCeny() {
  try {
    const raw = $os.readFile(`${__hooks}/kredity-ceny.json`);
    let txt = typeof raw === "string" ? raw : "";
    if (!txt && raw && raw.length) { let a = ""; for (let i = 0; i < raw.length; i++) a += String.fromCharCode(raw[i]); txt = decodeURIComponent(escape(a)); }
    const c = JSON.parse(txt);
    if (c && c.aki && c.referencni_tah && c.eur_kc) return c;
  } catch (err) { /* záloha níže */ }
  return CENY_VYCHOZI;
}
const CENY = nactiCeny();
// Kč za 1 token
const SAZBA_AKI = { in: CENY.aki.in * CENY.eur_kc / 1e6, cache: CENY.aki.cache * CENY.eur_kc / 1e6, out: CENY.aki.out * CENY.eur_kc / 1e6 };
const KREDIT_KC = (CENY.referencni_tah.in - CENY.referencni_tah.cached) * SAZBA_AKI.in + CENY.referencni_tah.cached * SAZBA_AKI.cache + CENY.referencni_tah.out * SAZBA_AKI.out;
const UNIT_IN = CENY.referencni_tah.in, UNIT_OUT = CENY.referencni_tah.out;   // pro API (kredit_kc, popis)
// přepis hlasovky „jako koupeno“ (Richard 5. 10. 2026): referenční cena za minutu (kredity-ceny.json `prepis`) po sekundách
const PREPIS = CENY.prepis || CENY_VYCHOZI.prepis;
const PREPIS_KC_S = PREPIS.usd_min * PREPIS.usd_kc / 60;
const kredityPrepisu = (sekund) => (Number(sekund) > 0 ? Math.min(3600, Number(sekund)) * PREPIS_KC_S / KREDIT_KC : 0);
// lokální model (náš hardware) — jen pro statistiku rezervy (seznam v kredity-ceny.json, podle jména modelu);
// na kredity NEMÁ vliv (Richard 5. 10. 2026: účtovat vše jako koupeno; do 4. 10. = 0 kreditů)
function jeLokalni(model, provider) { // eslint-disable-line no-unused-vars
  const m = String(model || "").toLowerCase();
  return (CENY.lokalni || []).some((k) => m.indexOf(k) >= 0);
}
const sazba = (model, provider) => SAZBA_AKI; // eslint-disable-line no-unused-vars
// kredity jednoho volání modelu
function kredityVolani(v) {
  if (!v || v.zahozeno) return 0;
  const r = sazba(v.model, v.provider);
  const tin = Number(v.in) || 0, tc = Math.min(tin, Number(v.cached) || 0);
  return ((tin - tc) * r.in + tc * r.cache + (Number(v.out) || 0) * r.out) / KREDIT_KC;
}
// kredity tahu ze statistik smyčky: rozpad po voláních (stats.volani); bez něj součty za cenu AKI.
// Chybový tah a potvrzení bez modelu = 0.
function kredityTahu(stats, chyba) {
  if (chyba || !stats || stats.app || !(Number(stats.calls) > 0)) return 0;
  const prepis = stats.hlas ? kredityPrepisu(stats.hlas.s) : 0; // délka nahrávky v sekundách (chat.js: stats.hlas.s)
  if (Array.isArray(stats.volani) && stats.volani.length) return prepis + stats.volani.reduce((a, v) => a + kredityVolani(v), 0);
  return prepis + kreditu(stats.in, stats.out, stats.cached);
}
// kredity ze součtů tokenů za cenu AKI (záloha, starší řádky bez rozpadu, testy)
const PODIL_ADMIN_VYCHOZI = 30;

// PODÍL SPRÁVCŮ = REZERVA, ne strop (Richard 4. 10. 2026, upřesnění původního záměru
// ze 14. 9.): správci smějí čerpat CELOU kvótu organizace, ale jejich podíl jim nikdo
// nevezme — ostatní členové mají strop `kvota − rezerva`. Dřív byl podíl stropem
// správců (30 % z 20 kreditů zkušebky = 6 → správce zkušebky narazil po 3 zprávách,
// hostovaná zkušebka 4. 10.). 100 % = ostatní nemají nic, 0 % = bez rezervy (společný balík).
// Brzda: správce narazí, až je vyčerpaná celá kvóta (součet všech); člen narazí na
// strop ostatních NEBO na celou kvótu (správci směli čerpat i z „jeho" části).

function kreditu(tokensIn, tokensOut, tokensCached, model) {
  const r = sazba(model, "");
  const tin = Number(tokensIn) || 0, tc = Math.min(tin, Number(tokensCached) || 0);
  return ((tin - tc) * r.in + tc * r.cache + (Number(tokensOut) || 0) * r.out) / KREDIT_KC;
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
  const rezerva = kvota > 0 ? kvota * podil / 100 : 0;
  return { kvota: kvota, podil_admin: podil, rezerva_admin: rezerva, zdroj: zdroj, strop_env: strop, vlastni: vlastni };
}

// spotřeba po lidech od data (SQL nad ai_chat_log)
function spotrebaOd(app, od, doo) {
  const rows = arrayOf(new DynamicModel({ user: "", n: 0, tokens_in: 0, tokens_out: 0, tokens_cached: 0, calls: 0, kredity_dt: 0, posledni: "" }));
  try {
    app.db().newQuery("SELECT user, COUNT(*) AS n, COALESCE(SUM(tokens_in),0) AS tokens_in, COALESCE(SUM(tokens_out),0) AS tokens_out, COALESCE(SUM(tokens_cached),0) AS tokens_cached, COALESCE(SUM(calls),0) AS calls, CAST(ROUND(COALESCE(SUM(kredity),0) * 10000) AS INTEGER) AS kredity_dt, MAX(created) AS posledni FROM ai_chat_log WHERE created >= {:od} AND created < {:do} GROUP BY user")
      .bind({ od: sql(od), do: sql(doo) }).all(rows);
  } catch (err) { /* prázdno */ }
  const out = {};
  for (const r of rows) out[String(r.user)] = { n: Number(r.n) || 0, tokens_in: Number(r.tokens_in) || 0, tokens_out: Number(r.tokens_out) || 0, tokens_cached: Number(r.tokens_cached) || 0, calls: Number(r.calls) || 0, posledni: String(r.posledni || ""), kredity: (Number(r.kredity_dt) || 0) / 10000 };
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
  // správci smějí až celou kvótu (podíl je jen jejich rezerva); ostatní nejvýš kvóta − rezerva
  admin.kvota = n.kvota > 0 ? n.kvota : 0;
  ostatni.kvota = n.kvota > 0 ? n.kvota - n.rezerva_admin : 0;
  return {
    tyden_od: od.toISOString(), tyden_do: doo.toISOString(), kvota: n.kvota, podil_admin: n.podil_admin, rezerva_admin: n.rezerva_admin, zdroj: n.zdroj, strop_env: n.strop_env, vlastni: n.vlastni, kredit_kc: KREDIT_KC,
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
  const rows = arrayOf(new DynamicModel({ w: 0, n: 0, tokens_in: 0, tokens_out: 0, tokens_cached: 0, kredity_dt: 0 }));
  try {
    app.db().newQuery("SELECT CAST((julianday(created) - julianday({:od0})) / 7 AS INTEGER) AS w, COUNT(*) AS n, COALESCE(SUM(tokens_in),0) AS tokens_in, COALESCE(SUM(tokens_out),0) AS tokens_out, COALESCE(SUM(tokens_cached),0) AS tokens_cached, CAST(ROUND(COALESCE(SUM(kredity),0) * 10000) AS INTEGER) AS kredity_dt FROM ai_chat_log WHERE created >= {:od0} AND created < {:do} GROUP BY w")
      .bind({ od0: sql(od0), do: sql(doo) }).all(rows);
  } catch (err) { /* prázdno */ }
  const podle = {};
  for (const r of rows) podle[Number(r.w)] = r;
  const out = [];
  for (let i = 0; i < kolik; i++) {           // i = 0 tento týden, dál do minulosti
    const w = kolik - 1 - i; const r = podle[w];
    const od = new Date(tento.getTime() - i * 7 * 86400000);
    out.push({ od: od.toISOString(), kredity: r ? zaokrouhli((Number(r.kredity_dt) || 0) / 10000) : 0, n: r ? Number(r.n) || 0 : 0, tokens_in: r ? Number(r.tokens_in) || 0 : 0, tokens_out: r ? Number(r.tokens_out) || 0 : 0, tokens_cached: r ? Number(r.tokens_cached) || 0 : 0 });
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
  const od = zacatekTydne(); const doo = new Date(od.getTime() + 7 * 86400000);
  // JEDEN dotaz: spotřeba správců i ostatních zvlášť (brzda potřebuje obě: celek i strop ostatních)
  // součty kreditů jako celé desetitisíciny: DynamicModel bere číselný literál jako int64 a SUM(real) by skenování shodilo (5. 10. 2026)
  const rows = arrayOf(new DynamicModel({ kr_a: 0, kr_o: 0 }));
  try {
    app.db().newQuery("SELECT CAST(ROUND(COALESCE(SUM(CASE WHEN u.role = 'admin' THEN l.kredity ELSE 0 END),0) * 10000) AS INTEGER) AS kr_a, CAST(ROUND(COALESCE(SUM(CASE WHEN u.role = 'admin' THEN 0 ELSE l.kredity END),0) * 10000) AS INTEGER) AS kr_o FROM ai_chat_log l LEFT JOIN users u ON u.id = l.user WHERE l.created >= {:od} AND l.created < {:do}")
      .bind({ od: sql(od), do: sql(doo) }).all(rows);
  } catch (err) { return null; /* bez součtu nebrzdit — chyba logu nesmí zastavit chat */ }
  const r = rows.length ? rows[0] : {};
  const spravci = (Number(r.kr_a) || 0) / 10000, ostatni = (Number(r.kr_o) || 0) / 10000;
  const celkem = spravci + ostatni;
  const odpoved = (klic, pouzito, kvota) => ({ status: 429, body: { error: t(L, klic, { pouzito: zaokrouhli(pouzito), kvota: zaokrouhli(kvota) }), code: "ai_kvota", kvota: zaokrouhli(kvota), pouzito: zaokrouhli(pouzito) } });
  // strop ostatních = kvóta bez rezervy správců; správci až celá kvóta
  if (!admin) {
    const strop = n.kvota - n.rezerva_admin;
    if (ostatni >= strop) return odpoved("err.aiKvotaOstatni", ostatni, strop);
  }
  if (celkem >= n.kvota) return odpoved("err.aiKvotaCelek", celkem, n.kvota);
  return null;
}

// zaokrouhlený výstup pro API
function proApi(app, kolikTydnu) {
  const st = stavTydne(app);
  const z = (o) => Object.assign({}, o, { kredity: zaokrouhli(o.kredity), kvota: o.kvota !== undefined ? zaokrouhli(o.kvota) : undefined });
  return {
    tyden_od: st.tyden_od, tyden_do: st.tyden_do, kvota: st.kvota, podil_admin: st.podil_admin, rezerva_admin: zaokrouhli(st.rezerva_admin), zdroj: st.zdroj, strop_env: st.strop_env, vlastni: st.vlastni, kredit_kc: Math.round(st.kredit_kc * 10000) / 10000,
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

module.exports = { kreditu, zacatekTydne, nastaveni, stavTydne, kvotaBrzda, proApi, ulozNastaveni, KREDIT_KC, PODIL_ADMIN_VYCHOZI, kredityTahu, kredityVolani, kredityPrepisu, jeLokalni, CENY, SAZBA_AKI };
