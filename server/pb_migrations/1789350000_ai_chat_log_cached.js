/// <reference path="../pb_data/types.d.ts" />
// ai_chat_log.tokens_cached = tokeny promptu, které model vzal z cache prefixu
// (usage.prompt_tokens_details.cached_tokens / llama-server timings.cache_n). Bez toho
// se efekt pořadí systémové zprávy nedá měřit z instance (nález 14. 9. 2026, DeepSeek/AKI:
// cache chytala jen 44 % vstupu). Kredity počítají cachovaný vstup za cache cenu.
migrate((app) => {
  const c = app.findCollectionByNameOrId("ai_chat_log");
  c.fields.add(new NumberField({ name: "tokens_cached" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("ai_chat_log");
  c.fields.removeByName("tokens_cached");
  app.save(c);
});
