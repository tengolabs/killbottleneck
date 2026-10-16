// Jádro UDÁLOSTÍ (events) a PŘIPOMÍNEK K UZLŮM (node_reminders) — JEDNO pro
// session routy (/events*, /node-reminders*), v1 API (/v1/events*,
// /v1/maps/{id}/nodes/{nodeId}/reminders*) i asistenta (přes v1 dočasným klíčem).
// Vzor rules-api.js: každá funkce vrací { status, body } — routa jen
// `e.json(r.status, r.body)`. Autentizaci řeší volající, sem přijde hotový
// uživatel (Record z users — session e.auth nebo vlastník API klíče).
//
// Model (19. 9. 2026, migrace 1789820000): událost = osobní položka kalendáře
// s časem, NENÍ úkol a nikdy se nesype do mapy. Připomínka k uzlu je per-user,
// RELATIVNÍ k termínu (offset_days + time) a termín NIKDY nemění.
// Čas = lokální čas instance (env TZ), řetězce YYYY-MM-DD + HH:MM.
//
// ⚠️ PocketBase JSVM: soubor se načítá přes require() uvnitř handlerů.

//
// TÝMOVÝ KALENDÁŘ (14. 10. 2026, migrace 1792001003): událost může ležet ve
// SDÍLENÉM kalendáři (`calendar`: firemní / zasedačka / nepřítomnosti) — pak ji
// vidí každý člen instance. Konec (`end_day`, `end_time`) dává dovolené rozsah dní
// a rezervaci místnosti délku. Práva drží JEDINÁ funkce pravaUdalosti: osobní
// událost mění jen autor; sdílenou autor + správce/manažer; nepřítomnost i ten,
// koho se týká. Zdroj (resource) odmítá překryv (najdiKolizi → 409 + next_free).

const EVENT_FIELDS = ["title", "day", "time", "note", "participants", "remind", "remind_before_min", "calendar", "end_day", "end_time"];
const CALENDAR_FIELDS = ["name", "kind", "color", "description", "write_access", "needs_approval", "archived", "visibility", "members"];
const CALENDAR_KINDS = ["shared", "resource", "absence"];
const NODE_REMINDER_FIELDS = ["offset_days", "time"];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_PARTICIPANTS = 50;
const MAX_REMIND_MIN = 10080; // týden
const DEFAULT_REMIND_MIN = 30;
const DEFAULT_RESOURCE_MIN = 60; // rezervace bez konce = hodina
const MAX_OFFSET_DAYS = 30;
const MAX_CALENDARS = 100;
// strop výpisu událostí v okně (dřív 1000: zasedačka 3×/den + firemní + nepřítomnosti by za rok tiše schovaly nejbližší budoucí)
const MAX_EVENTS_LIST = 3000;
const RESOURCE_DAY_END = "20:00"; // do kdy hledat náhradní volný čas téhož dne

// platný kalendářní den (regex pustí 2026-13-45)
function validDay(s) {
  if (!DAY_RE.test(String(s || ""))) return false;
  const [y, m, d] = String(s).split("-").map(Number);
  const x = new Date(y, m - 1, d);
  return x.getFullYear() === y && x.getMonth() === m - 1 && x.getDate() === d;
}

// den + n dní (záporné = zpět)
function dayPlusDays(day, n) {
  return require(`${__hooks}/helpers.js`).dayMinusDays(day, -Number(n || 0));
}
// rozdíl dnů b − a pro řetězce YYYY-MM-DD
function dayDiff(a, b) {
  const p = (s) => { const [y, m, d] = String(s).split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 86400000);
}

// ---------- sdílené kalendáře ----------

// Viditelnost kalendáře (Richard 15. 10. 2026, „jako naše projekty“): all = celý tým; members = jen vybraní
// členové + zakladatel + správce (role admin). user = Record uživatele; bez něj = bez filtru (server sám).
function kalendarViditelny(user, cal) {
  if (!cal) return true;
  if (!user) return true;
  if (cal.getString("visibility") !== "members") return true;
  if (cal.getString("created_by") === user.id) return true;
  // jako soukromý projekt: ani správce nevidí kalendář, kde není členem ani zakladatelem (Richard 15. 10. 2026)
  return (cal.get("members") || []).indexOf(user.id) >= 0;
}

// všechny kalendáře instance jedním dotazem: mapa id → záznam (max 100 na instanci);
// s `user` jen ty, které smí vidět
function kalendareMapa(app, user) {
  const out = {};
  let rows = [];
  try { rows = app.findRecordsByFilter("calendars", "id != ''", "name", MAX_CALENDARS + 1, 0); } catch (err) { rows = []; }
  for (const r of rows) if (!user || kalendarViditelny(user, r)) out[r.id] = r;
  return out;
}

// kalendář podle id NEBO názvu (bez ohledu na velikost písmen a diakritiku,
// jako podleNazvu v chat-spolecne) — asistent i MCP posílají název.
// opts.jenId = jen přesné id (routa save); opts.user = jen kalendáře, které uživatel vidí. Nic/nejednoznačné = null.
function kalendarZaznam(app, ref, opts) {
  const id = String(ref || "").trim();
  if (!id) return null;
  const user = opts && opts.user;
  try { const r = app.findRecordById("calendars", id); if (r) return kalendarViditelny(user, r) ? r : null; } catch (err) { /* není id */ }
  if (opts && opts.jenId) return null;
  const { normText } = require(`${__hooks}/helpers.js`);
  const n = normText(id);
  if (!n) return null;
  const rows = Object.values(kalendareMapa(app, user));
  const presne = rows.filter((r) => normText(r.getString("name")) === n);
  if (presne.length === 1) return presne[0];
  if (presne.length > 1 || (opts && opts.presne)) return null;
  const cast = rows.filter((r) => { const x = normText(r.getString("name")); return x.includes(n) || (x.length >= 3 && n.includes(x)); });
  return cast.length === 1 ? cast[0] : null;
}

function jeSpravce(user) {
  return require(`${__hooks}/helpers.js`).jeAdminNeboManazer(user);
}

// smí uživatel do kalendáře ZAPISOVAT nové události? ({ ok } nebo { error: {status, body} })
function smiZapisovat(user, cal, lang) {
  const { t } = require(`${__hooks}/i18n.js`);
  const name = cal.getString("name");
  if (cal.getBool("archived")) return { error: { status: 400, body: { error: t(lang, "err.calendarArchived", { name: name }) } } };
  if (cal.getString("write_access") === "admins" && !jeSpravce(user)) return { error: { status: 403, body: { error: t(lang, "err.calendarWriteDenied", { name: name }) } } };
  return { ok: true };
}

// JEDINÝ zdroj práv k události. cal = záznam kalendáře nebo null (osobní).
//   vidi: autor, účastník, nebo kdokoli u události ve sdíleném kalendáři (jako RLS)
//   meni: autor; u sdíleného kalendáře i správce/manažer; u nepřítomnosti i ten, koho se týká
function pravaUdalosti(user, rec, cal) {
  const parts = rec.get("participants") || [];
  const autor = rec.getString("owner") === user.id;
  const ucastnik = parts.indexOf(user.id) >= 0;
  const vidi = autor || ucastnik || (!!cal && kalendarViditelny(user, cal));
  let meni = autor;
  if (cal && jeSpravce(user)) meni = true;
  if (cal && cal.getString("kind") === "absence" && ucastnik) meni = true;
  // kdo událost nevidí (skrytý kalendář), ji ani nemění — i kdyby ji někdo načetl mimo findEvent
  meni = meni && vidi;
  return { vidi: vidi, meni: meni, autor: autor, ucastnik: ucastnik };
}

function calendarDto(rec, user, app) {
  const archived = rec.getBool("archived");
  const admins = rec.getString("write_access") === "admins";
  const clenove = rec.get("members") || [];
  return {
    id: rec.id,
    name: rec.getString("name"),
    kind: rec.getString("kind"),
    color: rec.getString("color"),
    description: rec.getString("description"),
    visibility: rec.getString("visibility") === "members" ? "members" : "all",
    members: app && clenove.length ? usersByIds(app, clenove).map((u) => u.getString("email")) : [],
    write_access: admins ? "admins" : "all",
    needs_approval: rec.getBool("needs_approval"),
    archived: archived,
    can_write: !archived && (!admins || jeSpravce(user)),
    can_manage: jeSpravce(user),
    events_count: app ? pocetUdalostiKalendare(app, rec.id) : undefined,
    created: rec.getString("created"),
    updated: rec.getString("updated"),
  };
}

function listCalendars(app, user) {
  const rows = Object.values(kalendareMapa(app, user));
  rows.sort((a, b) => a.getString("name").localeCompare(b.getString("name")));
  return { status: 200, body: { calendars: rows.map((r) => calendarDto(r, user, app)) } };
}

// založení (rec = null) nebo úprava — jen admin/manager. Druh se po založení nemění.
function saveCalendar(app, user, rec, info, ctx) {
  const { t } = require(`${__hooks}/i18n.js`);
  const { normText } = require(`${__hooks}/helpers.js`);
  const lang = ctx.lang;
  if (!jeSpravce(user)) return { status: 403, body: { error: t(lang, "err.calendarAdminOnly") } };
  // manažer bez členství kalendář „jen pro vybrané“ nevidí → ani nemění (jako soukromý projekt)
  if (rec && !kalendarViditelny(user, rec)) return { status: 404, body: { error: t(lang, "err.calendarNotFound", { name: rec.getString("name") }) } };
  const creating = !rec;
  const data = {};
  let memberIds = null;
  if (info.visibility !== undefined) {
    const v = String(info.visibility || "all");
    if (v !== "all" && v !== "members") return { status: 400, body: { error: t(lang, "err.calendarVisibility") } };
    data.visibility = v;
  }
  if (info.members !== undefined) {
    if (!Array.isArray(info.members)) return { status: 400, body: { error: t(lang, "err.participantsArray") } };
    if (info.members.length > 200) return { status: 400, body: { error: t(lang, "err.participantsMany", { max: 200 }) } };
    const p = resolveParticipants(app, info.members, user.id, lang, { keepOwner: true });
    if (p.error) return { status: 400, body: { error: p.error } };
    memberIds = p.ids;
    // kdo kalendář zužuje na vybrané, v něm zůstane — správce, který není zakladatel, by si ho jinak sám schoval
    const zakladatel = rec ? rec.getString("created_by") : user.id;
    if (zakladatel !== user.id && memberIds.indexOf(user.id) < 0) memberIds.push(user.id);
  }
  if (info.name !== undefined || creating) {
    const name = String(info.name || "").trim();
    if (!name) return { status: 400, body: { error: t(lang, "err.calendarNameRequired") } };
    if (name.length > 80) return { status: 400, body: { error: t(lang, "err.calendarNameLong") } };
    const n = normText(name);
    const stejny = Object.values(kalendareMapa(app)).find((r) => (!rec || r.id !== rec.id) && normText(r.getString("name")) === n);
    if (stejny) return { status: 400, body: { error: t(lang, "err.calendarNameTaken", { name: stejny.getString("name") }) } };
    data.name = name;
  }
  if (creating) {
    const kind = String(info.kind || "").trim();
    if (CALENDAR_KINDS.indexOf(kind) < 0) return { status: 400, body: { error: t(lang, "err.calendarKind") } };
    data.kind = kind;
  } else if (info.kind !== undefined && String(info.kind) !== rec.getString("kind")) {
    return { status: 400, body: { error: t(lang, "err.calendarKindFixed") } };
  }
  if (info.color !== undefined) {
    const color = String(info.color || "").trim();
    if (color && !COLOR_RE.test(color)) return { status: 400, body: { error: t(lang, "err.calendarColor") } };
    data.color = color;
  }
  if (info.description !== undefined) {
    const d = String(info.description || "");
    if (d.length > 500) return { status: 400, body: { error: t(lang, "err.calendarDescriptionLong") } };
    data.description = d;
  }
  if (info.write_access !== undefined) {
    const w = String(info.write_access || "all");
    if (w !== "all" && w !== "admins") return { status: 400, body: { error: t(lang, "err.calendarWriteAccess") } };
    data.write_access = w;
  }
  if (info.needs_approval !== undefined) data.needs_approval = !!info.needs_approval;
  if (info.archived !== undefined) data.archived = !!info.archived;
  if (creating) {
    if (Object.keys(kalendareMapa(app)).length >= MAX_CALENDARS) return { status: 400, body: { error: t(lang, "err.calendarLimit", { max: MAX_CALENDARS }) } };
    rec = new Record(app.findCollectionByNameOrId("calendars"));
    rec.set("created_by", user.id);
    rec.set("write_access", "all");
    rec.set("color", "");
    rec.set("description", "");
    rec.set("visibility", "all");
  }
  for (const k of Object.keys(data)) rec.set(k, data[k]);
  if (memberIds) rec.set("members", memberIds);
  app.save(rec);
  return { status: 200, body: { calendar: calendarDto(rec, user, app) } };
}

// Smazání kalendáře (Richard 15. 10. 2026: „už ho neumím smazat“): správce/manažer, jen viditelný;
// smaže i VŠECHNY jeho události (dialog počet ukáže a chce potvrzení). Archivace zůstává jako měkká cesta.
function deleteCalendar(app, user, rec, lang) {
  const { t } = require(`${__hooks}/i18n.js`);
  if (!jeSpravce(user)) return { status: 403, body: { error: t(lang, "err.calendarAdminOnly") } };
  if (!kalendarViditelny(user, rec)) return { status: 404, body: { error: t(lang, "err.calendarNotFound", { name: rec.getString("name") }) } };
  let udalosti = [];
  try { udalosti = app.findRecordsByFilter("events", "calendar = {:c}", "", 5000, 0, { c: rec.id }); } catch (err) { udalosti = []; }
  for (const ev of udalosti) { try { app.delete(ev); } catch (err) { /* další */ } }
  app.delete(rec);
  return { status: 200, body: { success: true, events_deleted: udalosti.length } };
}

// Výchozí sdílené kalendáře nové instance (Richard 15. 10. 2026: „když se založí nová
// firma, je nějaký kalendář defaultně?“ → ano): první správce dostane „Firemní“ (shared)
// a „Nepřítomnosti“ (absence) v jazyce své registrace — zasedačku ne, tu každá firma nemá
// (zůstává předvolbou ve Správě organizace). Celý tým vidí, zapisuje každý, schvalování
// vypnuté. Kdo je nechce, archivuje/smaže jedním klikem. Idempotentní: zakládá se jen
// do prázdné kolekce (obnova ze zálohy ani další registrace nic nezdvojí). Vypíná
// KB_UVODNI_MAPA=0 (= „nový účet začíná prázdný“, používají i testy, které zakládají
// „Firemní“ ručně).
const VYCHOZI_KALENDARE = [
  { kind: "shared", color: "#6366f1", name: { cs: "Firemní", en: "Company" } },
  { kind: "absence", color: "#14b8a6", name: { cs: "Nepřítomnosti", en: "Time off" } },
];
function zalozVychoziKalendare(app, user) {
  const { env } = require(`${__hooks}/helpers.js`);
  if ((env("UVODNI_MAPA") || "").trim() === "0") return [];
  if (!user || (user.getString("role") || "") !== "admin") return [];
  if (Object.keys(kalendareMapa(app)).length > 0) return [];
  const { userLang } = require(`${__hooks}/i18n.js`);
  const lang = userLang(user);
  const col = app.findCollectionByNameOrId("calendars");
  const out = [];
  for (const def of VYCHOZI_KALENDARE) {
    const rec = new Record(col);
    rec.set("name", def.name[lang] || def.name.cs);
    rec.set("kind", def.kind);
    rec.set("color", def.color);
    rec.set("write_access", "all");
    rec.set("visibility", "all");
    rec.set("needs_approval", false);
    rec.set("archived", false);
    rec.set("created_by", user.id);
    app.save(rec);
    out.push(rec);
  }
  return out;
}

// kolik událostí kalendář má (pro potvrzení smazání)
function pocetUdalostiKalendare(app, calId) {
  try { return app.countRecords("events", $dbx.hashExp({ calendar: calId })); } catch (err) { return 0; }
}

// kdo je pryč v okně dní (nepřítomnosti, které nečekají na schválení a nebyly
// zamítnuty). Jeden řádek na člověka a událost; řazeno od začátku.
function whoIsAway(app, from, to, user) {
  const kal = kalendareMapa(app, user);
  const absence = Object.keys(kal).filter((id) => kal[id].getString("kind") === "absence" && !kal[id].getBool("archived"));
  if (!absence.length) return [];
  let rows = [];
  // jen kalendáře nepřítomností už v dotazu — rušná zasedačka by jinak do stropu vytlačila dovolené
  const params = { from: from, to: to };
  const kalFiltr = absence.map((id, i) => { params["c" + i] = id; return "calendar = {:c" + i + "}"; }).join(" || ");
  try {
    rows = app.findRecordsByFilter("events",
      "(" + kalFiltr + ') && day <= {:to} && (end_day >= {:from} || day >= {:from})',
      "day,time", MAX_EVENTS_LIST, 0, params);
  } catch (err) { rows = []; }
  rows = rows.filter((r) => r.getString("status") !== "requested" && r.getString("status") !== "rejected");
  const ids = new Set();
  for (const r of rows) { ids.add(r.getString("owner")); for (const p of r.get("participants") || []) ids.add(p); }
  const emaily = {};
  for (const u of usersByIds(app, Array.from(ids))) emaily[u.id] = u.getString("email");
  const out = [];
  for (const r of rows) {
    const away = (r.get("participants") || []).length ? r.get("participants") : [r.getString("owner")];
    for (const uid of away) {
      if (!emaily[uid]) continue;
      out.push({ email: emaily[uid], from: r.getString("day"), to: r.getString("end_day") || r.getString("day"),
        title: r.getString("title"), calendar: kal[r.getString("calendar")].getString("name"), event_id: r.id });
    }
  }
  out.sort((a, b) => (a.from + a.email).localeCompare(b.from + b.email));
  return out;
}

function listAway(app, q, user) {
  const { addDaysStr } = require(`${__hooks}/helpers.js`);
  const now = new Date();
  const from = validDay(q && q.from) ? String(q.from) : addDaysStr(now, 0);
  const to = validDay(q && q.to) ? String(q.to) : addDaysStr(now, 14);
  return { status: 200, body: { away: whoIsAway(app, from, to, user), from: from, to: to } };
}

// ---------- události ----------

// Validace vstupu (create: rec = null → title+day povinné; update: jen co přišlo).
// Vrací { data } (jen pole, která se mají zapsat) nebo { error }.
// `calendar` projde syrově (id/název), rozřeší ho saveEvent; vztah začátek/konec
// kontroluje checkEventRange nad SLOUČENÝMI hodnotami (update může přijít jen s end_day).
function validateEvent(info, lang, rec) {
  const { t } = require(`${__hooks}/i18n.js`);
  const data = {};
  const creating = !rec;
  if (info.title !== undefined || creating) {
    const title = String(info.title || "").trim();
    if (!title) return { error: t(lang, "err.eventTitleRequired") };
    if (title.length > 200) return { error: t(lang, "err.eventTitleLong") };
    data.title = title;
  }
  if (info.day !== undefined || creating) {
    const day = String(info.day || "").trim();
    if (!validDay(day)) return { error: t(lang, "err.badDay", { value: day.slice(0, 40) }) };
    data.day = day;
  }
  if (info.time !== undefined) {
    const time = String(info.time || "").trim();
    if (time && !TIME_RE.test(time)) return { error: t(lang, "err.badTime", { value: time.slice(0, 40) }) };
    data.time = time;
  }
  if (info.note !== undefined) {
    const note = String(info.note || "");
    if (note.length > 2000) return { error: t(lang, "err.eventNoteLong") };
    data.note = note;
  }
  if (info.remind !== undefined) data.remind = !!info.remind;
  if (info.remind_before_min !== undefined) {
    const n = Number(info.remind_before_min);
    if (!Number.isInteger(n) || n < 0 || n > MAX_REMIND_MIN) return { error: t(lang, "err.badRemindMin", { max: MAX_REMIND_MIN }) };
    data.remind_before_min = n;
    // „30 min předem" bez výslovného remind = připomínku chci
    if (info.remind === undefined && creating) data.remind = true;
  }
  // zapnutí připomínky bez předstihu = výchozích 30 min (i při úpravě, ne jen při založení)
  if (data.remind && data.remind_before_min === undefined && (creating || !(rec && rec.getBool("remind")))) data.remind_before_min = DEFAULT_REMIND_MIN;
  if (info.participants !== undefined) {
    if (!Array.isArray(info.participants)) return { error: t(lang, "err.participantsArray") };
    if (info.participants.length > MAX_PARTICIPANTS) return { error: t(lang, "err.participantsMany", { max: MAX_PARTICIPANTS }) };
    data.participants = info.participants.map((p) => String(p || "").trim()).filter(Boolean);
  }
  if (info.end_day !== undefined) {
    const ed = String(info.end_day || "").trim();
    if (ed && !validDay(ed)) return { error: t(lang, "err.badEndDay", { value: ed.slice(0, 40) }) };
    data.end_day = ed;
  }
  if (info.end_time !== undefined) {
    const et = String(info.end_time || "").trim();
    if (et && !TIME_RE.test(et)) return { error: t(lang, "err.badTime", { value: et.slice(0, 40) }) };
    data.end_time = et;
  }
  if (info.calendar !== undefined) data.calendar = String(info.calendar || "").trim();
  return { data: data };
}

// Vztah začátek × konec nad SLOUČENÝMI hodnotami { day, time, end_day, end_time }
// + pravidla druhu kalendáře (zdroj = s časem; bez konce = +60 min).
// Vrací { data: doplněné hodnoty } nebo { error }.
function checkEventRange(eff, cal, lang) {
  const { t } = require(`${__hooks}/i18n.js`);
  const H = require(`${__hooks}/helpers.js`);
  const out = { day: eff.day, time: eff.time || "", end_day: eff.end_day || "", end_time: eff.end_time || "" };
  const kind = cal ? cal.getString("kind") : "";
  if (kind === "resource") {
    if (!out.time) return { error: t(lang, "err.resourceNeedsTime", { name: cal.getString("name") }) };
    if (!out.end_time) {
      const konec = H.minusMinutes(out.day, out.time, -DEFAULT_RESOURCE_MIN).split(" ");
      if (konec[0] !== out.day) out.end_day = konec[0];
      out.end_time = konec[1];
    }
  }
  if (out.end_time && !out.time) return { error: t(lang, "err.endTimeNeedsTime") };
  if (out.end_day && out.end_day === out.day) out.end_day = ""; // konec v týž den = bez end_day
  if (out.end_day && out.end_day < out.day) return { error: t(lang, "err.endBeforeStart", { start: out.day, end: out.end_day }) };
  if (!out.end_day && out.end_time && out.end_time <= out.time) return { error: t(lang, "err.endBeforeStart", { start: out.time, end: out.end_time }) };
  return { data: out };
}

// "YYYY-MM-DD HH:MM" začátku a konce události (celodenní = 00:00 … 23:59 posledního dne)
function rozsahUdalosti(r) {
  const day = r.day !== undefined ? r.day : r.getString("day");
  const time = r.time !== undefined ? r.time : r.getString("time");
  const endDay = (r.end_day !== undefined ? r.end_day : r.getString("end_day")) || day;
  const endTime = r.end_time !== undefined ? r.end_time : r.getString("end_time");
  return { od: day + " " + (time || "00:00"), do: endDay + " " + (endTime || (time ? time : "23:59")) };
}

// překryv s jinou událostí TÉHOŽ kalendáře (zdroj). Vrací kolidující záznam nebo null
// + návrh prvního volného času téhož dne (next_free) — řetězcové porovnání jako cron.
function najdiKolizi(app, calId, eff, selfId) {
  const H = require(`${__hooks}/helpers.js`);
  const ja = rozsahUdalosti(eff);
  let rows = [];
  try {
    rows = app.findRecordsByFilter("events",
      "calendar = {:c} && day <= {:to} && (end_day >= {:from} || day >= {:from}) && id != {:self}",
      "day,time", 200, 0, { c: calId, from: eff.day, to: eff.end_day || eff.day, self: String(selfId || "-") });
  } catch (err) { rows = []; }
  const obsazene = rows.map((r) => ({ rec: r, r: rozsahUdalosti(r) })).filter((x) => x.r.od < ja.do && ja.od < x.r.do);
  if (!obsazene.length) return null;
  obsazene.sort((a, b) => a.r.od.localeCompare(b.r.od));
  // next_free: první mezera téhož dne po požadovaném začátku, do RESOURCE_DAY_END
  let nextFree = null;
  if (eff.time && eff.end_time && !eff.end_day) {
    const delka = Math.round((Date.parse("2000-01-01T" + eff.end_time + ":00Z") - Date.parse("2000-01-01T" + eff.time + ":00Z")) / 60000);
    const dnes = rows.map(rozsahUdalosti).filter((x) => x.od.slice(0, 10) <= eff.day && x.do.slice(0, 10) >= eff.day)
      .map((x) => ({ od: x.od.slice(0, 10) < eff.day ? "00:00" : x.od.slice(11), do: x.do.slice(0, 10) > eff.day ? "23:59" : x.do.slice(11) }))
      .sort((a, b) => a.od.localeCompare(b.od));
    let start = eff.time;
    for (let i = 0; i < 50 && !nextFree; i++) {
      const konec = H.minusMinutes(eff.day, start, -delka).split(" ");
      if (konec[0] !== eff.day || konec[1] > RESOURCE_DAY_END) break;
      const blok = dnes.find((x) => x.od < konec[1] && start < x.do);
      if (!blok) nextFree = { day: eff.day, time: start, end_time: konec[1] };
      else start = blok.do;
    }
  }
  return { rec: obsazene[0].rec, next_free: nextFree };
}

// E-maily účastníků → id uživatelů. Jen EXISTUJÍCÍ účty instance (relace to vynucuje);
// externí kontakty ani neregistrovaní ne — pozvánka ven je synchronizace kalendáře,
// ne fáze 1. Shoda jako resolveOwner: nejdřív PŘESNĚ (Dup@x.cz ≠ dup@x.cz mohou být
// dva účty), pak bez ohledu na velikost písmen, víc shod = nejednoznačné.
// Vlastník se z účastníků tiše vyřadí (opts.keepOwner = ne — u nepřítomnosti
// znamenají účastníci „kdo je pryč“ a autor tam patřit může). Vrací { ids, emails } nebo { error }.
function resolveParticipants(app, emails, ownerId, lang, opts) {
  const keepOwner = !!(opts && opts.keepOwner);
  const { t } = require(`${__hooks}/i18n.js`);
  const { isExternalOwner } = require(`${__hooks}/helpers.js`);
  const ids = [];
  const out = [];
  let all = null;
  for (const raw of emails || []) {
    const v = String(raw || "").trim();
    if (!v) continue;
    if (isExternalOwner(v)) return { error: t(lang, "err.participantExternal", { email: v.slice(0, 120) }) };
    let u = null;
    try { u = app.findFirstRecordByFilter("users", "email = {:e}", { e: v }); } catch (err) { u = null; }
    if (!u) {
      if (!all) {
        try { all = app.findRecordsByFilter("users", "id != ''", "email", 500, 0); } catch (err) { all = []; }
      }
      const lower = v.toLowerCase();
      const shody = all.filter((x) => x.getString("email").toLowerCase() === lower);
      if (shody.length > 1) return { error: t(lang, "err.ownerAmbiguous", { owner: v.slice(0, 120), list: shody.map((x) => x.getString("email")).join(", ") }) };
      if (shody.length === 1) u = shody[0];
    }
    if (!u) return { error: t(lang, "err.participantUnknown", { email: v.slice(0, 120), hint: t(lang, "err.ownerHintList") }) };
    if ((u.id === ownerId && !keepOwner) || ids.indexOf(u.id) >= 0) continue;
    ids.push(u.id);
    out.push(u.getString("email"));
  }
  return { ids: ids, emails: out };
}

function usersByIds(app, ids) {
  if (!ids || !ids.length) return [];
  try { return app.findRecordsByIds("users", ids); } catch (err) { return []; }
}

// u = Record uživatele (práva → can_edit) nebo jen jeho id (export, starší volající → can_edit = autor).
// emaily = volitelná mapa id → e-mail (listEvents ji předpočítá jedním dotazem, jinak N+1);
// kal = volitelná mapa id → kalendář (jinak jeden dotaz).
function eventDto(app, rec, u, emaily, kal) {
  const user = typeof u === "string" ? null : u;
  const userId = user ? user.id : String(u || "");
  const ids = rec.get("participants") || [];
  const parts = emaily ? ids.map((id) => emaily[id]).filter(Boolean) : usersByIds(app, ids).map((x) => x.getString("email"));
  let ownerEmail = emaily ? (emaily[rec.getString("owner")] || "") : "";
  if (!ownerEmail) { try { ownerEmail = app.findRecordById("users", rec.getString("owner")).getString("email"); } catch (err) { /* smazaný účet */ } }
  const calId = rec.getString("calendar");
  let cal = null;
  if (calId) {
    if (kal) cal = kal[calId] || null;
    else { try { cal = app.findRecordById("calendars", calId); } catch (err) { cal = null; } }
  }
  const kind = cal ? cal.getString("kind") : "";
  const mine = rec.getString("owner") === userId;
  const prava = user ? pravaUdalosti(user, rec, cal) : { meni: mine };
  const out = {
    id: rec.id,
    title: rec.getString("title"),
    day: rec.getString("day"),
    time: rec.getString("time"),
    end_day: rec.getString("end_day"),
    end_time: rec.getString("end_time"),
    note: rec.getString("note"),
    owner_email: ownerEmail,
    participants: parts,
    remind: rec.getBool("remind"),
    remind_before_min: Number(rec.get("remind_before_min")) || 0,
    calendar: calId,
    calendar_name: cal ? cal.getString("name") : "",
    kind: kind,
    mine: mine,
    can_edit: !!prava.meni,
    created: rec.getString("created"),
    updated: rec.getString("updated"),
  };
  if (kind === "absence") {
    // kdo je pryč: účastníci, jinak autor
    out.away = parts.length ? parts : (ownerEmail ? [ownerEmail] : []);
    out.status = rec.getString("status");
    // poznámka k rozhodnutí je mezi žadatelem, dotyčným a správcem — ne pro celý tým
    out.decision_note = (mine || !!prava.ucastnik || (user && jeSpravce(user))) ? rec.getString("decision_note") : "";
  }
  return out;
}

function kalendarUdalosti(app, rec) {
  const calId = rec.getString("calendar");
  if (!calId) return null;
  try { return app.findRecordById("calendars", calId); } catch (err) { return null; }
}

// událost, kterou uživatel VIDÍ (autor, účastník, nebo ve sdíleném kalendáři); cizí = 404 (neprozrazovat)
function findEvent(app, id, user, lang) {
  const { t } = require(`${__hooks}/i18n.js`);
  let rec;
  try { rec = app.findRecordById("events", String(id || "")); } catch (err) { rec = null; }
  if (rec) {
    const cal = kalendarUdalosti(app, rec);
    if (pravaUdalosti(user, rec, cal).vidi) return { rec: rec, cal: cal };
  }
  return { error: { status: 404, body: { error: t(lang, "err.eventNotFound") } } };
}

// založení (rec = null) nebo úprava (rec) — práva viz pravaUdalosti. ctx = { lang, tise }
// (tise = bez notifikací, import). Zdroj: kolize → 409 { error, collision, next_free }.
// kdo je u nepřítomnosti pryč (účastníci, jinak autor) — pro porovnání „změnila se osoba?“
function prycIds(ids, rec) { return (ids.length ? ids.slice() : [rec.getString("owner")]).sort(); }

function saveEvent(app, user, rec, info, ctx) {
  const { t } = require(`${__hooks}/i18n.js`);
  const { notify } = require(`${__hooks}/helpers.js`);
  const lang = ctx.lang;
  let cal = rec ? kalendarUdalosti(app, rec) : null;
  if (rec && !pravaUdalosti(user, rec, cal).meni) return { status: 403, body: { error: t(lang, "err.eventNotEditable") } };
  const v = validateEvent(info, lang, rec);
  if (v.error) return { status: 400, body: { error: v.error } };
  const d = v.data;
  // kalendář: "" = osobní; jinak id/název, musí existovat, nebýt archivovaný a pustit zápis
  if (d.calendar !== undefined) {
    if (!d.calendar) {
      cal = null;
    } else {
      const c = kalendarZaznam(app, d.calendar, { user: user });
      if (!c) return { status: 404, body: { error: t(lang, "err.calendarNotFound", { name: d.calendar.slice(0, 80) }) } };
      if (!rec || c.id !== rec.getString("calendar")) {
        const w = smiZapisovat(user, c, lang);
        if (w.error) return w.error;
      }
      cal = c;
    }
    d.calendar = cal ? cal.id : "";
  }
  const absence = !!cal && cal.getString("kind") === "absence";
  let participantIds = null;
  if (d.participants !== undefined) {
    const p = resolveParticipants(app, d.participants, user.id, lang, { keepOwner: absence });
    if (p.error) return { status: 400, body: { error: p.error } };
    participantIds = p.ids;
    // nepřítomnost ZA KOLEGU zapisuje jen správce/manažer — člen by jinak kohokoli
    // „poslal na dovolenou“ (Můj den, kdo je pryč) bez schvalování (panel 15. 10. 2026)
    if (absence && !jeSpravce(user) && participantIds.some((id) => id !== user.id)) {
      return { status: 403, body: { error: t(lang, "err.absenceForOtherAdminOnly") } };
    }
  }
  // vztah začátek × konec nad sloučenými hodnotami + pravidla druhu (zdroj = s časem)
  const eff = {
    day: d.day !== undefined ? d.day : rec.getString("day"),
    time: d.time !== undefined ? d.time : (rec ? rec.getString("time") : ""),
    end_day: d.end_day !== undefined ? d.end_day : (rec ? rec.getString("end_day") : ""),
    end_time: d.end_time !== undefined ? d.end_time : (rec ? rec.getString("end_time") : ""),
  };
  // přesun dne bez výslovného konce = vícedenní událost drží délku (tažení v kalendáři)
  if (rec && d.day !== undefined && d.end_day === undefined && rec.getString("end_day")) {
    eff.end_day = dayPlusDays(d.day, dayDiff(rec.getString("day"), rec.getString("end_day")));
  }
  const cr = checkEventRange(eff, cal, lang);
  if (cr.error) return { status: 400, body: { error: cr.error } };
  for (const k of ["day", "time", "end_day", "end_time"]) {
    if (d[k] !== undefined || (rec ? rec.getString(k) : "") !== cr.data[k]) d[k] = cr.data[k];
  }
  if (cal && cal.getString("kind") === "resource") {
    const kolize = najdiKolizi(app, cal.id, cr.data, rec ? rec.id : "");
    if (kolize) {
      const kr = rozsahUdalosti(kolize.rec);
      return { status: 409, body: {
        error: t(lang, "err.eventCollision", { name: cal.getString("name"), title: kolize.rec.getString("title"), from: kr.od.slice(11), to: kr.do.slice(11) }),
        collision: eventDto(app, kolize.rec, user),
        next_free: kolize.next_free,
      } };
    }
  }
  const before = rec ? (rec.get("participants") || []).slice() : [];
  const creating = !rec;
  const statusPred = rec ? rec.getString("status") : "";
  if (!rec) {
    const { MAX_EVENTS_PER_USER } = require(`${__hooks}/helpers.js`);
    let pocet = 0;
    try { pocet = app.findRecordsByFilter("events", "owner = {:u}", "", MAX_EVENTS_PER_USER + 1, 0, { u: user.id }).length; } catch (err) { pocet = 0; }
    if (pocet >= MAX_EVENTS_PER_USER) return { status: 400, body: { error: t(lang, "err.eventLimit", { max: MAX_EVENTS_PER_USER }) } };
    rec = new Record(app.findCollectionByNameOrId("events"));
    rec.set("owner", user.id);
    rec.set("time", "");
    rec.set("note", "");
    rec.set("remind", false);
    rec.set("remind_before_min", 0);
    rec.set("reminded_at", "");
    rec.set("calendar", "");
    rec.set("end_day", "");
    rec.set("end_time", "");
    // nepřítomnost v kalendáři se schvalováním čeká na správce/manažera (výchozí vypnuto)
    rec.set("status", absence && cal.getBool("needs_approval") ? "requested" : "");
  }
  // změna dne/času/připomínky = připomínka znovu platí (cron ji pošle podle nového času)
  const resetKeys = ["day", "time", "remind", "remind_before_min"];
  let reset = false;
  for (const k of Object.keys(d)) {
    if (k === "participants") continue;
    if (resetKeys.indexOf(k) >= 0 && String(rec.get(k)) !== String(d[k])) reset = true;
    rec.set(k, d[k]);
  }
  if (participantIds) rec.set("participants", participantIds);
  // Schvalování drží i při ÚPRAVĚ (panel 15. 10. 2026): přesun události do kalendáře se
  // schvalováním, změna termínu/osoby u schválené či zamítnuté nepřítomnosti = nová žádost
  // (rozhodnutí se vynuluje, správci dostanou znovu). Přesun ven z nepřítomností = bez stavu.
  if (!creating) {
    const schvalovani = absence && cal.getBool("needs_approval");
    const zmenaRozsahu = ["day", "end_day", "time", "end_time", "calendar"].some((k) => d[k] !== undefined && String(d[k]) !== String(rec.original().get(k)))
      || (participantIds !== null && prycIds(participantIds, rec).join(",") !== prycIds(before, rec).join(","));
    if (!schvalovani) {
      if (rec.getString("status")) { rec.set("status", ""); rec.set("decided_by", ""); rec.set("decision_note", ""); }
    } else if (zmenaRozsahu || !rec.getString("status")) {
      rec.set("status", "requested"); rec.set("decided_by", ""); rec.set("decision_note", "");
    }
  }
  if (reset) rec.set("reminded_at", "");
  // připomínka do MINULOSTI (událost zapsaná zpětně, „zubař dnes ráno“) se tiše
  // označí jako vyřízená — cron by ji jinak poslal hned (panel 19. 9. 2026)
  if (rec.getBool("remind") && !rec.getString("reminded_at")) {
    const H = require(`${__hooks}/helpers.js`);
    const fireAt = rec.getString("time")
      ? H.minusMinutes(rec.getString("day"), rec.getString("time"), Number(rec.get("remind_before_min")) || 0)
      : rec.getString("day") + " " + String(H.deadlineHour()).padStart(2, "0") + ":00";
    if (fireAt <= H.nowLocalMinute()) rec.set("reminded_at", H.nowLocalMinute());
  }
  app.save(rec);

  // nová (nebo znovu otevřená) nepřítomnost ke schválení → správcům a manažerům, kteří
  // kalendář VIDÍ (skrytý kalendář nesmí prosáknout textem notifikace); žadatel = aktér, notify ho vynechá
  if (rec.getString("status") === "requested" && (creating || statusPred !== "requested") && !ctx.tise) {
    const dto = eventDto(app, rec, user);
    let spravci = [];
    try { spravci = app.findRecordsByFilter("users", 'role = "admin" || role = "manager"', "", 200, 0); } catch (err) { spravci = []; }
    spravci = spravci.filter((s) => kalendarViditelny(s, cal));
    for (const s of spravci) {
      try {
        notify(app, {
          email: s.getString("email"), actorEmail: user.email(), type: "absence_requested", eventId: rec.id,
          textKey: "notify.absenceRequested",
          params: { by: user.email(), who: (dto.away || []).join(", "), from: dto.day, to: dto.end_day || dto.day, title: dto.title },
        });
      } catch (err) { try { app.logger().warn("events: notifikace žádosti o nepřítomnost selhala", "error", String(err)); } catch (e2) { /* log je bonus */ } }
    }
  }
  // „pozván" jen NOVÝM účastníkům (vlastník je aktér → notify ho sám vynechá);
  // u nepřítomnosti zapsané za druhého (manažer → Jana) je to totéž: Jana ví, že je zapsaná
  if (participantIds && !ctx.tise) {
    const novi = participantIds.filter((id) => before.indexOf(id) < 0);
    for (const u of usersByIds(app, novi)) {
      try {
        notify(app, {
          email: u.getString("email"),
          actorEmail: user.email(),
          type: "event_invited",
          eventId: rec.id,
          textKey: "notify.eventInvited",
          params: { by: user.email(), title: rec.getString("title"), day: rec.getString("day"), time: rec.getString("time") ? " " + rec.getString("time") : "" },
        });
      } catch (err) {
        try { app.logger().warn("events: notifikace pozvání selhala", "error", String(err)); } catch (e2) { /* log je bonus */ }
      }
    }
  }
  return { status: 200, body: { event: eventDto(app, rec, user) } };
}

// seznam viděných událostí v okně dní (default dnes −365 … +730), řazený den+čas.
// Vícedenní událost se počítá, pokud do okna zasahuje (začala před `from`, končí v něm).
// Sdílené kalendáře vidí každý; archivované se vynechají. q.calendar = jen jeden kalendář.
function listEvents(app, user, q) {
  const { addDaysStr } = require(`${__hooks}/helpers.js`);
  const now = new Date();
  const from = validDay(q && q.from) ? String(q.from) : addDaysStr(now, -365);
  const to = validDay(q && q.to) ? String(q.to) : addDaysStr(now, 730);
  const kal = kalendareMapa(app, user);
  let filtr = '(owner = {:u} || participants.id ?= {:u} || calendar != "") && day <= {:to} && (end_day >= {:from} || day >= {:from})';
  const params = { u: user.id, from: from, to: to };
  if (q && q.calendar) {
    const c = kalendarZaznam(app, q.calendar, { user: user });
    if (!c) return { status: 200, body: { events: [], from: from, to: to } };
    filtr += " && calendar = {:c}";
    params.c = c.id;
  }
  let rows = [];
  try { rows = app.findRecordsByFilter("events", filtr, "day,time,created", MAX_EVENTS_LIST, 0, params); } catch (err) { rows = []; }
  const truncated = rows.length >= MAX_EVENTS_LIST;
  // kalendář skrytý (jen pro vybrané) nebo archivovaný = událost se nevypisuje (RLS totéž pro realtime)
  rows = rows.filter((r) => { const c = r.getString("calendar"); return !c || (kal[c] && !kal[c].getBool("archived")); });
  // zamítnutá nepřítomnost zůstává žadateli, dotyčnému a správci/manažerovi (může rozhodnutí změnit) — ostatním by v kalendáři lhala
  const spravce = jeSpravce(user);
  rows = rows.filter((r) => r.getString("status") !== "rejected" || spravce || r.getString("owner") === user.id || (r.get("participants") || []).indexOf(user.id) >= 0);
  // e-maily vlastníků a účastníků jedním dotazem (dřív 2 dotazy na každou událost)
  const ids = new Set();
  for (const r of rows) { ids.add(r.getString("owner")); for (const p of r.get("participants") || []) ids.add(p); }
  const emaily = {};
  for (const u of usersByIds(app, Array.from(ids))) emaily[u.id] = u.getString("email");
  return { status: 200, body: { events: rows.map((r) => eventDto(app, r, user, emaily, kal)), from: from, to: to, truncated: truncated } };
}

// Rozhodnutí o nepřítomnosti (schvalování zapnuté na kalendáři): jen správce/manažer;
// approved / rejected + poznámka; žadatel i dotyčný dostanou notifikaci. Rozhodnutí jde změnit.
function decideAbsence(app, user, rec, info, ctx) {
  const { t } = require(`${__hooks}/i18n.js`);
  const { notify } = require(`${__hooks}/helpers.js`);
  const lang = ctx.lang;
  const cal = kalendarUdalosti(app, rec);
  if (!cal || cal.getString("kind") !== "absence") return { status: 400, body: { error: t(lang, "err.absenceNotAbsence") } };
  if (!jeSpravce(user)) return { status: 403, body: { error: t(lang, "err.absenceDecideAdminOnly") } };
  if (!rec.getString("status")) return { status: 400, body: { error: t(lang, "err.absenceNotPending") } };
  const decision = String((info && info.decision) || "").trim();
  if (decision !== "approved" && decision !== "rejected") return { status: 400, body: { error: t(lang, "err.absenceDecision") } };
  const note = String((info && info.note) || "").trim();
  if (note.length > 500) return { status: 400, body: { error: t(lang, "err.absenceNoteLong") } };
  rec.set("status", decision);
  rec.set("decided_by", user.id);
  rec.set("decision_note", note);
  app.save(rec);
  const dto = eventDto(app, rec, user);
  const prijemci = new Set([rec.getString("owner")].concat(rec.get("participants") || []));
  if (!ctx.tise) {
    for (const u of usersByIds(app, Array.from(prijemci))) {
      try {
        notify(app, {
          email: u.getString("email"), actorEmail: user.email(), type: "absence_decided", eventId: rec.id,
          textKey: decision === "approved" ? "notify.absenceApproved" : "notify.absenceRejected",
          params: { by: user.email(), from: dto.day, to: dto.end_day || dto.day, title: dto.title, note: note ? " — " + note : "" },
        });
      } catch (err) { try { app.logger().warn("events: notifikace rozhodnutí selhala", "error", String(err)); } catch (e2) { /* log je bonus */ } }
    }
  }
  return { status: 200, body: { event: dto } };
}

// pozvaný se z události ODEBERE sám (Richard 19. 9. 2026): vyřadí se z participants,
// událost mu zmizí z kalendáře i Můj den; vlastník to uvidí v seznamu účastníků.
// Vlastník tudy nejde (má smazat), nezvaný = 404 přes findEvent.
function leaveEvent(app, user, rec, lang) {
  const { t } = require(`${__hooks}/i18n.js`);
  if (rec.getString("owner") === user.id) return { status: 400, body: { error: t(lang, "err.eventOwnerCannotLeave") } };
  // kdo není účastník (firemní akci jen vidí), nemá co opouštět — jinak „odešel“ a událost mu zůstala
  if ((rec.get("participants") || []).indexOf(user.id) < 0) return { status: 400, body: { error: t(lang, "err.eventNotParticipant") } };
  const parts = (rec.get("participants") || []).filter((id) => id !== user.id);
  rec.set("participants", parts);
  app.save(rec);
  return { status: 200, body: { success: true } };
}

function deleteEvent(app, user, rec, lang) {
  const { t } = require(`${__hooks}/i18n.js`);
  if (!pravaUdalosti(user, rec, kalendarUdalosti(app, rec)).meni) return { status: 403, body: { error: t(lang, "err.eventNotEditable") } };
  app.delete(rec);
  return { status: 200, body: { success: true } };
}

// ---------- připomínky k uzlům ----------

function nodeReminderDto(rec) {
  return {
    id: rec.id,
    map_id: rec.getString("map"),
    node_id: rec.getString("node_id"),
    offset_days: Number(rec.get("offset_days")) || 0,
    time: rec.getString("time"),
    day: rec.getString("day"),
    fires_at: rec.getString("day") ? rec.getString("day") + " " + rec.getString("time") : "",
    fired: !!rec.getString("fired_at"),
  };
}

// uzel mapy s platným termínem, jinak { error }
function nodeWithDeadline(app, map, nodeId, lang) {
  const { t } = require(`${__hooks}/i18n.js`);
  const { jsonVal } = require(`${__hooks}/helpers.js`);
  const node = (jsonVal(map, "nodes", []) || []).find((n) => n && n.id === nodeId);
  if (!node || node.type === "note") return { error: { status: 404, body: { error: t(lang, "err.nodeNotFound") } } };
  const d = (node.data || {});
  // hotový uzel / archivovaná mapa: cron by připomínku tiše smazal → říct to rovnou
  if (map.getBool("archived") || d.status === "done") return { error: { status: 400, body: { error: t(lang, "err.reminderNodeDone") } } };
  if (!validDay(d.deadline)) return { error: { status: 400, body: { error: t(lang, "err.reminderNeedsDeadline") } } };
  return { node: node, deadline: String(d.deadline) };
}

// upsert připomínky k uzlu (jedna na člověka a uzel). Mapa: kdokoli, kdo ji vidí
// (připomínka je soukromá, nic v mapě nemění). ctx = { lang }
function saveNodeReminder(app, user, mapId, nodeId, info, ctx) {
  const { t } = require(`${__hooks}/i18n.js`);
  const H = require(`${__hooks}/helpers.js`);
  const lang = ctx.lang;
  const r = H.v1ReadableMap(app, mapId, user);
  if (!r) return { status: 404, body: { error: t(lang, "err.mapNotFound") } };
  const nd = nodeWithDeadline(app, r.map, String(nodeId || ""), lang);
  if (nd.error) return { status: nd.error.status, body: nd.error.body };
  const offset = info.offset_days === undefined ? 0 : Number(info.offset_days);
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET_DAYS) return { status: 400, body: { error: t(lang, "err.badOffsetDays", { max: MAX_OFFSET_DAYS }) } };
  const time = String(info.time || "").trim();
  if (!TIME_RE.test(time)) return { status: 400, body: { error: t(lang, "err.badTime", { value: time.slice(0, 40) }) } };
  const day = H.dayMinusDays(nd.deadline, offset);
  if (day + " " + time <= H.nowLocalMinute()) return { status: 400, body: { error: t(lang, "err.reminderInPast", { at: day + " " + time }) } };
  let rec = null;
  try {
    rec = app.findFirstRecordByFilter("node_reminders", "owner = {:u} && map = {:m} && node_id = {:n}",
      { u: user.id, m: r.map.id, n: String(nodeId) });
  } catch (err) { rec = null; }
  if (!rec) {
    rec = new Record(app.findCollectionByNameOrId("node_reminders"));
    rec.set("owner", user.id);
    rec.set("map", r.map.id);
    rec.set("node_id", String(nodeId));
  }
  rec.set("offset_days", offset);
  rec.set("time", time);
  rec.set("day", day);
  rec.set("fired_at", "");
  app.save(rec);
  return { status: 200, body: { reminder: nodeReminderDto(rec), node_title: String((nd.node.data || {}).title || ""), deadline: nd.deadline } };
}

function listNodeReminders(app, user, mapId, nodeId) {
  let filter = "owner = {:u}";
  const params = { u: user.id };
  if (mapId) { filter += " && map = {:m}"; params.m = String(mapId); }
  if (nodeId) { filter += " && node_id = {:n}"; params.n = String(nodeId); }
  let rows = [];
  try { rows = app.findRecordsByFilter("node_reminders", filter, "day,time", 500, 0, params); } catch (err) { rows = []; }
  return { status: 200, body: { reminders: rows.map(nodeReminderDto) } };
}

function deleteNodeReminder(app, user, id, lang) {
  const { t } = require(`${__hooks}/i18n.js`);
  let rec;
  try { rec = app.findRecordById("node_reminders", String(id || "")); } catch (err) { rec = null; }
  if (!rec || rec.getString("owner") !== user.id) return { status: 404, body: { error: t(lang, "err.reminderNotFound") } };
  app.delete(rec);
  return { status: 200, body: { success: true } };
}

module.exports = {
  EVENT_FIELDS, CALENDAR_FIELDS, CALENDAR_KINDS, NODE_REMINDER_FIELDS, TIME_RE, DAY_RE, MAX_PARTICIPANTS, MAX_REMIND_MIN, MAX_OFFSET_DAYS,
  validDay, validateEvent, checkEventRange, resolveParticipants, eventDto, findEvent, saveEvent, listEvents, deleteEvent, leaveEvent,
  kalendareMapa, kalendarZaznam, kalendarUdalosti, kalendarViditelny, calendarDto, listCalendars, saveCalendar, smiZapisovat, pravaUdalosti,
  najdiKolizi, rozsahUdalosti, whoIsAway, listAway, decideAbsence, deleteCalendar, zalozVychoziKalendare, MAX_EVENTS_LIST,
  nodeReminderDto, saveNodeReminder, listNodeReminders, deleteNodeReminder,
};
