/// <reference path="../pb_data/types.d.ts" />
// Odeslaná hlášení chyb a nápadů.
//
// Richard 18. 8. 2026 při klik-testu: „ještě bych tam dal, co jsem odeslal za
// hlášení, ať vím, co už jsem nahlásil a nedělám to znovu."
//
// Proč se ukládá na SERVER a ne do prohlížeče: seznam má smysl i na jiném
// počítači a hlavně — dosud hlášení existovalo jen jako odeslaný mail. Když
// selhalo SMTP, ztratilo se úplně a uživatel se to nedozvěděl. Záznam vzniká
// PŘED odesláním, takže neodeslané hlášení zůstane aspoň v evidenci a nese
// příznak `sent: false`.
// ⚠️ Znovuodeslání z UI zatím NENÍ — uživatel vidí jen štítek „neodesláno".
// (Původní znění tady slibovalo „jde ho poslat znovu", což nebyla pravda;
// nález kontrolního panelu 19. 8. 2026.)
//
// Zapisuje POUZE routa /api/kb/report (createRule null): text jde do mailu
// a musí projít kontrolami a rate limitem, ne přímým zápisem do kolekce.
// Číst smí každý jen svoje — hlášení může obsahovat cokoli, včetně toho, co
// dotyčný nechce ukazovat kolegům, natož adminovi cizí instance.
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;

  const reports = new Collection({
    type: "base",
    name: "reports",
    fields: [
      { name: "kind", type: "text", required: true, max: 20 },      // chyba | napad
      { name: "text", type: "text", required: true, max: 5000 },
      { name: "page", type: "text", max: 300 },
      { name: "browser", type: "text", max: 300 },
      { name: "version", type: "text", max: 60 },
      { name: "owner", type: "relation", collectionId: usersId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "owner_email", type: "email" },
      { name: "sent", type: "bool" },                                // odešel mail?
      { name: "created", type: "autodate", onCreate: true },
    ],
    indexes: [
      "CREATE INDEX idx_reports_owner ON reports (owner, created)",
    ],
    listRule: 'owner = @request.auth.id',
    viewRule: 'owner = @request.auth.id',
    createRule: null,   // jen routa /report
    updateRule: null,
    deleteRule: null,   // co bylo nahlášeno, se nepřepisuje ani nemaže
  });
  app.save(reports);
}, (app) => {
  const c = app.findCollectionByNameOrId("reports");
  if (c) app.delete(c);
});
