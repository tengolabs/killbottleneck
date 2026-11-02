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
    }, required: ["title", "text"], additionalProperties: false } },
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
    }, required: ["kind", "title", "text"], additionalProperties: false } },
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
      const u = ulozDokument(app, auth, ktx, { kind: "presentation", title: title, text: text, map: m.mid, meta: meta });
      const n = os.snimky.length;
      const kde = u.doc ? `saved to the user's Documents (kind presentation, ${n} slide${n === 1 ? "" : "s"}) and the card below offers PPTX and PDF download` : `shown on a card only (NOT saved: ${u.duvod})`;
      return { text: `The deck outline is ${kde}${m.mid ? ", linked to the project" : ""}. Now write a one-line comment (no repetition of the outline) and offer via suggest_next to adjust a slide or add speaker notes.`,
        karta: { type: "soubor", druh: "presentation", title: u.doc ? u.doc.getString("title") : title, doc_id: u.doc ? u.doc.id : "", pocet: n, formaty: ["pptx", "pdf"], map_id: m.mid, ...(u.nahrazuje ? { nahrazuje: true } : {}) } };
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
      const u = ulozDokument(app, auth, ktx, { kind: "card", title: title, text: text, map: m.mid, meta: meta });
      const kde = u.doc ? `saved to the user's Documents (kind card, template ${kind}) and the card below offers PDF download; the user can change colour, add a photo or edit the wording in the Documents panel` : `shown on a card only (NOT saved: ${u.duvod})`;
      return { text: `The ${kind} is ${kde}. Now write a one-line comment (do not repeat the wording).`,
        karta: { type: "soubor", druh: "card", template: kind, title: u.doc ? u.doc.getString("title") : title, doc_id: u.doc ? u.doc.id : "", formaty: ["pdf"], map_id: m.mid, ...(u.nahrazuje ? { nahrazuje: true } : {}) } };
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
