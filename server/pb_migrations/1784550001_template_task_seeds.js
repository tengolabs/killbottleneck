/// <reference path="../pb_data/types.d.ts" />
// Šablona „včetně úkolů" (Richard 2026-07-20): volitelně nese i úkoly mapy
// (vč. podúkolů, termíny jako dny od startu, opakování, přiřazení). Položka:
// {id:'t1', parent:null|'tX', node:'n2'|'', title, description,
//  deadline_offset_days:null|number, recurrence, assignee_email}.
// Prázdné pole = čistá šablona. Razítko = aktuální čas.
migrate((app) => {
  const templates = app.findCollectionByNameOrId("templates");
  templates.fields.add(new JSONField({ name: "task_seeds", maxSize: 1000000 }));
  app.save(templates);
}, (app) => {
  const templates = app.findCollectionByNameOrId("templates");
  templates.fields.removeByName("task_seeds");
  app.save(templates);
});
