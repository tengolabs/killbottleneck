// Faktury z asistenta (Richard 9. 10. 2026: „vystav fakturu na Karla za konzultaci“) — data, číselná řada,
// součty, profil dodavatele, QR platba (SPAYD) a routy /chat/faktura*. Samostatný modul (vzor dokumenty.js),
// ať chat.js nebobtná a routy i nástroje mají JEDNU validaci, jedny stropy a jednu kontrolu vlastníka.
//
// Rozhodnutí (plán 9. 10. 2026):
//  · odběratel = záznam `clients` (instance-wide adresář; nepovinná pole address/ico/dic/email);
//  · dodavatel = SPOLEČNÝ profil organizace (instance_settings.invoicing, správce) nebo VLASTNÍ profil uživatele
//    (invoicing_profiles, 24. 10. 2026) — vlastní má přednost a dává vlastní číselnou řadu;
//  · faktura je NEMĚNNÁ (snímek dodavatele i odběratele), oprava = nová faktura; vidí ji vystavující a správce;
//  · částky počítá VÝHRADNĚ server (model žádné částky nepočítá, karta je ukáže);
//  · číselná řada na instanci a rok (serie "") nebo na uživatele (serie = id) BEZ DĚR: MAX+1 v transakci + unikátní index
//    (serie, year, number) + opakování při kolizi; smazání člena faktury NEMAŽE (cascade vypnut, Richard 24. 10. 2026);
//  · DPH v1: neplátce, nebo plátce s JEDNOU sazbou na fakturu; měna jen CZK;
//  · PDF se NIKDY neukládá (vyrobí ho prohlížeč z DTO, kdykoli znovu 1:1); QR platba = SPAYD, IBAN z českého čísla
//    účtu počítá server při uložení profilu (chybný účet = chybná platba → kontrolní číslice mod 11 i IBAN mod 97).
//  · KB NENÍ archiv daňových dokladů (10 let má zákazník) — v docs i v promptu.
//
// Čisté funkce (czIban, soucty, spayd, …) nesahají na PocketBase → jdou ověřit v node (tests/faktura-cisla.js).
// ⚠️ PocketBase JSVM: require() uvnitř funkcí (moduly se nevidí navzájem).
const HOOKS = typeof __hooks !== "undefined" ? __hooks : __dirname;

const MAX_FAKTUR = 500;     // na instanci; nad strop hláška (ne tiché mazání)
const MAX_POLOZEK = 50;
const MAX_POPIS = 200;
const MAX_POZNAMKA = 500;
const MAX_SEZNAM = 500;        // = MAX_FAKTUR: seznam v panelu, filtr měsíců a ZIP musí vidět všechny (strop 200 tiše ořezával)
const MENY = ["CZK"];
const VYCHOZI_SAZBA = 21;
const VYCHOZI_SPLATNOST = 14;
// profil dodavatele: pole → strop délky (whitelist; do JSONu se nikdy neukládá celé tělo)
const PROFIL_POLE = { name: 200, address: 300, ico: 20, dic: 20, bank_account: 40, iban: 34, email: 120, prefix: 6 };
// snímek klienta na faktuře
const KLIENT_POLE = { name: 120, address: 300, ico: 20, dic: 20, email: 120 };

function chybaS(status, klic, params) {
  const e = new Error(klic);
  e.status = status; e.klic = klic; e.params = params || {};
  return e;
}
function ocisti(s, max) { return String(s == null ? "" : s).replace(/\u0000/g, "").trim().slice(0, max); }
function radek(s, max) { return ocisti(s, max * 2).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
function vicerad(s, max) { return ocisti(s, max * 2).replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").slice(0, max); }
const jeMail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(String(s || ""));
const jeDen = (s) => { const t = String(s || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false; const d = new Date(t + "T00:00:00Z"); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t; }; // 2026-02-30 → NE (Date by přetočil na 2. 3.)
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ---------- bankovní účet, IBAN, SPAYD (čisté) ----------
// mod 97 nad dlouhým číselným řetězcem bez BigInt (goja BigInt nemá jistý)
function mod97(cislice) {
  let z = 0;
  for (let i = 0; i < cislice.length; i++) z = (z * 10 + (cislice.charCodeAt(i) - 48)) % 97;
  return z;
}
// kontrolní číslice českého čísla účtu (ČNB vyhláška 169/2011: váhy 6,3,7,9,10,5,8,4,2,1 zprava → mod 11 = 0)
function mod11(cast) {
  const vahy = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1];
  const s = cast.padStart(10, "0");
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (s.charCodeAt(i) - 48) * vahy[i];
  return sum % 11 === 0;
}
// „19-2000145399/0800“ → { iban: "CZ6508000000192000145399", ucet: "19-2000145399/0800" } | { error }
function czIban(ucet) {
  const s = String(ucet || "").replace(/\s+/g, "");
  const m = s.match(/^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/);
  if (!m) return { error: "format" };
  const pred = (m[1] || "").padStart(6, "0");
  const cis = m[2].padStart(10, "0");
  const banka = m[3];
  if (!mod11(pred) || !mod11(cis)) return { error: "checksum" };
  const bban = banka + pred + cis;
  const kontrola = String(98 - mod97(bban + "123500")).padStart(2, "0"); // C=12, Z=35, 00
  return { iban: "CZ" + kontrola + bban, ucet: (m[1] ? m[1] + "-" : "") + m[2] + "/" + banka };
}
// IBAN (libovolná země) → true, když sedí kontrolní číslice
function overIban(iban) {
  const s = String(iban || "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const pre = s.slice(4) + s.slice(0, 4);
  let cis = "";
  for (const ch of pre) cis += /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
  return mod97(cis) === 1;
}
const normIban = (s) => String(s || "").replace(/\s+/g, "").toUpperCase();
function bezDiakritiky(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, ""); }
// SPAYD (český standard QR platby): ACC = IBAN, AM = částka s tečkou na 2 des., CC, X-VS = číslice čísla faktury,
// DT = splatnost, MSG = bez diakritiky a bez „*“, max 60 zn. Bez účtu (IBAN) žádná QR platba.
function spayd(f) {
  if (!f || !f.supplier || !f.supplier.iban || !(Number(f.total) > 0)) return "";
  const casti = ["SPD*1.0", "ACC:" + normIban(f.supplier.iban), "AM:" + Number(f.total).toFixed(2), "CC:" + (f.currency || "CZK")];
  if (f.vs) casti.push("X-VS:" + f.vs);
  if (jeDen(f.due)) casti.push("DT:" + String(f.due).replace(/-/g, ""));
  const msg = bezDiakritiky(`Faktura ${f.cislo || ""}`).replace(/\*/g, " ").replace(/[^\x20-\x7E]/g, "").trim().slice(0, 60);
  if (msg) casti.push("MSG:" + msg);
  return casti.join("*");
}
// variabilní symbol = číslice (max 10); faktura ho skládá z ROKU + POŘADÍ (slozCislo bez předpony) — předpona smí mít číslice
// („2026“ → číslo 202620260001, ale VS 20260001; z celého čísla by vyšlo 2026202600 a platba by se nespárovala)
const variabilni = (cislo) => String(cislo || "").replace(/\D/g, "").slice(0, 10);

// ---------- položky a součty (čisté) ----------
// [{description, quantity, unit, unit_price}] → { items, error } (error = anglický text pro model)
function validujPolozky(items) {
  if (!Array.isArray(items) || !items.length) return { error: "items must be a non-empty array of {description, quantity, unit, unit_price}." };
  if (items.length > MAX_POLOZEK) return { error: `at most ${MAX_POLOZEK} items per invoice.` };
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const description = radek(it.description, MAX_POPIS);
    if (!description) return { error: `item ${i + 1}: description is required.` };
    const quantity = it.quantity === undefined || it.quantity === null || it.quantity === "" ? 1 : Number(it.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e6) return { error: `item ${i + 1} ("${description}"): quantity must be a positive number.` };
    const unit_price = Number(it.unit_price);
    if (!Number.isFinite(unit_price) || unit_price < 0 || unit_price > 1e9) return { error: `item ${i + 1} ("${description}"): unit_price must be a number ≥ 0 (price per unit WITHOUT VAT, in CZK).` };
    const q = Math.round(quantity * 1000) / 1000; // řádek i součet z TÉHOŽ zaokrouhleného množství (1,0005 × 1000 dřív dalo řádek 1000,50 a součet 1001)
    const cena = round2(unit_price);
    out.push({ description, quantity: q, unit: radek(it.unit, 12), unit_price: cena, total: round2(q * cena) });
  }
  return { items: out };
}
function soucty(items, vatPayer, vatRate) {
  const subtotal = round2(items.reduce((s, it) => s + round2(it.total !== undefined ? it.total : it.quantity * it.unit_price), 0));
  const sazba = vatPayer ? Number(vatRate) : 0;
  const vat = vatPayer ? round2(subtotal * sazba / 100) : 0;
  return { subtotal, vat, total: round2(subtotal + vat), vat_rate: sazba };
}
// 1 600,00 Kč (pro kartu a text modelu; PDF má vlastní formát v prohlížeči)
function castka(n, mena) {
  const [cela, des] = Number(n || 0).toFixed(2).split(".");
  // tisícové skupiny ručně — goja u globálního replace s lookaheadem vkládal oddělovač dvakrát (ai-faktury 9. 10.)
  let s = "";
  for (let i = 0; i < cela.length; i++) { if (i && (cela.length - i) % 3 === 0) s += "\u00a0"; s += cela[i]; }
  return `${s},${des}\u00a0${mena === "CZK" || !mena ? "Kč" : mena}`;
}
function datumPlus(ymd, dni) {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dni);
  return d.toISOString().slice(0, 10);
}

// ---------- profil dodavatele ----------
function profilNacti(app) {
  try {
    const rec = app.findFirstRecordByFilter("instance_settings", "id != ''");
    const raw = rec.getString("invoicing");
    if (raw) { const p = JSON.parse(raw); if (p && typeof p === "object") return p; }
  } catch (err) { /* žádný záznam */ }
  return {};
}
// minimum pro fakturu: jméno/firma + adresa (IČO u nepodnikatele prázdné; účet nepovinný = bez platebního bloku)
function profilKompletni(p) { return !!(p && p.name && p.address); }
const profilChybi = (p) => ["name", "address"].filter((k) => !(p && p[k]));
// whitelist + validace; `zmeny` se slévají s `stav` (částečná změna přes asistenta). Vrací { profil } | { chyba, pole }
function profilOcisti(zmeny, stav) {
  const z = zmeny || {};
  const p = Object.assign({}, stav || {});
  for (const k in PROFIL_POLE) {
    if (z[k] === undefined) continue;
    p[k] = k === "address" ? vicerad(z[k], PROFIL_POLE[k]) : radek(z[k], PROFIL_POLE[k]);
  }
  if (z.vat_payer !== undefined) p.vat_payer = z.vat_payer === true || z.vat_payer === "true" || z.vat_payer === 1;
  if (z.vat_rate !== undefined && z.vat_rate !== "") {
    const r = Number(z.vat_rate);
    if (!Number.isFinite(r) || r < 0 || r > 100) return { chyba: "err.invVatRate", pole: "vat_rate" };
    p.vat_rate = Math.round(r * 100) / 100;
  }
  if (z.due_days !== undefined && z.due_days !== "") {
    const d = Number(z.due_days);
    if (!Number.isInteger(d) || d < 0 || d > 365) return { chyba: "err.invDueDays", pole: "due_days" };
    p.due_days = d;
  }
  if (z.currency !== undefined && z.currency !== "") {
    const c = String(z.currency).toUpperCase().trim();
    if (!MENY.includes(c)) return { chyba: "err.invCurrency", pole: "currency" };
    p.currency = c;
  }
  if (p.email && !jeMail(p.email)) return { chyba: "err.invEmail", pole: "email" };
  if (p.ico) p.ico = String(p.ico).replace(/\s+/g, ""); // „1234 5678“ (přepis vizitky) = 12345678
  if (p.ico && !/^\d{1,12}$/.test(p.ico)) return { chyba: "err.invIco", pole: "ico" };
  if (p.dic) p.dic = String(p.dic).replace(/\s+/g, "").toUpperCase();
  if (p.vat_payer === true && !p.dic) return { chyba: "err.invDicRequired", pole: "dic" }; // daňový doklad bez DIČ dodavatele nejde
  if (z.prefix !== undefined && String(z.prefix).trim() && !/^[A-Za-z0-9-]{1,6}$/.test(String(z.prefix).trim())) return { chyba: "err.invPrefix", pole: "prefix" }; // kontrola PŘED ořezem na 6
  // účet: české číslo → IBAN se dopočítá; IBAN zadaný rovnou se ověří; smazání účtu smaže i IBAN
  if (z.bank_account !== undefined) {
    if (!p.bank_account) { p.iban = ""; }
    else {
      const r = czIban(p.bank_account);
      if (r.error) {
        if (overIban(p.bank_account)) { p.iban = normIban(p.bank_account); p.bank_account = ""; }
        else return { chyba: r.error === "checksum" ? "err.invAccountChecksum" : "err.invAccount", pole: "bank_account" };
      } else { p.bank_account = r.ucet; p.iban = r.iban; }
    }
  } else if (z.iban !== undefined) {
    if (!p.iban) { /* smazáno */ }
    else if (!overIban(p.iban)) return { chyba: "err.invIban", pole: "iban" };
    else p.iban = normIban(p.iban);
  }
  if (p.vat_payer === undefined) p.vat_payer = false;
  if (p.vat_rate === undefined) p.vat_rate = VYCHOZI_SAZBA;
  if (p.due_days === undefined) p.due_days = VYCHOZI_SPLATNOST;
  if (!p.currency) p.currency = MENY[0];
  for (const k of Object.keys(p)) if (p[k] === "" || p[k] === null) delete p[k];
  return { profil: p };
}
function profilUloz(app, profil) {
  let rec;
  try { rec = app.findFirstRecordByFilter("instance_settings", "id != ''"); }
  catch (err) { rec = new Record(app.findCollectionByNameOrId("instance_settings")); }
  rec.set("invoicing", Object.keys(profil).length ? profil : null);
  app.save(rec);
}
// Vlastní údaje dodavatele uživatele (24. 10. 2026): záznam v `invoicing_profiles`; mají přednost před společnými
function profilVlastniZaznam(app, userId) {
  try { return app.findFirstRecordByFilter("invoicing_profiles", "user = {:u}", { u: String(userId || "") }); } catch (err) { return null; }
}
function profilVlastniNacti(app, userId) {
  const rec = profilVlastniZaznam(app, userId);
  if (!rec) return null;
  try { const p = JSON.parse(rec.getString("profil") || "null"); return p && typeof p === "object" && Object.keys(p).length ? p : null; } catch (err) { return null; }
}
function profilVlastniUloz(app, userId, profil) {
  let rec = profilVlastniZaznam(app, userId);
  if (!profil || !Object.keys(profil).length) { if (rec) app.delete(rec); return; }
  if (!rec) { rec = new Record(app.findCollectionByNameOrId("invoicing_profiles")); rec.set("user", String(userId)); }
  rec.set("profil", profil);
  app.save(rec);
}
// Profil, který platí pro faktury TOHOTO uživatele: vlastní (má-li ho), jinak společný organizace.
// `serie` = klíč číselné řady: "" společná, id uživatele vlastní.
function profilAktivni(app, auth) {
  const vlastni = auth ? profilVlastniNacti(app, auth.id) : null;
  if (vlastni) return { profil: vlastni, zdroj: "vlastni", serie: String(auth.id) };
  return { profil: profilNacti(app), zdroj: "spolecny", serie: "" };
}
function profilDto(p) {
  const out = Object.assign({ vat_payer: false, vat_rate: VYCHOZI_SAZBA, due_days: VYCHOZI_SPLATNOST, currency: MENY[0] }, p || {});
  return { profil: out, complete: profilKompletni(out), missing: profilChybi(out) };
}

// ---------- klienti ----------
function norm(s) { return require(`${HOOKS}/helpers.js`).normText(s); }
function klientDto(rec) {
  return { id: rec.id, name: rec.getString("name"), address: rec.getString("address"), ico: rec.getString("ico"), dic: rec.getString("dic"), email: rec.getString("email"), note: rec.getString("note") };
}
function klienti(app) {
  try { return app.findRecordsByFilter("clients", "id != ''", "name", MAX_SEZNAM, 0); } catch (err) { return []; }
}
// odkaz od modelu: id, PŘESNÉ jméno (bez diakritiky a velikosti písmen), jinak podřetězec („Karel“ → Karel Novák);
// víc shod = nejednoznačné → { kandidati }
function klientPodleOdkazu(app, ref) {
  const r = String(ref || "").trim();
  if (!r) return { rec: null, kandidati: [] };
  try { const rec = app.findRecordById("clients", r); if (rec) return { rec, kandidati: [] }; } catch (err) { /* není id */ }
  const n = norm(r);
  const vse = klienti(app);
  const presne = vse.filter((c) => norm(c.getString("name")) === n);
  if (presne.length === 1) return { rec: presne[0], kandidati: [] };
  if (presne.length > 1) return { rec: null, kandidati: presne };
  const slova = n.split(/\s+/).filter(Boolean);
  const cast = vse.filter((c) => { const t = norm(c.getString("name")); return slova.length && slova.every((w) => t.split(/\s+/).some((x) => x === w || x.startsWith(w))); });
  if (cast.length === 1) return { rec: cast[0], kandidati: [] };
  return { rec: null, kandidati: cast };
}
function klientSnimek(rec) {
  const out = {};
  for (const k in KLIENT_POLE) { const v = k === "address" ? vicerad(rec.getString(k), KLIENT_POLE[k]) : radek(rec.getString(k), KLIENT_POLE[k]); if (v) out[k] = v; }
  return out;
}
// založit / upravit klienta (nástroj save_client i routy): data = {name, address, ico, dic, email, note}; existující podle id
function klientUloz(app, auth, data, existing) {
  const d = data || {};
  const H = require(`${HOOKS}/helpers.js`);
  let rec = existing || null;
  if (rec && !(rec.getString("owner") === auth.id || H.jeAdmin(auth))) throw chybaS(403, "err.clientNotEditable");
  if (!rec) {
    rec = new Record(app.findCollectionByNameOrId("clients"));
    rec.set("owner", auth.id);
    rec.set("owner_email", auth.email());
  }
  if (d.name !== undefined || !existing) {
    const name = radek(d.name, KLIENT_POLE.name);
    if (!name) throw chybaS(400, "err.clientNameRequired");
    rec.set("name", name);
  }
  if (d.address !== undefined) rec.set("address", vicerad(d.address, KLIENT_POLE.address));
  for (const k of ["ico", "dic"]) if (d[k] !== undefined) rec.set(k, radek(d[k], KLIENT_POLE[k]).replace(/\s+/g, "")); // jedna pravda s předkontrolou save_client (mezery pryč)
  if (d.email !== undefined) {
    const em = radek(d.email, KLIENT_POLE.email);
    if (em && !jeMail(em)) throw chybaS(400, "err.invEmail");
    rec.set("email", em);
  }
  if (d.note !== undefined) rec.set("note", ocisti(d.note, 2000));
  if (rec.getString("ico") && !/^\d{1,12}$/.test(rec.getString("ico"))) throw chybaS(400, "err.invIco");
  app.save(rec);
  return rec;
}

// ---------- faktury ----------
function jeVlastnikNeboAdmin(auth, rec) {
  const H = require(`${HOOKS}/helpers.js`);
  return rec.getString("user") === auth.id || H.jeAdmin(auth);
}
function najdi(app, auth, id) {
  if (!id) return null;
  let rec;
  try { rec = app.findRecordById("invoices", String(id)); } catch (err) { return null; }
  return jeVlastnikNeboAdmin(auth, rec) ? rec : null;
}
function seznam(app, auth, opt) {
  const o = opt || {};
  const H = require(`${HOOKS}/helpers.js`);
  const params = {};
  const f = [];
  if (!H.jeAdmin(auth)) { params.u = auth.id; f.push("user = {:u}"); }
  if (o.year) { params.y = Number(o.year); f.push("year = {:y}"); }
  if (o.unpaid) f.push("paid_on = ''");
  const limit = Math.max(1, Math.min(MAX_SEZNAM, parseInt(o.limit, 10) || MAX_SEZNAM));
  try { return app.findRecordsByFilter("invoices", f.length ? f.join(" && ") : "id != ''", "-year,-number", limit, 0, params); } catch (err) { return []; }
}
function jsonPole(rec, pole, def) { const { jsonVal } = require(`${HOOKS}/helpers.js`); return jsonVal(rec, pole, def); }
function dto(rec, cely) {
  const out = {
    id: rec.id, cislo: rec.getString("cislo"), year: Number(rec.get("year")) || 0, number: Number(rec.get("number")) || 0,
    issued: rec.getString("issued"), due: rec.getString("due"), total: Number(rec.get("total")) || 0, currency: rec.getString("currency") || "CZK",
    paid_on: rec.getString("paid_on"), client: rec.getString("client"), customer_name: (jsonPole(rec, "customer", {}) || {}).name || "",
    user: rec.getString("user"), created: rec.getString("created"), serie: rec.getString("serie") ? "vlastni" : "spolecny",
  };
  if (cely) {
    out.supplier = jsonPole(rec, "supplier", {}) || {};
    out.customer = jsonPole(rec, "customer", {}) || {};
    out.items = jsonPole(rec, "items", []) || [];
    out.vat_payer = rec.getBool("vat_payer");
    out.vat_rate = Number(rec.get("vat_rate")) || 0;
    out.subtotal = Number(rec.get("subtotal")) || 0;
    out.vat = Number(rec.get("vat")) || 0;
    out.note = rec.getString("note");
    out.chat = rec.getString("chat");
    out.vs = variabilni(slozCislo("", out.year, out.number));
    out.spayd = spayd(out);
  }
  return out;
}
// číslo = prefix + rok + pořadí na 4 místa (20260001); řada na instanci a rok (serie "") NEBO na uživatele s vlastním
// profilem (serie = id), bez děr: MAX+1 v transakci,
// unikátní index chytí souběh (druhé okno) → opakovat (max 3×)
function dalsiCislo(tx, year, serie) {
  const row = new DynamicModel({ m: 0 });
  tx.db().newQuery("SELECT IFNULL(MAX(number), 0) AS m FROM invoices WHERE year = {:y} AND serie = {:s}").bind({ y: year, s: String(serie || "") }).one(row);
  return Number(row.m) + 1;
}
const slozCislo = (prefix, year, n) => `${prefix || ""}${year}${String(n).padStart(4, "0")}`;
// vystavit fakturu: data = {client_id, items (validované), due?, note?, vat_rate?}; profil dodavatele musí být kompletní
function vystav(app, auth, data, opt) {
  const o = opt || {};
  const d = data || {};
  const akt = profilAktivni(app, auth);
  const profil = akt.profil;
  if (!profilKompletni(profil)) throw chybaS(400, "err.invProfileIncomplete", { missing: profilChybi(profil).join(", ") });
  let klient;
  try { klient = app.findRecordById("clients", String(d.client_id || "")); } catch (err) { throw chybaS(404, "err.clientNotFound"); }
  const v = validujPolozky(d.items);
  if (v.error) throw chybaS(400, "err.invItems", { detail: v.error });
  const vatPayer = !!profil.vat_payer;
  const sazba = d.vat_rate !== undefined && d.vat_rate !== null && d.vat_rate !== "" ? Number(d.vat_rate) : Number(profil.vat_rate === undefined ? VYCHOZI_SAZBA : profil.vat_rate);
  if (vatPayer && (!Number.isFinite(sazba) || sazba < 0 || sazba > 100)) throw chybaS(400, "err.invVatRate");
  const { dnes } = require(`${HOOKS}/chat-spolecne.js`);
  const issued = jeDen(d.issued) ? String(d.issued) : dnes();
  const due = jeDen(d.due) ? String(d.due) : datumPlus(issued, Number(profil.due_days === undefined ? VYCHOZI_SPLATNOST : profil.due_days));
  if (due < issued) throw chybaS(400, "err.invDueBeforeIssued");
  let pocet = 0;
  try { pocet = app.countRecords("invoices", $dbx.hashExp({})); } catch (err) { pocet = 0; }
  if (pocet >= MAX_FAKTUR) throw chybaS(400, "err.invLimit", { max: MAX_FAKTUR });
  const s = soucty(v.items, vatPayer, sazba);
  const year = Number(issued.slice(0, 4));
  const col = app.findCollectionByNameOrId("invoices");
  let rec = null;
  let posledni = null;
  for (let pokus = 0; pokus < 3 && !rec; pokus++) {
    try {
      app.runInTransaction((tx) => {
        const n = dalsiCislo(tx, year, akt.serie);
        const r = new Record(col);
        r.set("user", auth.id);
        r.set("serie", akt.serie);
        r.set("client", klient.id);
        r.set("cislo", slozCislo(profil.prefix, year, n));
        r.set("year", year);
        r.set("number", n);
        r.set("issued", issued);
        r.set("due", due);
        r.set("supplier", profil);
        r.set("customer", klientSnimek(klient));
        r.set("items", v.items);
        r.set("vat_payer", vatPayer);
        r.set("vat_rate", s.vat_rate);
        r.set("subtotal", s.subtotal);
        r.set("vat", s.vat);
        r.set("total", s.total);
        r.set("currency", profil.currency || "CZK");
        r.set("note", vicerad(d.note, MAX_POZNAMKA));
        r.set("chat", ocisti(o.chat, 40));
        tx.save(r);
        rec = r;
      });
    } catch (err) {
      posledni = err;
      rec = null;
      if (!/UNIQUE|unique|idx_invoices_rada/.test(String(err && err.message ? err.message : err))) throw err;
    }
  }
  if (!rec) throw posledni || chybaS(500, "err.invNumbering");
  return rec;
}
function zaplaceno(app, auth, id, kdy) {
  const rec = najdi(app, auth, id);
  if (!rec) throw chybaS(404, "err.invNotFound");
  if (kdy === false || kdy === "" || kdy === null) rec.set("paid_on", "");
  else { const { dnes } = require(`${HOOKS}/chat-spolecne.js`); rec.set("paid_on", jeDen(kdy) ? String(kdy) : dnes()); }
  app.save(rec);
  return rec;
}
// faktury vzniklé v novém rozhovoru dřív, než měl rozhovor id (vzor dokumenty.doplnChat)
function doplnChat(app, ids, chatId) {
  for (const id of ids || []) {
    try { const rec = app.findRecordById("invoices", id); if (!rec.getString("chat")) { rec.set("chat", chatId); app.save(rec); } } catch (err) { /* nic */ }
  }
}
function odpovedChyby(e, err) {
  const { t, userLang } = require(`${HOOKS}/i18n.js`);
  if (err && err.klic) return e.json(err.status || 400, { error: t(userLang(e.auth), err.klic, err.params || {}) });
  throw err;
}

module.exports = {
  MAX_FAKTUR, MAX_POLOZEK, MAX_POPIS, MAX_POZNAMKA, MENY, VYCHOZI_SAZBA, VYCHOZI_SPLATNOST, PROFIL_POLE, KLIENT_POLE,
  czIban, overIban, mod11, mod97, spayd, variabilni, validujPolozky, soucty, castka, datumPlus, bezDiakritiky,
  profilNacti, profilKompletni, profilChybi, profilOcisti, profilUloz, profilDto, profilVlastniNacti, profilVlastniUloz, profilAktivni,
  klientDto, klienti, klientPodleOdkazu, klientSnimek, klientUloz,
  najdi, seznam, dto, vystav, zaplaceno, doplnChat, odpovedChyby, slozCislo, chybaS, jeDen, round2,
};
