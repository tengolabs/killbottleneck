// Obrázky přes asistenta (29. 10. 2026): generate_image jen ZADÁ obrázek (stav „ceka“), karta `obrazek`
// v prohlížeči ho hned po tahu nakreslí (/chat/obrazek/vytvorit, sekundy) — vzor create_page (chat-stranky.js).
// Model píše anglický popis; FLUX 3 (text v obrázku) jen s vyplněným `text` a zapnutým KB_IMAGE_TEXT.
// Skupina `kresleni` jen když o ni rozhovor stojí. ⚠️ PocketBase JSVM: require() uvnitř funkcí.
const HOOKS = typeof __hooks !== "undefined" ? __hooks : __dirname;
const O = () => require(`${HOOKS}/obrazky.js`);
const MAX_ZA_TAH = 4; // víc obrázků v jednom tahu = spíš smyčka modelu než přání uživatele

const FORMATY = { square: "ctverec", banner: "banner", header: "hlavicka", portrait: "vysoky", landscape: "siroky" };

const NASTROJE = [
  { name: "generate_image", skupina: "kresleni", kind: "direct", jenKdy: "images", description: "Draw a standalone picture for the user (illustration, header image, banner for an e-mail or page, wallpaper). NOT for a greeting card, invitation, poster or presentation file — draft_card / draft_presentation draw their own picture. Write `prompt` in ENGLISH as a detailed visual description (subject, setting, style, colors, composition, mood); the image model sees nothing else. By default the picture has NO text — add \"no text\" to the prompt. Only when the user wants readable words in the picture (a headline, sign, greeting) put that exact short text (max ~40 characters, in the user's language) into `text`; text pictures may get a letter wrong — the user can redraw with the button on the card. The app draws the picture right after your turn (a few seconds) and shows it on a card with Download and Redraw. In your reply add only one short sentence; do not describe the picture again.",
    parameters: { type: "object", properties: {
      prompt: { type: "string", description: "detailed visual description in English (max ~2500 chars)" },
      title: { type: "string", description: "short caption for the card in the user's language (2–6 words)" },
      format: { type: "string", enum: Object.keys(FORMATY), description: "square 1024×1024 (default), banner 1200×400 (e-mail header), header 1536×640 (page header), portrait 512×896, landscape 1792×1024" },
      text: { type: "string", description: "exact text that must be readable in the picture (optional; leave out for pictures without text)" },
    }, required: ["prompt", "title"], additionalProperties: false } },
];

function vykonej(app, auth, L, name, args, ktx) {
  const a = args || {};
  if (name !== "generate_image") return { text: "Error: unknown tool " + name };
  if (ktx) { ktx.obrazku = (ktx.obrazku || 0) + 1; if (ktx.obrazku > MAX_ZA_TAH) return { text: `Error: at most ${MAX_ZA_TAH} pictures per message — tell the user to ask for more in the next message.` }; }
  let rec;
  try {
    rec = O().zaloz(app, auth.id, { prompt: a.prompt, title: a.title, text: a.text, preset: FORMATY[String(a.format || "")] || "ctverec" }, { chat: ktx && ktx.chatId });
  } catch (err) {
    if (err && err.klic === "err.imageTextOff") return { text: "Error: pictures with readable text are not available on this instance — offer the same picture without text (leave `text` out)." };
    if (err && err.klic === "err.imagesOff") return { text: "Error: pictures are not available on this instance." };
    if (err && err.klic === "err.imagePromptMissing") return { text: "Error: prompt is required (an English visual description)." };
    if (err && err.klic === "err.imagePromptLong") return { text: `Error: the prompt is too long (max ${O().MAX_PROMPT} characters) — shorten it.` };
    throw err;
  }
  if (ktx && ktx.dok) ktx.dok.push({ id: rec.id, novy: true, obrazek: true }); // id rozhovoru doplní chatRun; hybrid: předaný tah ho smaže
  return { text: `Picture "${rec.getString("title")}" is queued; the app draws it now (seconds) and shows it on a card with Download and Redraw. Reply with ONE short sentence — do not call generate_image again for the same picture.`,
    karta: { type: "obrazek", image_id: rec.id, title: rec.getString("title"), model: rec.getString("model"), preset: rec.getString("preset") } };
}

module.exports = { NASTROJE, vykonej, FORMATY };
