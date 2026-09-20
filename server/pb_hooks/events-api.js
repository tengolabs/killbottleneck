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

const EVENT_FIELDS = ["title", "day", "time", "note", "participants", "remind", "remind_before_min"];
const NODE_REMINDER_FIELDS = ["offset_days", "time"];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MAX_PARTICIPANTS = 50;
const MAX_REMIND_MIN = 10080; // týden
const DEFAULT_REMIND_MIN = 30;
const MAX_OFFSET_DAYS = 30;

// platný kalendářní den (regex pustí 2026-13-45)
function validDay(s) {
  if (!DAY_RE.test(String(s || ""))) return false;
  const [y, m, d] = String(s).split("-").map(Number);
  const x = new Date(y, m - 1, d);
  return x.getFullYear() === y && x.getMonth() === m - 1 && x.getDate() === d;
}

// ---------- události ----------

// Validace vstupu (create: rec = null → title+day povinné; update: jen co přišlo).
// Vrací { data } (jen pole, která se mají zapsat) nebo { error }.
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
  return { data: data };
}

// E-maily účastníků → id uživatelů. Jen EXISTUJÍCÍ účty instance (relace to vynucuje);
// externí kontakty ani neregistrovaní ne — pozvánka ven je synchronizace kalendáře,
// ne fáze 1. Shoda jako resolveOwner: nejdřív PŘESNĚ (Dup@x.cz ≠ dup@x.cz mohou být
// dva účty), pak bez ohledu na velikost písmen, víc shod = nejednoznačné.
// Vlastník se z účastníků tiše vyřadí. Vrací { ids, emails } nebo { error }.
function resolveParticipants(app, emails, ownerId, lang) {
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
    if (u.id === ownerId || ids.indexOf(u.id) >= 0) continue;
    ids.push(u.id);
    out.push(u.getString("email"));
  }
  return { ids: ids, emails: out };
}

function usersByIds(app, ids) {
  if (!ids || !ids.length) return [];
  try { return app.findRecordsByIds("users", ids); } catch (err) { return []; }
}

// emaily = volitelná mapa id → e-mail (listEvents ji předpočítá jedním dotazem, jinak N+1)
function eventDto(app, rec, userId, emaily) {
  const ids = rec.get("participants") || [];
  const parts = emaily ? ids.map((id) => emaily[id]).filter(Boolean) : usersByIds(app, ids).map((u) => u.getString("email"));
  let ownerEmail = emaily ? (emaily[rec.getString("owner")] || "") : "";
  if (!ownerEmail) { try { ownerEmail = app.findRecordById("users", rec.getString("owner")).getString("email"); } catch (err) { /* smazaný účet */ } }
  return {
    id: rec.id,
    title: rec.getString("title"),
    day: rec.getString("day"),
    time: rec.getString("time"),
    note: rec.getString("note"),
    owner_email: ownerEmail,
    participants: parts,
    remind: rec.getBool("remind"),
    remind_before_min: Number(rec.get("remind_before_min")) || 0,
    mine: rec.getString("owner") === userId,
    created: rec.getString("created"),
    updated: rec.getString("updated"),
  };
}

// událost, kterou uživatel VIDÍ (vlastník nebo účastník); cizí = 404 (neprozrazovat)
function findEvent(app, id, user, lang) {
  const { t } = require(`${__hooks}/i18n.js`);
  let rec;
  try { rec = app.findRecordById("events", String(id || "")); } catch (err) { rec = null; }
  if (rec) {
    const parts = rec.get("participants") || [];
    if (rec.getString("owner") === user.id || parts.indexOf(user.id) >= 0) return { rec: rec };
  }
  return { error: { status: 404, body: { error: t(lang, "err.eventNotFound") } } };
}

// založení (rec = null) nebo úprava (rec) — jen vlastník. ctx = { lang }
function saveEvent(app, user, rec, info, ctx) {
  const { t } = require(`${__hooks}/i18n.js`);
  const { notify } = require(`${__hooks}/helpers.js`);
  const lang = ctx.lang;
  if (rec && rec.getString("owner") !== user.id) return { status: 403, body: { error: t(lang, "err.eventNotOwner") } };
  const v = validateEvent(info, lang, rec);
  if (v.error) return { status: 400, body: { error: v.error } };
  const d = v.data;
  let participantIds = null;
  if (d.participants !== undefined) {
    const p = resolveParticipants(app, d.participants, user.id, lang);
    if (p.error) return { status: 400, body: { error: p.error } };
    participantIds = p.ids;
  }
  const before = rec ? (rec.get("participants") || []).slice() : [];
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

  // „pozván" jen NOVÝM účastníkům (vlastník je aktér → notify ho sám vynechá)
  if (participantIds) {
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
  return { status: 200, body: { event: eventDto(app, rec, user.id) } };
}

// seznam viděných událostí v okně dní (default dnes −365 … +730), řazený den+čas
function listEvents(app, user, q) {
  const { addDaysStr } = require(`${__hooks}/helpers.js`);
  const now = new Date();
  const from = validDay(q && q.from) ? String(q.from) : addDaysStr(now, -365);
  const to = validDay(q && q.to) ? String(q.to) : addDaysStr(now, 730);
  let rows = [];
  try {
    rows = app.findRecordsByFilter("events",
      "(owner = {:u} || participants.id ?= {:u}) && day >= {:from} && day <= {:to}",
      "day,time,created", 1000, 0, { u: user.id, from: from, to: to });
  } catch (err) { rows = []; }
  // e-maily vlastníků a účastníků jedním dotazem (dřív 2 dotazy na každou událost)
  const ids = new Set();
  for (const r of rows) { ids.add(r.getString("owner")); for (const p of r.get("participants") || []) ids.add(p); }
  const emaily = {};
  for (const u of usersByIds(app, Array.from(ids))) emaily[u.id] = u.getString("email");
  return { status: 200, body: { events: rows.map((r) => eventDto(app, r, user.id, emaily)), from: from, to: to } };
}

// pozvaný se z události ODEBERE sám (Richard 19. 9. 2026): vyřadí se z participants,
// událost mu zmizí z kalendáře i Můj den; vlastník to uvidí v seznamu účastníků.
// Vlastník tudy nejde (má smazat), nezvaný = 404 přes findEvent.
function leaveEvent(app, user, rec, lang) {
  const { t } = require(`${__hooks}/i18n.js`);
  if (rec.getString("owner") === user.id) return { status: 400, body: { error: t(lang, "err.eventOwnerCannotLeave") } };
  const parts = (rec.get("participants") || []).filter((id) => id !== user.id);
  rec.set("participants", parts);
  app.save(rec);
  return { status: 200, body: { success: true } };
}

function deleteEvent(app, user, rec, lang) {
  const { t } = require(`${__hooks}/i18n.js`);
  if (rec.getString("owner") !== user.id) return { status: 403, body: { error: t(lang, "err.eventNotOwner") } };
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
  EVENT_FIELDS, NODE_REMINDER_FIELDS, TIME_RE, DAY_RE, MAX_PARTICIPANTS, MAX_REMIND_MIN, MAX_OFFSET_DAYS,
  validDay, validateEvent, resolveParticipants, eventDto, findEvent, saveEvent, listEvents, deleteEvent, leaveEvent,
  nodeReminderDto, saveNodeReminder, listNodeReminders, deleteNodeReminder,
};
