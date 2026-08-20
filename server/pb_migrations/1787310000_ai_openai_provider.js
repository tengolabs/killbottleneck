/// <reference path="../pb_data/types.d.ts" />
// Pátá poloha přepínače AI: „openai" = jakékoli OpenAI-kompatibilní rozhraní
// (OpenAI, OpenRouter, Groq, Mistral, Together, vLLM, LM Studio, llama.cpp,
// liteLLM proxy…). Do v0.39 uměl killBottleneck jen tvar volání Ollamy, takže
// se k běžným poskytovatelům nedalo připojit vůbec.
//
// ⚠️ Hodnota se PŘIDÁVÁ, žádná se neodebírá — existující instance s ollama/api/
// custom se nesmí hnout.
migrate((app) => {
  const c = app.findCollectionByNameOrId("ai_settings");
  const f = c.fields.getByName("provider");
  f.values = ["none", "ollama", "api", "custom", "openai"];
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("ai_settings");
  const f = c.fields.getByName("provider");
  f.values = ["none", "ollama", "api", "custom"];
  app.save(c);
});
