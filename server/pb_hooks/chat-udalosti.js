// Události v kalendáři a připomínky kroků přes asistenta: schémata, vykonání, kontroly před kartou a popisy karet.
// Vzniklo rozdělením chat.js po skupinách nástrojů (5. 10. 2026, bod 2 prověrky asistenta): kód přesunut DOSLOVA, chování beze změny.
// Sdílené resolvery (mapaId, uzelId, sDocasnymKlicem, …) jsou v chat-spolecne.js; chat.js skládá seznam nástrojů v PŮVODNÍM pořadí
// (PORADI_NASTROJU — pořadí schémat je součást prefixu promptu, cache musí držet) a podle `modul` u nástroje sem deleguje
// vykonej / overZapis / popisAkce. ⚠️ PocketBase JSVM: require() uvnitř funkcí (líné přístupové funkce níže).
const HOOKS = typeof __hooks !== "undefined" ? __hooks : __dirname; // mimo PocketBase (testy v node) složka souboru
const SPOL = () => require(`${HOOKS}/chat-spolecne.js`);

// VLASTNÍ událost uživatele podle id, nebo podle názvu (přesně, pak jednoznačná částečná shoda; `day` zúží,
// když se název opakuje) → záznam nebo null. Pozvané události se neupravují (jen opustit v kalendáři).
function udalostZaznam(app, auth, ref, day, iPozvane) {
  const id = String(ref || "").trim();
  if (!id) return null;
  let rows = [];
  try { rows = app.findRecordsByFilter("events", iPozvane ? "owner = {:u} || participants.id ?= {:u}" : "owner = {:u}", "-day,-time", 500, 0, { u: auth.id }); } catch (err) { rows = []; }
  const podleId = rows.find((r) => r.id === id);
  if (podleId) return podleId;
  const kand = day ? rows.filter((r) => r.getString("day") === String(day)) : rows;
  return SPOL().podleNazvu(kand, id, (r) => r.getString("title"));
}

const NASTROJE = [
  { name: "list_reminders", skupina: "udalosti", kind: "read", description: "The user's timed reminders on map steps (id, step, when it fires); optional map_id / node_id filter.",
    parameters: { type: "object", properties: { map_id: { type: "string" }, node_id: { type: "string" } }, required: [], additionalProperties: false } },
  { name: "delete_reminder", skupina: "udalosti", kind: "write", description: "Remove a timed reminder from a map step (the deadline stays). reminder_id from list_reminders; when the step has exactly one reminder of the user it may be omitted. The user confirms first.",
    parameters: { type: "object", properties: { map_id: { type: "string" }, node_id: { type: "string" }, reminder_id: { type: "string" } }, required: ["map_id", "node_id"], additionalProperties: false } },
  // události a časové připomínky (19. 9. 2026) — skupina `udalosti`, zápis přes v1 dočasným klíčem
  { name: "create_event", skupina: "udalosti", kind: "write", description: "Create a personal calendar EVENT with a time (meeting, call, dentist, video conference…) — NOT a task and not part of any map. Optional participants (e-mails of instance members from list_people — each sees it in their calendar) and a reminder N minutes before (in-app + e-mail). The user confirms first.",
    parameters: { type: "object", properties: { title: { type: "string" }, day: { type: "string", description: "YYYY-MM-DD" }, time: { type: "string", description: "HH:MM (24h); omit for an all-day event" }, note: { type: "string" }, participants: { type: "array", items: { type: "string" }, description: "e-mails of instance members (from list_people)" }, remind_before_min: { type: "integer", description: "reminder N minutes before start (0 = at start); omit for no reminder" } }, required: ["title", "day"], additionalProperties: false } },
  { name: "list_events", skupina: "udalosti", kind: "read", description: "The user's calendar events (own and invited) in a day range; default today−365 … +730.",
    parameters: { type: "object", properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } }, required: [], additionalProperties: false } },
  { name: "update_event", skupina: "udalosti", kind: "write", description: "Change an EXISTING calendar event of the user: move it (day/time), rename it, edit the note or participants, or set/change/remove its reminder (\"remind me an hour before\" on an event already created = update_event with remind_before_min 60; remind false removes it). event_id = the id from list_events or the create result, or the exact title (add day when the title repeats). Only the owner of the event. The user confirms first.",
    parameters: { type: "object", properties: { event_id: { type: "string" }, day: { type: "string", description: "YYYY-MM-DD, only to find the event by title when several share it; combine with new_day to move it" }, title: { type: "string" }, new_day: { type: "string", description: "YYYY-MM-DD" }, time: { type: "string", description: "HH:MM (24h); empty string = all-day" }, note: { type: "string" }, participants: { type: "array", items: { type: "string" }, description: "the FULL new list of participant e-mails" }, remind: { type: "boolean", description: "false = remove the reminder" }, remind_before_min: { type: "integer", description: "reminder N minutes before start (0 = at start)" } }, required: ["event_id"], additionalProperties: false } },
  { name: "delete_event", skupina: "udalosti", kind: "write", description: "Delete the user's own calendar event (invitees lose it too). event_id = id from list_events or the exact title. Cannot be undone. The user confirms first.",
    parameters: { type: "object", properties: { event_id: { type: "string" }, day: { type: "string", description: "YYYY-MM-DD, only to find the event by title" } }, required: ["event_id"], additionalProperties: false } },
  { name: "create_reminder", skupina: "udalosti", kind: "write", description: "Set a TIMED reminder for a map node relative to its deadline: offset_days before the deadline (0 = on the deadline day, 1 = the day before) at time HH:MM. Does NOT change the deadline; the node must already have one (set it with update_node first, the user confirms, then call this). One reminder per node (calling again replaces it). The user confirms first.",
    parameters: { type: "object", properties: { map_id: { type: "string", description: "the exact map title" }, node_id: { type: "string", description: "the exact node title (from get_map)" }, offset_days: { type: "integer", description: "0 = on the deadline day, 1 = the day before, …" }, time: { type: "string", description: "HH:MM (24h)" } }, required: ["map_id", "node_id", "time"], additionalProperties: false } },
];

function vykonej(app, auth, L, name, args, ktx) {
  const M = require(`${__hooks}/mcp-tools.js`);
  const a = args || {};
  switch (name) {
    case "list_reminders": {
      const mid = a.map_id ? SPOL().mapaId(app, auth, a.map_id) : "";
      if (a.map_id && !mid) return { text: `Error: map "${String(a.map_id)}" not found (use list_maps).` };
      const nid = mid && a.node_id ? SPOL().uzelId(app, auth, mid, a.node_id) : "";
      const rem = SPOL().pripominkyUzlu(app, auth, mid, nid);
      if (!rem.length) return { text: "No timed reminders." };
      const { jsonVal } = require(`${__hooks}/helpers.js`);
      const nazvy = {};
      const radky = rem.map((r) => {
        if (!nazvy[r.map_id]) { try { const m = app.findRecordById("goalmaps", r.map_id); nazvy[r.map_id] = { t: m.getString("title"), n: jsonVal(m, "nodes", []) }; } catch (err) { nazvy[r.map_id] = { t: "?", n: [] }; } }
        const uz = nazvy[r.map_id].n.find((x) => x.id === r.node_id);
        return `• ${r.fires_at} — "${uz ? ((uz.data || {}).title || (uz.data || {}).apexText || r.node_id) : r.node_id}" in "${nazvy[r.map_id].t}" (id: ${r.id}${r.fired ? ", already fired" : ""})`;
      });
      return { text: radky.join("\n") };
    }
    case "delete_reminder": {
      const mid = SPOL().mapaId(app, auth, a.map_id);
      const nid = SPOL().uzelId(app, auth, mid, a.node_id);
      const rem = SPOL().pripominkyUzlu(app, auth, mid, nid);
      const r0 = a.reminder_id ? rem.find((r) => r.id === String(a.reminder_id)) : rem[0];
      if (!r0) return { text: "Error: reminder not found." };
      return SPOL().sDocasnymKlicem(app, auth, (v1) => {
        const r = v1("POST", `/v1/maps/${encodeURIComponent(mid)}/nodes/${encodeURIComponent(nid)}/reminders/${encodeURIComponent(r0.id)}/delete`, {});
        if (r.status !== 200) return { text: SPOL().chybaV1(r) };
        return { text: `Reminder removed (was ${r0.fires_at}); the deadline is unchanged.` };
      });
    }
    // ---------- události a časové připomínky (19. 9. 2026) ----------
    case "list_events": {
      const E = require(`${__hooks}/events-api.js`);
      const r = E.listEvents(app, auth, { from: a.from, to: a.to });
      const ev = (r.body && r.body.events) || [];
      if (!ev.length) return { text: `No events between ${r.body.from} and ${r.body.to}.` };
      return { text: M.DATA_FENCE + "\n\n" + ev.map((x) => `• ${M.renderEvent(x)}`).join("\n") };
    }
    case "create_event": {
      return SPOL().sDocasnymKlicem(app, auth, (v1) => {
        const body = { title: a.title, day: a.day };
        for (const k of ["time", "note", "participants", "remind_before_min"]) if (a[k] !== undefined) body[k] = a[k];
        const r = v1("POST", "/v1/events", body);
        if (r.status !== 200) return { text: SPOL().chybaV1(r) };
        const ev = r.json.event || {};
        const kdy = ev.remind ? ` Reminder fires ${ev.remind_before_min} min before start (in-app + e-mail if enabled), instance local time.` : "";
        return { text: `Event created: ${M.renderEvent(ev)}.${kdy} Tell the user only this.`, karta: { type: "vysledek", udalost_id: ev.id, udalost_den: ev.day } };
      });
    }
    case "update_event": {
      const ev = udalostZaznam(app, auth, a.event_id, a.day);
      if (!ev) return { text: "Error: event not found." };
      return SPOL().sDocasnymKlicem(app, auth, (v1) => {
        const body = {};
        for (const k of ["title", "time", "note", "participants", "remind", "remind_before_min"]) if (a[k] !== undefined) body[k] = a[k];
        if (a.new_day !== undefined) body.day = a.new_day;
        if (body.remind_before_min !== undefined && body.remind === undefined) body.remind = true;
        const r = v1("POST", `/v1/events/${encodeURIComponent(ev.id)}`, body);
        if (r.status !== 200) return { text: SPOL().chybaV1(r) };
        const e2 = r.json.event || {};
        const kdy = e2.remind ? ` Reminder fires ${e2.remind_before_min} min before start (in-app + e-mail if enabled), instance local time.` : " No reminder.";
        return { text: `Event updated: ${M.renderEvent(e2)}.${kdy} Tell the user only this.`, karta: { type: "vysledek", udalost_id: e2.id, udalost_den: e2.day } };
      });
    }
    case "delete_event": {
      const ev = udalostZaznam(app, auth, a.event_id, a.day, true);
      if (!ev) return { text: "Error: event not found." };
      const pozvany = ev.getString("owner") !== auth.id; // pozvaný událost opouští (vlastník ji maže) — jako v kalendáři
      return SPOL().sDocasnymKlicem(app, auth, (v1) => {
        const r = v1("POST", `/v1/events/${encodeURIComponent(ev.id)}/${pozvany ? "leave" : "delete"}`, {});
        if (r.status !== 200) return { text: SPOL().chybaV1(r) };
        const kdy = `${ev.getString("day")}${ev.getString("time") ? " " + ev.getString("time") : ""}`;
        return { text: pozvany ? `The user left the event "${ev.getString("title")}" (${kdy}); it stays in the organizer's calendar.` : `Event "${ev.getString("title")}" (${kdy}) deleted.` };
      });
    }
    case "create_reminder": {
      const mid = SPOL().mapaId(app, auth, a.map_id);
      if (!mid) return { text: `Error: map "${String(a.map_id || "")}" not found or not accessible (use list_maps; pass the id or the exact title).` };
      const nid = SPOL().uzelId(app, auth, mid, a.node_id);
      if (!nid) return { text: `Error: node "${String(a.node_id || "")}" not found in the map (use get_map; pass the node id or its exact title).` };
      return SPOL().sDocasnymKlicem(app, auth, (v1) => {
        const r = v1("POST", `/v1/maps/${encodeURIComponent(mid)}/nodes/${encodeURIComponent(nid)}/reminders`,
          { offset_days: a.offset_days === undefined ? 0 : a.offset_days, time: a.time });
        if (r.status !== 200) return { text: SPOL().chybaV1(r) };
        const m = v1("GET", `/v1/maps/${encodeURIComponent(mid)}`);
        return { text: `Reminder set for "${r.json.node_title}" (deadline ${r.json.deadline}): fires on ${r.json.reminder.fires_at} instance local time (in-app + e-mail if enabled). The deadline is unchanged. Tell the user only this.`,
          // připomínka žije v kalendáři → odkaz karty vede tam, ne do mapy (klik-test Richarda 5. 10. 2026)
          karta: { type: "vysledek", map_id: mid, map_title: m.status === 200 ? m.json.title : "", node_id: nid, pripominka: true, den: r.json.deadline } };
      });
    }
    default: return { text: "Error: unknown tool " + name };
  }
}

function overZapis(app, auth, name, a) {
  const { chybaMapy, chybaUzlu } = SPOL().kontrolyZapisu(app, auth);
  switch (name) {
    case "delete_reminder": {
      const mid = SPOL().mapaId(app, auth, a.map_id);
      if (!mid) return chybaMapy(a.map_id);
      const nid = SPOL().uzelId(app, auth, mid, a.node_id);
      if (!nid) return `Error: node "${String(a.node_id || "")}" not found in the map (use get_map; pass the node id or its exact title).`;
      const rem = SPOL().pripominkyUzlu(app, auth, mid, nid);
      if (!rem.length) return `Error: the user has no timed reminder on "${SPOL().titulUzlu(app, auth, a.map_id, a.node_id)}" (list_reminders).`;
      if (a.reminder_id && !rem.some((r) => r.id === String(a.reminder_id))) return `Error: reminder "${String(a.reminder_id)}" not found on this node (list_reminders).`;
      if (!a.reminder_id && rem.length > 1) return `Error: the node has ${rem.length} reminders — pass reminder_id (list_reminders): ${rem.map((r) => `${r.id} (${r.fires_at})`).join(", ")}.`;
      return null;
    }
    // událost: tvar i účastníci se ověří PŘED kartou — model dostane chybu hned (neznámý
    // e-mail, špatný čas), uživatel nepotvrzuje něco, co server stejně odmítne
    case "create_event": {
      const E = require(`${__hooks}/events-api.js`);
      const v = E.validateEvent(a, "en", null);
      if (v.error) return `Error: ${v.error}`;
      if (v.data.participants && v.data.participants.length) {
        const p = E.resolveParticipants(app, v.data.participants, auth.id, "en");
        if (p.error) return `Error: ${p.error} Use list_people for valid e-mails.`;
      }
      return null;
    }
    // úprava/smazání události: existuje, je uživatelova (pozvaný ji neupravuje), změna je validní — chyba modelu
    // hned, ne po potvrzení (klik-test 4. 10.: „přidat připomínku“ k hotové události dřív nešlo vůbec)
    case "update_event": case "delete_event": {
      const E = require(`${__hooks}/events-api.js`);
      const ev = udalostZaznam(app, auth, a.event_id, a.day, name === "delete_event");
      if (!ev) return `Error: event "${String(a.event_id || "")}" not found among the user's ${name === "delete_event" ? "" : "own "}events (use list_events and pass the id${name === "delete_event" ? "" : "; an invited event can only be left — delete_event removes it from the user's calendar"}).`;
      if (name === "delete_event") return null;
      const zmeny = {};
      for (const k of ["title", "time", "note", "participants", "remind", "remind_before_min"]) if (a[k] !== undefined) zmeny[k] = a[k];
      if (a.new_day !== undefined) zmeny.day = a.new_day;
      if (!Object.keys(zmeny).length) return "Error: pass at least one change (title, new_day, time, note, participants, remind or remind_before_min).";
      if (zmeny.remind_before_min !== undefined && zmeny.remind === undefined) zmeny.remind = true;
      const v = E.validateEvent(zmeny, "en", ev);
      if (v.error) return `Error: ${v.error}`;
      if (v.data.participants && v.data.participants.length) {
        const p = E.resolveParticipants(app, v.data.participants, auth.id, "en");
        if (p.error) return `Error: ${p.error} Use list_people for valid e-mails.`;
      }
      return null;
    }
    // připomínka: uzel musí mít termín a čas nesmí být v minulosti — jinak by karta
    // slíbila připomenutí, které nepřijde (stejný důvod jako u chybaTerminovehoPravidla)
    case "create_reminder": {
      const chyba = chybaMapy(a.map_id) || chybaUzlu(a.map_id, a.node_id) || (a.node_id ? null : "Error: node_id is required.");
      if (chyba) return chyba;
      const E = require(`${__hooks}/events-api.js`);
      const { v1ReadableMap, jsonVal, dayMinusDays, nowLocalMinute } = require(`${__hooks}/helpers.js`);
      const mid = SPOL().mapaId(app, auth, a.map_id);
      const nid = SPOL().uzelId(app, auth, mid, a.node_id);
      const r = v1ReadableMap(app, mid, auth);
      const n = r ? jsonVal(r.map, "nodes", []).find((x) => x.id === nid) : null;
      const d = (n && n.data) || {};
      if (!E.validDay(d.deadline)) return `Error: the node "${d.title || a.node_id}" has no deadline — a reminder is tied to the deadline. First set the deadline with update_node (the user confirms), then call create_reminder.`;
      if (!E.TIME_RE.test(String(a.time || ""))) return `Error: time must be HH:MM (24h), got "${String(a.time || "")}".`;
      const off = a.offset_days === undefined ? 0 : Number(a.offset_days);
      if (!Number.isInteger(off) || off < 0 || off > E.MAX_OFFSET_DAYS) return `Error: offset_days must be an integer 0–${E.MAX_OFFSET_DAYS}.`;
      const kdy = dayMinusDays(String(d.deadline), off) + " " + a.time;
      if (kdy <= nowLocalMinute()) return `Error: the reminder would fire on ${kdy}, which has already passed (deadline ${d.deadline}). Choose a later time or a smaller offset.`;
      return null;
    }
    default: return null;
  }
}

function popisAkce(app, auth, L, name, a) {
  const cs = L !== "en";
  const { nazevMapy, uzelData, nazevUzlu } = SPOL().pojmenovani(app, auth);
  switch (name) {
    case "delete_reminder": {
      const rem = SPOL().pripominkyUzlu(app, auth, SPOL().mapaId(app, auth, a.map_id), SPOL().uzelId(app, auth, SPOL().mapaId(app, auth, a.map_id), a.node_id));
      const r0 = a.reminder_id ? rem.find((r) => r.id === String(a.reminder_id)) : rem[0];
      const kdy = r0 ? ` (${r0.fires_at})` : "";
      return cs ? `Zrušit připomínku ke kroku „${nazevUzlu(a.map_id, a.node_id)}“${kdy} — termín zůstává` : `Remove the reminder on "${nazevUzlu(a.map_id, a.node_id)}"${kdy} — the deadline stays`;
    }
    case "create_event": {
      const kdy = a.time ? `${SPOL().datumKratce(a.day, L)} ${a.time}` : (cs ? `${SPOL().datumKratce(a.day, L)} (celý den)` : `${SPOL().datumKratce(a.day, L)} (all day)`);
      const casti = [cs ? `Založit událost „${SPOL().ocisti(a.title, 120)}“ ${kdy}` : `Create the event "${SPOL().ocisti(a.title, 120)}" ${kdy}`];
      if (a.remind_before_min !== undefined) casti.push(cs ? `připomenout ${Number(a.remind_before_min) === 0 ? "v čas začátku" : `${a.remind_before_min} min předem`}` : `remind ${Number(a.remind_before_min) === 0 ? "at start" : `${a.remind_before_min} min before`}`);
      const lide = (Array.isArray(a.participants) ? a.participants : []).map((p) => SPOL().ocisti(p, 80)).filter(Boolean);
      if (lide.length) casti.push((cs ? "pozvat: " : "invite: ") + lide.join(", "));
      return casti.join(" · ");
    }
    case "update_event": case "delete_event": {
      const ev = udalostZaznam(app, auth, a.event_id, a.day, name === "delete_event");
      const nazev = ev ? ev.getString("title") : String(a.event_id || "");
      const kdyPuv = ev ? (ev.getString("time") ? `${SPOL().datumKratce(ev.getString("day"), L)} ${ev.getString("time")}` : SPOL().datumKratce(ev.getString("day"), L)) : "";
      if (name === "delete_event") {
        if (ev && ev.getString("owner") !== auth.id) return cs ? `Odhlásit se z události „${SPOL().ocisti(nazev, 120)}“ ${kdyPuv} (pořadateli zůstane)` : `Leave the event "${SPOL().ocisti(nazev, 120)}" ${kdyPuv} (the organizer keeps it)`;
        return cs ? `Smazat událost „${SPOL().ocisti(nazev, 120)}“ ${kdyPuv} — nejde vrátit, zmizí i pozvaným` : `Delete the event "${SPOL().ocisti(nazev, 120)}" ${kdyPuv} — cannot be undone, invitees lose it too`;
      }
      const z = [];
      if (a.title !== undefined) z.push(cs ? `název „${SPOL().ocisti(a.title, 120)}“` : `title "${SPOL().ocisti(a.title, 120)}"`);
      if (a.new_day !== undefined || a.time !== undefined) {
        const den = a.new_day !== undefined ? a.new_day : (ev ? ev.getString("day") : "");
        const cas = a.time !== undefined ? a.time : (ev ? ev.getString("time") : "");
        z.push((cs ? "přesunout na " : "move to ") + (cas ? `${SPOL().datumKratce(den, L)} ${cas}` : `${SPOL().datumKratce(den, L)}${cs ? " (celý den)" : " (all day)"}`));
      }
      if (a.remind === false) z.push(cs ? "zrušit připomínku" : "remove the reminder");
      else if (a.remind_before_min !== undefined) z.push(cs ? `připomenout ${Number(a.remind_before_min) === 0 ? "v čas začátku" : `${a.remind_before_min} min předem`}` : `remind ${Number(a.remind_before_min) === 0 ? "at start" : `${a.remind_before_min} min before`}`);
      else if (a.remind === true) z.push(cs ? "zapnout připomínku" : "turn the reminder on");
      if (a.participants !== undefined) z.push((cs ? "pozvaní: " : "invitees: ") + ((Array.isArray(a.participants) ? a.participants : []).map((p) => SPOL().ocisti(p, 80)).filter(Boolean).join(", ") || (cs ? "nikdo" : "nobody")));
      if (a.note !== undefined) z.push(cs ? "nová poznámka" : "new note");
      return (cs ? `Změnit událost „${SPOL().ocisti(nazev, 120)}“ (${kdyPuv}): ` : `Change the event "${SPOL().ocisti(nazev, 120)}" (${kdyPuv}): `) + z.join(" · ");
    }
    case "create_reminder": {
      const uzel = nazevUzlu(a.map_id, a.node_id);
      const termin = uzelData(a.map_id, a.node_id).deadline || "";
      const off = a.offset_days === undefined ? 0 : Number(a.offset_days);
      let den = "";
      try { const { dayMinusDays } = require(`${__hooks}/helpers.js`); if (/^\d{4}-\d{2}-\d{2}$/.test(termin)) den = dayMinusDays(termin, off); } catch (err) { /* bez dne */ }
      const kdy = cs
        ? (off === 0 ? "v den termínu" : off === 1 ? "den před termínem" : `${off} ${off <= 4 ? "dny" : "dní"} před termínem`) + (den ? ` (${SPOL().datumKratce(den, L)})` : "") + ` v ${a.time}`
        : (off === 0 ? "on the deadline day" : off === 1 ? "the day before the deadline" : `${off} days before the deadline`) + (den ? ` (${SPOL().datumKratce(den, L)})` : "") + ` at ${a.time}`;
      return cs ? `Připomenout „${uzel}“ (projekt „${nazevMapy(a.map_id)}“) ${kdy} — termín se nemění` : `Remind about "${uzel}" (project "${nazevMapy(a.map_id)}") ${kdy} — deadline unchanged`;
    }
    default: return "";
  }
}

module.exports = { NASTROJE, vykonej, overZapis, popisAkce, udalostZaznam };
