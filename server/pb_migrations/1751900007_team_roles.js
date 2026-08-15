/// <reference path="../pb_data/types.d.ts" />
// Tým v rámci instance (instance = jeden tým): role admin / manager / user.
// Manažer a admin vidí a řídí všechny úkoly týmu; člen jen své (owner/assignee)
// a úkoly na sdílených mapách — beze změny dosavadní logiky, jen rozšíření.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const roleField = users.fields.getByName("role");
  roleField.values = ["admin", "manager", "user"];
  app.save(users);

  const lead = ' || @request.auth.role = "admin" || @request.auth.role = "manager"';

  const tasks = app.findCollectionByNameOrId("tasks");
  tasks.listRule += lead;
  tasks.viewRule += lead;
  tasks.updateRule += lead;
  tasks.deleteRule += lead;
  app.save(tasks);

  const tc = app.findCollectionByNameOrId("task_comments");
  tc.listRule += lead;
  tc.viewRule += lead;
  // createRule má tvar '@request.auth.id != "" && (...)' — vedení přidat DOVNITŘ závorky
  tc.createRule = tc.createRule.replace(/\)$/, lead + ")");
  app.save(tc);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  const roleField = users.fields.getByName("role");
  roleField.values = ["admin", "user"];
  app.save(users);

  const lead = ' || @request.auth.role = "admin" || @request.auth.role = "manager"';
  const tasks = app.findCollectionByNameOrId("tasks");
  for (const k of ["listRule", "viewRule", "updateRule", "deleteRule"]) {
    tasks[k] = tasks[k].split(lead).join("");
  }
  app.save(tasks);
  const tc = app.findCollectionByNameOrId("task_comments");
  for (const k of ["listRule", "viewRule", "createRule"]) {
    tc[k] = tc[k].split(lead).join("");
  }
  app.save(tc);
});
