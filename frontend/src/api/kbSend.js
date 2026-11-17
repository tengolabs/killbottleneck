// Jádro volání /api/kb/* (viz api/kb.js — tady jen to, co potřebuje i lite režim).
import i18next from 'i18next';
import { pb } from '@/api/pb';
import { serverReason } from '@/lib/serverReason';

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
    // The message goes to the screen at ~40 callers (`e.message || t(...)`): a sentence written by OUR server
    // (already in the person's language) is kept; PocketBase's and the SDK's English "Something went wrong."
    // is replaced by a translated one — a Czech user used to read English on every network failure (F5-05).
    const e = new Error(serverReason(err) || (err?.status
      ? i18next.t('common:misc.requestFailed', { defaultValue: 'The request failed. Please try again.' })
      : i18next.t('common:misc.serverUnreachable', { defaultValue: 'The server did not answer. Check the connection and try again.' })));
    e.status = err?.status;
    e.response = telo;
    e.isTimeout = !!(ctrl?.signal?.aborted && (err?.isAbort || err?.name === 'AbortError'));
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

