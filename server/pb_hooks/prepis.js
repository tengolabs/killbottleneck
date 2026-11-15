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

const puvod = (u) => require(`${__hooks}/helpers.js`).puvodUrl(u); // původ adresy (schéma + host[:port]) — jedna definice v helpers

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

// base64 → `n` bytes from byte `offset` (no decoding of the whole recording; goja has no Buffer)
function bytesAt(b64, offset, n) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const od = Math.floor(Math.max(0, offset) / 3) * 4;
  const skip = Math.max(0, offset) - od / 4 * 3;
  const s = String(b64 || "").slice(od, od + Math.ceil((skip + n) / 3) * 4);
  const out = [];
  for (let i = 0; i + 3 < s.length; i += 4) {
    const v = (A.indexOf(s[i]) << 18) | (A.indexOf(s[i + 1]) << 12) | ((A.indexOf(s[i + 2]) & 63) << 6) | (A.indexOf(s[i + 3]) & 63);
    out.push((v >> 16) & 255, (v >> 8) & 255, v & 255);
  }
  return out.slice(skip, skip + n);
}
const bajtyZacatku = (b64, n) => bytesAt(b64, 0, n);
const base64Bytes = (b64) => { const s = String(b64 || ""); return Math.max(0, Math.floor(s.length * 3 / 4) - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0)); };

// ---------- length of a voice message, measured by the SERVER (S8-03, 11 Nov 2026) ----------
// Credits for a transcript are charged per second of audio. The length used to be the number the
// client sent (`audio_s`): 0 made the transcript free (the web app sends 0 for every uploaded file),
// 3600 burnt 104 credits with one request. Now the length comes from the uploaded bytes only:
//   1. measured from the container where it is written there and cheap to read — WAV (sample rate ×
//      block size), Ogg (granule position of the last page), MP4/M4A (mvhd), MP3 (frame count of a VBR header,
//      else the bit rate of the first frame);
//   2. otherwise (WebM, fragmented MP4 from Safari's recorder, anything unreadable) estimated from the size
//      at 32 kbit/s — the bit rate our own recorder asks for (useNahravani.js), so a message recorded in
//      the app costs what it did before.
// A measured length must also fit the size: it cannot be shorter than the file at 512 kbit/s (WAV:
// 2 304 kbit/s = 48 kHz stereo 24-bit PCM) nor longer than at 6 kbit/s (the lowest speech bit rate of Opus). A crafted
// header therefore moves the price only inside that window, never to zero and never to an hour.
// The transcriber's own answer is NOT used: neither our gateway nor the OpenAI `json` format returns a length.
const AUDIO_REF_BPS = 32000, AUDIO_MIN_BPS = 6000, AUDIO_MAX_BPS = 512000, WAV_MAX_BPS = 2304000;
const AUDIO_MAX_S = 3600; // the cap of ai_chat_log.audio_ms and of kredity.js
const be = (b, i, n) => { let v = 0; for (let k = 0; k < n; k++) v = v * 256 + (b[i + k] || 0); return v; };
const le = (b, i, n) => { let v = 0; for (let k = n - 1; k >= 0; k--) v = v * 256 + (b[i + k] || 0); return v; };
const ascii = (b, i, txt) => txt.split("").every((ch, k) => b[i + k] === ch.charCodeAt(0));

function wavSeconds(b64, total) {
  const h = bytesAt(b64, 0, 48);
  if (!ascii(h, 12, "fmt ")) return 0;
  // Only uncompressed audio (PCM 1, IEEE float 3, or "extensible" carrying one of the two) is measured
  // from the header: a compressed stream inside a WAV says nothing about its length there. And the
  // rate is built from what a decoder really uses (channels × sample rate × sample size) — the
  // `block align` field is ignored by decoders, so a crafted one used to shrink the price.
  let code = le(h, 20, 2);
  if (code === 0xfffe) code = le(h, 44, 2);
  if (code !== 1 && code !== 3) return 0;
  const rate = le(h, 22, 2) * le(h, 24, 4) * Math.ceil(le(h, 34, 2) / 8); // bytes per second
  return rate > 0 ? Math.max(0, total - 44) / rate : 0;
}
function oggSeconds(b64, total) {
  const first = bytesAt(b64, 0, 27 + 255 + 32);
  const p = 27 + (first[26] || 0); // first packet: the codec identification header
  let rate = 0, skip = 0;
  if (ascii(first, p, "OpusHead")) { rate = 48000; skip = le(first, p + 10, 2); }
  else if (first[p] === 1 && ascii(first, p + 1, "vorbis")) rate = le(first, p + 12, 4);
  if (!rate) return 0;
  // the last page carries the position of the last sample; a page is at most 65 307 bytes
  const n = Math.min(total, 65307 + 27);
  const tail = bytesAt(b64, total - n, n);
  for (let i = tail.length - 27; i >= 0; i--) {
    if (tail[i] !== 0x4f || !ascii(tail, i, "OggS")) continue;
    if (le(tail, i + 12, 2) !== 0) return 0; // position unknown (-1) or absurd
    return Math.max(0, le(tail, i + 6, 6) - skip) / rate;
  }
  return 0;
}
function mp4Seconds(b64, total) {
  // walk the boxes [from, to) and return the offset of the payload of the first box of `type`
  const find = (from, to, type) => {
    for (let pos = from, k = 0; pos + 8 <= to && k < 64; k++) {
      const h = bytesAt(b64, pos, 16);
      let size = be(h, 0, 4), head = 8;
      if (size === 1) { size = be(h, 8, 8); head = 16; } else if (size === 0) size = to - pos;
      if (size < head) return null;
      if (ascii(h, 4, type)) return { at: pos + head, end: Math.min(to, pos + size) };
      pos += size;
    }
    return null;
  };
  const moov = find(0, total, "moov");
  const mvhd = moov && find(moov.at, moov.end, "mvhd");
  if (!mvhd) return 0;
  const h = bytesAt(b64, mvhd.at, 32);
  const v1 = h[0] === 1;
  const scale = be(h, v1 ? 20 : 12, 4), dur = v1 ? be(h, 24, 8) : be(h, 16, 4);
  if (!scale || !dur || (!v1 && dur === 0xffffffff)) return 0; // fragmented recording: the length is not in the header
  return dur / scale;
}
function mp3Seconds(b64, total) {
  let at = 0;
  const id3 = bytesAt(b64, 0, 10);
  if (ascii(id3, 0, "ID3")) at = 10 + ((id3[6] & 127) << 21 | (id3[7] & 127) << 14 | (id3[8] & 127) << 7 | (id3[9] & 127));
  const h = bytesAt(b64, at, 4);
  if (h[0] !== 0xff || (h[1] & 0xe0) !== 0xe0 || ((h[1] >> 1) & 3) !== 1) return 0; // Layer III only
  const ver = (h[1] >> 3) & 3, v1 = ver === 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  // variable bit rate: the first frame is a Xing/Info header with the number of frames
  const hz = [44100, 48000, 32000][(h[2] >> 2) & 3] / (v1 ? 1 : ver === 2 ? 2 : 4);
  const f = bytesAt(b64, at, 200);
  for (let i = 4; i < 180 && hz; i++) {
    if ((ascii(f, i, "Xing") || ascii(f, i, "Info")) && (f[i + 7] & 1)) return be(f, i + 8, 4) * (v1 ? 1152 : 576) / hz;
  }
  const kbps = (v1 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
    : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0])[h[2] >> 4];
  return kbps ? Math.max(0, total - at) * 8 / (kbps * 1000) : 0;
}
// Seconds of audio in a voice message (whole seconds, 1–3600); `ext` is the kind recognised by druhZvuku.
function audioSeconds(b64, ext) {
  const total = base64Bytes(b64);
  if (!total) return 0;
  let s = 0;
  try {
    s = ext === "wav" ? wavSeconds(b64, total) : ext === "ogg" ? oggSeconds(b64, total)
      : ext === "m4a" ? mp4Seconds(b64, total) : ext === "mp3" ? mp3Seconds(b64, total) : 0;
  } catch (err) { s = 0; }
  if (!(s > 0) || !Number.isFinite(s)) s = total * 8 / AUDIO_REF_BPS;
  else s = Math.min(Math.max(s, total * 8 / (ext === "wav" ? WAV_MAX_BPS : AUDIO_MAX_BPS)), total * 8 / AUDIO_MIN_BPS);
  return Math.min(AUDIO_MAX_S, Math.max(1, Math.round(s)));
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

module.exports = { prepisConfig, hlasDostupny, prepisSurovy, zkontrolujHlas, prepisHlasovky, druhZvuku, audioSeconds, MAX_AUDIO_MB_CHAT, HLAS_MAX_S };
