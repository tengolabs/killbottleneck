// Jádro volání /api/kb/* (viz api/kb.js — tady jen to, co potřebuje i lite režim).
import { pb } from '@/api/pb';

export async function kbSend(path, { method = 'POST', body, timeoutMs } = {}) {
  // timeoutMs: po uplynutí požadavek uřízneme na klientovi (err.isTimeout) —
  // bez toho by uživatel čekal na serverový limit (u AI 120 s) bez vysvětlení.
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    return await pb.send(path, {
      method,
      ...(method === 'GET' ? {} : { body: body || {} }),
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
  } catch (err) {
    const telo = err?.response || {};
    const e = new Error(telo.error || telo.message || err?.message || 'Chyba serveru');
    e.status = err?.status;
    e.response = telo;
    e.isTimeout = !!(ctrl?.signal?.aborted && (err?.isAbort || err?.name === 'AbortError'));
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

