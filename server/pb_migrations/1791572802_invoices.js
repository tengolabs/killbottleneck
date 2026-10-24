/// <reference path="../pb_data/types.d.ts" />
// Vystavené faktury (asistent, 9. 10. 2026). Faktura je NEMĚNNÁ: nese snímek dodavatele (`supplier`) i odběratele
// (`customer`) z okamžiku vystavení — pozdější změna adresy klienta ji nemění a PDF jde kdykoli vygenerovat
// znovu 1:1 (PDF se NIKDY neukládá, jen data — Cloud Lite cizí soubory neukládá). Oprava = nová faktura.
// Částky (`subtotal`, `vat`, `total`) počítá VÝHRADNĚ server z položek — model žádné částky nepočítá.
// Číselná řada: jedna na instanci a rok (`year`, `number`), BEZ DĚR — unikátní index je jediná pravda,
// číslo přiděluje faktury.js v transakci (MAX+1 + opakování při kolizi), NE čítač jako project_number.
// Vidí vystavující a správce; zápis jen server (routy /chat/faktura*, nástroje asistenta).
// KB NENÍ archiv daňových dokladů — zákonnou povinnost (10 let) má zákazník, PDF si stáhne.
// Razítko = aktuální čas (automigrate=0).
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const clientsId = app.findCollectionByNameOrId("clients").id;
  const c = new Collection({
    type: "base",
    name: "invoices",
    fields: [
      { name: "user", type: "relation", collectionId: usersId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "client", type: "relation", collectionId: clientsId, maxSelect: 1 },
      { name: "cislo", type: "text", max: 20, required: true },
      { name: "year", type: "number", onlyInt: true, min: 2000, required: true },
      { name: "number", type: "number", onlyInt: true, min: 1, required: true },
      { name: "issued", type: "text", max: 10 },
      { name: "due", type: "text", max: 10 },
      { name: "supplier", type: "json", maxSize: 4096 },
      { name: "customer", type: "json", maxSize: 2048 },
      { name: "items", type: "json", maxSize: 16384 },
      { name: "vat_payer", type: "bool" },
      { name: "vat_rate", type: "number", min: 0, max: 100 },
      { name: "subtotal", type: "number" },
      { name: "vat", type: "number" },
      { name: "total", type: "number" },
      { name: "currency", type: "text", max: 3 },
      { name: "note", type: "text", max: 500 },
      { name: "paid_on", type: "text", max: 10 },
      { name: "chat", type: "text", max: 40 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_invoices_rada ON invoices (year, number)",
      "CREATE INDEX idx_invoices_user_created ON invoices (user, created)",
    ],
    listRule: 'user = @request.auth.id || @request.auth.role = "admin"',
    viewRule: 'user = @request.auth.id || @request.auth.role = "admin"',
    createRule: null, // jen server
    updateRule: null,
    deleteRule: null,
  });
  app.save(c);
}, (app) => {
  try { const c = app.findCollectionByNameOrId("invoices"); if (c) app.delete(c); } catch (err) { /* už není */ }
});
