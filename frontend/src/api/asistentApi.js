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
export const chat = (payload) => kbSend('/api/kb/chat', { body: payload, timeoutMs: overrideMs() || (payload && (payload.image_base64 || payload.pdf_text) ? CHAT_IMG_TIMEOUT_MS : CHAT_TIMEOUT_MS) });
export const chatPotvrdit = (payload) => kbSend('/api/kb/chat/potvrdit', { body: payload, timeoutMs: overrideMs() || CHAT_TIMEOUT_MS });
export const chatSeznam = () => kbSend('/api/kb/chat/seznam', { method: 'GET' });
export const chatDetail = (id) => kbSend(`/api/kb/chat/detail/${encodeURIComponent(id)}`, { method: 'GET' });
export const chatSmazat = (id) => kbSend('/api/kb/chat/smazat', { body: { chat_id: id } });
export const chatPamet = () => kbSend('/api/kb/chat/pamet', { method: 'GET' });
export const chatPametUloz = (text, mapId) => kbSend('/api/kb/chat/pamet', { body: mapId ? { text, map_id: mapId } : { text } });
export const chatKonceptUloz = (payload) => kbSend('/api/kb/chat/koncept-uloz', { body: payload });
export const chatModely = () => kbSend('/api/kb/chat/modely', { method: 'GET' });
