import { useCallback, useEffect, useRef, useState } from 'react';
import { chat as chatApi, chatPotvrdit, chatOprav, chatDetail, chatSeznam, chatSmazat, chatVratit } from '@/api/asistentApi';
import { base44 } from '@/api/base44Client';
import { nahradPrepis } from '@/lib/prepisZpravy';
import { nactiKlic, ulozKlic, smazKlic } from '@/lib/storageKeys';
import { setSkin, setTheme } from '@/lib/theme';
import { getBuiltinSkin } from '@/lib/skins';
import { setLang } from '@/lib/lang';
import { saveMode, MODE_AUTO, MODE_LITE, MODE_FULL } from '@/lib/liteMode';
import { KLIC_CITELNOST, platnyStupen } from '@/lib/citelnost';
import { KLIC_ZAMEK } from '@/lib/alignStyles';

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
// Každá karta se projeví JEDNOU (aplikovane = klíče už projevených karet) a vrácená (Vrátit) už nikdy:
// dřív se při každém potvrzení další karty v témže tahu znovu aplikovaly všechny karty nastavení od poslední
// zprávy uživatele, takže Vrátit u jazyka a potvrzení pozvánky vrátilo UI do angličtiny, zatímco účet byl česky
// (panel 4. 10. 2026).
const klicKarty = (dto, mi, ki, k) => `${(dto && dto.id) || ''}:${k.id || `${mi}:${ki}:${k.type}:${k.co || ''}`}`;
function projevKarty(dto, patchUser, klient, aplikovane) {
  const msgs = (dto && dto.messages) || [];
  const odUser = msgs.map((m) => m.role).lastIndexOf('user');
  const karty = [];
  msgs.forEach((m, mi) => { if (mi > odUser && m.role === 'assistant') (m.karty || []).forEach((k, ki) => karty.push([k, klicKarty(dto, mi, ki, k)])); });
  for (const [k, klic] of karty) {
    if (k.vraceno) continue;
    let projev = null;
    if (k.type === 'skin') {
      const s = getBuiltinSkin(k.skin_id);
      if (s) projev = () => { setSkin(s); if (patchUser) patchUser({ skin_id: k.skin_id }); };
    } else if (k.type === 'theme') {
      projev = () => setTheme(k.theme === 'dark' ? 'dark' : 'light');
    } else if (k.type === 'nastaveni') {
      projev = () => aplikujKlienta(k, patchUser, klient);
    } else if (k.type === 'akce' && k.stav === 'hotovo' && k.odkaz && k.odkaz.type === 'nastaveni' && !k.odkaz.vraceno) {
      // nastavení, které šlo přes kartu (jazyk, režim e-mailů, vypnutí upozornění, přepnutí do lite): výsledek visí na kartě akce
      projev = () => aplikujKlienta(k.odkaz, patchUser, klient);
    }
    if (!projev) continue; // karta „ceka“ se nezapisuje — projeví se až po Ano
    if (aplikovane) { if (aplikovane.has(klic)) continue; aplikovane.add(klic); }
    projev();
  }
}
// Nastavení z karty `nastaveni` (3. 10. 2026): serverová pole už server uložil (jen se propíší do uživatele
// v paměti), klientské předvolby (motiv, zjednodušené zobrazení, čitelnost) se ukládají TADY do prohlížeče.
// `hodnota` přebíjí k.hodnota (Vrátit = tatáž cesta s předchozí hodnotou). klient = { navigate } z panelu.
export function aplikujKlienta(k, patchUser, klient, hodnota) {
  const v = hodnota !== undefined ? hodnota : k.hodnota;
  const pu = (f) => { if (patchUser) patchUser(f); };
  switch (k.co) {
    case 'language': setLang(v === 'en' ? 'en' : 'cs'); pu({ language: v === 'en' ? 'en' : 'cs' }); break;
    case 'theme': setTheme(v === 'dark' ? 'dark' : 'light'); break;
    case 'mode':
      saveMode(v === 'lite' ? MODE_LITE : v === 'full' ? MODE_FULL : MODE_AUTO);
      // zjednodušené zobrazení nemá panel asistenta → rovnou tam (karta uživatele varovala a potvrdil ji)
      if (v === 'lite' && klient && klient.navigate) klient.navigate('/lite');
      break;
    case 'readability':
      ulozKlic(KLIC_CITELNOST, platnyStupen(v));
      try { window.dispatchEvent(new Event('kb-citelnost-changed')); } catch { /* SSR/test */ }
      break;
    case 'align_lock': { const z = !v || v === 'none' ? '' : v; ulozKlic(KLIC_ZAMEK, z); pu({ align_lock: z }); break; }
    case 'full_name': pu({ full_name: v || '' }); break;
    case 'display_name': pu({ name: v || '' }); break;
    case 'notify_email_mode': pu({ notify_email_mode: v || '' }); break;
    case 'notify': pu({ notify_prefs: hodnota !== undefined ? hodnota : (k.prefs || {}) }); break;
    default: break;
  }
}
// Pole účtu, která musí při Vrátit zapsat prohlížeč (server už původní hodnotu přepsal); null = jen prohlížeč
export function poleProVraceni(k) {
  const p = k.predchozi;
  switch (k.co) {
    case 'language': return { language: p === 'en' ? 'en' : 'cs' };
    case 'align_lock': return { align_lock: !p || p === 'none' ? '' : p };
    case 'full_name': return { full_name: p || '' };
    case 'display_name': return { name: p || '' };
    case 'notify_email_mode': return { notify_email_mode: p || '' };
    case 'notify': return { notify_prefs: k.predchozi_prefs || {} };
    default: return null;
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
  // 'rate' = hodinový strop (ai_rate). Jiné 429 mají vlastní text ze serveru — měsíční limit přepisu u brány,
  // strop zkušebky — a „hodinový strop“ by u nich lhal (panel 1. 10. 2026); 429 bez textu (proxy) = rate
  if (e && e.status === 429 && !(e.response && e.response.error && e.response.code !== 'ai_rate')) return 'rate';
  return (e && e.response && (e.response.error || e.response.message)) || 'generic';
};

export function useAsistentChat({ open, klient }) {
  const klientRef = useRef(klient); // { navigate } — projevení karet nastavení (přechod do /lite)
  klientRef.current = klient;
  const aplikovane = useRef(new Set()); // klíče karet, které se v prohlížeči už projevily (viz projevKarty)
  const [chatId, setChatIdState] = useState(() => nactiKlic(KEY_CHAT) || '');
  const [chat, setChat] = useState(null);      // DTO ze serveru {id,title,messages,pending,model}
  const [seznam, setSeznam] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [model, setModelState] = useState(() => nactiKlic(KEY_MODEL) || '');
  const zivy = useRef(true);
  useEffect(() => () => { zivy.current = false; }, []);
  // právě otevřený rozhovor — odpověď na potvrzení / opravu, která dorazí po přepnutí jinam, se nesmí vykreslit
  // do cizího rozhovoru (panel by ukazoval rozhovor A s id rozhovoru B a další zpráva by šla do B)
  const aktualni = useRef(chatId);
  aktualni.current = chatId;

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
  // ponechChybu: znovunačtení rozhovoru PO chybě (zpráva neodešla, karta se nepotvrdila) nesmí smazat hlášku, která
  // právě říká proč — dřív ji smazalo hned, takže v rozběhnutém rozhovoru zpráva jen beze slova zmizela
  const otevriChat = useCallback(async (id, ponechChybu) => {
    if (!ponechChybu) setError(null);
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
      projevKarty(r.chat, patchUser, klientRef.current, aplikovane.current);
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
  // hlas = { base64, s } z Hlasovka.jsx (1. 10. 2026) — nahrávka jde serveru jen k přepisu, neukládá se
  const send = useCallback(async (text, context, patchUser, obrazek, pdf, hlas) => {
    const t = String(text || '').trim();
    if ((!t && !obrazek && !pdf && !hlas) || loading) return { ok: false, vratit: false };
    setError(null);
    setLoading(true);
    // optimisticky ukázat zprávu hned; server ji uloží i při chybě modelu
    const docasna = { role: 'user', content: t, ts: new Date().toISOString(), docasna: true };
    if (obrazek && obrazek.nahled) docasna.obrazek = { nahled: obrazek.nahled, mime: obrazek.nahledMime };
    if (pdf) docasna.pdf = { name: pdf.name, pages: pdf.pages };
    if (hlas) docasna.hlas = { s: hlas.s || 0 };
    setChat((c) => ({ ...(c || { id: chatId, title: '', pending: [] }), messages: [...((c && c.messages) || []), docasna] }));
    const obr = obrazek ? { image_base64: obrazek.base64, nahled_base64: obrazek.nahled || undefined } : {};
    if (pdf) { obr.pdf_text = pdf.strany; obr.pdf_name = pdf.name; obr.pdf_pages = pdf.pages; }
    if (hlas) { obr.audio_base64 = hlas.base64; obr.audio_s = hlas.s || 0; }
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
      projevKarty(r.chat, patchUser, klientRef.current, aplikovane.current);
      ohlasZmenuMapy(r.chat);
      nactiSeznam();
      return { ok: true, vratit: false };
    } catch (e) {
      const kod = e && e.response && e.response.code;
      // Hlasovka: nahrávka zůstane k opakování VŽDY, když ji server neuložil do rozhovoru — přepis selhal, nebyla
      // v ní řeč, brána odmítla, ale i výpadek sítě, chyba proxy (413/502/504) nebo vypršení času. Jen když server
      // řekne `ulozeno` (přepis je v rozhovoru, selhal až model), nahrávka potřeba není — poslala by se podruhé.
      // Obrázek / PDF: jako dosud jen při odmítnutí vstupu (jinak mohly být zpracované).
      const ulozeno = !!(e && e.response && e.response.ulozeno);
      const nezpracovano = hlas ? !ulozeno : !!(e && !e.isTimeout && (e.status === 400 || e.status === 429 || e.status === 422 || kod === 'ai_vision' || String(kod || '').startsWith('ai_hlas')));
      if (!zivy.current) return { ok: false, vratit: nezpracovano };
      setError(prevedChybu(e));
      if (chatId) otevriChat(chatId, true);
      else if ((obrazek || pdf || hlas) && nezpracovano) setChat((c) => (c && !c.id ? null : c)); // nový rozhovor se nezaložil → pryč s dočasnou bublinou
      else if (obrazek || pdf || hlas) nactiSeznam(); // mohl vzniknout na serveru — ať je v historii
      return { ok: false, vratit: nezpracovano };
    } finally {
      if (zivy.current) setLoading(false);
    }
  }, [chatId, loading, model, otevriChat, nactiSeznam, setChatId]);

  // vysledek = výsledek akce vykonané prohlížečem (oprava PDF: {provedeno, nenalezeno, chyba}) — jen u karet s `klient`
  // actionId = jedno id, nebo pole id („Provést vše" — jedna žádost, model dopoví jednou)
  const potvrd = useCallback(async (actionId, ok, context, patchUser, vysledek) => {
    if (!chatId || loading) return;
    setError(null);
    setLoading(true);
    try {
      const ktere = Array.isArray(actionId) ? { action_ids: actionId } : { action_id: actionId };
      const r = await chatPotvrdit({ chat_id: chatId, ...ktere, ok: !!ok, context: context || {}, model: model || undefined, ...(vysledek ? { vysledek } : {}) });
      if (!zivy.current) return;
      ohlasZmenuMapy(r.chat); // změna v mapě platí, i když uživatel mezitím otevřel jiný rozhovor
      if (aktualni.current !== chatId) { nactiSeznam(); return; }
      setChat(r.chat);
      projevKarty(r.chat, patchUser, klientRef.current, aplikovane.current);
    } catch (e) {
      if (!zivy.current || aktualni.current !== chatId) return;
      setError(prevedChybu(e));
      otevriChat(chatId, true);
    } finally {
      if (zivy.current) setLoading(false);
    }
  }, [chatId, loading, model, otevriChat, nactiSeznam]);

  // Vrátit u karty nastavení: tatáž cesta s předchozí hodnotou; serverová pole zapíše prohlížeč (vzor persistSkin).
  // Karta se označí `vraceno` (už se znovu neprojeví, tlačítko zmizí); když zápis na server selže, vrátí false
  // a panel to řekne — dřív se chyba spolkla a prohlížeč byl vrácený, účet ne.
  const vratNastaveni = useCallback(async (karta, patchUser, userId) => {
    const predchozi = karta.co === 'notify' ? (karta.predchozi_prefs || {}) : (karta.predchozi || '');
    const stejna = (k) => k === karta || (karta.id && k.id === karta.id);
    setChat((c) => (!c ? c : { ...c, messages: (c.messages || []).map((m) => (!m.karty ? m : { ...m, karty: m.karty.map((k) => (stejna(k) ? { ...k, vraceno: true } : (k.odkaz && stejna(k.odkaz) ? { ...k, odkaz: { ...k.odkaz, vraceno: true } } : k))) })) }));
    // server: karta je vrácená (přežije přemontování aplikace při změně jazyka — Router key = jazyk)
    let ok = true;
    if (karta.id && chatId) { try { await chatVratit({ chat_id: chatId, karta_id: karta.id }); } catch { ok = false; } }
    const pole = poleProVraceni(karta);
    if (pole && userId) { try { await base44.entities.User.update(userId, pole); } catch { ok = false; } }
    // až nakonec: změna jazyka přemontuje aplikaci a rozhovor se načte znovu ze serveru — ten už kartu zná jako vrácenou
    aplikujKlienta(karta, patchUser, klientRef.current, predchozi);
    return ok;
  }, [chatId]);

  // Oprava přepisu POSLEDNÍ hlasovky / fotky (tužka v bublině, 1. 10. 2026): server nahradí text pod značkou, zahodí
  // odpověď a nepotvrzené návrhy z toho tahu a asistent odpoví znovu. Opravený text i zmizelá odpověď jsou vidět hned.
  const oprav = useCallback(async (text, context, patchUser) => {
    const t = String(text || '').trim();
    if (!t || !chatId || loading) return false;
    setError(null);
    setLoading(true);
    setChat((c) => {
      const msgs = (c && c.messages) || [];
      const i = msgs.map((m) => m.role).lastIndexOf('user');
      if (i < 0) return c;
      return { ...c, pending: [], lze_opravit: false, messages: [...msgs.slice(0, i), { ...msgs[i], content: nahradPrepis(msgs[i].content, t), opraveno: true }] };
    });
    try {
      const r = await chatOprav({ chat_id: chatId, text: t, context: context || {}, model: model || undefined });
      if (!zivy.current) return true;
      nactiSeznam();
      if (aktualni.current !== chatId) return true; // mezitím otevřen jiný rozhovor — odpověď patří tomu původnímu
      setChat(r.chat);
      projevKarty(r.chat, patchUser, klientRef.current, aplikovane.current);
      ohlasZmenuMapy(r.chat);
      return true;
    } catch (e) {
      if (!zivy.current || aktualni.current !== chatId) return false;
      setError(prevedChybu(e));
      otevriChat(chatId, true); // server je směrodatný: buď původní stav (odmítnuto), nebo opravená zpráva bez odpovědi (pád modelu)
      return false;
    } finally {
      if (zivy.current) setLoading(false);
    }
  }, [chatId, loading, model, otevriChat, nactiSeznam]);

  const novy = useCallback(() => { setChat(null); setChatId(''); setError(null); }, [setChatId]);
  const smaz = useCallback(async (id) => {
    try { await chatSmazat(id); } catch { /* už není */ }
    if (id === chatId) novy();
    nactiSeznam();
  }, [chatId, novy, nactiSeznam]);

  return { chat, chatId, seznam, loading, error, model, setModel, send, potvrd, oprav, novy, smaz, otevriChat, zacniRezim, vratNastaveni };
}
