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

// ---------- Ollama (/api/chat) ----------
function chatOllama(cfg, system, user, opts) {
  const { env } = require(`${__hooks}/helpers.js`);
  const lang = opts.lang;
  const base = trimSlashes((cfg && cfg.url) || env("AI_URL") || "http://localhost:11434");
  const model = (cfg && cfg.model) || env("AI_MODEL") || "gpt-oss:20b";
  const payload = {
    model: model,
    stream: false,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    options: { temperature: 0.7, num_predict: opts.numPredict || 4000 },
  };
  if (opts.json) payload.format = "json";
  if (opts.think !== undefined) payload.think = opts.think;
  const res = $http.send({
    url: base + "/api/chat",
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    timeout: 300,
  });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(msg(lang, "ollamaHttp", { status: res.statusCode, model: model }));
  }
  const content = res.json && res.json.message && res.json.message.content;
  if (!content) throw new Error(msg(lang, "emptyReply"));
  return content;
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
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  const limit = opts.numPredict || 4000;

  const bohate = {
    model: model, messages: messages, stream: false,
    temperature: 0.7, max_tokens: limit,
  };
  if (opts.json) bohate.response_format = { type: "json_object" };
  // holé tělo: nic, co by šlo odmítnout jako neznámý nebo nepovolený parametr
  const hole = { model: model, messages: messages, stream: false, max_completion_tokens: limit };

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
      timeout: 300,
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
  return content;
}

// Jediný vstup pro celý produkt. opts: {json, numPredict, think, lang}
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

module.exports = { llmChat, llmTranscribe, openaiBase, MAX_AUDIO_MB };
