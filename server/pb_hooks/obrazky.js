// Obrázky asistenta (29. 10. 2026): FLUX.2 klein (ilustrace, Apache 2.0) a FLUX 3 Klein (obrázky s textem)
// na GPU serveru přes bránu (mode=image). Rozhodnutí Richarda 29. 10.: oba modely, FLUX 3 jen tam, kde má být
// v obrázku text, a s vlastním vypínačem (KB_IMAGE_TEXT). Vzor Stránek: nástroj
// generate_image jen ZADÁ (stav „ceka“), karta v prohlížeči pak zavolá /chat/obrazek/vytvorit (sekundy).
// Výpadek služby obrázků = „obrázky teď nejdou“, ŽÁDNÁ tichá náhrada jiným modelem.
//
// Kam obrázek jde: KB_IMAGE_URL (…/v1/advisor brány) + KB_IMAGE_TOKEN; bez adresy s KB_IMAGE_PROVIDER=api
// adresa a token AI brány instance (provider api). KB_IMAGE_TEXT=1 povolí FLUX 3. Bez toho je funkce skrytá
// (self-host, Lite beze změny).
// Vlastní služba (self-host, 5. 11. 2026): KB_IMAGE_PROVIDER=openai = standardní OpenAI Images API
// (POST {KB_IMAGE_URL}/images/generations, výchozí https://api.openai.com/v1), klíč KB_IMAGE_TOKEN, model KB_IMAGE_MODEL
// (výchozí gpt-image-1). Obrázek se chce jako JPEG (output_format) — jiný formát pole souboru nepřijme.
// ⚠️ PocketBase JSVM: require() uvnitř funkcí.

const PRESETY = { ctverec: [1024, 1024], banner: [1200, 400], hlavicka: [1536, 640], vysoky: [512, 896], siroky: [1792, 1024] };
const MAX_PROMPT = 3000;   // strop brány i služby obrázků
const MAX_TITLE = 120;
const TIMEOUT_S = 90;      // Cloudflare utne požadavek kolem 100 s; 16 úloh ve frontě FLUX 3 ≈ 60 s
const ZAMEK_MS = (TIMEOUT_S + 30) * 1000;

function chybaS(status, klic, params) { const e = new Error(klic); e.status = status; e.klic = klic; e.params = params || {}; return e; }

function konfigurace(app) {
  const { env, aiConfig, puvodUrl, aiHostBlocked } = require(`${__hooks}/helpers.js`);
  const p = String(env("IMAGE_PROVIDER") || "").toLowerCase();
  if (p === "none") return null;
  if (p === "openai") {
    const klic = env("IMAGE_TOKEN") || "";
    if (!klic) return null; // bez klíče se OpenAI nedá volat → funkce skrytá
    return { openai: true, url: String(env("IMAGE_URL") || "https://api.openai.com/v1").replace(/\/+$/, ""), token: klic,
      model: env("IMAGE_MODEL") || "gpt-image-1", text: env("IMAGE_TEXT") === "1" };
  }
  let url = env("IMAGE_URL") || "", token = env("IMAGE_TOKEN") || "";
  let c = null;
  try { c = aiConfig(app); } catch (err) { c = null; }
  const brana = c && c.provider === "api" && c.url;
  if (!url && p === "api" && brana) url = c.url;
  if (!url) return null;
  // adresa z nastavení v DB: stejná kontrola soukromé sítě jako chat / přepis (hostovaná instance nesmí do LAN boxu)
  if (c && c.source === "db" && url === c.url && aiHostBlocked(url)) return null;
  // token brány instance smí odejít jen na tutéž bránu (vzor prepis.js)
  if (!token && brana && puvodUrl(url) === puvodUrl(c.url)) token = c.token || "";
  return { url: url, token: token, text: env("IMAGE_TEXT") === "1" };
}

// Nabízí instance obrázky? Konfigurace + tarif brány (/v1/status v aiModesCache, když se ptá stejná brána).
function dostupne(app) {
  const cfg = konfigurace(app);
  if (!cfg) return false;
  if (cfg.openai) return true; // vlastní služba: tarif naší brány se jí netýká
  const { aiConfig, puvodUrl } = require(`${__hooks}/helpers.js`);
  let c = null;
  try { c = aiConfig(app); } catch (err) { c = null; }
  if (!c || !c.url || puvodUrl(cfg.url) !== puvodUrl(c.url)) return true; // obrázky jdou jinam než chat → tarif chatové brány neplatí
  const k = app.store().get("aiModesCache");
  return !(k && k.provider === "api" && Array.isArray(k.modes) && k.modes.length && !k.modes.includes("image"));
}

function najdi(app, userId, id) {
  if (!id || !/^[a-z0-9]{15}$/.test(String(id))) return null;
  try {
    const rec = app.findRecordById("ai_images", String(id));
    // banner sumáře patří instanci (sdílí ho všichni příjemci e-mailu) — uživatel ho nesmí smazat ani překreslit
    return rec.getString("user") === userId && !rec.getBool("banner") ? rec : null;
  } catch (err) { return null; }
}

function adresa(rec) {
  const f = rec.getString("file");
  return f ? `/api/files/ai_images/${rec.id}/${encodeURIComponent(f)}` : "";
}

// „pise“ déle než zámek kreslení = proces spadl uprostřed (restart, nasazení) → navenek chyba (Zkusit znovu), ne věčné točení
function uvizly(rec) {
  if (rec.getString("stav") !== "pise") return false;
  const u = new Date(String(rec.getString("updated")).replace(" ", "T"));
  return !isNaN(u.getTime()) && Date.now() - u.getTime() > ZAMEK_MS;
}
// Po startu PocketBase (nasazení, OOM): kreslení „pise“ nemá kdo dokončit. S hotovým souborem (spadlé „Nakreslit znovu“)
// = zpět hotovo — jinak by obrázek zmizel ze záložky i z Kanceláře, přestože soubor existuje; bez souboru = chyba (vzor stranky.poRestartu)
function poRestartu(app) {
  let rows = [];
  try { rows = app.findRecordsByFilter("ai_images", "stav = 'pise'", "", 500, 0); } catch (err) { rows = []; }
  for (const rec of rows) {
    try {
      if (rec.getString("file")) { nastavStav(app, rec, "hotovo", ""); continue; }
      const { t, userLang } = require(`${__hooks}/i18n.js`);
      let L = userLang(null); try { L = userLang(app.findRecordById("users", rec.getString("user"))); } catch (err) { L = userLang(null); }
      nastavStav(app, rec, "chyba", t(L, "err.imageInterrupted"));
    } catch (err) { /* další záznam */ }
  }
  return rows.length;
}
function dto(rec) {
  const r = PRESETY[rec.getString("preset")] || PRESETY.ctverec;
  return {
    id: rec.id,
    title: rec.getString("title"),
    model: rec.getString("model"),
    preset: rec.getString("preset"),
    stav: uvizly(rec) ? "chyba" : rec.getString("stav"),
    chyba: uvizly(rec) ? "timeout" : rec.getString("chyba"),
    url: adresa(rec),
    width: r[0], height: r[1],
    gen_s: Number(rec.get("gen_s")) || 0,
    chat: rec.getString("chat"),
    trvale: !!rec.getBool("trvale"),
    created: rec.getString("created"),
  };
}

// Zadání z nástroje / MCP. Text v obrázku (FLUX 3) = `text`; prompt ho musí obsahovat doslova.
function zaloz(app, userId, o, opt) {
  const cfg = konfigurace(app);
  if (!cfg) throw chybaS(404, "err.imagesOff");
  const prompt = String(o.prompt || "").replace(/\u0000/g, "").trim();
  if (!prompt) throw chybaS(400, "err.imagePromptMissing");
  const text = String(o.text || "").replace(/[\u0000\r\n]/g, " ").trim().slice(0, 200);
  if (text && !cfg.text) throw chybaS(403, "err.imageTextOff");
  const p = text && prompt.indexOf(text) < 0 ? `${prompt} The image clearly shows the text "${text}".` : prompt;
  if (p.length > MAX_PROMPT) throw chybaS(400, "err.imagePromptLong", { max: MAX_PROMPT });
  const preset = PRESETY[o.preset] ? o.preset : "ctverec";
  const rec = new Record(app.findCollectionByNameOrId("ai_images"));
  rec.set("user", userId);
  rec.set("title", String(o.title || "").replace(/[\u0000\r\n]/g, " ").trim().slice(0, MAX_TITLE));
  rec.set("prompt", p);
  rec.set("model", text ? "flux3" : "klein");
  rec.set("preset", preset);
  rec.set("stav", "ceka");
  rec.set("chat", String((opt && opt.chat) || "").slice(0, 40));
  rec.set("banner", !!(opt && opt.banner)); // jen server (sumarMail.js) — uživatelský vstup ho nastavit nemůže
  app.save(rec);
  return rec;
}

// „Nový obrázek“ ze záložky Obrázky. Formáty podle toho, na co obrázek je (Richard 4. 11. večer: „office obrázky do
// prezentací, mailu, příspěvků“): prezentace = na šířku, e-mail = pruh (banner), příspěvek = čtverec, story = na výšku.
// Popis člověka (česky, krátce) přepíše chatovací model asistenta na podrobný anglický popis scény — stejná cesta jako
// obrázky v prezentaci a v chatu (generate_image). Richard 4. 11. večer 2: krátká věta rovnou do FLUXu dávala pokaždé
// jiný vzhled a chyby („2× PC“); líbí se mu teplé malované ilustrace z prezentace → styl „ilustrace“.
// 5. 11. 2026: výchozí je „malba“ — v porovnání 6 scén × 2 modely × 2 pokusy vyšla hezčí než plochá ilustrace.
const PRESETY_NOVY = ["ctverec", "siroky", "vysoky", "banner"];
const STYLY = {
  malba: "detailed painterly illustration, soft cinematic lighting, warm golden light rays through a window, rich amber and brown tones, atmospheric and peaceful mood",
  // změřeno 4. 11.: „soft painted“ dělá průhledné dvojité monitory / postavy, „deep green“ zelený kal → bez nich
  ilustrace: "warm flat illustration, cozy interior, soft morning light through a window, honey-colored wood, calm earthy colors",
  foto: "professional photograph, natural light, realistic, sharp focus",
  kresleny: "friendly cartoon illustration, clean outlines, cheerful warm colors",
  akvarel: "soft watercolor painting, gentle washes, paper texture, warm palette",
  skica: "hand-drawn pencil sketch, fine lines, black and white",
  "3d": "3D render, soft clay style, rounded shapes, warm studio lighting",
};
const UCEL = {
  siroky: "a wide presentation slide picture (landscape 16:9)",
  banner: "a very wide e-mail header strip (3:1) — keep the subject small and centered, calm background on the sides",
  ctverec: "a square social media post",
  vysoky: "a tall portrait story picture (9:16) — subject vertical, centered",
};
const POPIS_SYSTEM = [
  "You write prompts for the FLUX image model. The user describes a picture in a few words (often in Czech).",
  "Write ONE English prompt of 40–90 words: a concrete, coherent scene that shows exactly what the user asked for.",
  "Name the main subject first, then the setting, composition and exact counts (e.g. \"a man at a desk with one computer monitor\"),",
  "Always say how many people there are (e.g. \"one man, alone in the room\"), so the image model does not add extra figures.",
  "lighting, colors and the given style. Keep every detail the user asked for; do not add people, objects or brands they did not imply.",
  "Reply with the prompt only: no quotes, no explanation.",
].join(" ");
const POPIS_BEZ_TEXTU = " No words, letters, logos or signs in the picture — end the prompt with \"no text\".";
const POPIS_S_TEXTEM = " The picture must show the given words exactly once, clearly readable (e.g. as a headline); say where they are. No other text.";
function popisUzivatele(b) { return String((b && b.prompt) || "").replace(/\s+/g, " ").trim().slice(0, 1000); }
function stylNoveho(b) { const k = String((b && b.styl) || ""); return Object.prototype.hasOwnProperty.call(STYLY, k) ? k : "malba"; }
function presetNoveho(b) { return PRESETY_NOVY.includes(b && b.preset) ? b.preset : "ctverec"; }
// odpověď modelu → jeden řádek promptu (bez uvozovek a úvodu „Prompt:“); "" = nepoužitelná
function vycistiPopis(out, sTextem) {
  let p = String(out || "").replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").replace(/```[a-z]*|```/gi, " ").replace(/\s+/g, " ").trim();
  p = p.replace(/^(prompt|image prompt)\s*:\s*/i, "").replace(/^["'“„]+|["'”“]+$/g, "").trim();
  if (p.length < 20) return "";
  if (sTextem) p = p.replace(/[,.\s]*\bno text\.?$/i, ""); // FLUX 3: text tam být má (zaloz připíše přesná slova)
  else if (!/no text\.?$/i.test(p)) p = p.replace(/[.\s]+$/, "") + ", no text";
  return p.slice(0, 2000);
}
// popis → anglický prompt přes chatovací model instance (vlastní model zákazníka taky) + řádek ai_chat_log (tokeny, kredity)
function napisPopis(app, e, b, L) {
  const C = require(`${__hooks}/chat.js`);
  const { llmChat } = require(`${__hooks}/llm.js`);
  const popis = popisUzivatele(b);
  if (!popis) throw chybaS(400, "err.imagePromptMissing");
  const cfgR = C.chatCfg(e, {}, L);
  if (cfgR.chyba) { const err = new Error(cfgR.chyba.body.error); err.status = cfgR.chyba.status; err.odpoved = cfgR.chyba.body; throw err; }
  const cfg = cfgR.cfg;
  // týdenní strop obrázků dřív než model (popis by jinak stál tokeny zbytečně)
  const tyden = tydenBrzda(app, L);
  if (tyden) { const err = new Error(String(tyden.body.error)); err.status = tyden.status; err.odpoved = tyden.body; throw err; }
  const brzda = C.chatBrzda(e, L, { _popisObrazku: true }, cfg); // jako textový tah (váha 1); kreslení pak samo ubere svou váhu
  if (brzda) { const err = new Error(String((brzda.body && brzda.body.error) || "")); err.status = brzda.status; err.odpoved = brzda.body; throw err; }
  const text = String((b && b.text) || "").trim();
  // české „notebook“ = laptop; model ho bez nápovědy překládal jako papírový sešit (změřeno 4. 11.)
  const laptop = /\bnot[eě]b[oů]|\bnoťas/i.test(popis) ? '\n(Czech "notebook" here means a laptop computer — write "laptop".)' : "";
  const user = `Picture: ${popis}${laptop}\nUse: ${UCEL[presetNoveho(b)]}\nStyle: ${STYLY[stylNoveho(b)]}` + (text ? `\nWords in the picture: "${text.slice(0, 200)}"` : "");
  const s = {}, t0 = Date.now();
  let out = "", chyba = null;
  try {
    out = llmChat(cfg, POPIS_SYSTEM + (text ? POPIS_S_TEXTEM : POPIS_BEZ_TEXTU), user, { numPredict: 400 + (cfg.think ? 2000 : 0), timeout: 60, lang: L, stats: s, temperature: 0.5, think: cfg.think === undefined ? false : cfg.think });
  } catch (err) {
    chyba = String((err && err.message) || err);
  }
  const prompt = chyba ? "" : vycistiPopis(out, !!text);
  if (!chyba && !prompt) chyba = "image_prompt_empty";
  const stats = { calls: 1, in: s.in || 0, out: s.out || 0, cached: s.cached || 0, model: s.model || cfg.model || "", tools: ["image_prompt"], skupiny: ["kresleni"], zdarma: zdarma(),
    volani: [{ model: s.model || cfg.model || "", provider: cfg.provider || "", in: s.in || 0, cached: s.cached || 0, out: s.out || 0, tier: "heavy", druh: "obrazek_popis", vlastni: !!cfg.vlastni }] };
  C.zapisLog(app, e.auth, { id: "" }, cfg, stats, Date.now() - t0, chyba);
  if (chyba) {
    try { $app.logger().warn("obrazky: popis nového obrázku se nenapsal", "error", chyba.slice(0, 300)); } catch (e2) { /* log je bonus */ }
    throw chybaS(502, "err.imagePromptFailed");
  }
  return prompt;
}
function novy(app, e, b, L) {
  const popis = popisUzivatele(b);
  if (!popis) throw chybaS(400, "err.imagePromptMissing");
  const cfg = konfigurace(app);
  if (!cfg) throw chybaS(404, "err.imagesOff");
  if (String((b && b.text) || "").trim() && !cfg.text) throw chybaS(403, "err.imageTextOff"); // dřív než model (tokeny zbytečně)
  const title = popis.length > 80 ? popis.slice(0, 79).replace(/\s+\S*$/, "") + "…" : popis;
  return zaloz(app, e.auth.id, { prompt: napisPopis(app, e, b, L), title: title, text: (b && b.text) || "", preset: presetNoveho(b) });
}

// base64 JPEG → soubor záznamu (vzor hlášení chyb v main.pb.js: dočasný soubor → busybox base64 -d → fileFromPath)
function ulozSoubor(rec, b64) {
  const stem = $os.tempDir() + "/kb-obrazek-" + $security.randomString(12);
  const b64Path = stem + ".b64", jpgPath = stem + ".jpg";
  try {
    $os.writeFile(b64Path, String(b64).replace(/[^A-Za-z0-9+/=]/g, ""), 0o600);
    $os.writeFile(jpgPath, "", 0o600);
    $os.cmd("sh", "-c", "base64 -d < '" + b64Path + "' > '" + jpgPath + "'").run();
    rec.set("file", $filesystem.fileFromPath(jpgPath)); // maxSelect 1 → starý soubor PocketBase po uložení smaže
  } finally {
    try { $os.remove(b64Path); } catch (err) { /* nevadí */ }
  }
  return jpgPath;
}

// OpenAI Images API: velikost podle formátu — gpt-image umí 1024², 1536×1024 a 1024×1536 (dall-e-3 1792 místo 1536);
// jiná kompatibilní služba dostane přesné rozměry formátu
function velikostOpenai(model, preset) {
  const [w, h] = PRESETY[preset] || PRESETY.ctverec;
  const m = String(model || "").toLowerCase();
  if (!/^(gpt-image|dall-e)/.test(m)) return `${w}x${h}`;
  if (w === h || m === "dall-e-2") return "1024x1024";
  const dlouha = m === "dall-e-3" ? 1792 : 1536;
  return w > h ? `${dlouha}x1024` : `1024x${dlouha}`;
}
function volejOpenai(cfg, rec) {
  const telo = { model: cfg.model, prompt: rec.getString("prompt"), n: 1, size: velikostOpenai(cfg.model, rec.getString("preset")) };
  if (/^gpt-image/i.test(cfg.model)) telo.output_format = "jpeg";
  else telo.response_format = "b64_json";
  const t0 = Date.now();
  let res;
  try {
    res = $http.send({ url: cfg.url + "/images/generations", method: "POST", body: JSON.stringify(telo),
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.token }, timeout: TIMEOUT_S });
  } catch (err) {
    try { $app.logger().warn("obrazky: spojení s OpenAI službou selhalo", "error", String(err).slice(0, 300)); } catch (e2) { /* log je bonus */ }
    throw chybaS(502, "err.imageUnavailable");
  }
  const d = (res.json && Array.isArray(res.json.data) && res.json.data[0]) || null;
  if (res.statusCode === 200 && d && d.b64_json) {
    const b64 = String(d.b64_json);
    if (b64.slice(0, 4) !== "/9j/") throw chybaS(502, "err.imageOpenaiFormat"); // JPEG začíná FF D8 FF = base64 „/9j/“
    return { b64: b64, seed: 0, gen_s: Math.round((Date.now() - t0) / 100) / 10 };
  }
  if (res.statusCode === 429) throw chybaS(503, "err.imageBusy");
  const msg = String((res.json && res.json.error && (res.json.error.code || res.json.error.type)) || ("HTTP " + res.statusCode)).slice(0, 80);
  try { $app.logger().warn("obrazky: OpenAI služba odmítla", "status", res.statusCode, "code", msg); } catch (e2) { /* log je bonus */ }
  if (res.statusCode >= 400 && res.statusCode < 500) throw chybaS(502, "err.imageOpenaiRefused", { msg: msg });
  throw chybaS(502, "err.imageUnavailable");
}

// Volání brány → {b64, seed, gen_s}; chyba = chybaS (hláška v jazyce uživatele, nikdy adresa služby)
function volejBranu(cfg, rec, seed, L) {
  if (cfg.openai) return volejOpenai(cfg, rec);
  const telo = { mode: "image", prompt: rec.getString("prompt"), model: rec.getString("model"), preset: rec.getString("preset") };
  if (seed !== null && seed !== undefined) telo.seed = seed;
  let res;
  try {
    res = $http.send({ url: cfg.url, method: "POST", body: JSON.stringify(telo),
      headers: { "Content-Type": "application/json", "X-KB-Token": cfg.token || "" }, timeout: TIMEOUT_S });
  } catch (err) {
    try { $app.logger().warn("obrazky: spojení s bránou selhalo", "error", String(err).slice(0, 300)); } catch (e2) { /* log je bonus */ }
    throw chybaS(502, "err.imageUnavailable");
  }
  if (res.statusCode === 200 && res.json && res.json.image_base64) {
    return { b64: res.json.image_base64, seed: Number(res.json.seed) || 0, gen_s: Number(res.json.gen_s) || 0 };
  }
  const d = (res.json && (res.json.detail || res.json)) || {};
  const kod = String((typeof d === "object" && d.code) || "");
  if (kod === "image_busy" || res.statusCode === 503) throw chybaS(503, "err.imageBusy");
  if (kod === "image_model_disabled") throw chybaS(403, "err.imageTextOff");
  if (res.statusCode === 403 || res.statusCode === 429) {
    const { odmitnutiBrany } = require(`${__hooks}/helpers.js`);
    const o = odmitnutiBrany(res, L);
    const e = new Error(o.body.error); e.status = o.status; e.odpoved = o.body; throw e;
  }
  try { $app.logger().warn("obrazky: brána odmítla", "status", res.statusCode, "code", kod); } catch (e2) { /* log je bonus */ }
  throw chybaS(502, "err.imageUnavailable");
}

function nastavStav(app, rec, stav, chyba) {
  rec.set("stav", stav); rec.set("chyba", String(chyba || "").slice(0, 300));
  app.save(rec);
}

// řádek ai_chat_log: kredity obrázku podle modelu (kredity.js, stats.obrazek), k rozhovoru karty
// opt.system = obrázek instance (banner sumáře): řádek kvůli provozu zůstává, kredity 0 (neplatí náhodný první příjemce)
function zapisLog(app, auth, rec, ms, chyba, gen, opt) {
  try {
    const l = new Record(app.findCollectionByNameOrId("ai_chat_log"));
    const model = rec.getString("model");
    const stats = { calls: 1, in: 0, out: 0, cached: 0, obrazek: { model: model } };
    l.set("stav", chyba ? "chyba" : "ok"); l.set("chyba", chyba ? String(chyba).slice(0, 300) : "");
    l.set("user", auth.id); l.set("chat", rec.getString("chat")); l.set("provider", "image");
    // vlastní služba (OpenAI Images API) = její model, ne náš FLUX
    l.set("model", (opt && opt.model ? String(opt.model).slice(0, 60) : (model === "flux3" ? "flux3-klein" : "flux2-klein")) + "#obrazek");
    l.set("tokens_in", 0); l.set("tokens_out", 0); l.set("tokens_cached", 0); l.set("ms", ms); l.set("calls", 1);
    l.set("tools", opt && opt.system ? "image_banner" : "image_draw"); l.set("skupiny", "kresleni"); // banner = jiná značka: do týdenního stropu se nepočítá // vlastní značka (vzor page_writer) — tah s generate_image je jiný řádek
    if (gen) l.set("prepis_ms", Math.round(gen * 1000)); // čas na GPU (GPU čas jako u přepisu)
    l.set("kredity", opt && opt.system ? 0 : Math.round(require(`${__hooks}/kredity.js`).kredityTahu(stats, chyba, null) * 10000) / 10000);
    l.set("zdroj", opt && opt.model ? "vlastni" : "nas");
    l.set("volani", "[]");
    app.save(l);
  } catch (err) {
    try { $app.logger().warn("obrazky: zápis do ai_chat_log selhal", "error", String(err).slice(0, 300)); } catch (e2) { /* log je bonus */ }
  }
}

// Týdenní strop obrázků instance (KB_OBRAZKY_TYDEN; prázdné / 0 = bez stropu; Richard 5. 11. 2026: obrázky „solo“ —
// vlastní počet, ne kredity). Počítají se POVEDENÁ kreslení uživatelů (řádky image_draw, i Nakreslit znovu a ilustrace
// Stránek) od pondělí 00:00 UTC — stejný týden jako kvóta kreditů (kredity.js zacatekTydne); banner sumáře (image_banner)
// patří instanci a do stropu se nepočítá. Rozkreslené (ještě bez řádku) se nepočítají → souběh může strop přetáhnout o pár kusů.
function stropTydne() {
  const { env } = require(`${__hooks}/helpers.js`);
  const n = parseInt(env("OBRAZKY_TYDEN"), 10);
  return n > 0 ? Math.min(n, 1000000) : 0;
}
function nakreslenoTydne(app, ted) {
  const od = require(`${__hooks}/kredity.js`).zacatekTydne(ted).toISOString().replace("T", " ").slice(0, 19);
  const rows = arrayOf(new DynamicModel({ n: 0 }));
  try {
    app.db().newQuery("SELECT COUNT(*) AS n FROM ai_chat_log WHERE tools = 'image_draw' AND stav = 'ok' AND created >= {:od}").bind({ od: od }).all(rows);
  } catch (err) { return 0; }
  return rows.length ? Number(rows[0].n) || 0 : 0;
}
function tydenBrzda(app, L) {
  const strop = stropTydne();
  if (!strop) return null;
  if (nakreslenoTydne(app) < strop) return null;
  const { t } = require(`${__hooks}/i18n.js`);
  return { status: 429, body: { error: t(L, "err.imageWeekLimit", { limit: strop }), code: "image_week" } };
}
// obrázek bez kreditů (KB_OBRAZEK_KREDITY=0): kreslení ani popis Nového obrázku pak nečerpají kvótu kreditů a ta je ani nezastaví
function zdarma() {
  const { env } = require(`${__hooks}/helpers.js`);
  const p = parseFloat(env("OBRAZEK_KREDITY"));
  return Number.isFinite(p) && p === 0;
}
function stavTydne(app) {
  const strop = stropTydne();
  return strop ? { strop: strop, nakresleno: nakreslenoTydne(app) } : null;
}

// POST /chat/obrazek/vytvorit {id, znovu?} → {status, body}. Nakreslí obrázek ve stavu ceka/chyba;
// znovu = hotový obrázek nakreslit znovu s novým seedem (soubor se nahradí). Odpověď píše routa.
function vytvorit(app, e, body) {
  const C = require(`${__hooks}/chat.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const cfg = konfigurace(app);
  if (!cfg) return { status: 404, body: { error: t(L, "err.imagesOff") } };
  const rec = najdi(app, e.auth.id, body && body.id);
  if (!rec) return { status: 404, body: { error: t(L, "err.imageNotFound") } };
  const znovu = !!(body && body.znovu);
  if (rec.getString("stav") === "hotovo" && !znovu) return { status: 200, body: { obrazek: dto(rec) } };
  // odmítnutí PŘED kreslením (text vypnutý, brzda, kvóta): nenakreslený obrázek → „chyba“ se zprávou, jinak by zůstal
  // „ceka“ a karta by se točila donekonečna bez Zkusit znovu (checkup 5. 11. večer); hotový obrázek zůstává hotový
  const odmitni = (r) => {
    if (rec.getString("stav") !== "hotovo") { try { nastavStav(app, rec, "chyba", String((r.body && r.body.error) || "")); } catch (err) { /* smazaný */ } }
    return r;
  };
  if (rec.getString("model") === "flux3" && !cfg.text) return odmitni({ status: 403, body: { error: t(L, "err.imageTextOff") } });
  // stránka má v HTML adresu SOUBORU — nový soubor by starý smazal a stránka by obrázek ztratila (dokument bere obrázek podle id)
  if (znovu) {
    const pouz = pouziti(app, rec);
    if (!pouz) return { status: 503, body: { error: t(L, "err.imageUnavailable") } };
    const stranky = pouz.filter((x) => x.druh === "stranka");
    if (stranky.length) return { status: 409, body: { error: t(L, "err.imageInPage", { kde: stranky.map((x) => x.title || "?").join(", ") }), code: "image_in_page" } };
  }
  // zámek proti dvojímu kreslení (dvě karty / dva prohlížeče) — PŘED brzdou, ať 409 nestojí kvótu
  const store = app.store();
  const klic = "img:pise:" + rec.id;
  let obsazeno = false;
  store.setFunc(klic, (stary) => {
    const od = Number(stary) || 0;
    if (od && Date.now() - od < ZAMEK_MS) { obsazeno = true; return stary; }
    return Date.now();
  });
  if (obsazeno) return { status: 409, body: { error: t(L, "err.imageDrawing") } };
  try {
    const brzda = C.chatBrzda(e, L, { _obrazek: true }, null);
    if (brzda) return odmitni(brzda);
    return nakresli(app, e.auth, rec, cfg, L, znovu);
  } finally {
    store.set(klic, 0);
  }
}

// Jádro kreslení (karta i stránky): stav pise → brána → soubor → hotovo + řádek logu. Bez zámku a brzdy (řeší volající).
function nakresli(app, auth, rec, cfg, L, znovu, opt0) {
  const { t } = require(`${__hooks}/i18n.js`);
  const opt = cfg.openai ? Object.assign({}, opt0 || {}, { model: cfg.model }) : opt0;
  const pred = { stav: rec.getString("stav"), chyba: rec.getString("chyba") };
  nastavStav(app, rec, "pise", "");
  const t0 = Date.now();
  let vys;
  try {
    vys = volejBranu(cfg, rec, znovu ? null : (rec.get("seed") || null), L);
  } catch (err) {
    const zprava = err && err.klic ? t(L, err.klic, err.params || {}) : String((err && err.message) || "");
    // nový obrázek: chyba na kartě (Zkusit znovu); nepovedené „Znovu“ hotový obrázek NEzahodí
    if (znovu && pred.stav === "hotovo") nastavStav(app, rec, "hotovo", "");
    else nastavStav(app, rec, "chyba", zprava);
    zapisLog(app, auth, rec, Date.now() - t0, err && err.klic ? err.klic : "gateway_" + (err && err.status), 0, opt);
    if (err && err.odpoved) return { status: err.status, body: err.odpoved };
    if (err && err.klic) return { status: err.status || 502, body: { error: zprava, code: err.klic === "err.imageBusy" ? "image_busy" : "" } };
    throw err;
  }
  // uložení souboru / záznamu může selhat (jiný formát než JPEG, restart, plný disk) → stav „chyba“, NE věčné „pise“
  // (karta by se točila donekonečna a obrázek nešel ani odebrat); kredity 0 jako u chyby brány
  let cesta = "";
  try {
    cesta = ulozSoubor(rec, vys.b64);
    rec.set("seed", vys.seed); rec.set("gen_s", vys.gen_s);
    rec.set("stav", "hotovo"); rec.set("chyba", "");
    app.save(rec);
  } catch (err) {
    try { $app.logger().warn("obrazky: uložení obrázku selhalo", "id", rec.id, "error", String(err).slice(0, 300)); } catch (e2) { /* log je bonus */ }
    try {
      const znovuNacteny = app.findRecordById("ai_images", rec.id); // rec nese neuložené změny (soubor, stav hotovo)
      if (znovu && pred.stav === "hotovo") nastavStav(app, znovuNacteny, "hotovo", "");
      else nastavStav(app, znovuNacteny, "chyba", t(L, "err.imageUnavailable"));
    } catch (e3) { /* záznam mezitím smazaný */ }
    zapisLog(app, auth, rec, Date.now() - t0, "image_save", 0, opt);
    return { status: 502, body: { error: t(L, "err.imageUnavailable"), code: "" } };
  } finally {
    if (cesta) { try { $os.remove(cesta); } catch (err) { /* nevadí */ } }
  }
  zapisLog(app, auth, rec, Date.now() - t0, null, vys.gen_s, opt);
  return { status: 200, body: { obrazek: dto(rec) } };
}

// obrázky zadané v novém rozhovoru dřív, než měl rozhovor id (chatRun ukládá až na konci) — vzor stranky.doplnChat
function doplnChat(app, ids, chatId) {
  for (const id of ids || []) {
    try {
      const rec = app.findRecordById("ai_images", id);
      if (!rec.getString("chat")) { rec.set("chat", chatId); app.save(rec); }
    } catch (err) { /* smazaný mezitím */ }
  }
}
// ---------- ilustrace ve Stránkách (fáze 4, 29. 10. 2026) ----------
// Writer stránky vloží na místo ilustrace značku <img data-kb-image="anglický popis" data-format="…" alt="popisek">;
// server ji tu nakreslí (klein, sekundy) a dosadí cestu k souboru bez adresy serveru (viz dosadIlustrace). Nejvýš MAX_ILUSTRACI na stránku;
// značka navíc nebo nepovedené kreslení = značka zmizí (žádný rozbitý obrázek). Text do ilustrací nepatří — nápisy
// má stránka v HTML. Kredity jako karta (řádek image_draw k rozhovoru stránky).
const MAX_ILUSTRACI = 3;
const ZNACKA_RE = /<img\b[^>]*\bdata-kb-image\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi;
const atribut = (tag, jm) => { const m = tag.match(new RegExp("\\b" + jm + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)')", "i")); return m ? (m[2] != null ? m[2] : m[3]) : ""; };
const escAttr = (s) => String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// ⚠️ test() na regexu s /g posouvá lastIndex a matchAll ho zdědí (první značka by se přeskočila) → vždy nová kopie
const bezTextu = (p) => (/no text/i.test(p) ? p : p + ", no text, no letters");
const znackyRe = () => new RegExp(ZNACKA_RE.source, "gi");
function maZnackyIlustraci(html) { return znackyRe().test(String(html || "")); }
// html → {html, pocet, chyb}. Obrázek dostane cestu BEZ adresy serveru (/api/files/ai_images/…): stránka se otevírá z aplikace,
// z /p/ odkazu i z jiného počítače — adresa, ze které se psala (zkušebka 127.0.0.1), by jinde nic nenačetla (Richard 4. 11. 2026)
function dosadIlustrace(app, auth, html, o) {
  const cfg = konfigurace(app);
  const s = String(html || "");
  const znacky = [...s.matchAll(znackyRe())].map((m) => m[0]);
  if (!znacky.length) return { html: s, pocet: 0, chyb: 0 };
  let out = s, pocet = 0, chyb = 0;
  for (let i = 0; i < znacky.length; i++) {
    const tag = znacky[i];
    let nahrada = "";
    const popis = atribut(tag, "data-kb-image").trim();
    // brzda za KAŽDÝ obrázek (kvóta kreditů vždy — i s vlastním modelem stránky kreslí naše služba obrázků; checkup 5. 11.);
    // odmítnutí = značka zmizí jako při výpadku, stránka se dopíše
    const odmitnuto = cfg && popis && i < MAX_ILUSTRACI && o && o.brzda ? !!o.brzda() : false;
    if (odmitnuto) chyb++;
    if (cfg && popis && i < MAX_ILUSTRACI && !odmitnuto) {
      let rec = null;
      try {
        rec = zaloz(app, auth.id, { prompt: bezTextu(popis), title: atribut(tag, "alt").slice(0, MAX_TITLE),
          preset: require(`${__hooks}/chat-obrazky.js`).FORMATY[atribut(tag, "data-format").toLowerCase()] || "siroky" }, { chat: o && o.chat });
        const r = nakresli(app, auth, rec, cfg, o && o.L, false);
        if (r.status === 200) {
          const d = r.body.obrazek, alt = atribut(tag, "alt"), trida = atribut(tag, "class"), styl = atribut(tag, "style");
          nahrada = `<img src="${escAttr(d.url)}" alt="${escAttr(alt)}" width="${d.width}" height="${d.height}" loading="lazy"`
            + (trida ? ` class="${escAttr(trida)}"` : "") + ` style="${escAttr(styl || "max-width:100%;height:auto;border-radius:12px")}">`;
          pocet++;
        } else chyb++;
      } catch (err) { chyb++; try { $app.logger().warn("obrazky: ilustrace stránky selhala", "error", String(err).slice(0, 200)); } catch (e2) { /* log je bonus */ } }
    }
    out = out.replace(tag, () => nahrada); // funkce: $' / $& v alt nebo style od modelu by se jinak rozvinuly
  }
  return { html: out, pocet: pocet, chyb: chyb };
}

// Cesty k NAŠIM obrázkům v HTML stránky → zakladna + /api/files/ai_images/… (zakladna "" = bez adresy serveru).
// Stránky psané do 4. 11. 2026 nesou adresu, ze které se psaly — přepíše se jen adresa obrázku, který na instanci existuje
// (cizí obrázek se stejnou cestou z jiného serveru zůstane, jak je).
const MAX_OVERENI_CEST = 50;
const CESTA_OBR_RE = /(\bsrc\s*=\s*["'])((?:https?:)?\/\/[^"'\/\s>]+)?(\/api\/files\/ai_images\/([a-z0-9]{15})\/)/gi;
function cestyObrazku(app, html, zakladna) {
  const s = String(html || "");
  if (s.indexOf("/api/files/ai_images/") < 0) return s;
  const z = String(zakladna || "").replace(/\/+$/, "");
  const nase = {};
  let dotazu = 0;
  return s.replace(CESTA_OBR_RE, (cele, pred, host, cesta, id) => {
    if (host) {
      if (!(id in nase) && ++dotazu > MAX_OVERENI_CEST) return cele; // veřejná /p/ stránka: nejvýš tolik dotazů do DB na požadavek
      if (!(id in nase)) { try { app.findRecordById("ai_images", id); nase[id] = true; } catch (err) { nase[id] = false; } }
      if (!nase[id]) return cele;
    }
    return pred + z + cesta;
  });
}

// Obrázky v Kanceláři (3. 11. 2026): prezentace (titulní snímek + až 3 obsahové) a přání / pozvánka / plakát (jeden).
// Dokument nese v meta.images [{slot, id}]: slot "" = titulní snímek prezentace / obrázek přání, jinak nadpis snímku.
// Soubor PDF/PPTX skládá prohlížeč — obrázek si stáhne z veřejné adresy souboru (jako logo organizace).
// Diplom obrázek nemá (rámeček a pečeť; fotka uživatele v rohu zůstává).
const MAX_OBRAZKU_DOKUMENTU = 4;
const BEZ_OBRAZKU = ["certificate"];
// preset podle místa v šabloně: pruh přání a panel snímku na výšku, pozvánka a plakát pás na šířku
function presetDokumentu(kind, template) {
  if (kind === "card") return template === "invitation" ? "banner" : template === "poster" ? "hlavicka" : "vysoky";
  return "vysoky";
}
function zalozProDokument(app, userId, o, opt) {
  const p = String(o.prompt || "").replace(/\u0000/g, "").trim();
  if (!p) throw chybaS(400, "err.imagePromptMissing"); // „, no text“ by z prázdného popisu udělalo neprázdný
  return zaloz(app, userId, { prompt: bezTextu(p), title: o.title, preset: presetDokumentu(o.kind, o.template) }, opt);
}
// meta.images → jen obrázky vlastníka dokumentu (cizí id z panelu nebo od modelu tiše vypadne)
function vlastniObrazky(app, userId, images) {
  return (images || []).filter((x) => !!najdi(app, userId, x.id));
}
// pro DTO dokumentu: stav a adresa každého obrázku (smazaný záznam vypadne)
function obrazkyDokumentu(app, userId, images) {
  const out = [];
  for (const x of images || []) {
    const rec = najdi(app, userId, x.id);
    if (rec) out.push({ ...dto(rec), slot: x.slot || "" });
  }
  return out;
}
// obrázky smazaného / nepovedeného dokumentu — jen ty, které NIKDE jinde nejsou (stejné id může panel dát i do jiného
// dokumentu nebo stránky) a které si uživatel nenechal natrvalo (checkup 5. 11.). Volat AŽ po smazání dokumentu.
function smazObrazky(app, userId, ids) {
  for (const id of ids || []) { const rec = najdi(app, userId, id); if (rec) smazNepouzite(app, rec); }
}

// Hybrid: lehký model tah předal hlavnímu → jeho zadané obrázky smazat (karta zahozeného tahu se nezobrazí)
function vratitTah(app, zmeny) {
  for (const z of zmeny || []) {
    try { if (z.novy) app.delete(app.findRecordById("ai_images", z.id)); } catch (err) { /* nic k vrácení */ }
  }
}

// ---------- záložka Obrázky a úklid (4. 11. 2026, rozhodnutí Richarda) ----------
// Použitý obrázek = v meta.images dokumentu nebo v HTML stránky (i v předchozí verzi — „Vrátit“ ho potřebuje);
// ten se nesmaže, dokud dokument / stránka existuje. Nepoužitý (jen z chatu nebo API) se smaže po 90 dnech,
// pokud ho uživatel nenechal natrvalo; banner ranního sumáře (příznak banner, jen server) po 30 dnech (starý mail pak
// ukáže prázdné místo); smazaný rozhovor = jeho nepoužité obrázky hned.
const DNI_NEPOUZITY = 90;
const DNI_BANNER = 30;
const MAX_SEZNAM = 60;
const casPred = (dni) => new Date(Date.now() - dni * 86400000).toISOString().replace("T", " ");
// → pole míst, nebo null = NEVÍM (dotaz selhal) — mazání pak obrázek bere jako použitý (raději nechat než smazat ze stránky)
function pouziti(app, rec) {
  const out = [], p = { u: rec.getString("user"), id: rec.id };
  try {
    for (const d of app.findRecordsByFilter("ai_documents", "user = {:u} && (meta ~ {:id} || predchozi ~ {:id})", "-updated", 20, 0, p)) out.push({ druh: "dokument", id: d.id, title: d.getString("title") });
    for (const s of app.findRecordsByFilter("ai_pages", "user = {:u} && (html ~ {:id} || predchozi_html ~ {:id})", "-updated", 20, 0, p)) out.push({ druh: "stranka", id: s.id, title: s.getString("title") });
  } catch (err) {
    try { $app.logger().warn("obrazky: nevím, kde se obrázek používá", "id", rec.id, "error", String(err).slice(0, 200)); } catch (e2) { /* log je bonus */ }
    return null;
  }
  return out;
}
// Totéž pro celou stránku záložky naráz (checkup 5. 11.: 2 dotazy LIKE přes celé HTML stránek ZA KAŽDÝ obrázek = až 120
// průchodů textem na jedno otevření). Jeden SQL dotaz na kolekci vrátí jen dvojice (místo, obrázek) — HTML stránek ani
// dokumentů se do paměti nenačítá (checkup 5. 11. večer: načtení všech stránek = desítky MB na otevření záložky).
// → {id: [místa]}, nebo null (chyba) → volající se vrátí k pouziti() po jednom.
const ZDROJE_POUZITI = [["ai_documents", "dokument", "meta", "predchozi"], ["ai_pages", "stranka", "html", "predchozi_html"]];
function pouzitiVsech(app, userId, ids) {
  if (!ids.length) return {};
  try {
    const out = {};
    for (const id of ids) out[id] = [];
    for (const [kolekce, druh, a, b] of ZDROJE_POUZITI) {
      const rows = arrayOf(new DynamicModel({ id: "", title: "", img: "" }));
      app.db().newQuery(`SELECT t.id AS id, t.title AS title, j.value AS img FROM ${kolekce} t, json_each({:ids}) j`
        + ` WHERE t.user = {:u} AND (instr(t.${a}, j.value) > 0 OR instr(t.${b}, j.value) > 0) ORDER BY t.updated DESC LIMIT 20000`)
        .bind({ u: userId, ids: JSON.stringify(ids) }).all(rows);
      for (const r of rows) if (out[r.img] && out[r.img].length < 20) out[r.img].push({ druh: druh, id: r.id, title: r.title });
    }
    return out;
  } catch (err) {
    try { $app.logger().warn("obrazky: použití pro seznam selhalo", "error", String(err).slice(0, 200)); } catch (e2) { /* log je bonus */ }
    return null;
  }
}
// den, kdy úklid obrázek smaže ("" = nesmaže: natrvalo nebo použitý)
function smazeSe(rec, pouz) {
  if (rec.getBool("trvale") || !pouz || pouz.length) return "";
  const c = new Date(rec.getString("created").replace(" ", "T"));
  // obrázek starší než 90 dní, který právě přestal být použitý, smaže až příští noční úklid — ne „v minulosti“
  return isNaN(c.getTime()) ? "" : new Date(Math.max(c.getTime() + DNI_NEPOUZITY * 86400000, Date.now())).toISOString();
}
function dtoSprava(app, rec, pouzHotove) {
  const pouz = pouzHotove !== undefined ? pouzHotove : pouziti(app, rec);
  return { ...dto(rec), pouziti: pouz || [], smaze_se: smazeSe(rec, pouz) };
}
// seznam pro záložku Obrázky: jen HOTOVÉ (nenakreslený / nepovedený patří kartě, která ho kreslí — v záložce by se
// točil donekonečna) a bez bannerů sumáře (ty patří instanci, ne uživateli); q = název nebo popis
function seznam(app, userId, o) {
  const q = String((o && o.q) || "").trim().slice(0, 100);
  const strana = Math.max(0, Math.min(100, parseInt((o && o.strana) || 0, 10) || 0));
  let filtr = "user = {:u} && stav = 'hotovo' && banner = false";
  if (q) filtr += " && (title ~ {:q} || prompt ~ {:q})";
  let rows = [];
  try { rows = app.findRecordsByFilter("ai_images", filtr, "-created", MAX_SEZNAM + 1, strana * MAX_SEZNAM, { u: userId, q: q }); } catch (err) { rows = []; }
  const strana0 = rows.slice(0, MAX_SEZNAM);
  const vse = pouzitiVsech(app, userId, strana0.map((r) => r.id));
  return { obrazky: strana0.map((r) => dtoSprava(app, r, vse ? vse[r.id] : undefined)), dalsi: rows.length > MAX_SEZNAM };
}
function ponechat(app, userId, id, trvale) {
  const rec = najdi(app, userId, id);
  if (!rec) throw chybaS(404, "err.imageNotFound");
  rec.set("trvale", !!trvale);
  app.save(rec);
  return rec;
}
// smazat ze záložky: použitý obrázek NE (stránka / dokument by ztratily obrázek) — nejdřív ho odebrat tam
function smazat(app, userId, id) {
  const rec = najdi(app, userId, id);
  if (!rec) throw chybaS(404, "err.imageNotFound");
  const pouz = pouziti(app, rec);
  if (!pouz) throw chybaS(503, "err.imageUnavailable");
  if (pouz.length) throw chybaS(409, "err.imageInUse", { kde: pouz.map((x) => x.title || "?").join(", ") });
  app.delete(rec);
}
function smazNepouzite(app, rec) {
  const pouz = pouziti(app, rec);
  if (rec.getBool("trvale") || !pouz || pouz.length) return false;
  try { app.delete(rec); return true; } catch (err) {
    try { app.logger().warn("obrazky: úklid obrázku selhal", "id", rec.id, "error", String(err).slice(0, 200)); } catch (e2) { /* log je bonus */ }
    return false;
  }
}
// smazaný rozhovor (hook ai_chats) → jeho nepoužité obrázky
function poSmazaniChatu(app, chatId) {
  if (!chatId) return;
  let rows = [];
  try { rows = app.findRecordsByFilter("ai_images", "chat = {:c}", "", 500, 0, { c: chatId }); } catch (err) { rows = []; }
  for (const rec of rows) smazNepouzite(app, rec);
}
// noční úklid (cron prune_ai_images) → počet smazaných. Použité zůstávají kandidáty, proto se jimi prochází
// stránkovaně (offset jen o ponechané), nejvýš 5 000 za noc — jinak by staré použité zablokovaly mazání nových.
function uklid(app) {
  let smazano = 0;
  let bannery = [];
  try { bannery = app.findRecordsByFilter("ai_images", "banner = true && created < {:h}", "created", 500, 0, { h: casPred(DNI_BANNER) }); } catch (err) { bannery = []; }
  for (const rec of bannery) { try { app.delete(rec); smazano++; } catch (err) { /* příště */ } }
  let off = 0, prohledano = 0;
  while (prohledano < 5000) {
    let rows = [];
    try { rows = app.findRecordsByFilter("ai_images", "trvale = false && banner = false && created < {:h}", "created", 200, off, { h: casPred(DNI_NEPOUZITY) }); } catch (err) { rows = []; }
    if (!rows.length) break;
    for (const rec of rows) { prohledano++; if (smazNepouzite(app, rec)) smazano++; else off++; }
    if (rows.length < 200) break;
  }
  return smazano;
}

module.exports = { tydenBrzda, stavTydne, zdarma, poRestartu, novy, PRESETY_NOVY, STYLY, vycistiPopis, cestyObrazku, DNI_NEPOUZITY, DNI_BANNER, pouziti, dtoSprava, seznam, ponechat, smazat, poSmazaniChatu, uklid, MAX_OBRAZKU_DOKUMENTU, BEZ_OBRAZKU, presetDokumentu, zalozProDokument, vlastniObrazky, obrazkyDokumentu, smazObrazky, PRESETY, MAX_ILUSTRACI, doplnChat, vratitTah, dosadIlustrace, maZnackyIlustraci, nakresli, MAX_PROMPT, konfigurace, dostupne, najdi, dto, zaloz, vytvorit, chybaS };
