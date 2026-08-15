/// <reference path="../pb_data/types.d.ts" />
// Instanční nastavení vzhledu (a budoucí ne-AI defaulty) — jediný záznam,
// kolekce ZAMČENÁ (vzor ai_settings; záměrně NErozšiřujeme ai_settings, ta drží
// AI token a je sémanticky jinde). Zápis jen přes admin routu /api/kb/instance-skin,
// čtení pro frontend přes veřejný GET /api/kb/config (skin není tajemství —
// obarvuje i přihlašovací obrazovku).
migrate((app) => {
  const c = new Collection({
    type: "base",
    name: "instance_settings",
    fields: [
      { name: "skin", type: "json", maxSize: 8192 },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("instance_settings");
  if (c) app.delete(c);
});
