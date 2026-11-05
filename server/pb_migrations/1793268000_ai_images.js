/// <reference path="../pb_data/types.d.ts" />
// Obrázky asistenta (29. 10. 2026): FLUX.2 klein (ilustrace) / FLUX 3 Klein (obrázky s textem) na GPU serveru
// přes bránu (mode=image). Nástroj generate_image jen ZADÁ (stav „ceka“), prohlížeč pak zavolá
// /chat/obrazek/vytvorit — vzor Stránek (ai_pages). Zapisují VÝHRADNĚ routy /api/kb/chat/obrazek* a nástroje.
// Soubor je NECHRÁNĚNÝ (náhodné jméno + id záznamu): obrázek musí jít vložit do e-mailu (denní sumář)
// a do veřejné stránky /p/ — vzor org_settings.logo. Pravidla list/view jen pro vlastníka (realtime, karta).
// Razítko = aktuální čas (automigrate=0).
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const c = new Collection({
    type: "base",
    name: "ai_images",
    fields: [
      { name: "user", type: "relation", collectionId: usersId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "title", type: "text", max: 200 },
      // anglický popis pro model obrázků (píše ho model asistenta); strop = brána (3000)
      { name: "prompt", type: "text", max: 3000 },
      { name: "model", type: "select", maxSelect: 1, required: true, values: ["klein", "flux3"] },
      { name: "preset", type: "select", maxSelect: 1, required: true, values: ["ctverec", "banner", "hlavicka", "vysoky", "siroky"] },
      { name: "seed", type: "number", onlyInt: true, min: 0 },
      { name: "stav", type: "select", maxSelect: 1, required: true, values: ["ceka", "pise", "hotovo", "chyba"] },
      { name: "chyba", type: "text", max: 300 },
      { name: "file", type: "file", maxSelect: 1, maxSize: 8388608, mimeTypes: ["image/jpeg"], protected: false },
      { name: "gen_s", type: "number", min: 0 },
      { name: "chat", type: "text", max: 40 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX idx_ai_images_user_created ON ai_images (user, created)",
    ],
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: null, // jen server
    updateRule: null,
    deleteRule: null,
  });
  app.save(c);
}, (app) => {
  try { const c = app.findCollectionByNameOrId("ai_images"); if (c) app.delete(c); } catch (err) { /* už není */ }
});
