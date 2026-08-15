/// <reference path="../pb_data/types.d.ts" />
// Veřejná mapa sdílí plátno, ne exekuci: úkoly a jejich komentáře už NEJSOU
// čitelné jen proto, že mapa má zapnutý veřejný odkaz. (Anonymním nikdy nebyly
// — rules vyžadují @request.auth; tohle zavírá i přihlášené návštěvníky.)
migrate((app) => {
  const tasks = app.findCollectionByNameOrId("tasks");
  tasks.listRule = tasks.listRule.split(" || map.is_public = true").join("");
  tasks.viewRule = tasks.viewRule.split(" || map.is_public = true").join("");
  app.save(tasks);

  const tc = app.findCollectionByNameOrId("task_comments");
  tc.listRule = tc.listRule.split(" || task.map.is_public = true").join("");
  tc.viewRule = tc.viewRule.split(" || task.map.is_public = true").join("");
  app.save(tc);
}, (app) => {
  const tasks = app.findCollectionByNameOrId("tasks");
  tasks.listRule = tasks.listRule.replace(
    ' || map.owner = @request.auth.id',
    ' || map.owner = @request.auth.id || map.is_public = true'
  );
  tasks.viewRule = tasks.listRule;
  app.save(tasks);

  const tc = app.findCollectionByNameOrId("task_comments");
  tc.listRule = tc.listRule.replace(
    ' || task.map.owner = @request.auth.id',
    ' || task.map.owner = @request.auth.id || task.map.is_public = true'
  );
  tc.viewRule = tc.listRule;
  app.save(tc);
});
