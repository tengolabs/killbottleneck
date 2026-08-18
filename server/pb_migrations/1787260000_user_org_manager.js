/// <reference path="../pb_data/types.d.ts" />
// Správce organizační struktury — SAMOSTATNÝ PŘÍZNAK, přesně podle vzoru
// `is_ai_manager` (migrace 1785020002). Role (admin/manager/user) je exkluzivní
// a nese RLS pravidla; správcovství struktury je na ní kolmé — typicky ho dostane
// personalista, který má kreslit strom pozic, ale NEMÁ být administrátorem
// instance. Nová hodnota v `role` by znamenala přepsat všechna RLS pravidla.
//
// Tenhle příznak proto ŽÁDNÁ RLS pravidla nemění: řídí jen serverové routy
// org struktury (/org-map, /org-structure/*) a update hook mapy kind='org'.
// ⚠️ SMAZÁNÍ org mapy zůstává výhradně adminovi — mazání struktury celé firmy
// není editace (Richard 17. 8. 2026).
//
// Když příznak nemá NIKDO, zastává správcovství admin — stejně jako u AI
// (Richard: „když nebude nikdo přiřazen, musí to někdo být jako teď").
// Nastavuje ho výhradně admin (users create/update hook).
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new BoolField({ name: "is_org_manager" }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("is_org_manager");
  app.save(users);
});
