/// <reference path="../pb_data/types.d.ts" />
// Stránky asistenta — doplnění po klik-testu Richarda 15. 10. 2026:
//  · `shared_with` = jmenovitě vybraní členové organizace (seznam id uživatelů; „vidí tým“ samo
//    nestačí — práva se mají nastavovat jako u sdílení mapy: vybrat lidi);
//  · `prubeh` = kroky psaní (osnova → kostra → jednotlivé části), ať je vidět, co writer právě
//    dělá; `rozepsano` = rozpracované HTML během psaní (náhled roste po částech). Obojí jen po
//    dobu stavu „pise“; hotová stránka je dál v `html`.
// Pravidla kolekce beze změny (zápis jen server). Razítko = aktuální čas (automigrate=0).
migrate((app) => {
  const c = app.findCollectionByNameOrId("ai_pages");
  c.fields.add(new JSONField({ name: "shared_with", maxSize: 20000 }));
  c.fields.add(new JSONField({ name: "prubeh", maxSize: 20000 }));
  c.fields.add(new TextField({ name: "rozepsano", max: 400000 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("ai_pages");
  for (const n of ["shared_with", "prubeh", "rozepsano"]) { try { c.fields.removeByName(n); } catch (err) { /* už není */ } }
  app.save(c);
});
