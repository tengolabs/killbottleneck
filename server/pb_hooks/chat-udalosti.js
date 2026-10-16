// Události v kalendáři a připomínky kroků přes asistenta: schémata, vykonání, kontroly před kartou a popisy karet.
// Vzniklo rozdělením chat.js po skupinách nástrojů (5. 10. 2026, bod 2 prověrky asistenta): kód přesunut DOSLOVA, chování beze změny.
// Sdílené resolvery (mapaId, uzelId, sDocasnymKlicem, …) jsou v chat-spolecne.js; chat.js skládá seznam nástrojů v PŮVODNÍM pořadí
// (PORADI_NASTROJU — pořadí schémat je součást prefixu promptu, cache musí držet) a podle `modul` u nástroje sem deleguje
// vykonej / overZapis / popisAkce. ⚠️ PocketBase JSVM: require() uvnitř funkcí (líné přístupové funkce níže).
const HOOKS = typeof __hooks !== "undefined" ? __hooks : __dirname; // mimo PocketBase (testy v node) složka souboru
const SPOL = () => require(`${HOOKS}/chat-spolecne.js`);

// Událost podle id, nebo podle názvu (přesně, pak jednoznačná částečná shoda; `day` zúží, když se název
// opakuje) → záznam nebo null. Bez iPozvane jen události, které uživatel SMÍ MĚNIT (vlastní, ve sdíleném
// kalendáři jako správce/manažer, vlastní nepřítomnost — pravaUdalosti); s iPozvane vše, co vidí.
function udalostZaznam(app, auth, ref, day, iPozvane) {
  const id = String(ref || "").trim();
  if (!id) return null;
  const E = require(`${HOOKS}/events-api.js`);
  const kal = E.kalendareMapa(app, auth);
  const smi = (r) => { const p = E.pravaUdalosti(auth, r, kal[r.getString("calendar")] || null); return iPozvane ? p.vidi : p.meni; };
  // id napřímo (starší událost by se do výpisu 1000 nejnovějších nevešla)
  try { const r = app.findRecordById("events", id); if (r && smi(r)) return r; } catch (err) { /* není id */ }
  let rows = [];
  try { rows = app.findRecordsByFilter("events", 'owner = {:u} || participants.id ?= {:u} || calendar != ""', "-day,-time", 1000, 0, { u: auth.id }); } catch (err) { rows = []; }
  rows = rows.filter(smi);
  const kand = day ? rows.filter((r) => r.getString("day") === String(day)) : rows;
  return SPOL().podleNazvu(kand, id, (r) => r.getString("title"));
}

// tělo události pro v1 z argumentů modelu: `person` (nepřítomnost „Jana má dovolenou“) = participants
const TELO_UDALOSTI = ["time", "end_day", "end_time", "note", "participants", "remind_before_min", "calendar"];
function teloUdalosti(a, klice) {
  const body = {};
  for (const k of klice) if (a[k] !== undefined) body[k] = a[k];
  if (a.person !== undefined && body.participants === undefined) body.participants = String(a.person || "").trim() ? [String(a.person).trim()] : [];
  return body;
}

// kolize zdroje (409) pro model: kolidující rezervace + první volný čas téhož dne
function textKolize(j) {
  const nf = j && j.next_free;
  return `Error 409: ${(j && j.error) || "the room is already booked then"}${nf ? ` Next free slot that day: ${nf.time}–${nf.end_time} — offer it to the user (ask_user) instead of giving up.` : " No free slot that day — ask the user for another day."}`;
}

// názvy sdílených kalendářů pro chybová hlášení modelu
function seznamKalendaru(app, auth) {
  const E = require(`${HOOKS}/events-api.js`);
  const n = Object.values(E.kalendareMapa(app, auth)).filter((c) => !c.getBool("archived")).map((c) => `"${c.getString("name")}" (${c.getString("kind")})`);
  return n.length ? n.join(", ") : "none yet";
}

const NASTROJE = [
  { name: "list_reminders", skupina: "udalosti", kind: "read", description: "The user's timed reminders on map steps (id, step, when it fires); optional map_id / node_id filter.",
    parameters: { type: "object", properties: { map_id: { type: "string" }, node_id: { type: "string" } }, required: [], additionalProperties: false } },
  { name: "delete_reminder", skupina: "udalosti", kind: "write", description: "Remove a timed reminder from a map step (the deadline stays). reminder_id from list_reminders; when the step has exactly one reminder of the user it may be omitted. The user confirms first.",
    parameters: { type: "object", properties: { map_id: { type: "string" }, node_id: { type: "string" }, reminder_id: { type: "string" } }, required: ["map_id", "node_id"], additionalProperties: false } },
  // události a časové připomínky (19. 9. 2026) — skupina `udalosti`, zápis přes v1 dočasným klíčem
  // + týmový kalendář (14. 10. 2026): sdílené kalendáře (firemní / zasedačka / nepřítomnosti), konec události, kdo je pryč
  { name: "create_event", skupina: "udalosti", kind: "write", description: "Create a calendar EVENT with a time (meeting, call, dentist, video conference…) — NOT a task and not part of any map. Personal by default; `calendar` (a shared calendar name from list_calendars) makes it a company event (kind shared), a room/car booking (kind resource — needs time, end_time defaults to +60 min, an overlapping booking is refused and the error names the next free slot) or time off (kind absence — all-day, end_day for a range, `person` = who is away, default the user). Optional participants (e-mails of instance members from list_people — each sees it in their calendar) and a reminder N minutes before (in-app + e-mail). The user confirms first.",
    parameters: { type: "object", properties: { title: { type: "string" }, day: { type: "string", description: "YYYY-MM-DD" }, time: { type: "string", description: "HH:MM (24h); omit for an all-day event" }, end_day: { type: "string", description: "YYYY-MM-DD; last day of a multi-day event (vacation)" }, end_time: { type: "string", description: "HH:MM (24h); end of a timed event (room booking, meeting length)" }, note: { type: "string" }, participants: { type: "array", items: { type: "string" }, description: "e-mails of instance members (from list_people)" }, person: { type: "string", description: "absence only: e-mail of the person who is away (omit = the user)" }, remind_before_min: { type: "integer", description: "reminder N minutes before start (0 = at start); omit for no reminder" }, calendar: { type: "string", description: "name of a shared calendar (list_calendars); omit for a personal event" } }, required: ["title", "day"], additionalProperties: false } },
  { name: "list_events", skupina: "udalosti", kind: "read", description: "The calendar events the user sees — own, invited and every event of the shared calendars (company events, room bookings, time off) — in a day range; default today−365 … +730. Optional calendar = one shared calendar only.",
    parameters: { type: "object", properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" }, calendar: { type: "string", description: "name of a shared calendar" } }, required: [], additionalProperties: false } },
  { name: "update_event", skupina: "udalosti", kind: "write", description: "Change an EXISTING calendar event: move it (new_day/time), set its end (end_day/end_time), rename it, edit the note or participants, move it between calendars (calendar; \"\" = personal), or set/change/remove its reminder (\"remind me an hour before\" on an event already created = update_event with remind_before_min 60; remind false removes it). event_id = the id from list_events or the create result, or the exact title (add day when the title repeats). The user may change their own events, events in shared calendars as admin/manager, and their own time off. Moving the day of a multi-day event keeps its length. The user confirms first.",
    parameters: { type: "object", properties: { event_id: { type: "string" }, day: { type: "string", description: "YYYY-MM-DD, only to find the event by title when several share it; combine with new_day to move it" }, title: { type: "string" }, new_day: { type: "string", description: "YYYY-MM-DD" }, time: { type: "string", description: "HH:MM (24h); empty string = all-day" }, end_day: { type: "string", description: "YYYY-MM-DD; empty string = single day" }, end_time: { type: "string", description: "HH:MM (24h); empty string = no end time" }, note: { type: "string" }, participants: { type: "array", items: { type: "string" }, description: "the FULL new list of participant e-mails" }, remind: { type: "boolean", description: "false = remove the reminder" }, remind_before_min: { type: "integer", description: "reminder N minutes before start (0 = at start)" }, calendar: { type: "string", description: "shared calendar name; empty string = personal" } }, required: ["event_id"], additionalProperties: false } },
  { name: "delete_event", skupina: "udalosti", kind: "write", description: "Delete a calendar event (own; in a shared calendar as admin/manager; invitees lose it too). If the user was only invited, they leave the event instead. event_id = id from list_events or the exact title. Cannot be undone. The user confirms first.",
    parameters: { type: "object", properties: { event_id: { type: "string" }, day: { type: "string", description: "YYYY-MM-DD, only to find the event by title" } }, required: ["event_id"], additionalProperties: false } },
  { name: "list_calendars", skupina: "udalosti", kind: "read", description: "The shared calendars of the team — company events (shared), rooms and other bookable things (resource), vacations and time off (absence) — with who may add entries and whether time off needs approval. Use the names in create_event / update_event `calendar`.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "who_is_away", skupina: "udalosti", kind: "read", description: "Who is away (vacation, time off from absence calendars) in a day range; default today … +14. One line per person and absence.",
    parameters: { type: "object", properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } }, required: [], additionalProperties: false } },
  { name: "create_calendar", skupina: "udalosti", kind: "write", description: "Create a SHARED calendar — only an admin or manager may (for a member: tell them to ask an admin). kind shared = company events; resource = a room, car or other bookable thing (overlapping bookings are refused); absence = vacations and time off (needs_approval true = new entries wait for an admin/manager decision; default false). visibility all = the whole team sees it (default); members = only the listed members (e-mails from list_people) + the creator and admins, like a project shared with chosen people. write_access admins = only admins/managers add entries (default all). The user confirms first.",
    parameters: { type: "object", properties: { name: { type: "string" }, kind: { type: "string", enum: ["shared", "resource", "absence"] }, color: { type: "string", description: "#RRGGBB" }, description: { type: "string" }, write_access: { type: "string", enum: ["all", "admins"] }, needs_approval: { type: "boolean" }, visibility: { type: "string", enum: ["all", "members"] }, members: { type: "array", items: { type: "string" }, description: "member e-mails who see the calendar (visibility members)" } }, required: ["name", "kind"], additionalProperties: false } },
  { name: "delete_calendar", skupina: "udalosti", kind: "write", description: "Delete a SHARED calendar (by name from list_calendars) together with ALL its events — admin or manager only, cannot be undone. The user confirms first.",
    parameters: { type: "object", properties: { calendar: { type: "string" } }, required: ["calendar"], additionalProperties: false } },
  { name: "decide_absence", skupina: "udalosti", kind: "write", description: "Approve or decline a TIME-OFF request (an absence waiting for approval) — admin or manager only. event_id from list_events / the request; note = reason or condition (shown to the requester). The user confirms first.",
    parameters: { type: "object", properties: { event_id: { type: "string" }, decision: { type: "string", enum: ["approved", "rejected"] }, note: { type: "string" } }, required: ["event_id", "decision"], additionalProperties: false } },
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
      const r = E.listEvents(app, auth, { from: a.from, to: a.to, calendar: a.calendar });
      const ev = (r.body && r.body.events) || [];
      if (!ev.length) return { text: `No events between ${r.body.from} and ${r.body.to}${a.calendar ? ` in calendar "${a.calendar}"` : ""}.` };
      return { text: M.DATA_FENCE + "\n\n" + ev.map((x) => `• ${M.renderEvent(x)}`).join("\n") };
    }
    case "list_calendars": {
      const E = require(`${__hooks}/events-api.js`);
      const r = E.listCalendars(app, auth);
      const c = ((r.body && r.body.calendars) || []).filter((x) => !x.archived);
      if (!c.length) return { text: "No shared calendars yet. An admin or manager can create them (create_calendar): e.g. company events, a meeting room, time off." };
      return { text: M.DATA_FENCE + "\n\n" + c.map((x) => `• ${M.renderCalendar(x)}`).join("\n") };
    }
    case "who_is_away": {
      const E = require(`${__hooks}/events-api.js`);
      const r = E.listAway(app, { from: a.from, to: a.to }, auth);
      const w = (r.body && r.body.away) || [];
      if (!w.length) return { text: `Nobody is away between ${r.body.from} and ${r.body.to}.` };
      return { text: M.DATA_FENCE + "\n\n" + w.map((x) => `• ${M.renderAway(x)}`).join("\n") };
    }
    case "create_calendar": {
      return SPOL().sDocasnymKlicem(app, auth, (v1) => {
        const body = { name: a.name, kind: a.kind };
        for (const k of ["color", "description", "write_access", "needs_approval", "visibility", "members"]) if (a[k] !== undefined) body[k] = a[k];
        const r = v1("POST", "/v1/calendars", body);
        if (r.status !== 200) return { text: SPOL().chybaV1(r) };
        return { text: `Calendar created: ${M.renderCalendar(r.json.calendar)}. Everyone in the team sees it; events go in via create_event with calendar "${r.json.calendar.name}". Tell the user only this.` };
      });
    }
    case "create_event": {
      return SPOL().sDocasnymKlicem(app, auth, (v1) => {
        const body = Object.assign({ title: a.title, day: a.day }, teloUdalosti(a, TELO_UDALOSTI));
        const r = v1("POST", "/v1/events", body);
        if (r.status === 409) return { text: textKolize(r.json) };
        if (r.status !== 200) return { text: SPOL().chybaV1(r) };
        const ev = r.json.event || {};
        const kdy = ev.remind ? ` Reminder fires ${ev.remind_before_min} min before start (in-app + e-mail if enabled), instance local time.` : "";
        const kal = ev.calendar_name ? ` It is in the shared calendar "${ev.calendar_name}" — the whole team sees it.` : "";
        return { text: `Event created: ${M.renderEvent(ev)}.${kal}${kdy} Tell the user only this.`, karta: { type: "vysledek", udalost_id: ev.id, udalost_den: ev.day } };
      });
    }
    case "update_event": {
      const ev = udalostZaznam(app, auth, a.event_id, a.day);
      if (!ev) return { text: "Error: event not found." };
      return SPOL().sDocasnymKlicem(app, auth, (v1) => {
        const body = teloUdalosti(a, ["title", "time", "end_day", "end_time", "note", "participants", "remind", "remind_before_min", "calendar"]);
        if (a.new_day !== undefined) body.day = a.new_day;
        if (body.remind_before_min !== undefined && body.remind === undefined) body.remind = true;
        const r = v1("POST", `/v1/events/${encodeURIComponent(ev.id)}`, body);
        if (r.status === 409) return { text: textKolize(r.json) };
        if (r.status !== 200) return { text: SPOL().chybaV1(r) };
        const e2 = r.json.event || {};
        const kdy = e2.remind ? ` Reminder fires ${e2.remind_before_min} min before start (in-app + e-mail if enabled), instance local time.` : " No reminder.";
        return { text: `Event updated: ${M.renderEvent(e2)}.${kdy} Tell the user only this.`, karta: { type: "vysledek", udalost_id: e2.id, udalost_den: e2.day } };
      });
    }
    case "delete_event": {
      const ev = udalostZaznam(app, auth, a.event_id, a.day, true);
      if (!ev) return { text: "Error: event not found." };
      const E = require(`${__hooks}/events-api.js`);
      const prava = E.pravaUdalosti(auth, ev, E.kalendarUdalosti(app, ev));
      const pozvany = !prava.meni; // kdo nesmí měnit, událost opouští (pozvaný) — jako v kalendáři
      if (pozvany && !prava.ucastnik) return { text: `Error: the user is not invited to "${ev.getString("title")}" and cannot change it — only its creator, or an admin or manager for a shared calendar. Tell the user.` };
      return SPOL().sDocasnymKlicem(app, auth, (v1) => {
        const r = v1("POST", `/v1/events/${encodeURIComponent(ev.id)}/${pozvany ? "leave" : "delete"}`, {});
        if (r.status !== 200) return { text: SPOL().chybaV1(r) };
        const kdy = `${ev.getString("day")}${ev.getString("time") ? " " + ev.getString("time") : ""}`;
        return { text: pozvany ? `The user left the event "${ev.getString("title")}" (${kdy}); it stays in the organizer's calendar.` : `Event "${ev.getString("title")}" (${kdy}) deleted.` };
      });
    }
    case "delete_calendar": {
      const E = require(`${__hooks}/events-api.js`);
      const c = E.kalendarZaznam(app, a.calendar, { user: auth });
      if (!c) return { text: `Error: calendar "${String(a.calendar || "")}" not found (list_calendars).` };
      return SPOL().sDocasnymKlicem(app, auth, (v1) => {
        const r = v1("POST", `/v1/calendars/${encodeURIComponent(c.id)}/delete`, {});
        if (r.status !== 200) return { text: SPOL().chybaV1(r) };
        return { text: `Calendar "${c.getString("name")}" deleted with ${r.json.events_deleted} event(s). Tell the user only this.` };
      });
    }
    case "decide_absence": {
      const ev = udalostZaznam(app, auth, a.event_id, "", true);
      if (!ev) return { text: "Error: event not found." };
      return SPOL().sDocasnymKlicem(app, auth, (v1) => {
        const r = v1("POST", `/v1/events/${encodeURIComponent(ev.id)}/decide`, { decision: a.decision, note: a.note || "" });
        if (r.status !== 200) return { text: SPOL().chybaV1(r) };
        const M2 = require(`${__hooks}/mcp-tools.js`);
        return { text: `Time off ${a.decision}: ${M2.renderEvent(r.json.event)}. The requester and the person away were notified. Tell the user only this.`, karta: { type: "vysledek", udalost_id: ev.id, udalost_den: ev.getString("day") } };
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
      const body = Object.assign({ title: a.title, day: a.day }, teloUdalosti(a, TELO_UDALOSTI));
      const v = E.validateEvent(body, "en", null);
      if (v.error) return `Error: ${v.error}`;
      // sdílený kalendář: existuje, není archivovaný, uživatel do něj smí; zdroj = kolize ještě PŘED kartou
      let cal = null;
      if (v.data.calendar) {
        cal = E.kalendarZaznam(app, v.data.calendar, { user: auth });
        if (!cal) return `Error: calendar "${String(v.data.calendar)}" not found. Shared calendars: ${seznamKalendaru(app, auth)}. Omit calendar for a personal event.`;
        const w = E.smiZapisovat(auth, cal, "en");
        if (w.error) return `Error: ${w.error.body.error}`;
      }
      if (v.data.participants && v.data.participants.length) {
        const p = E.resolveParticipants(app, v.data.participants, auth.id, "en", { keepOwner: !!cal && cal.getString("kind") === "absence" });
        if (p.error) return `Error: ${p.error} Use list_people for valid e-mails.`;
      }
      const cr = E.checkEventRange({ day: v.data.day, time: v.data.time || "", end_day: v.data.end_day || "", end_time: v.data.end_time || "" }, cal, "en");
      if (cr.error) return `Error: ${cr.error}`;
      if (cal && cal.getString("kind") === "resource") {
        const k = E.najdiKolizi(app, cal.id, cr.data, "");
        if (k) { const kr = E.rozsahUdalosti(k.rec); return textKolize({ error: `"${cal.getString("name")}" is already booked then: "${k.rec.getString("title")}" ${kr.od.slice(11)}–${kr.do.slice(11)}.`, next_free: k.next_free }); }
      }
      return null;
    }
    case "create_calendar": {
      const E = require(`${__hooks}/events-api.js`);
      const { jeAdminNeboManazer, normText } = require(`${__hooks}/helpers.js`);
      if (!jeAdminNeboManazer(auth)) return "Error: only an admin or manager can create shared calendars. Tell the user to ask an admin (or an admin can do it in Organization settings).";
      const name = String(a.name || "").trim();
      if (!name) return "Error: name is required.";
      if (E.CALENDAR_KINDS.indexOf(String(a.kind || "")) < 0) return `Error: kind must be one of ${E.CALENDAR_KINDS.join(", ")}.`;
      const n = normText(name);
      if (Object.values(E.kalendareMapa(app)).some((c) => normText(c.getString("name")) === n)) return `Error: a calendar named "${name}" already exists (list_calendars).`;
      if (a.members !== undefined) {
        if (!Array.isArray(a.members)) return "Error: members must be an array of member e-mails.";
        const p = E.resolveParticipants(app, a.members, auth.id, "en", { keepOwner: true });
        if (p.error) return `Error: ${p.error} Use list_people for valid e-mails.`;
      }
      return null;
    }
    // úprava/smazání události: existuje, uživatel ji smí měnit (pozvaný ji jen opouští), změna je validní — chyba modelu
    // hned, ne po potvrzení (klik-test 4. 10.: „přidat připomínku“ k hotové události dřív nešlo vůbec)
    case "update_event": case "delete_event": {
      const E = require(`${__hooks}/events-api.js`);
      const ev = udalostZaznam(app, auth, a.event_id, a.day, name === "delete_event");
      if (!ev) return `Error: event "${String(a.event_id || "")}" not found among the user's ${name === "delete_event" ? "" : "own "}events${name === "delete_event" ? "" : " (nor among shared-calendar events the user may change)"} (use list_events and pass the id${name === "delete_event" ? "" : "; an invited event can only be left — delete_event removes it from the user's calendar"}).`;
      if (name === "delete_event") return null;
      const zmeny = teloUdalosti(a, ["title", "time", "end_day", "end_time", "note", "participants", "remind", "remind_before_min", "calendar"]);
      if (a.new_day !== undefined) zmeny.day = a.new_day;
      if (!Object.keys(zmeny).length) return "Error: pass at least one change (title, new_day, time, end_day, end_time, note, participants, calendar, remind or remind_before_min).";
      if (zmeny.remind_before_min !== undefined && zmeny.remind === undefined) zmeny.remind = true;
      const v = E.validateEvent(zmeny, "en", ev);
      if (v.error) return `Error: ${v.error}`;
      let cal = E.kalendarUdalosti(app, ev);
      if (v.data.calendar !== undefined) {
        if (!v.data.calendar) cal = null;
        else {
          const c = E.kalendarZaznam(app, v.data.calendar, { user: auth });
          if (!c) return `Error: calendar "${String(v.data.calendar)}" not found. Shared calendars: ${seznamKalendaru(app, auth)}.`;
          if (c.id !== ev.getString("calendar")) { const w = E.smiZapisovat(auth, c, "en"); if (w.error) return `Error: ${w.error.body.error}`; }
          cal = c;
        }
      }
      if (v.data.participants && v.data.participants.length) {
        const p = E.resolveParticipants(app, v.data.participants, auth.id, "en", { keepOwner: !!cal && cal.getString("kind") === "absence" });
        if (p.error) return `Error: ${p.error} Use list_people for valid e-mails.`;
      }
      const eff = {
        day: v.data.day !== undefined ? v.data.day : ev.getString("day"),
        time: v.data.time !== undefined ? v.data.time : ev.getString("time"),
        end_day: v.data.end_day !== undefined ? v.data.end_day : ev.getString("end_day"),
        end_time: v.data.end_time !== undefined ? v.data.end_time : ev.getString("end_time"),
      };
      const cr = E.checkEventRange(eff, cal, "en");
      if (cr.error) return `Error: ${cr.error}`;
      if (cal && cal.getString("kind") === "resource") {
        const k = E.najdiKolizi(app, cal.id, cr.data, ev.id);
        if (k) { const kr = E.rozsahUdalosti(k.rec); return textKolize({ error: `"${cal.getString("name")}" is already booked then: "${k.rec.getString("title")}" ${kr.od.slice(11)}–${kr.do.slice(11)}.`, next_free: k.next_free }); }
      }
      return null;
    }
    case "delete_calendar": {
      const E = require(`${__hooks}/events-api.js`);
      const { jeAdminNeboManazer } = require(`${__hooks}/helpers.js`);
      if (!jeAdminNeboManazer(auth)) return "Error: only an admin or manager can delete shared calendars.";
      if (!E.kalendarZaznam(app, a.calendar, { user: auth })) return `Error: calendar "${String(a.calendar || "")}" not found. Shared calendars: ${seznamKalendaru(app, auth)}.`;
      return null;
    }
    case "decide_absence": {
      const E = require(`${__hooks}/events-api.js`);
      const { jeAdminNeboManazer } = require(`${__hooks}/helpers.js`);
      if (!jeAdminNeboManazer(auth)) return "Error: only an admin or manager can approve time off.";
      const ev = udalostZaznam(app, auth, a.event_id, "", true);
      if (!ev) return `Error: event "${String(a.event_id || "")}" not found (use list_events and pass the id).`;
      const cal = E.kalendarUdalosti(app, ev);
      if (!cal || cal.getString("kind") !== "absence") return "Error: this event is not time off (absence calendar).";
      if (!ev.getString("status")) return "Error: this time off needs no approval (the calendar has approval switched off).";
      if (a.decision !== "approved" && a.decision !== "rejected") return "Error: decision must be approved or rejected.";
      if (String(a.note || "").length > 500) return "Error: note is too long (max 500 characters).";
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

// „20. 10. 14:00–15:00“ · „20. 10.–24. 10. (celý den)“ · „20. 10. (celý den)“; bezCelyDen = u původního času vynechat „(celý den)“
function kdyUdalosti(day, time, endDay, endTime, L, bezCelyDen) {
  const cs = L !== "en";
  const d1 = SPOL().datumKratce(day, L);
  const d2 = endDay && endDay !== day ? SPOL().datumKratce(endDay, L) : "";
  if (time) {
    if (d2) return `${d1} ${time} → ${d2}${endTime ? " " + endTime : ""}`;
    return `${d1} ${time}${endTime ? "–" + endTime : ""}`;
  }
  const dny = d2 ? `${d1}–${d2}` : d1;
  return bezCelyDen ? dny : `${dny} ${cs ? "(celý den)" : "(all day)"}`;
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
      const E = require(`${__hooks}/events-api.js`);
      const cal = a.calendar ? E.kalendarZaznam(app, a.calendar) : null;
      const kind = cal ? cal.getString("kind") : "";
      // zdroj bez konce = +60 min (stejně jako server) — karta ukáže skutečný rozsah rezervace
      const cr = E.checkEventRange({ day: a.day, time: a.time || "", end_day: a.end_day || "", end_time: a.end_time || "" }, cal, "en");
      const rozsah = cr.data || { day: a.day, time: a.time, end_day: a.end_day, end_time: a.end_time };
      const kdy = kdyUdalosti(rozsah.day, rozsah.time, rozsah.end_day, rozsah.end_time, L);
      const casti = [];
      if (kind === "absence") {
        const kdo = SPOL().ocisti(a.person || (Array.isArray(a.participants) && a.participants.length ? a.participants.join(", ") : ""), 160) || (cs ? "vy" : "you");
        casti.push(cs ? `Zapsat nepřítomnost: ${kdo} ${kdy} („${SPOL().ocisti(a.title, 120)}“)` : `Record time off: ${kdo} ${kdy} ("${SPOL().ocisti(a.title, 120)}")`);
      } else if (kind === "resource") {
        casti.push(cs ? `Rezervovat „${cal.getString("name")}“ ${kdy} — „${SPOL().ocisti(a.title, 120)}“` : `Book "${cal.getString("name")}" ${kdy} — "${SPOL().ocisti(a.title, 120)}"`);
      } else {
        casti.push(cs ? `Založit událost „${SPOL().ocisti(a.title, 120)}“ ${kdy}` : `Create the event "${SPOL().ocisti(a.title, 120)}" ${kdy}`);
      }
      if (cal && kind !== "resource") casti.push(cs ? `do kalendáře „${cal.getString("name")}“` : `in the calendar "${cal.getString("name")}"`);
      if (a.remind_before_min !== undefined) casti.push(cs ? `připomenout ${Number(a.remind_before_min) === 0 ? "v čas začátku" : `${a.remind_before_min} min předem`}` : `remind ${Number(a.remind_before_min) === 0 ? "at start" : `${a.remind_before_min} min before`}`);
      const lide = kind === "absence" ? [] : (Array.isArray(a.participants) ? a.participants : []).map((p) => SPOL().ocisti(p, 80)).filter(Boolean);
      if (lide.length) casti.push((cs ? "pozvat: " : "invite: ") + lide.join(", "));
      return casti.join(" · ");
    }
    case "create_calendar": {
      const druh = { shared: cs ? "společné akce" : "company events", resource: cs ? "místnost / zdroj, rezervace se nepřekrývají" : "room / resource, no overlapping bookings", absence: cs ? "nepřítomnosti" : "time off" }[String(a.kind)] || String(a.kind || "");
      const z = [cs ? `Založit sdílený kalendář „${SPOL().ocisti(a.name, 80)}“ (${druh})` : `Create the shared calendar "${SPOL().ocisti(a.name, 80)}" (${druh})`];
      if (a.visibility === "members") z.push((cs ? "uvidí jen: " : "visible only to: ") + ((Array.isArray(a.members) ? a.members : []).map((p) => SPOL().ocisti(p, 80)).filter(Boolean).join(", ") || (cs ? "zakladatel a správci" : "the creator and admins")));
      if (a.write_access === "admins") z.push(cs ? "zapisuje jen správce a manažer" : "only admins and managers add entries");
      if (a.needs_approval) z.push(cs ? "nepřítomnosti se schvalují" : "time off needs approval");
      return z.join(" · ");
    }
    case "update_event": case "delete_event": {
      const E = require(`${__hooks}/events-api.js`);
      const ev = udalostZaznam(app, auth, a.event_id, a.day, name === "delete_event");
      const nazev = ev ? ev.getString("title") : String(a.event_id || "");
      const kdyPuv = ev ? kdyUdalosti(ev.getString("day"), ev.getString("time"), ev.getString("end_day"), ev.getString("end_time"), L, true) : "";
      const calPuv = ev ? E.kalendarUdalosti(app, ev) : null;
      if (name === "delete_event") {
        if (ev && !E.pravaUdalosti(auth, ev, calPuv).meni) return cs ? `Odhlásit se z události „${SPOL().ocisti(nazev, 120)}“ ${kdyPuv} (pořadateli zůstane)` : `Leave the event "${SPOL().ocisti(nazev, 120)}" ${kdyPuv} (the organizer keeps it)`;
        const kde = calPuv ? (cs ? ` z kalendáře „${calPuv.getString("name")}“` : ` from the calendar "${calPuv.getString("name")}"`) : "";
        return cs ? `Smazat událost „${SPOL().ocisti(nazev, 120)}“ ${kdyPuv}${kde} — nejde vrátit, zmizí i ${calPuv ? "ostatním" : "pozvaným"}` : `Delete the event "${SPOL().ocisti(nazev, 120)}" ${kdyPuv}${kde} — cannot be undone, ${calPuv ? "others" : "invitees"} lose it too`;
      }
      const z = [];
      if (a.title !== undefined) z.push(cs ? `název „${SPOL().ocisti(a.title, 120)}“` : `title "${SPOL().ocisti(a.title, 120)}"`);
      if (a.new_day !== undefined || a.time !== undefined || a.end_day !== undefined || a.end_time !== undefined) {
        const den = a.new_day !== undefined ? a.new_day : (ev ? ev.getString("day") : "");
        const cas = a.time !== undefined ? a.time : (ev ? ev.getString("time") : "");
        let konecDen = a.end_day !== undefined ? a.end_day : (ev ? ev.getString("end_day") : "");
        if (a.new_day !== undefined && a.end_day === undefined && ev && ev.getString("end_day")) konecDen = ""; // délku dopočítá server
        const konecCas = a.end_time !== undefined ? a.end_time : (ev ? ev.getString("end_time") : "");
        z.push((cs ? "přesunout na " : "move to ") + kdyUdalosti(den, cas, konecDen, konecCas, L, true));
      }
      if (a.calendar !== undefined) {
        const c = a.calendar ? E.kalendarZaznam(app, a.calendar) : null;
        z.push(a.calendar ? (cs ? `do kalendáře „${c ? c.getString("name") : SPOL().ocisti(a.calendar, 80)}“` : `into the calendar "${c ? c.getString("name") : SPOL().ocisti(a.calendar, 80)}"`) : (cs ? "jako osobní událost" : "as a personal event"));
      }
      if (a.remind === false) z.push(cs ? "zrušit připomínku" : "remove the reminder");
      else if (a.remind_before_min !== undefined) z.push(cs ? `připomenout ${Number(a.remind_before_min) === 0 ? "v čas začátku" : `${a.remind_before_min} min předem`}` : `remind ${Number(a.remind_before_min) === 0 ? "at start" : `${a.remind_before_min} min before`}`);
      else if (a.remind === true) z.push(cs ? "zapnout připomínku" : "turn the reminder on");
      if (a.participants !== undefined || a.person !== undefined) {
        const lide = (a.person !== undefined ? [a.person] : (Array.isArray(a.participants) ? a.participants : [])).map((p) => SPOL().ocisti(p, 80)).filter(Boolean).join(", ");
        const absence = calPuv && calPuv.getString("kind") === "absence";
        z.push((absence ? (cs ? "kdo je pryč: " : "who is away: ") : (cs ? "pozvaní: " : "invitees: ")) + (lide || (cs ? "nikdo" : "nobody")));
      }
      if (a.note !== undefined) z.push(cs ? "nová poznámka" : "new note");
      return (cs ? `Změnit událost „${SPOL().ocisti(nazev, 120)}“ (${kdyPuv}): ` : `Change the event "${SPOL().ocisti(nazev, 120)}" (${kdyPuv}): `) + z.join(" · ");
    }
    case "delete_calendar": {
      const E = require(`${__hooks}/events-api.js`);
      const c = E.kalendarZaznam(app, a.calendar, { user: auth });
      const n = c ? E.calendarDto(c, auth, app).events_count : 0;
      const nazev = SPOL().ocisti(c ? c.getString("name") : String(a.calendar || ""), 80);
      return cs ? `Smazat sdílený kalendář „${nazev}“ i s ${n} ${n === 1 ? "událostí" : n >= 2 && n <= 4 ? "událostmi" : "událostmi"} — nejde vrátit` : `Delete the shared calendar "${nazev}" with its ${n} event(s) — cannot be undone`;
    }
    case "decide_absence": {
      const E = require(`${__hooks}/events-api.js`);
      const ev = udalostZaznam(app, auth, a.event_id, "", true);
      const d = ev ? E.eventDto(app, ev, auth) : null;
      const kdo = d ? (d.away || []).map((p) => SPOL().ocisti(p, 80)).join(", ") : String(a.event_id || "");
      const kdy = d ? kdyUdalosti(d.day, "", d.end_day, "", L, true) : "";
      const nazev = d ? ` („${SPOL().ocisti(d.title, 120)}“)` : "";
      const pozn = a.note ? (cs ? ` — ${SPOL().ocisti(a.note, 200)}` : ` — ${SPOL().ocisti(a.note, 200)}`) : "";
      if (a.decision === "rejected") return cs ? `Zamítnout nepřítomnost: ${kdo} ${kdy}${nazev}${pozn}` : `Decline the time off: ${kdo} ${kdy}${nazev.replace(/[„“]/g, '"')}${pozn}`;
      return cs ? `Schválit nepřítomnost: ${kdo} ${kdy}${nazev}${pozn}` : `Approve the time off: ${kdo} ${kdy}${nazev.replace(/[„“]/g, '"')}${pozn}`;
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
