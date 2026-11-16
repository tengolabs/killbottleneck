/// <reference path="../pb_data/types.d.ts" />
// Brain training, game of the day (v1.4.0, 16 Nov 2026): every finished round stores whether it was the player's
// game of the day and under which rules it was played, so the streak never has to re-derive the past.
//
//   daily   bool    the round was the game of the day of its `day` (set by /finish)
//   rules   number  0 = a row from v1.3.0 (any finished round kept the streak — still counted that way),
//                   2 = game of the day (RULES_VERSION in pb_hooks/brain.js)
//   hints   number  hints used in the round (anagram, sudoku; 0 elsewhere) — for the future experience system
migrate((app) => {
  const col = app.findCollectionByNameOrId("brain_results");
  let changed = false;
  if (!col.fields.getByName("daily")) { col.fields.add(new BoolField({ name: "daily" })); changed = true; }
  if (!col.fields.getByName("rules")) { col.fields.add(new NumberField({ name: "rules", onlyInt: true, min: 0, max: 99 })); changed = true; }
  if (!col.fields.getByName("hints")) { col.fields.add(new NumberField({ name: "hints", onlyInt: true, min: 0, max: 1000 })); changed = true; }
  if (changed) app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("brain_results");
  col.fields.removeByName("daily");
  col.fields.removeByName("rules");
  col.fields.removeByName("hints");
  app.save(col);
});
