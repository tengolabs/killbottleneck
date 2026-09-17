// Doprava k modelu — JEDINÉ místo, kde se rozhoduje, JAK se model zavolá.
// Prompty, parsování a kontrakt odpovědí zůstávají v ollama.js; tenhle modul
// jen pošle zprávy a vrátí text. Díky tomu přidání dalšího rozhraní neznamená
// druhou sadu promptů (a tím dvojí ladění a tichý drift mezi nimi).
//
// Podporovaná rozhraní:
//   ollama = nativní Ollama /api/chat (beze změny proti stavu před v0.40)
//   openai = OpenAI-kompatibilní /chat/completions — OpenAI, OpenRouter, Groq,
//            Mistral, Together, vLLM, LM Studio, llama.cpp, liteLLM proxy…
//
// ⚠️ Moduly se v izolovaném PocketBase VM nevidí navzájem → require() patří
// dovnitř funkcí, ne na začátek souboru (stejný vzor jako v ollama.js).

const ERR = {
  emptyReply: { cs: "model vrátil prázdnou odpověď", en: "model returned an empty response" },
  emptyThinking: {
    cs: "model spotřeboval celý limit na přemýšlení a nic nenapsal — zvyšte limit nebo zvolte model, který nepřemýšlí",
    en: "the model spent its whole budget on reasoning and wrote nothing — raise the limit or pick a non-reasoning model",
  },
  ollamaHttp: { cs: "Ollama vrátila HTTP {status} (model {model})", en: "Ollama returned HTTP {status} (model {model})" },
  openaiHttp: { cs: "AI služba vrátila HTTP {status}: {detail}", en: "the AI service returned HTTP {status}: {detail}" },
  openaiHttpKratce: {
    cs: "AI služba vrátila HTTP {status} — řekněte to prosím správci instance",
    en: "the AI service returned HTTP {status} — please tell your instance administrator",
  },
  openaiNoToken: { cs: "chybí klíč k AI službě", en: "the AI service key is missing" },
  noUrl: { cs: "chybí adresa AI služby", en: "the AI service address is missing" },
  audioTooBig: { cs: "nahrávka je větší než {mb} MB", en: "the recording is larger than {mb} MB" },
  audioMissing: { cs: "chybí nahrávka", en: "the recording is missing" },
  transcribeFailed: { cs: "přepis se nepovedl: HTTP {status}", en: "transcription failed: HTTP {status}" },
  transcribeEmpty: { cs: "služba nevrátila text přepisu", en: "the service returned no transcript" },
  visionFailed: { cs: "obrázek se teď nepodařilo přečíst — zkuste to prosím za chvíli", en: "the image could not be read right now — please try again shortly" },
};

function msg(lang, key, params) {
  const L = lang === "en" ? "en" : "cs";
  let s = (ERR[key] && ERR[key][L]) || key;
  if (params) for (const k of Object.keys(params)) s = s.split("{" + k + "}").join(params[k]);
  return s;
}

function trimSlashes(s) { return String(s || "").trim().replace(/\/+$/, ""); }

// Adresa, jak ji lidé opravdu zadávají. Přijmeme „https://api.openai.com/v1",
// „…/v1/", „https://openrouter.ai/api/v1" i rovnou nalepený koncový bod
// „…/v1/chat/completions". Bez /v1 na konci ho doplníme — tak to má drtivá
// většina bran; kdo má vlastní cestu (…/api/v2), tu si necháme.
function openaiBase(url) {
  // dotaz i kotva se odřezávají PRVNÍ — jinak by „…/v1/chat/completions?a=1"
  // skončilo jako „…?a=1/v1" (nález panelu 20. 8. 2026)
  let b = String(url || "").trim().split("#")[0].split("?")[0];
  b = trimSlashes(b);
  b = trimSlashes(b.replace(/\/chat\/completions$/i, "").replace(/\/audio\/transcriptions$/i, ""));
  // Verzi doplňujeme jen tehdy, když v cestě žádná není. Kdo má vlastní
  // podcestu s verzí (Gemini „…/v1beta/openai"), tomu ji nepřepisujeme.
  if (!/\/v\d/i.test(b)) b += "/v1";
  return b;
}

// Krátký výtah z chybové odpovědi — ať admin vidí, CO službě vadilo, a nemusí
// hádat z holého čísla.
// ⚠️ Ořez se dělá VŽDY přes .slice(): `toString(body, 300)` druhý argument
// ZAHAZUJE (změřeno v kontejneru — 1999 znaků dovnitř, 1999 ven), takže by se
// do hlášky vysypala celá HTML chybová stránka od proxy.
function errDetail(res) {
  try {
    const j = res.json;
    if (j && j.error) return String(j.error.message || j.error).slice(0, 300);
    if (j && j.message) return String(j.message).slice(0, 300);
  } catch (err) { /* tělo nemusí být JSON */ }
  try { return String(toString(res.body)).slice(0, 300); } catch (err) { return ""; }
}

// Chyba od cizí AI služby. Detail umí nést materiál klíče (OpenAI vrací v 401
// doslova kus klíče) i vnitřní adresy poskytovatele, proto ho dostane JEN
// admin; běžný člen holý stav. Do logu jde vždycky, ať má správce z čeho vyjít.
function chybaSluzby(res, lang, podrobne) {
  const detail = errDetail(res);
  try {
    $app.logger().warn("llm: AI služba odpověděla chybou",
      "status", String(res.statusCode), "detail", detail);
  } catch (err) { /* log je bonus, chyba má přednost */ }
  return new Error(podrobne
    ? msg(lang, "openaiHttp", { status: res.statusCode, detail: detail })
    : msg(lang, "openaiHttpKratce", { status: res.statusCode }));
}

// Ollama za autentizovanou proxy (cloud: api.killbottleneck.com/v1/ollama, 13. 9. 2026):
// když má konfigurace token, jde v hlavičce Authorization; holá ollama ho ignoruje.
function hlavickyOllama(cfg) {
  const h = { "Content-Type": "application/json" };
  if (cfg && cfg.token) h.Authorization = "Bearer " + cfg.token;
  return h;
}

// Kontext modelu: ollama má výchozí num_ctx 4096 a delší prompt TIŠE ořízne od
// začátku (systémový prompt i nástroje) — chat s 5–9k tokeny promptu pak „neposlouchá“.
// KB_CHAT_NUM_CTX / KB_CHAT_LIGHT_NUM_CTX pošlou num_ctx v každém volání (14. 9. 2026).
function volbyOllama(cfg, o) {
  const n = Number(cfg && cfg.numCtx);
  if (n > 0) o.num_ctx = n;
  return o;
}

// ---------- Ollama (/api/chat) ----------
function chatOllama(cfg, system, user, opts) {
  const { env } = require(`${__hooks}/helpers.js`);
  const lang = opts.lang;
  const base = trimSlashes((cfg && cfg.url) || env("AI_URL") || "http://localhost:11434");
  const model = (cfg && cfg.model) || env("AI_MODEL") || "gpt-oss:20b";
  const payload = {
    model: model,
    stream: false,
    messages: zpravy(system, user, opts).map(naDratOllama),
    options: volbyOllama(cfg, { temperature: teplota(opts), num_predict: opts.numPredict || 4000 }),
  };
  if (opts.json) payload.format = "json";
  if (opts.think !== undefined) payload.think = opts.think;
  const res = $http.send({
    url: base + "/api/chat",
    method: "POST",
    body: JSON.stringify(payload),
    headers: hlavickyOllama(cfg),
    timeout: Number(opts.timeout) || 300,
  });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(msg(lang, "ollamaHttp", { status: res.statusCode, model: model }));
  }
  const content = res.json && res.json.message && res.json.message.content;
  if (!content) throw new Error(msg(lang, "emptyReply"));
  if (opts.stats) {
    // spotřeba pro log rádce/kvót — ollama počítá i myšlení do eval_count
    opts.stats.model = model; opts.stats.in = res.json.prompt_eval_count || null; opts.stats.out = res.json.eval_count || null;
  }
  return content;
}

// Zprávy pro model: system + (volitelná historie rozhovoru) + poslední dotaz.
// Historie = [{role:"user"|"assistant", content}] — rádce („rozhovor o úkolu")
// ji posílá, ostatní módy ne; kdo ji neposílá, dostane přesně dnešní dvojici.
// opts.obrazky = [{b64, mime}] se připojí k poslednímu dotazu (přepis obrázku, 16. 9. 2026);
// na drát je převádí naDratOllama / naDratOpenAI — každé rozhraní chce jiný tvar.
function zpravy(system, user, opts) {
  const out = [{ role: "system", content: system }];
  const hist = Array.isArray(opts.history) ? opts.history : [];
  for (const m of hist) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    out.push({ role: m.role, content: String(m.content || "").slice(0, 4000) });
  }
  const posledni = { role: "user", content: user };
  if (Array.isArray(opts.obrazky) && opts.obrazky.length) posledni.obrazky = opts.obrazky;
  out.push(posledni);
  return out;
}
// teplota per volání (rádce chce nižší kvůli faktům), výchozí 0.7 jako dřív
function teplota(opts) {
  const t = Number(opts.temperature);
  return t >= 0 && t <= 2 ? t : 0.7;
}

// ---------- OpenAI-kompatibilní (/chat/completions) ----------
// Dva pokusy, ne jeden: „OpenAI-kompatibilní" je v praxi rodina rozhraní, ne
// jedno rozhraní. Bohatší tělo (response_format, temperature, max_tokens) umí
// většina, ale ne všichni:
//   · menší brány a starší modely neznají response_format → 400
//   · uvažující modely (o-series, gpt-5*) odmítají temperature ≠ 1 a chtějí
//     max_completion_tokens místo max_tokens → taky 400
// Proto po 400 zopakujeme volání s holým tělem, které bere každý. Opakuje se
// JEN na 400 (chyba tvaru požadavku) — 401/429/5xx opakovat nemá smysl.
function chatOpenAI(cfg, system, user, opts) {
  const lang = opts.lang;
  const base = openaiBase(cfg && cfg.url);
  if (!base || base === "/v1") throw new Error(msg(lang, "noUrl"));
  const model = (cfg && cfg.model) || "";
  const token = (cfg && cfg.token) || "";
  const messages = zpravy(system, user, opts).map(naDratOpenAI);
  const limit = opts.numPredict || 4000;

  const bohate = {
    model: model, messages: messages, stream: false,
    temperature: teplota(opts), max_tokens: limit,
  };
  if (opts.json) bohate.response_format = { type: "json_object" };
  // holé tělo: nic, co by šlo odmítnout jako neznámý nebo nepovolený parametr
  const hole = { model: model, messages: messages, stream: false, max_completion_tokens: limit };
  if (cfg && cfg.extra) { Object.assign(bohate, cfg.extra); Object.assign(hole, cfg.extra); } // KB_CHAT_OPENAI_EXTRA: pole navíc do těla (llama-server chat_template_kwargs apod.)

  function odesli(payload) {
    return $http.send({
      url: base + "/chat/completions",
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token,
        // OpenRouter tímhle pozná, odkud volání je; ostatní brány to ignorují
        "HTTP-Referer": "https://killbottleneck.com",
        "X-Title": "killBottleneck",
      },
      timeout: Number(opts.timeout) || 300,
    });
  }

  let res = odesli(bohate);
  if (res.statusCode === 400) res = odesli(hole);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw chybaSluzby(res, lang, !!(cfg && cfg.podrobneChyby));
  }
  const volba = (res.json && res.json.choices && res.json.choices[0]) || null;
  const content = volba && volba.message && volba.message.content;
  if (!content) {
    // ⚠️ Uvažující model umí spotřebovat celý strop na přemýšlení a vrátit
    // prázdný content — pro uživatele to vypadá jako „nic se nestalo". Pozná
    // se to podle finish_reason a musí to skončit srozumitelně, ne tichem.
    if (volba && volba.finish_reason === "length") throw new Error(msg(lang, "emptyThinking"));
    throw new Error(msg(lang, "emptyReply"));
  }
  if (opts.stats) {
    const u = (res.json && res.json.usage) || {};
    opts.stats.model = model; opts.stats.in = u.prompt_tokens || null; opts.stats.out = u.completion_tokens || null;
    const d = u.prompt_tokens_details || {}; opts.stats.cached = d.cached_tokens || 0;
  }
  return content;
}

// Jediný vstup pro celý produkt. opts: {json, numPredict, think, lang, history, temperature, stats}
function llmChat(cfg, system, user, opts) {
  const o = opts || {};
  o.lang = o.lang === "en" ? "en" : "cs";
  const provider = String((cfg && cfg.provider) || "ollama").toLowerCase();
  if (provider === "openai") return chatOpenAI(cfg, system, user, o);
  return chatOllama(cfg, system, user, o);
}

// ---------- přepis řeči (OpenAI /audio/transcriptions) ----------
// Prohlížeč posílá nahrávku jako base64 v JSONu (kontrakt naší brány), OpenAI
// ji chce jako multipart soubor. Převod jde uvnitř PocketBase VM: base64 do
// dočasného souboru → busybox `base64 -d` → $filesystem.fileFromPath → FormData.
// (Ověřeno na živém kontejneru, ne odhadem — čistě JS dekód 25MB base64 by
// v goja jen zbytečně žral paměť.)
const MAX_AUDIO_MB = 25; // strop OpenAI i naší brány

function llmTranscribe(cfg, body, lang) {
  const L = lang === "en" ? "en" : "cs";
  const b64 = String((body && body.audio_base64) || "");
  if (!b64) throw new Error(msg(L, "audioMissing"));
  if (b64.length * 3 / 4 > MAX_AUDIO_MB * 1024 * 1024) {
    throw new Error(msg(L, "audioTooBig", { mb: MAX_AUDIO_MB }));
  }
  const { env } = require(`${__hooks}/helpers.js`);
  const base = openaiBase(cfg && cfg.url);
  if (!base || base === "/v1") throw new Error(msg(L, "noUrl"));
  // model přepisu: z administrace, jinak z prostředí, jinak výchozí OpenAI
  // (Groq má „whisper-large-v3", proto se to musí dát přenastavit)
  const model = (cfg && cfg.transcribeModel) || env("AI_TRANSCRIBE_MODEL") || "whisper-1";
  // Přípona rozhoduje, jak služba nahrávku přečte — ale do shellu smí jít jen
  // to, co jsme sami prohlédli. Ze jména od klienta bereme VÝHRADNĚ příponu
  // a jen z bezpečné abecedy; zbytek jména zahazujeme.
  const m = String((body && body.filename) || "").toLowerCase().match(/\.([a-z0-9]{1,5})$/);
  const ext = m ? m[1] : "webm";
  const stem = $os.tempDir() + "/kb-audio-" + $security.randomString(12);
  const b64Path = stem + ".b64";
  const binPath = stem + "." + ext;
  try {
    $os.writeFile(b64Path, b64, 0o600);
    $os.cmd("sh", "-c", "base64 -d < '" + b64Path + "' > '" + binPath + "'").run();
    const form = new FormData();
    form.append("file", $filesystem.fileFromPath(binPath));
    form.append("model", model);
    form.append("language", L);
    form.append("response_format", "json");
    const res = $http.send({
      url: base + "/audio/transcriptions",
      method: "POST",
      body: form,
      headers: { "Authorization": "Bearer " + ((cfg && cfg.token) || "") },
      timeout: 600, // dlouhá nahrávka legitimně trvá minuty
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(msg(L, "transcribeFailed", { status: res.statusCode }));
    }
    const text = res.json && res.json.text;
    if (!text) throw new Error(msg(L, "transcribeEmpty"));
    return { text: String(text) };
  } finally {
    // úklid MUSÍ proběhnout i po chybě — jinak dočasné soubory s nahrávkami
    // zůstávají ležet v kontejneru
    try { $os.remove(b64Path); } catch (err) { /* nevadí */ }
    try { $os.remove(binPath); } catch (err) { /* nevadí */ }
  }
}

// ---------- rozhovor s NÁSTROJI (chat na boku, 13. 9. 2026) ----------
// Model dostane seznam nástrojů (JSON schémata) a smí místo textu vrátit volání
// nástroje. Tahle funkce jen PŘELOŽÍ jeden tvar zpráv na drát obou rozhraní a
// zpět — smyčku (vykonat nástroj, poslat výsledek, zeptat se znovu) drží volající
// (chat.js), protože jen ten ví, co se smí vykonat hned a co až po potvrzení.
//
// zprávy: [{ role: system|user|assistant|tool, content, toolCalls?: [{id,name,args}], toolCallId?, name? }]
// nástroje: [{ name, description, parameters }]  (JSON schema jako u MCP)
// vrací:   { content, toolCalls: [{ id, name, args }], stats }
//
// Ollama (/api/chat): `tools:[{type:"function",function:{…}}]`, odpověď
//   message.tool_calls[].function.{name,arguments(objekt)}; zpráva nástroje má
//   roli "tool" a `tool_name`. Volání nemá id → doplníme vlastní.
// OpenAI: tool_calls[].{id,function:{name,arguments(řetězec JSON)}}; zpráva
//   nástroje nese `tool_call_id`. Druhý pokus s holým tělem jako u chatOpenAI.
// Obrázky (z.obrazky = [{b64, mime}]) jen u role user: Ollama je chce jako pole holých
// base64 vedle contentu, OpenAI jako pole částí s data-URI. Bez obrázku musí být
// tvar přesně dnešní — textové zprávy se nemění ani o bajt.
const sObrazky = (z) => z.role === "user" && Array.isArray(z.obrazky) && z.obrazky.length > 0;
function naDratOllama(z) {
  const out = { role: z.role, content: String(z.content || "") };
  if (sObrazky(z)) out.images = z.obrazky.map((o) => String(o.b64 || ""));
  if (z.role === "assistant" && Array.isArray(z.toolCalls) && z.toolCalls.length) {
    out.tool_calls = z.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args || {} } }));
  }
  if (z.role === "tool") out.tool_name = z.name || "";
  return out;
}
function naDratOpenAI(z) {
  const out = { role: z.role, content: String(z.content || "") };
  if (sObrazky(z)) {
    out.content = [{ type: "text", text: out.content }].concat(z.obrazky.map((o) => ({
      type: "image_url", image_url: { url: "data:" + (o.mime || "image/jpeg") + ";base64," + String(o.b64 || "") },
    })));
  }
  if (z.role === "assistant" && Array.isArray(z.toolCalls) && z.toolCalls.length) {
    out.tool_calls = z.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args || {}) } }));
    if (!out.content) out.content = null;
  }
  if (z.role === "tool") out.tool_call_id = z.toolCallId || "";
  return out;
}
function zDratu(calls, argsJsouRetezec) {
  const out = [];
  for (const c of Array.isArray(calls) ? calls : []) {
    const f = (c && c.function) || {};
    if (!f.name) continue;
    let args = f.arguments;
    if (argsJsouRetezec || typeof args === "string") {
      try { args = JSON.parse(String(args || "{}")); } catch (err) { args = { _parse_error: String(args).slice(0, 200) }; }
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) args = {};
    out.push({ id: String(c.id || ("call_" + $security.randomString(8))), name: String(f.name), args: args });
  }
  return out;
}
function llmChatTools(cfg, zpravyIn, nastroje, opts) {
  const o = opts || {};
  const lang = o.lang === "en" ? "en" : "cs";
  const provider = String((cfg && cfg.provider) || "ollama").toLowerCase();
  const limit = o.numPredict || 1500;
  const stats = o.stats || {};
  if (provider === "openai") {
    const base = openaiBase(cfg && cfg.url);
    if (!base || base === "/v1") throw new Error(msg(lang, "noUrl"));
    const model = (cfg && cfg.model) || "";
    const token = (cfg && cfg.token) || "";
    const messages = zpravyIn.map(naDratOpenAI);
    const tools = (nastroje || []).map((n) => ({ type: "function", function: { name: n.name, description: n.description, parameters: n.parameters } }));
    const bohate = { model: model, messages: messages, stream: false, temperature: teplota(o), max_tokens: limit, tools: tools };
    const hole = { model: model, messages: messages, stream: false, max_completion_tokens: limit, tools: tools };
  if (cfg && cfg.extra) { Object.assign(bohate, cfg.extra); Object.assign(hole, cfg.extra); } // KB_CHAT_OPENAI_EXTRA: pole navíc do těla (llama-server chat_template_kwargs apod.)
    const odesli = (payload) => $http.send({
      url: base + "/chat/completions", method: "POST", body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token, "HTTP-Referer": "https://killbottleneck.com", "X-Title": "killBottleneck" },
      timeout: 300,
    });
    let res = odesli(bohate);
    if (res.statusCode === 400) res = odesli(hole);
    if (res.statusCode < 200 || res.statusCode >= 300) throw chybaSluzby(res, lang, !!(cfg && cfg.podrobneChyby));
    const volba = (res.json && res.json.choices && res.json.choices[0]) || null;
    const m = (volba && volba.message) || {};
    const toolCalls = zDratu(m.tool_calls, true);
    const content = String(m.content || "");
    if (!content && !toolCalls.length) {
      if (volba && volba.finish_reason === "length") throw new Error(msg(lang, "emptyThinking"));
      const e = new Error(msg(lang, "emptyReply")); e.emptyReply = true; throw e;
    }
    const u = (res.json && res.json.usage) || {};
    stats.model = model; stats.in = u.prompt_tokens || null; stats.out = u.completion_tokens || null;
    // cachovaný prefix promptu: OpenAI/DeepSeek/AKI = usage.prompt_tokens_details.cached_tokens,
    // llama-server (rig) navíc timings.cache_n — bez toho se úspora cache nedá měřit z instance
    const det = u.prompt_tokens_details || {}; const tim = (res.json && res.json.timings) || {};
    stats.cached = Number(det.cached_tokens || tim.cache_n || 0) || 0;
    return { content: content, toolCalls: toolCalls, stats: stats };
  }
  const { env } = require(`${__hooks}/helpers.js`);
  const base = trimSlashes((cfg && cfg.url) || env("AI_URL") || "http://localhost:11434");
  const model = (cfg && cfg.model) || env("AI_MODEL") || "gpt-oss:20b";
  const payload = {
    model: model, stream: false,
    messages: zpravyIn.map(naDratOllama),
    tools: (nastroje || []).map((n) => ({ type: "function", function: { name: n.name, description: n.description, parameters: n.parameters } })),
    options: volbyOllama(cfg, { temperature: teplota(o), num_predict: limit }),
  };
  if (o.think !== undefined) payload.think = o.think;
  const res = $http.send({
    url: base + "/api/chat", method: "POST", body: JSON.stringify(payload),
    headers: hlavickyOllama(cfg), timeout: 300,
  });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(msg(lang, "ollamaHttp", { status: res.statusCode, model: model }));
  }
  const m = (res.json && res.json.message) || {};
  const toolCalls = zDratu(m.tool_calls, false);
  const content = String(m.content || "");
  if (!content && !toolCalls.length) {
    // diagnostika do logu: co model vlastně poslal (klíče, důvod konce, tokeny)
    try {
      $app.logger().warn("llm: prázdná odpověď modelu s nástroji", "model", model, "keys", Object.keys(m).join(","),
        "done_reason", String(res.json.done_reason || ""), "eval", String(res.json.eval_count || 0), "thinking", String(m.thinking || "").slice(0, 200));
    } catch (err) { /* log je bonus */ }
    const e = new Error(msg(lang, "emptyReply")); e.emptyReply = true; throw e;
  }
  stats.model = model; stats.in = res.json.prompt_eval_count || null; stats.out = res.json.eval_count || null;
  return { content: content, toolCalls: toolCalls, stats: stats };
}

// ---------- přepis obrázku (vision, 16. 9. 2026) ----------
// retez = konfigurace v pořadí: naše karta (KB_VISION_*), pak záloha (KB_VISION_ZALOHA_*).
// Naše karta dostane cfg.pokusy opakování navíc — po nečinnosti model teprve načítá
// do paměti a první volání umí spadnout na timeout; záloha jen jeden pokus.
// Obrázek žije jen v tomhle volání: nikam se neukládá ani neloguje.
function llmVision(retez, system, user, obrazky, opts) {
  const o = opts || {};
  const lang = o.lang === "en" ? "en" : "cs";
  const chyby = [];
  const cfgs = (retez || []).filter((c) => c && ["ollama", "openai"].includes(String(c.provider || "").toLowerCase()));
  for (let i = 0; i < cfgs.length; i++) {
    const cfg = cfgs[i];
    const pokusu = 1 + (i === 0 ? Math.max(0, Number(cfg.pokusy) || 0) : 0);
    for (let p = 0; p < pokusu; p++) {
      const s = {};
      try {
        const text = llmChat(cfg, system, user, { lang: lang, obrazky: obrazky, temperature: 0, think: false, numPredict: o.numPredict || 1200, timeout: cfg.timeout, stats: s });
        if (o.stats) { o.stats.model = s.model || cfg.model || ""; o.stats.in = s.in || 0; o.stats.out = s.out || 0; o.stats.kde = cfg.kde || ""; }
        return text;
      } catch (err) {
        chyby.push((cfg.kde || String(i)) + ": " + String(err && err.message ? err.message : err).slice(0, 200));
      }
    }
  }
  try { $app.logger().warn("llm: přepis obrázku selhal", "pokusy", chyby.join(" | ")); } catch (err) { /* log je bonus */ }
  const e = new Error(msg(lang, "visionFailed"));
  e.status = 502;
  e.code = "ai_vision"; // klient podle toho vrátí obrázek do políčka (nic se neuložilo)
  throw e;
}

module.exports = { llmChat, llmChatTools, llmTranscribe, llmVision, openaiBase, MAX_AUDIO_MB };
