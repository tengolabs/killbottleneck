/// <reference path="../pb_data/types.d.ts" />
// Rozšíření notifikací pro vykonavatele uzlů a agentní běhy:
//   node_comment  — komentář u uzlu mapy (dosud notifikoval jen komentář u úkolu)
//   map_shared    — někdo mi nasdílel projekt
//   ai_request    — nové/změněné zadání pro AI agenta (chodí správcům AI agentů)
//   deadline      — souhrn blížících se/prošlých termínů (denní cron)
//   agent_done / agent_failed — automatizace doběhla / selhala
//
// `dedup_key` + PARTIAL UNIQUE index = idempotence opakovaně spouštěných notifikací.
// Termínový cron běží hodinově (catch-up po výpadku), ale poslat smí jen jednou denně;
// razítko jako u templates.auto_last NEJDE — uzly žijí v JSON mapy, zápis razítka by
// zvedl goalmaps.updated a rozbil base_updated (409 v otevřeném editoru i v MCP).
// Index je tvrdá závora i proti souběhu (vzor idx_time_entries_running).
// Prázdný dedup_key je z indexu vyňatý, takže běžné notifikace se nijak neomezují.
// Razítko = aktuální čas.
migrate((app) => {
  const col = app.findCollectionByNameOrId("notifications");
  col.fields.getByName("type").values = [
    "task_assigned", "task_comment", "node_assigned", "node_unblocked",
    "map_created", "timer_autostop",
    "node_comment", "map_shared", "ai_request", "deadline", "agent_done", "agent_failed",
  ];
  col.fields.add(new TextField({ name: "dedup_key", max: 200 }));
  col.indexes = [
    "CREATE UNIQUE INDEX idx_notifications_dedup ON notifications (dedup_key) WHERE dedup_key != ''",
    "CREATE INDEX idx_notifications_user_created ON notifications (`user`, created)",
    "CREATE INDEX idx_notifications_user_read ON notifications (`user`, `read`)",
  ];
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("notifications");
  col.fields.getByName("type").values = [
    "task_assigned", "task_comment", "node_assigned", "node_unblocked",
    "map_created", "timer_autostop",
  ];
  col.fields.removeByName("dedup_key");
  col.indexes = [];
  app.save(col);
});
