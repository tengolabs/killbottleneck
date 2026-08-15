/// <reference path="../pb_data/types.d.ts" />
// BEZPEČNOSTNÍ OPRAVA: nepřihlášený host (guest) mohl číst soukromé mapy/úkoly.
//
// Migrace 013 zavedla READ klauzuli `…map_shares_via_map.email ?= @request.auth.email`
// BEZ guardu `@request.auth.id != ""` (ten měla jen EDIT klauzule). PocketBase back-relace
// s `?=` na PRÁZDNÉ relaci (mapa bez sdílení = výchozí stav) matchuje, když je porovnávaná
// hodnota prázdná — a guest má @request.auth.email = "". Výsledek: každou nesdílenou mapu
// (i úkol/komentář) přečetl kdokoli nepřihlášený. Přihlášených se to netýká (neprázdný e-mail).
//
// Druhý leak u úkolů: `assignee_email = @request.auth.email` → guest "" = "" matchuje úkoly
// bez přiřazení; a prázdná map relace u samostatných úkolů. Migrace 009 z tasks/task_comments
// odebrala veřejný přístup úplně → obalíme CELÁ jejich read/edit pravidla guardem. goalmaps a
// comments mají legitimní guest cestu (is_public) → guardujeme jen děravou share klauzuli.
migrate((app) => {
  const RULES = ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"];

  // 1) goalmaps + comments: obal share READ klauzuli guardem auth.id != ""
  const guardShare = (name, prefix) => {
    const c = app.findCollectionByNameOrId(name);
    const bare = prefix + "map_shares_via_map.email ?= @request.auth.email";
    const guarded = '(@request.auth.id != "" && ' + bare + ")";
    for (const f of RULES) {
      if (!c[f] || c[f].includes(guarded)) continue; // už obaleno = idempotence
      c[f] = c[f].split(bare).join(guarded);
    }
    app.save(c);
  };
  guardShare("goalmaps", "");
  guardShare("comments", "goalmap.");

  // 2) tasks + task_comments: žádný guest přístup — obal read/update/delete guardem.
  //    (createRule už guard má; dvojitý guard je neškodný, proto ho vynecháme.)
  const lockAuth = (name) => {
    const c = app.findCollectionByNameOrId(name);
    const pre = '@request.auth.id != "" && (';
    for (const f of ["listRule", "viewRule", "updateRule", "deleteRule"]) {
      if (!c[f] || c[f].startsWith(pre)) continue; // idempotence
      c[f] = pre + c[f] + ")";
    }
    app.save(c);
  };
  lockAuth("tasks");
  lockAuth("task_comments");
}, (app) => {
  const RULES = ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"];
  const unguardShare = (name, prefix) => {
    const c = app.findCollectionByNameOrId(name);
    const bare = prefix + "map_shares_via_map.email ?= @request.auth.email";
    const guarded = '(@request.auth.id != "" && ' + bare + ")";
    for (const f of RULES) {
      if (!c[f] || !c[f].includes(guarded)) continue;
      c[f] = c[f].split(guarded).join(bare);
    }
    app.save(c);
  };
  unguardShare("goalmaps", "");
  unguardShare("comments", "goalmap.");

  const unlockAuth = (name) => {
    const c = app.findCollectionByNameOrId(name);
    const pre = '@request.auth.id != "" && (';
    for (const f of ["listRule", "viewRule", "updateRule", "deleteRule"]) {
      if (!c[f] || !c[f].startsWith(pre)) continue;
      c[f] = c[f].slice(pre.length, -1);
    }
    app.save(c);
  };
  unlockAuth("tasks");
  unlockAuth("task_comments");
});
