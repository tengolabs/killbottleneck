// Přepis řeči — JEDNO místo pro hlasovky v asistentovi i pro „Nahrát zvuk“ (routa /advisor), 1. 10. 2026.
//
// Kam přepis jde (pořadí):
//   1. KB_TRANSCRIBE_PROVIDER=openai + KB_TRANSCRIBE_URL (+ _MODEL, _TOKEN) = OpenAI tvar (multipart
//      /audio/transcriptions): speaches, whisper.cpp server, faster-whisper-server, OpenAI, Groq…
//      KB_TRANSCRIBE_PROVIDER=none přepis vypne úplně.
//   2. adresa přepisu z nastavení AI (KB_AI_TRANSCRIBE_URL / Administrace): končí na
//      /audio/transcriptions → OpenAI tvar (docs to sliboval, kód dřív posílal JSON); jinak náš JSON
//      kontrakt ({mode:"transcribe", audio_base64, filename, lang}) jako dosud.
//   3. provider openai bez adresy přepisu → /audio/transcriptions téže služby.
//   4. provider api/custom → brána (…/v1/advisor, mode transcribe) jako dosud.
//   ollama bez adresy přepisu přepis neumí.
// Token jde na vlastní adresu přepisu v OpenAI tvaru jen při TÉMŽE původu jako adresa AI — whisper
// na jiném stroji klíč k placené službě nedostane.
//
// ⚠️ PocketBase JSVM: require() uvnitř funkcí (moduly se nevidí navzájem), handlery se serializují.

const MAX_AUDIO_MB_CHAT = 3;   // hlasovka v asistentovi: 5 min opusu ≈ 1,2 MB, m4a ze Safari víc
const HLAS_MAX_S = 300;        // délka hlasovky (klient zastaví nahrávání; server hlídá velikost)

const puvod = (u) => { const m = String(u || "").match(/^(https?:\/\/[^/?#]+)/i); return m ? m[1].toLowerCase() : ""; };

function prepisConfig(app) {
  const { env, aiConfig, aiHostBlocked } = require(`${__hooks}/helpers.js`);
  const p = String(env("TRANSCRIBE_PROVIDER") || "").toLowerCase();
  if (p === "none") return null;
  if (p === "openai") {
    const url = env("TRANSCRIBE_URL") || "";
    // filtr ticha (speaches/faster-whisper): výchozí zapnuto u vlastního přepisovače, ne u OpenAI/Groq
    const vad = env("TRANSCRIBE_VAD") ? env("TRANSCRIBE_VAD") === "1" : !/openai\.com|groq\.com/i.test(url);
    return url ? { druh: "multipart", url: url, model: env("TRANSCRIBE_MODEL") || "whisper-1", token: env("TRANSCRIBE_TOKEN") || "", vlastni: true, vad: vad } : null;
  }
  let c;
  try { c = aiConfig(app); } catch (err) { return null; }
  const model = c.transcribeModel || env("AI_TRANSCRIBE_MODEL") || "whisper-1";
  const brana = c.provider === "api" || c.provider === "custom";
  if (c.transcribeUrl) {
    if (c.source === "db" && aiHostBlocked(c.transcribeUrl)) return null;
    if (/\/audio\/transcriptions\/?$/i.test(c.transcribeUrl)) {
      return { druh: "multipart", url: c.transcribeUrl, model: model, token: puvod(c.transcribeUrl) === puvod(c.url) ? (c.token || "") : "", vad: env("TRANSCRIBE_VAD") === "1" };
    }
    return { druh: "json", url: c.transcribeUrl, token: brana ? (c.token || "") : "", sTokenem: brana };
  }
  if (c.provider === "openai") return c.url ? { druh: "multipart", url: c.url, model: model, token: c.token || "" } : null;
  if (brana) {
    if (!c.url) return null;
    return { druh: "json", url: c.url.replace(/kb-advisor\/?$/, "kb-transcribe").replace(/flowmap-advisor\/?$/, "flowmap-transcribe"), token: c.token || "", sTokenem: true };
  }
  return null;
}

// Nabízí instance přepis? Stejná pravidla jako /config (mikrofon nesmí svítit tam, kde přepis skončí
// chybou): vlastní přepis a adresa přepisu ano; brána podle tarifu (/v1/status v aiModesCache);
// openai jen když služba v /models nabízí whisper/transcribe (OpenRouter, vLLM ho nemají) — zjištění
// se drží 10 min, ať systémová zpráva asistenta nevolá službu v každém tahu.
function hlasDostupny(app) {
  const cfg = prepisConfig(app);
  if (!cfg) return false;
  if (cfg.vlastni) return true;
  const { aiConfig } = require(`${__hooks}/helpers.js`);
  let c;
  try { c = aiConfig(app); } catch (err) { return false; }
  if (c.transcribeUrl || c.provider === "custom") return true;
  const st = $app.store();
  if (c.provider === "api") {
    const k = st.get("aiModesCache");
    return !(k && k.provider === "api" && Array.isArray(k.modes) && !k.modes.includes("transcribe"));
  }
  if (c.provider === "openai") {
    const klic = "prepis:modely:" + c.url;
    const ted = Math.floor(Date.now() / 1000);
    const k = st.get(klic);
    if (k && ted - k.at < 600) return !!k.umi;
    let umi = false;
    try {
      const { openaiBase } = require(`${__hooks}/llm.js`);
      const res = $http.send({ url: openaiBase(c.url) + "/models", method: "GET", headers: { "Authorization": "Bearer " + (c.token || "") }, timeout: 5 });
      umi = res.statusCode === 200 && !!res.json && Array.isArray(res.json.data) && res.json.data.some((m) => /whisper|transcribe/i.test(String((m || {}).id || "")));
    } catch (err) { umi = false; }
    st.set(klic, { at: ted, umi: umi });
    return umi;
  }
  return false;
}

// Přepis → {status, json}; nikdy nehází (routa /advisor stav propouští, jak byla zvyklá).
// o.prazdneOk: prázdný přepis = {text: ""} (hlasovka pozná „nebyla slyšet řeč“); routa /advisor dál 502 jako dřív.
function prepisSurovy(app, L, body, o) {
  const { t } = require(`${__hooks}/i18n.js`);
  const cfg = prepisConfig(app);
  if (!cfg) return { status: 503, json: { error: t(L, "err.transcribeNotConfigured") } };
  if (cfg.druh === "multipart") {
    try {
      const { llmTranscribe } = require(`${__hooks}/llm.js`);
      return { status: 200, json: llmTranscribe({ url: cfg.url, token: cfg.token, transcribeModel: cfg.model, vad: !!cfg.vad }, body, L) };
    } catch (err) {
      if (err && err.prazdny && o && o.prazdneOk) return { status: 200, json: { text: "" } };
      // text výjimky nese adresu přepisovače i s vnitřní IP a portem → jen do logu, volajícímu obecná hláška
      try { $app.logger().warn("prepis: služba selhala", "error", String(err && err.message ? err.message : err).slice(0, 300)); } catch (e2) { /* log je bonus */ }
      return { status: 502, json: { error: t(L, "err.transcribeUnavailable") } };
    }
  }
  try {
    const headers = { "Content-Type": "application/json" };
    if (cfg.sTokenem) headers["X-KB-Token"] = cfg.token;
    const res = $http.send({ url: cfg.url, method: "POST", body: JSON.stringify(Object.assign({}, body, { mode: "transcribe" })), headers: headers,
      // přepis nahrávky legitimně trvá minuty (Whisper na bráně má 600 s)
      timeout: cfg.sTokenem ? 600 : 300 });
    // vlastní JSON adresa u ollama/openai: stav i tělo propustit, jak to dosud dělala routa
    if (!cfg.sTokenem) return { status: res.statusCode, json: res.json };
    if (res.statusCode < 200 || res.statusCode >= 300) {
      if (res.statusCode === 403 || res.statusCode === 429) {
        // kvóta × dočasná brzda × zkušebka: jedno místo pro obě routy (helpers.odmitnutiBrany)
        const { odmitnutiBrany } = require(`${__hooks}/helpers.js`);
        const o = odmitnutiBrany(res, L);
        return { status: o.status, json: o.body };
      }
      return { status: 502, json: { error: t(L, "err.aiAdvisorError", { status: res.statusCode }) } };
    }
    if (res.json && res.json.schema_version !== undefined && res.json.schema_version !== 1) {
      return { status: 502, json: { error: t(L, "err.aiIncompatibleVersion", { version: res.json.schema_version }) } };
    }
    return { status: 200, json: res.json };
  } catch (err) {
    // deník výpadků (jen událost — NIKDY nahrávka ani text)
    try { $app.logger().warn("prepis: spojení s AI selhalo", "error", String(err)); } catch (e2) { /* log je bonus */ }
    return { status: 502, json: { error: t(L, cfg.sTokenem ? "err.aiConnectFailed" : "err.transcribeUnavailable") } };
  }
}

// base64 → prvních pár bajtů (bez dekódování celé nahrávky; goja nemá Buffer)
function bajtyZacatku(b64, n) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const s = String(b64 || "").slice(0, Math.ceil(n / 3) * 4);
  const out = [];
  for (let i = 0; i + 3 < s.length; i += 4) {
    const v = (A.indexOf(s[i]) << 18) | (A.indexOf(s[i + 1]) << 12) | ((A.indexOf(s[i + 2]) & 63) << 6) | (A.indexOf(s[i + 3]) & 63);
    out.push((v >> 16) & 255, (v >> 8) & 255, v & 255);
  }
  return out.slice(0, n);
}
// Druh nahrávky podle OBSAHU (ne přípony od klienta): přípona jde do názvu souboru pro přepisovač
// a do shellu (llmTranscribe) — smí tam jen to, co jsme sami poznali. WhatsApp .opus = Ogg → .ogg.
function druhZvuku(b64) {
  const b = bajtyZacatku(b64, 12);
  const s = (i, txt) => txt.split("").every((ch, k) => b[i + k] === ch.charCodeAt(0));
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  if (s(0, "OggS")) return "ogg";
  if (s(4, "ftyp")) return "m4a";
  if (s(0, "RIFF") && s(8, "WAVE")) return "wav";
  if (s(0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "mp3";
  return "";
}
// Hlasovka z těla /chat — kontrola PŘED hodinovou brzdou (vadná nahrávka ani vypnutý přepis nesmí ubrat
// strop). Vrací příponu; hází 400 (code ai_voice_off / ai_hlas_typ / ai_hlas_velka).
function zkontrolujHlas(app, body, L) {
  const { env } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const chyba = (klic, code, p) => { const e = new Error(t(L, klic, p)); e.status = 400; e.code = code; return e; };
  if (!hlasDostupny(app)) throw chyba("err.chatVoiceOff", "ai_voice_off");
  if (body.image_base64 || body.pdf_text) throw chyba("err.chatVoiceMix", "ai_hlas_typ");
  const s = String(body.audio_base64 || "");
  const mb = Number(env("CHAT_MAX_AUDIO_MB") || 0) || MAX_AUDIO_MB_CHAT;
  if (s.length * 3 / 4 > mb * 1048576) throw chyba("err.chatVoiceTooBig", "ai_hlas_velka", { mb: mb });
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) throw chyba("err.chatVoiceType", "ai_hlas_typ");
  const ext = druhZvuku(s);
  if (!ext) throw chyba("err.chatVoiceType", "ai_hlas_typ");
  return ext;
}
// Přepis hlasovky pro asistenta → text; hází (502 ai_hlas, 422 ai_hlas_prazdny, 403/429 z brány).
// Detail cizí chyby (adresa služby, výtah odpovědi) jde jen do logu — člen dostane obecnou hlášku.
function prepisHlasovky(app, L, b64, ext) {
  const { t } = require(`${__hooks}/i18n.js`);
  const v = prepisSurovy(app, L, { audio_base64: b64, filename: "hlasovka." + ext, lang: L, mode: "transcribe" }, { prazdneOk: true });
  if (v.status !== 200) {
    try { $app.logger().warn("prepis: hlasovka se nepřepsala", "status", String(v.status), "error", String((v.json && v.json.error) || "").slice(0, 300)); } catch (e2) { /* log je bonus */ }
    const e = new Error(v.status === 403 || v.status === 429 ? ((v.json && v.json.error) || t(L, "err.chatVoiceFailed")) : t(L, "err.chatVoiceFailed"));
    e.status = v.status === 403 || v.status === 429 ? v.status : 502;
    e.code = "ai_hlas";
    throw e;
  }
  const text = String((v.json && v.json.text) || "").replace(/\u0000/g, "").trim();
  // typické halucinace Whisperu na tichu/šumu (celý přepis je jen tohle) = žádná řeč, ne nápad do zásobníku
  const halucinace = /^(?:(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:org|cz|com|net|eu)\/?|titulky (?:vytvořil|vytvořila|připravil|připravila|přeložil|přeložila)[^\n]{0,40}|(?:děkuj(?:i|eme)|díky) za (?:pozornost|sledování)[.!]?|thank you(?: (?:so much )?for watching)?[.!]?|you|\.+)$/i;
  if (!text || halucinace.test(text)) { const e = new Error(t(L, "err.chatVoiceEmpty")); e.status = 422; e.code = "ai_hlas_prazdny"; throw e; }
  return text;
}

module.exports = { prepisConfig, hlasDostupny, prepisSurovy, zkontrolujHlas, prepisHlasovky, druhZvuku, MAX_AUDIO_MB_CHAT, HLAS_MAX_S };
