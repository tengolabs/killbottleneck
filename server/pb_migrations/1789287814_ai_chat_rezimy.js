/// <reference path="../pb_data/types.d.ts" />
// AI chat na boku — režimy rozhovoru a paměť projektů (13. 9. 2026, zpětná
// vazba Richarda): ai_chats.mode (volny | rozbor | porada) + target (json:
// cíl průvodce — mapa/uzel), ai_memory.map (prázdné = paměť o uživateli,
// id mapy = poznámky asistenta k projektu) → unikát (user, map) místo (user).
migrate((app) => {
  const chats = app.findCollectionByNameOrId("ai_chats");
  chats.fields.add(new TextField({ name: "mode", max: 20 }));
  chats.fields.add(new JSONField({ name: "target", maxSize: 4000 }));
  app.save(chats);
  const mem = app.findCollectionByNameOrId("ai_memory");
  mem.fields.add(new TextField({ name: "map", max: 40 }));
  mem.indexes = ["CREATE UNIQUE INDEX idx_ai_memory_user_map ON ai_memory (user, map)"];
  app.save(mem);
}, (app) => {
  const mem = app.findCollectionByNameOrId("ai_memory");
  mem.fields.removeByName("map");
  mem.indexes = ["CREATE UNIQUE INDEX idx_ai_memory_user ON ai_memory (user)"];
  app.save(mem);
  const chats = app.findCollectionByNameOrId("ai_chats");
  chats.fields.removeByName("mode");
  chats.fields.removeByName("target");
  app.save(chats);
});
