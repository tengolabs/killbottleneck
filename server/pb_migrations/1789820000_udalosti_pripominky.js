/// <reference path="../pb_data/types.d.ts" />
// Události a časové připomínky (19. 9. 2026, Richard 18. 9.: „notifikace s časem,
// i na věci bez projektu — telekonference, zubař; a k úkolům v mapě").
//
// ⚠️ `events` je VĚDOMÉ PROLOMENÍ pravidla „nic nestojí samo" (projekt → uzel),
// stejně jako zásobník nápadů (buffer_nodes): událost NENÍ úkol, nikdy se
// nesype do mapy ani do node.data. Je to osobní položka kalendáře s časem,
// účastníky (existující uživatelé instance) a připomínkou.
//
// `node_reminders` = připomínka k uzlu mapy PER UŽIVATEL. Žije MIMO node.data
// (termín je dohoda, připomínka je moje soukromá věc) — proto se ničeho v JSON
// mapy nedotýká a canonicalNodeData zůstává beze změny. Je RELATIVNÍ k termínu
// (offset_days + time): `day` je jen denormalizace pro cron a server ji
// přepočítá po každém uložení mapy (syncNodeReminders).
//
// Zápis do obou kolekcí jde VÝHRADNĚ přes routy (events-api.js): účastníci
// podle e-mailu, validace HH:MM, notifikace „pozván", reset po přesunu — to
// přes holé PocketBase CRUD hlídat nejde. Čtení přes RLS (list/view) zůstává,
// aby fungoval realtime v kalendáři. Zrcadlo `participants` NENÍ autorizace
// pro zápis (ten dělá routa), jen pro čtení.
//
// Čas je LOKÁLNÍ ČAS INSTANCE (env TZ) jako řetězce YYYY-MM-DD + HH:MM —
// stejná konvence jako deadline (řetězcové porovnání, žádné TZ posuny).
// Razítko = aktuální čas (automigrate=0, starší by PB přeskočil).
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const mapsId = app.findCollectionByNameOrId("goalmaps").id;

  const events = new Collection({
    type: "base",
    name: "events",
    fields: [
      { name: "owner", type: "relation", collectionId: usersId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "title", type: "text", required: true, max: 200 },
      { name: "day", type: "text", required: true, pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      // "" = celodenní (připomínka pak chodí v KB_DEADLINE_HOUR)
      { name: "time", type: "text", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" },
      { name: "note", type: "text", max: 2000 },
      { name: "participants", type: "relation", collectionId: usersId, maxSelect: 50, cascadeDelete: false },
      { name: "remind", type: "bool" },
      { name: "remind_before_min", type: "number", onlyInt: true, min: 0, max: 10080 },
      // "" = ještě nevystřeleno; routa save ho nuluje při změně dne/času/připomínky
      { name: "reminded_at", type: "text", max: 30 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX idx_events_owner_day ON events (owner, day)",
      "CREATE INDEX idx_events_due ON events (remind, reminded_at, day)",
    ],
    listRule: "owner = @request.auth.id || participants.id ?= @request.auth.id",
    viewRule: "owner = @request.auth.id || participants.id ?= @request.auth.id",
    createRule: null, // jen server (routy /api/kb/events*)
    updateRule: null,
    deleteRule: null,
  });
  app.save(events);

  const reminders = new Collection({
    type: "base",
    name: "node_reminders",
    fields: [
      { name: "owner", type: "relation", collectionId: usersId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "map", type: "relation", collectionId: mapsId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "node_id", type: "text", required: true, max: 60 },
      // 0 = v den termínu, 1 = den předem, … (max měsíc)
      { name: "offset_days", type: "number", onlyInt: true, min: 0, max: 30 },
      { name: "time", type: "text", required: true, pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" },
      // denormalizace deadline − offset_days; přepočítává server po uložení mapy
      { name: "day", type: "text", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      { name: "fired_at", type: "text", max: 30 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      // jedna připomínka na člověka a uzel (anti-bloat: žádný seznam připomínek, upsert)
      "CREATE UNIQUE INDEX idx_node_reminders_one ON node_reminders (owner, map, node_id)",
      "CREATE INDEX idx_node_reminders_due ON node_reminders (fired_at, day)",
    ],
    listRule: "owner = @request.auth.id",
    viewRule: "owner = @request.auth.id",
    createRule: null, // jen server (routy /api/kb/node-reminders*)
    updateRule: null,
    deleteRule: null,
  });
  app.save(reminders);

  // notifikace: dva nové typy + odkaz na událost (vzor 1786694910)
  const col = app.findCollectionByNameOrId("notifications");
  const f = col.fields.getByName("type");
  for (const v of ["reminder", "event_invited"]) {
    if (f.values.indexOf(v) < 0) f.values = f.values.concat([v]);
  }
  col.fields.add(new TextField({ name: "event_id", max: 40 }));
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("notifications");
  const f = col.fields.getByName("type");
  f.values = f.values.filter((v) => v !== "reminder" && v !== "event_invited");
  col.fields.removeByName("event_id");
  app.save(col);
  for (const name of ["node_reminders", "events"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (err) { /* už není */ }
  }
});
