/// <reference path="../pb_data/types.d.ts" />
// Kredity tahu uložené u řádku logu (5. 10. 2026, rozhodnutí Richarda 4. 10.): 1 kredit = průměrný skutečný tah
// (ceny AKI DeepSeek V4.1, lokální modely 0, zahozený pokus lehkého / chyba / potvrzení bez modelu 0).
// Součty kvóty jsou pak SUM(kredity) — přepočet při změně cen se dělá jen pro nové řádky, historie drží, co platilo.
// Zpětné dopočtení starších řádků: ze součtů tokenů za cenu AKI; řádky jen lokálních modelů (gpt-oss, rig Qwen, ollama) 0.
migrate((app) => {
  const c = app.findCollectionByNameOrId("ai_chat_log");
  c.fields.add(new Field({ name: "kredity", type: "number", min: 0 }));
  c.fields.add(new Field({ name: "volani", type: "json", maxSize: 20000 }));
  app.save(c);
  const EUR = 24.3, IN = 0.25 * EUR / 1e6, CACHE = 0.10 * EUR / 1e6, OUT = 1.00 * EUR / 1e6;
  const KREDIT = (17618 - 11452) * IN + 11452 * CACHE + 284 * OUT;
  // i lokální modely za cenu AKI — „vše jako koupeno“ (Richard 5. 10. 2026)
  app.db().newQuery("UPDATE ai_chat_log SET kredity = CASE WHEN stav = 'chyba' OR COALESCE(calls, 0) = 0 THEN 0 ELSE ((tokens_in - MIN(tokens_in, COALESCE(tokens_cached, 0))) * {:cin} + MIN(tokens_in, COALESCE(tokens_cached, 0)) * {:cc} + tokens_out * {:cout}) / {:kredit} END")
    .bind({ cin: IN, cc: CACHE, cout: OUT, kredit: KREDIT }).execute();
  // přepis hlasovky „jako koupeno“ (Richard 5. 10. 2026): 0,006 USD/min (whisper-1), kurz 20,8, po sekundách z audio_ms (strop hodina)
  app.db().newQuery("UPDATE ai_chat_log SET kredity = kredity + MIN(COALESCE(audio_ms, 0), 3600000) / 1000.0 * {:prepis} / {:kredit} WHERE stav <> 'chyba' AND COALESCE(calls, 0) > 0 AND COALESCE(audio_ms, 0) > 0")
    .bind({ prepis: 0.006 * 20.8 / 60, kredit: KREDIT }).execute();
}, (app) => {
  const c = app.findCollectionByNameOrId("ai_chat_log");
  c.fields.removeByName("kredity");
  c.fields.removeByName("volani");
  app.save(c);
});
