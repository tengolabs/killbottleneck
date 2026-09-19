import { useCallback, useEffect, useRef, useState } from 'react';
import { chat as chatApi, chatPotvrdit, chatDetail, chatSeznam, chatSmazat } from '@/api/asistentApi';
import { nactiKlic, ulozKlic, smazKlic } from '@/lib/storageKeys';
import { setSkin, setTheme } from '@/lib/theme';
import { getBuiltinSkin } from '@/lib/skins';

// Logika rozhovoru chatu na boku — v líném chunku panelu (ne v hlavním balíku).
// Aktivní rozhovor (kb-chat-id) a model (kb-chat-model) přežívají v localStorage,
// zprávy jsou na serveru (ai_chats), takže přemontování panelu (přepnutí
// jazyka) nic neztratí kromě rozepsaného textu.
const KEY_CHAT = 'kb-chat-id';
const KEY_MODEL = 'kb-chat-model';

// Karty z odpovědi, které se projeví v prohlížeči: skin a světlý/tmavý režim.
// Server už skin_id uložil; tady se jen aplikuje (SkinDialog dělá totéž).
// Karta skinu visí na TÉ zprávě asistenta, která nástroj zavolala — v jednom
// kole jich může být víc (nástroj → dopověď), proto se projde celý poslední tah.
function projevKarty(dto, patchUser) {
  const msgs = (dto && dto.messages) || [];
  const odUser = msgs.map((m) => m.role).lastIndexOf('user');
  const karty = msgs.slice(odUser + 1).filter((m) => m.role === 'assistant').flatMap((m) => m.karty || []);
  for (const k of karty) {
    if (k.type === 'skin') {
      const s = getBuiltinSkin(k.skin_id);
      if (s) { setSkin(s); if (patchUser) patchUser({ skin_id: k.skin_id }); }
    } else if (k.type === 'theme') {
      setTheme(k.theme === 'dark' ? 'dark' : 'light');
    }
  }
}
// Potvrzená akce změnila mapu → otevřený editor si ji slije hned
// (useMapAutosave poslouchá kb-map-changed), ne až za 45 s hlídání na pozadí.
function ohlasZmenuMapy(dto) {
  const msgs = (dto && dto.messages) || [];
  const odUser = msgs.map((m) => m.role).lastIndexOf('user');
  const karty = msgs.slice(odUser + 1).flatMap((m) => m.karty || []);
  const zmenene = karty.filter((k) => (k.type === 'akce' && k.stav === 'hotovo') || k.type === 'vysledek');
  // Zásobník nápadů: add_idea (karta napad) přidá položku, potvrzené add_idea_to_map /
  // create_project_from_ideas (karta vysledek) ji z něj odeberou → panel zásobníku
  // (useBufferNodes) se má načíst znovu. Dřív ukazoval starý seznam až do reloadu,
  // takže „Uloženo do zásobníku“ vypadalo jako lež (13. 9. 2026).
  const zasobnik = karty.some((k) => k.type === 'napad') || zmenene.length > 0;
  if (zasobnik) { try { window.dispatchEvent(new CustomEvent('kb-buffer-changed')); } catch { /* SSR/test */ } }
  if (!zmenene.length) return;
  try { window.dispatchEvent(new CustomEvent('kb-map-changed', { detail: { mapIds: zmenene.map((k) => (k.odkaz && k.odkaz.map_id) || k.map_id).filter(Boolean) } })); } catch { /* SSR/test */ }
}
const prevedChybu = (e) => {
  if (e && e.isTimeout) return 'timeout';
  // vyčerpaná týdenní kvóta kreditů organizace: server říká komu a kolik → ukázat jeho text
  if (e && e.status === 429 && e.response && e.response.code === 'ai_kvota' && e.response.error) return e.response.error;
  if (e && e.status === 429) return 'rate';
  return (e && e.response && (e.response.error || e.response.message)) || 'generic';
};

export function useAsistentChat({ open }) {
  const [chatId, setChatIdState] = useState(() => nactiKlic(KEY_CHAT) || '');
  const [chat, setChat] = useState(null);      // DTO ze serveru {id,title,messages,pending,model}
  const [seznam, setSeznam] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [model, setModelState] = useState(() => nactiKlic(KEY_MODEL) || '');
  const zivy = useRef(true);
  useEffect(() => () => { zivy.current = false; }, []);

  const setModel = useCallback((m) => {
    setModelState(m || '');
    if (m) ulozKlic(KEY_MODEL, m); else smazKlic(KEY_MODEL);
  }, []);
  const setChatId = useCallback((id) => {
    setChatIdState(id || '');
    if (id) ulozKlic(KEY_CHAT, id); else smazKlic(KEY_CHAT);
  }, []);
  const nactiSeznam = useCallback(async () => {
    try { const r = await chatSeznam(); if (zivy.current) setSeznam(r.chats || []); } catch { /* seznam je bonus */ }
  }, []);
  const otevriChat = useCallback(async (id) => {
    setError(null);
    if (!id) { setChat(null); setChatId(''); return; }
    try {
      const r = await chatDetail(id);
      if (!zivy.current) return;
      setChat(r.chat); setChatId(r.chat.id);
    } catch {
      setChat(null); setChatId(''); // smazaný / cizí rozhovor → začít čistě
    }
  }, [setChatId]);

  // po otevření obnovit poslední rozhovor (jen jednou; zavřený panel nic nestahuje)
  const nacteno = useRef(false);
  useEffect(() => {
    if (!open || nacteno.current) return;
    nacteno.current = true;
    if (chatId) otevriChat(chatId);
  }, [open, chatId, otevriChat]);
  // seznam rozhovorů hned (i zavřený panel: ouško podle něj ví, jestli dnes
  // ranní porada už byla) — jeden levný dotaz
  useEffect(() => { nactiSeznam(); }, [nactiSeznam]);

  // Průvodce (ranní porada / rozbor projektu) = vždy NOVÝ rozhovor s režimem;
  // zprávu za uživatele složí server (kickoff), target = mapa/uzel z kontextu.
  const zacniRezim = useCallback(async (mode, target, context, patchUser) => {
    if (loading) return;
    setError(null);
    setLoading(true);
    setChat(null); setChatId('');
    try {
      const r = await chatApi({ mode, target: target || {}, message: '', context: context || {}, model: model || undefined });
      if (!zivy.current) return;
      setChat(r.chat); setChatId(r.chat.id);
      projevKarty(r.chat, patchUser);
      nactiSeznam();
    } catch (e) {
      if (!zivy.current) return;
      setError(prevedChybu(e));
    } finally {
      if (zivy.current) setLoading(false);
    }
  }, [loading, model, nactiSeznam, setChatId]);

  // obrazek = { base64, nahled, nahledMime } z lib/obrazek.pripravObrazek (volitelné).
  // Vrací { ok, vratit }: vratit = server zprávu NEZPRACOVAL (vadný obrázek, vypnuté čtení, přepis
  // selhal, brzda) → panel vrátí obrázek i text do políčka. Po jiné chybě (timeout, pád smyčky až
  // po přepisu) je zpráva na serveru už uložená — vrácení by vedlo ke zdvojenému tahu (checkup 16. 9.).
  // pdf = { name, pages, strany:[{page,text}] } z lib/pdf.nactiPdf (volitelné) — serveru jde JEN text,
  // soubor zůstává v prohlížeči (panel ho drží pro kartu opravy).
  const send = useCallback(async (text, context, patchUser, obrazek, pdf) => {
    const t = String(text || '').trim();
    if ((!t && !obrazek && !pdf) || loading) return { ok: false, vratit: false };
    setError(null);
    setLoading(true);
    // optimisticky ukázat zprávu hned; server ji uloží i při chybě modelu
    const docasna = { role: 'user', content: t, ts: new Date().toISOString(), docasna: true };
    if (obrazek && obrazek.nahled) docasna.obrazek = { nahled: obrazek.nahled, mime: obrazek.nahledMime };
    if (pdf) docasna.pdf = { name: pdf.name, pages: pdf.pages };
    setChat((c) => ({ ...(c || { id: chatId, title: '', pending: [] }), messages: [...((c && c.messages) || []), docasna] }));
    const obr = obrazek ? { image_base64: obrazek.base64, nahled_base64: obrazek.nahled || undefined } : {};
    if (pdf) { obr.pdf_text = pdf.strany; obr.pdf_name = pdf.name; obr.pdf_pages = pdf.pages; }
    try {
      let r;
      try {
        r = await chatApi({ chat_id: chatId || undefined, message: t, context: context || {}, model: model || undefined, ...obr });
      } catch (e) {
        // rozhovor už na serveru není (smazaný jinde) → NEZTRATIT zprávu: poslat ji
        // do nového rozhovoru a říct to (dřív server tiše založil nový a historie
        // „zmizela“ bez vysvětlení, 13. 9. 2026)
        if (!(e && e.status === 404 && chatId)) throw e;
        setChatId('');
        r = await chatApi({ message: t, context: context || {}, model: model || undefined, ...obr });
        if (zivy.current) setError('lost');
      }
      if (!zivy.current) return { ok: true, vratit: false };
      setChat(r.chat); setChatId(r.chat.id);
      projevKarty(r.chat, patchUser);
      ohlasZmenuMapy(r.chat);
      nactiSeznam();
      return { ok: true, vratit: false };
    } catch (e) {
      const kod = e && e.response && e.response.code;
      const nezpracovano = !!(e && !e.isTimeout && (e.status === 400 || e.status === 429 || kod === 'ai_vision'));
      if (!zivy.current) return { ok: false, vratit: nezpracovano };
      setError(prevedChybu(e));
      if (chatId) otevriChat(chatId);
      else if ((obrazek || pdf) && nezpracovano) setChat((c) => (c && !c.id ? null : c)); // nový rozhovor se nezaložil → pryč s dočasnou bublinou
      else if (obrazek || pdf) nactiSeznam(); // mohl vzniknout na serveru — ať je v historii
      return { ok: false, vratit: nezpracovano };
    } finally {
      if (zivy.current) setLoading(false);
    }
  }, [chatId, loading, model, otevriChat, nactiSeznam, setChatId]);

  // vysledek = výsledek akce vykonané prohlížečem (oprava PDF: {provedeno, nenalezeno, chyba}) — jen u karet s `klient`
  const potvrd = useCallback(async (actionId, ok, context, patchUser, vysledek) => {
    if (!chatId || loading) return;
    setError(null);
    setLoading(true);
    try {
      const r = await chatPotvrdit({ chat_id: chatId, action_id: actionId, ok: !!ok, context: context || {}, model: model || undefined, ...(vysledek ? { vysledek } : {}) });
      if (!zivy.current) return;
      setChat(r.chat);
      projevKarty(r.chat, patchUser);
      ohlasZmenuMapy(r.chat);
    } catch (e) {
      if (!zivy.current) return;
      setError(prevedChybu(e));
      otevriChat(chatId);
    } finally {
      if (zivy.current) setLoading(false);
    }
  }, [chatId, loading, model, otevriChat]);

  const novy = useCallback(() => { setChat(null); setChatId(''); setError(null); }, [setChatId]);
  const smaz = useCallback(async (id) => {
    try { await chatSmazat(id); } catch { /* už není */ }
    if (id === chatId) novy();
    nactiSeznam();
  }, [chatId, novy, nactiSeznam]);

  return { chat, chatId, seznam, loading, error, model, setModel, send, potvrd, novy, smaz, otevriChat, zacniRezim };
}
