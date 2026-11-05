// Kancelář v asistentovi (Richard 14. 10. 2026: „více kancelářských věcí — ať nabídne udělat prezentaci nebo PDF přání“).
// Skupina `kancelar` (klíčová slova / open_tools / režim kancelar): draft_presentation · draft_card.
//  · Oba nástroje jsou `direct` jako draft_text: výsledek je SOUKROMÝ dokument v Dokumentech (druh presentation / card),
//    uživatel ho v panelu upraví a soubor si stáhne znovu — žádná karta k potvrzení, nic se neposílá ven.
//  · Soubory (PPTX, PDF, Word) vyrábí PROHLÍŽEČ z textu + meta (frontend/src/lib/kancelar/); server žádný soubor nedrží.
//  · Osnova prezentace = text: `# Titul`, `## Nadpis snímku`, `- odrážka`, `> poznámka řečníka`. Stropy MAX_SNIMKU /
//    MAX_ODRAZEK — překročení je chyba PRO MODEL (ať zkrátí), ne tiché oříznutí.
//  · Průvodce z AI bloku (režim `kancelar`): první krok skládá APLIKACE (formulář: co, pro koho, tón) — hned, vykání,
//    0 kreditů ([[feedback-vzdy-klikat-asistent]]); odpověď se modelu spáruje jako ask_user.
// ⚠️ PocketBase JSVM: require() uvnitř funkcí.
const HOOKS = typeof __hooks !== "undefined" ? __hooks : __dirname;
const SPOL = () => require(`${HOOKS}/chat-spolecne.js`);
const DOK = () => require(`${HOOKS}/dokumenty.js`);

const MAX_SNIMKU = 20;
const MAX_ODRAZEK = 8;
const SABLONY = ["greeting", "invitation", "poster", "certificate"];

const NASTROJE = [
  { name: "draft_presentation", skupina: "kancelar", kind: "direct", description: "Create a slide deck (presentation) for the user — a project status for a client or the boss, a pitch, a meeting deck. Write the OUTLINE into `text` in this exact plain format: first line `# Deck title`, then for each slide a line `## Slide heading` followed by 3–6 lines `- bullet` (short, max ~12 words each) and optionally `> speaker notes` (one line per note). Max 20 slides, max 8 bullets per slide; no other markup. Take facts (steps, deadlines, owners, what is done) from get_map — never invent numbers or dates. The outline is SAVED to the user's Documents (editable text) and the card offers PPTX and PDF download; in your reply add only a one-line comment and offer via suggest_next to adjust a slide or add speaker notes. When the deck belongs to a project pass `map` = exact map title.",
    parameters: { type: "object", properties: {
      title: { type: "string", description: "deck title (also the title slide)" },
      subtitle: { type: "string", description: "title-slide subtitle: audience, occasion or date (optional)" },
      text: { type: "string", description: "the outline in the `# / ## / - / >` format" },
      audience: { type: "string", description: "who the deck is for (client, team, management) — optional" },
      map: { type: "string", description: "exact map title the deck belongs to (optional)" },
      picture: { type: "string", description: "ENGLISH visual description of a picture for the title slide (subject, setting, style, colours; no text) — optional" },
      slide_pictures: { type: "array", maxItems: 3, description: "pictures for up to 3 content slides (optional)", items: { type: "object", properties: {
        slide: { type: "string", description: "exact slide heading from the outline" },
        prompt: { type: "string", description: "ENGLISH visual description of the picture (no text)" },
      }, required: ["slide", "prompt"], additionalProperties: false } },
    }, required: ["title", "text"], additionalProperties: false },
    obrazkovaPole: ["picture", "slide_pictures"],
    popisObrazku: " PICTURES: this instance can draw pictures — by default pass `picture` for the title slide (an English visual description fitting the topic and audience, e.g. a calm flat illustration; never text in the picture) and, when it helps, `slide_pictures` for at most 3 content slides; leave them out only when the user wants no pictures. The app draws them on the chat card right after your turn and puts them into the PowerPoint and PDF." },
  { name: "draft_card", skupina: "kancelar", kind: "direct", description: "Create a printable PDF card for the user: a greeting card (greeting — Christmas / New Year 'PF', birthday, anniversary, thank-you to clients), an invitation (invitation — company party, open day, training; pass `date` and `place`, optionally `link` for a QR code), a poster (poster — A4 notice or announcement) or a certificate (certificate — diploma, award, or a formal acknowledgement / thank-you to be handed over or framed, e.g. for years of cooperation; a short seasonal or birthday wish is greeting). `title` = the big headline (short), `text` = the body: a few short sentences or lines (plain text, no markup), `signature` = who signs (company or person). Keep it warm and concrete, in the user's language; never invent dates, prices or names — ask with ask_user when missing. The card is SAVED to the user's Documents (editable text; the user picks a colour and can add a photo in the panel) and the chat card offers PDF download; in your reply add only a one-line comment.",
    parameters: { type: "object", properties: {
      kind: { type: "string", enum: SABLONY },
      title: { type: "string", description: "headline printed large" },
      text: { type: "string", description: "body text, a few short lines" },
      date: { type: "string", description: "invitation: when, as the user said it (e.g. '12. 12. 2026 v 18:00') — optional" },
      place: { type: "string", description: "invitation: where — optional" },
      link: { type: "string", description: "http(s) URL for a QR code (registration, map, website), max 300 characters — optional; printed only on invitation and poster" },
      signature: { type: "string", description: "who signs the card — optional" },
      map: { type: "string", description: "exact map title the card belongs to (optional)" },
      picture: { type: "string", description: "ENGLISH visual description of the picture on the card (greeting, invitation, poster; not certificate) — optional" },
    }, required: ["kind", "title", "text"], additionalProperties: false },
    obrazkovaPole: ["picture"],
    popisObrazku: " PICTURES: this instance can draw pictures — for greeting, invitation and poster pass `picture` by default (an English visual description of a fitting illustration for the occasion, style and colours; never text in the picture); a certificate has no picture. Leave it out only when the user wants no picture. The app draws it on the chat card right after your turn and puts it into the PDF (a photo the user adds in Documents takes its place)." },
];

// Osnova: řádky → { titul, snimky: [{ nadpis, odrazky, poznamky }] }; chyby anglicky pro model. Jen tolik, kolik
// server potřebuje k ověření (frontend má vlastní parser pro vykreslení — lib/kancelar/osnova.js, STEJNÁ pravidla:
// řádky před prvním `##` = podtitul, `-`/`•`/`*` odrážka, `>` poznámka, jiný řádek ve snímku = odrážka).
function overOsnovu(text) {
  const radky = String(text || "").replace(/\r/g, "").split("\n");
  let titul = ""; const snimky = []; let akt = null;
  for (const raw of radky) {
    const r = raw.trim();
    if (!r) continue;
    const h1 = r.match(/^#\s+(.+)$/); const h2 = r.match(/^#{2,3}\s+(.+)$/);
    if (h1 && !akt && !titul) { titul = h1[1].trim(); continue; }
    if (h2 || h1) { akt = { nadpis: (h2 || h1)[1].trim(), odrazky: [], poznamky: [] }; snimky.push(akt); continue; }
    if (!akt) continue; // řádky před prvním snímkem = podtitul (frontend parsujOsnovu je tak čte) — ne chyba
    const b = r.match(/^[-•*]\s+(.+)$/); const n = r.match(/^>\s*(.+)$/);
    if (n) akt.poznamky.push(n[1].trim());
    else akt.odrazky.push((b ? b[1] : r).trim());
  }
  if (!snimky.length) return { chyba: 'Error: no slides found — write each slide as a line "## Slide heading" followed by "- bullet" lines (and optional "> speaker note").' };
  if (snimky.length > MAX_SNIMKU) return { chyba: `Error: ${snimky.length} slides is too many — keep at most ${MAX_SNIMKU} (merge or drop slides) and call again.` };
  const dlouhy = snimky.find((s) => s.odrazky.length > MAX_ODRAZEK);
  if (dlouhy) return { chyba: `Error: slide "${dlouhy.nadpis}" has ${dlouhy.odrazky.length} bullets — keep at most ${MAX_ODRAZEK} per slide (split it) and call again.` };
  return { titul, snimky };
}

// Dvojník v témž tahu (druh + název): model osnovu předělal → přepsat první dokument, ne založit druhý (jako draft_text)
function ulozDokument(app, auth, ktx, data) {
  const D = DOK();
  const klic = D.norm(data.kind + "|" + data.title + "|");
  const dvojnik = ktx && ktx.dok && data.title ? ktx.dok.find((z) => z.novy && z.klic === klic) : null;
  try {
    if (dvojnik) return { doc: D.uloz(app, auth.id, data, { id: dvojnik.id, predchozi: "smazat", mapa: true }), nahrazuje: true };
    const doc = D.uloz(app, auth.id, data, { chat: ktx && ktx.chatId });
    if (ktx && ktx.dok) ktx.dok.push({ id: doc.id, novy: true, klic: klic });
    return { doc: doc, nahrazuje: false };
  } catch (err) {
    const duvod = err && err.klic === "err.docLimit" ? `the document limit (${D.MAX_DOKUMENTU}) is full — tell the user to delete old documents` : "saving failed — tell the user to copy the text";
    if (!err || !err.klic) { try { app.logger().warn("chat: kancelář se neuložila", "user", auth.id, "error", String(err && err.message ? err.message : err)); } catch (e2) { /* log je bonus */ } }
    return { doc: null, duvod: duvod };
  }
}
// Zadané obrázky (stav „ceka“) pro dokument; nakreslí je karta v chatu hned po tahu. Bez služby obrázků nebo s chybným
// popisem se dokument uloží bez nich — obrázky jsou bonus, prezentace i přání fungují i bez nich.
function zadejObrazky(app, auth, ktx, kind, template, prani) {
  const O = require(`${HOOKS}/obrazky.js`);
  if (!prani.length || !O.dostupne(app) || O.BEZ_OBRAZKU.includes(template)) return [];
  const out = [];
  for (const p of prani.slice(0, O.MAX_OBRAZKU_DOKUMENTU)) {
    if (out.some((x) => x.slot === p.slot)) continue;
    try {
      const rec = O.zalozProDokument(app, auth.id, { prompt: p.prompt, title: p.title, kind: kind, template: template }, { chat: ktx && ktx.chatId });
      out.push({ slot: p.slot, id: rec.id });
      if (ktx && ktx.dok) ktx.dok.push({ id: rec.id, novy: true, obrazek: true }); // id rozhovoru doplní chatRun; hybrid: předaný tah je smaže
    } catch (err) { /* prázdný či dlouhý popis → bez toho obrázku */ }
  }
  return out;
}
function obrazkyZArgumentu(a, titul, nadpisy) {
  const prani = [];
  const pic = String(a.picture || "").trim();
  if (pic) prani.push({ slot: "", prompt: pic, title: titul });
  for (const s of Array.isArray(a.slide_pictures) ? a.slide_pictures.slice(0, 3) : []) {
    const slot = DOK().radek(s && s.slide, 200), prompt = String((s && s.prompt) || "").trim();
    const nadpis = nadpisy && nadpisy.find((n) => DOK().norm(n) === DOK().norm(slot));
    if (nadpis && prompt) prani.push({ slot: nadpis, prompt: prompt, title: nadpis });
  }
  return prani;
}

function mapaZArgumentu(app, auth, ref) {
  if (!ref) return { mid: "" };
  const mid = SPOL().mapaId(app, auth, ref);
  return mid ? { mid: mid } : { chyba: `Error: map "${String(ref)}" not found (use list_maps; pass the exact title).` };
}

function vykonej(app, auth, L, name, args, ktx) {
  const a = args || {};
  const S = SPOL();
  switch (name) {
    case "draft_presentation": {
      const text = S.ocisti(a.text, DOK().MAX_TEXT);
      if (!text) return { text: "Error: text (the outline) is required." };
      if (DOK().jeZastupny(text)) return { text: "Error: `text` must be the whole outline, not a placeholder. Write it out completely and call draft_presentation once." };
      const os = overOsnovu(text);
      if (os.chyba) return { text: os.chyba };
      const title = DOK().radek(a.title, 200) || os.titul;
      if (!title) return { text: "Error: title is required (pass `title` or start the outline with `# Deck title`)." };
      const m = mapaZArgumentu(app, auth, a.map);
      if (m.chyba) return { text: m.chyba };
      const meta = { subtitle: S.ocisti(a.subtitle, 200), audience: S.ocisti(a.audience, 120), lang: L };
      const obr = zadejObrazky(app, auth, ktx, "presentation", "", obrazkyZArgumentu(a, title, os.snimky.map((s) => s.nadpis)));
      if (obr.length) meta.images = obr;
      const u = ulozDokument(app, auth, ktx, { kind: "presentation", title: title, text: text, map: m.mid, meta: meta });
      if (!u.doc) require(`${HOOKS}/obrazky.js`).smazObrazky(app, auth.id, obr.map((x) => x.id));
      const n = os.snimky.length;
      const kde = u.doc ? `saved to the user's Documents (kind presentation, ${n} slide${n === 1 ? "" : "s"}) and the card below offers PPTX and PDF download` : `shown on a card only (NOT saved: ${u.duvod})`;
      const sObr = u.doc && obr.length ? ` ${obr.length} picture${obr.length === 1 ? " is" : "s are"} being drawn on the card (seconds).` : "";
      return { text: `The deck outline is ${kde}${m.mid ? ", linked to the project" : ""}.${sObr} Now write a one-line comment (no repetition of the outline) and offer via suggest_next to adjust a slide or add speaker notes.`,
        karta: { type: "soubor", druh: "presentation", title: u.doc ? u.doc.getString("title") : title, doc_id: u.doc ? u.doc.id : "", pocet: n, formaty: ["pptx", "pdf"], map_id: m.mid, ...(u.doc && obr.length ? { obrazky: obr.map((x) => x.id) } : {}), ...(u.nahrazuje ? { nahrazuje: true } : {}) } };
    }
    case "draft_card": {
      const kind = SABLONY.includes(a.kind) ? a.kind : "";
      if (!kind) return { text: `Error: kind must be one of ${SABLONY.join(", ")}.` };
      const title = DOK().radek(a.title, 200);
      const text = S.ocisti(a.text, DOK().MAX_TEXT);
      if (!title || !text) return { text: "Error: title and text are required." };
      if (DOK().jeZastupny(text)) return { text: "Error: `text` must be the final wording, not a placeholder." };
      if (a.link && !/^https?:\/\/\S+$/i.test(String(a.link).trim())) return { text: "Error: link must be a full http(s) URL (or omit it)." };
      if (a.link && String(a.link).trim().length > 300) return { text: "Error: link is too long (max 300 characters) — shorten it or omit it." }; // tiché oříznutí = QR na jiný cíl (/checkup 2. 11. 2026)
      const m = mapaZArgumentu(app, auth, a.map);
      if (m.chyba) return { text: m.chyba };
      const meta = { template: kind, date: S.ocisti(a.date, 60), place: S.ocisti(a.place, 200), link: S.ocisti(a.link, 300), signature: S.ocisti(a.signature, 120), lang: L };
      const obr = zadejObrazky(app, auth, ktx, "card", kind, obrazkyZArgumentu(a, title, null));
      if (obr.length) meta.images = obr;
      const u = ulozDokument(app, auth, ktx, { kind: "card", title: title, text: text, map: m.mid, meta: meta });
      if (!u.doc) require(`${HOOKS}/obrazky.js`).smazObrazky(app, auth.id, obr.map((x) => x.id));
      const kde = u.doc ? `saved to the user's Documents (kind card, template ${kind}) and the card below offers PDF download; the user can change colour, add a photo or edit the wording in the Documents panel` : `shown on a card only (NOT saved: ${u.duvod})`;
      const sObr = u.doc && obr.length ? " The picture is being drawn on the card (seconds)." : "";
      return { text: `The ${kind} is ${kde}.${sObr} Now write a one-line comment (do not repeat the wording).`,
        karta: { type: "soubor", druh: "card", template: kind, title: u.doc ? u.doc.getString("title") : title, doc_id: u.doc ? u.doc.id : "", formaty: ["pdf"], map_id: m.mid, ...(u.doc && obr.length ? { obrazky: obr.map((x) => x.id) } : {}), ...(u.nahrazuje ? { nahrazuje: true } : {}) } };
    }
    default: return { text: "Error: unknown tool " + name };
  }
}
function overZapis() { return null; }
function popisAkce() { return ""; }

// Průvodce z AI bloku (režim kancelar): formulář skládá aplikace — co připravit, pro koho / k čemu, tón.
const FORMULAR = {
  cs: { text: "Připravím prezentaci, přání, pozvánku, plakát nebo diplom — soubor si pak stáhnete (PowerPoint, PDF nebo Word) a text můžete kdykoli upravit v Dokumentech. Vyberte, co to má být, a napište, pro koho a k jaké příležitosti; na zbytek se doptám.",
    otazky: [
      { text: "Co mám připravit?", options: ["Prezentaci projektu", "Přání (PF, narozeniny, poděkování)", "Pozvánku na akci", "Plakát", "Diplom nebo poděkování"] },
      { text: "Pro koho a k jaké příležitosti? (klient, tým, akce, datum…)", options: [] },
      { text: "Jaký tón?", options: ["Přátelský", "Formální", "Slavnostní"] },
    ] },
  en: { text: "I will prepare a presentation, a greeting card, an invitation, a poster or a certificate — you then download the file (PowerPoint, PDF or Word) and can edit the text any time in Documents. Pick what it should be and tell me who it is for and the occasion; I will ask about the rest.",
    otazky: [
      { text: "What should I prepare?", options: ["A project presentation", "A greeting card (season's greetings, birthday, thank-you)", "An invitation to an event", "A poster", "A certificate or acknowledgement"] },
      { text: "Who is it for and what is the occasion? (client, team, event, date…)", options: [] },
      { text: "Which tone?", options: ["Friendly", "Formal", "Festive"] },
    ] },
};
function formularKancelare(L) {
  const F = FORMULAR[L === "en" ? "en" : "cs"];
  const questions = F.otazky.map((q) => ({ text: q.text, options: q.options.slice() }));
  const id = "formular_" + $security.randomString(10);
  return { role: "assistant", content: F.text, ts: new Date().toISOString(),
    karty: [{ type: "otazky", toolCallId: id, questions: questions }], toolCalls: [{ id: id, name: "ask_user", args: { questions: questions } }], tier: "heavy", uvod: true };
}

module.exports = { NASTROJE, vykonej, overZapis, popisAkce, overOsnovu, formularKancelare, MAX_SNIMKU, MAX_ODRAZEK, SABLONY };
