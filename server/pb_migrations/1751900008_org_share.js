/// <reference path="../pb_data/types.d.ts" />
// Sdílení s celou organizací (instance = jeden tým) + nastavení organizace.
// goalmaps.team_access: "" = privátní / "read" = celá organizace čte /
// "edit" = celá organizace upravuje. org_settings: název + logo (spravuje admin).
migrate((app) => {
  const goalmaps = app.findCollectionByNameOrId("goalmaps");
  goalmaps.fields.add(new SelectField({
    name: "team_access", values: ["read", "edit"], maxSelect: 1,
  }));
  const orgRead = ' || (@request.auth.id != "" && team_access != "")';
  goalmaps.listRule += orgRead;
  goalmaps.viewRule += orgRead;
  goalmaps.updateRule += ' || (@request.auth.id != "" && team_access = "edit")';
  app.save(goalmaps);

  const tasks = app.findCollectionByNameOrId("tasks");
  const taskOrgRead = ' || (@request.auth.id != "" && map.team_access != "")';
  tasks.listRule += taskOrgRead;
  tasks.viewRule += taskOrgRead;
  tasks.updateRule += ' || (@request.auth.id != "" && map.team_access = "edit")';
  // create: doplnit do závorky výčtu, kdo smí zakládat úkol na mapě
  tasks.createRule = tasks.createRule.replace(/\)$/, ' || map.team_access = "edit")');
  app.save(tasks);

  const tc = app.findCollectionByNameOrId("task_comments");
  const tcOrgRead = ' || (@request.auth.id != "" && task.map.team_access != "")';
  tc.listRule += tcOrgRead;
  tc.viewRule += tcOrgRead;
  tc.createRule = tc.createRule.replace(/\)$/, ' || task.map.team_access != "")');
  app.save(tc);

  const comments = app.findCollectionByNameOrId("comments");
  const cOrgRead = ' || (@request.auth.id != "" && goalmap.team_access != "")';
  comments.listRule += cOrgRead;
  comments.viewRule += cOrgRead;
  comments.createRule = comments.createRule.replace(/\)$/, ' || goalmap.team_access != "")');
  app.save(comments);

  const org = new Collection({
    type: "base",
    name: "org_settings",
    fields: [
      { name: "name", type: "text" },
      { name: "logo", type: "file", maxSelect: 1, maxSize: 5242880, mimeTypes: ["image/png", "image/jpeg", "image/svg+xml", "image/webp"] },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    listRule: "",
    viewRule: "",
    createRule: '@request.auth.role = "admin"',
    updateRule: '@request.auth.role = "admin"',
    deleteRule: '@request.auth.role = "admin"',
  });
  app.save(org);
}, (app) => {
  const goalmaps = app.findCollectionByNameOrId("goalmaps");
  goalmaps.listRule = goalmaps.listRule.split(' || (@request.auth.id != "" && team_access != "")').join("");
  goalmaps.viewRule = goalmaps.viewRule.split(' || (@request.auth.id != "" && team_access != "")').join("");
  goalmaps.updateRule = goalmaps.updateRule.split(' || (@request.auth.id != "" && team_access = "edit")').join("");
  goalmaps.fields.removeByName("team_access");
  app.save(goalmaps);

  const tasks = app.findCollectionByNameOrId("tasks");
  tasks.listRule = tasks.listRule.split(' || (@request.auth.id != "" && map.team_access != "")').join("");
  tasks.viewRule = tasks.viewRule.split(' || (@request.auth.id != "" && map.team_access != "")').join("");
  tasks.updateRule = tasks.updateRule.split(' || (@request.auth.id != "" && map.team_access = "edit")').join("");
  tasks.createRule = tasks.createRule.split(' || map.team_access = "edit"').join("");
  app.save(tasks);

  const tc = app.findCollectionByNameOrId("task_comments");
  tc.listRule = tc.listRule.split(' || (@request.auth.id != "" && task.map.team_access != "")').join("");
  tc.viewRule = tc.viewRule.split(' || (@request.auth.id != "" && task.map.team_access != "")').join("");
  tc.createRule = tc.createRule.split(' || task.map.team_access != ""').join("");
  app.save(tc);

  const comments = app.findCollectionByNameOrId("comments");
  comments.listRule = comments.listRule.split(' || (@request.auth.id != "" && goalmap.team_access != "")').join("");
  comments.viewRule = comments.viewRule.split(' || (@request.auth.id != "" && goalmap.team_access != "")').join("");
  comments.createRule = comments.createRule.split(' || goalmap.team_access != ""').join("");
  app.save(comments);

  const org = app.findCollectionByNameOrId("org_settings");
  if (org) app.delete(org);
});
