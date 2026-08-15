/// <reference path="../pb_data/types.d.ts" />
// Úkoly se řídí viditelností MAPY — soukromá mapa je soukromá i s úkoly.
//
// Richard 6. 8. 2026: „počkej, jestli mám privátní mapu, tak ji nemá vidět
// nikdo jiný." Do teď platilo, že admin a manažer vidí úkoly VŠECH (migrace
// 1751900007_team_roles.js, tehdy vědomé rozhodnutí „vedení řídí úkoly týmu").
// Jenže mapa sama soukromá byla — takže admin mapu neviděl, ale její úkoly ano.
// Nesrovnalost si nikdo nevšiml, dokud úvodní mapa nezačala každému účtu
// vyrábět šest až sedm úkolů: při 25 účtech viděl admin 151 úkolů, z toho
// většinu cizích onboardingových. (Změřeno kontrolním panelem 6. 8. 2026.)
//
// Zrušit stačí nepodmíněnou roli. Přístup přes VLASTNÍKA mapy, přes SDÍLENÍ
// i přes TÝMOVOU mapu (`map.team_access`) v pravidle zůstává, takže vedení
// o dohled nad společnou prací nepřijde — přijde jen o cizí soukromé úkoly.
//
// Zpět (down) vrací původní stav, aby šlo rozhodnutí kdykoli otočit.
const ROLE = ' || @request.auth.role = "admin" || @request.auth.role = "manager"';

// ⚠️ Pravidla se MUSÍ přiřazovat napřímo (col.listRule = …), ne přes proměnný
// klíč col[k]. Přes klíč migrace tiše proběhne, zapíše se mezi provedené —
// a pravidlo zůstane beze změny. Stálo mě to jeden falešný „hotovo".
// ⚠️ String(r) je nutné: hodnota pravidla NENÍ z pohledu JS řetězec (je to
// hodnota z Go), takže `typeof r === "string"` je false a podmínka ji tiše
// propustila beze změny — migrace se zapsala mezi provedené a nezměnila nic.
const bez = (r) => String(r || "").split(ROLE).join("");
const sRoli = (r) => (String(r || "").includes(ROLE) ? String(r) : String(r || "") + ROLE);

migrate((app) => {
  const tasks = app.findCollectionByNameOrId("tasks");
  tasks.listRule = bez(tasks.listRule);
  tasks.viewRule = bez(tasks.viewRule);
  tasks.updateRule = bez(tasks.updateRule);
  tasks.deleteRule = bez(tasks.deleteRule);
  app.save(tasks);

  const tc = app.findCollectionByNameOrId("task_comments");
  tc.listRule = bez(tc.listRule);
  tc.viewRule = bez(tc.viewRule);
  tc.createRule = bez(tc.createRule);
  app.save(tc);
}, (app) => {
  const tasks = app.findCollectionByNameOrId("tasks");
  tasks.listRule = sRoli(tasks.listRule);
  tasks.viewRule = sRoli(tasks.viewRule);
  tasks.updateRule = sRoli(tasks.updateRule);
  tasks.deleteRule = sRoli(tasks.deleteRule);
  app.save(tasks);

  const tc = app.findCollectionByNameOrId("task_comments");
  tc.listRule = sRoli(tc.listRule);
  tc.viewRule = sRoli(tc.viewRule);
  app.save(tc);
});
