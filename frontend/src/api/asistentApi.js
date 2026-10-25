// AI chat na boku — volání /api/kb/chat*. Samostatný malý modul (ne v api/kb.js):
// AsistentContext sedí v App.jsx, tedy v hlavním balíku, a kb.js by do něj
// přitáhl advisor a spol. (+5 kB nad strop lite-bundle.js, 13. 9. 2026).
import { kbSend } from '@/api/kbSend';

// chat = smyčka nástrojů nad modelem → delší strop než jednorázové AI akce
const CHAT_TIMEOUT_MS = 180_000;
// tah s obrázkem = přepis (až 90 s na kartě, pak případně záloha) + smyčka nástrojů
const CHAT_IMG_TIMEOUT_MS = 300_000;
const overrideMs = () => {
  try { return Number(localStorage.getItem('kb_ai_timeout_ms')) || 0; } catch { return 0; }
};
// tah s textem PDF = dlouhý prompt (desítky tisíc znaků) → stejný strop jako obrázek
export const chat = (payload) => kbSend('/api/kb/chat', { body: payload, timeoutMs: overrideMs() || (payload && (payload.image_base64 || payload.pdf_text || payload.audio_base64) ? CHAT_IMG_TIMEOUT_MS : CHAT_TIMEOUT_MS) });
export const chatPotvrdit = (payload) => kbSend('/api/kb/chat/potvrdit', { body: payload, timeoutMs: overrideMs() || CHAT_TIMEOUT_MS });
// rozjezd: po odpovědi předehřát druhý hlavní model (server sám pozná, zda je co předehřívat); bez čekání, bez UI
export const chatPredehrat = (payload) => kbSend('/api/kb/chat/predehrat', { body: payload, timeoutMs: 180000 });
// oprava přepisu poslední hlasovky / fotky: zahodí nepotvrzené návrhy a asistent odpoví znovu (běžný tah)
export const chatOprav = (payload) => kbSend('/api/kb/chat/oprav', { body: payload, timeoutMs: overrideMs() || CHAT_TIMEOUT_MS });
export const chatSeznam = () => kbSend('/api/kb/chat/seznam', { method: 'GET' });
// Vrátit u karty nastavení: server si kartu označí `vraceno` (přežije přemontování při změně jazyka)
export const chatVratit = (payload) => kbSend('/api/kb/chat/vratit', { body: payload });
export const chatDetail = (id) => kbSend(`/api/kb/chat/detail/${encodeURIComponent(id)}`, { method: 'GET' });
export const chatSmazat = (id) => kbSend('/api/kb/chat/smazat', { body: { chat_id: id } });
export const chatPamet = () => kbSend('/api/kb/chat/pamet', { method: 'GET' });
export const chatPametUloz = (text, mapId) => kbSend('/api/kb/chat/pamet', { body: mapId ? { text, map_id: mapId } : { text } });
export const chatModely = () => kbSend('/api/kb/chat/modely', { method: 'GET' });
// Dokumenty asistenta (30. 9. 2026): soukromé poznámky, koncepty e-mailů a sumáře
export const dokumenty = ({ skupina, q } = {}) => {
  const p = new URLSearchParams();
  if (skupina) p.set('skupina', skupina);
  if (q) p.set('q', q);
  const qs = p.toString();
  return kbSend(`/api/kb/chat/dokumenty${qs ? `?${qs}` : ''}`, { method: 'GET' });
};
export const dokument = (id) => kbSend(`/api/kb/chat/dokument/${encodeURIComponent(id)}`, { method: 'GET' });
export const dokumentUloz = (payload) => kbSend('/api/kb/chat/dokument', { body: payload });
export const dokumentVratit = (id) => kbSend('/api/kb/chat/dokument/vratit', { body: { id } });
export const dokumentSmazat = (id) => kbSend('/api/kb/chat/dokument/smazat', { body: { id } });
// Stránky asistenta (14. 10. 2026): HTML artefakty — seznam (moje|tym), detail s HTML, page writer, sdílení
export const stranky = ({ skupina, q } = {}) => {
  const p = new URLSearchParams();
  if (skupina) p.set('skupina', skupina);
  if (q) p.set('q', q);
  const qs = p.toString();
  return kbSend(`/api/kb/chat/stranky${qs ? `?${qs}` : ''}`, { method: 'GET' });
};
export const stranka = (id) => kbSend(`/api/kb/chat/stranka/${encodeURIComponent(id)}`, { method: 'GET' });
// writer píše minuty; odpověď klient nečeká (stav přijde realtime), strop jen ať požadavek nevisí navěky
export const strankaNapsat = (id) => kbSend('/api/kb/chat/stranka/napsat', { body: { id }, timeoutMs: 300_000 });
export const strankaVratit = (id) => kbSend('/api/kb/chat/stranka/vratit', { body: { id } });
export const strankaSmazat = (id) => kbSend('/api/kb/chat/stranka/smazat', { body: { id } });
export const strankaSdilet = (payload) => kbSend('/api/kb/chat/stranka/sdilet', { body: payload });
export const strankaTym = (payload) => kbSend('/api/kb/chat/stranka/tym', { body: payload });
// {id, akce: 'pridat'|'odebrat', user: id člena} — jmenovité sdílení (15. 10. 2026)
export const strankaLide = (payload) => kbSend('/api/kb/chat/stranka/lide', { body: payload });
// Faktury a profil dodavatele (9. 10. 2026): vystavuje je asistent (create_invoice), panel je čte a označuje
// zaplacené; PDF vyrábí prohlížeč z DTO (lib/faktura). Profil dodavatele: společný (správce, Správa organizace) + vlastní (/me, Můj účet).
export const faktury = ({ year, unpaid } = {}) => {
  const p = new URLSearchParams();
  if (year) p.set('year', String(year));
  if (unpaid) p.set('unpaid', '1');
  const qs = p.toString();
  return kbSend(`/api/kb/chat/faktury${qs ? `?${qs}` : ''}`, { method: 'GET' });
};
export const faktura = (id) => kbSend(`/api/kb/chat/faktura/${encodeURIComponent(id)}`, { method: 'GET' });
export const fakturaZaplaceno = (id, paid) => kbSend('/api/kb/chat/faktura/zaplaceno', { body: { id, paid } });
export const invoicingProfile = () => kbSend('/api/kb/invoicing-profile', { method: 'GET' });
export const invoicingProfileUloz = (payload) => kbSend('/api/kb/invoicing-profile', { body: payload });
// vlastní údaje dodavatele uživatele (přednost před společnými, vlastní číselná řada); { smazat: true } = zpět na společné
export const invoicingProfileMe = () => kbSend('/api/kb/invoicing-profile/me', { method: 'GET' });
export const invoicingProfileMeUloz = (payload) => kbSend('/api/kb/invoicing-profile/me', { body: payload });
