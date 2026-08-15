// Náhrada Base44 serverových funkcí — volá lokální PocketBase routy /api/kb/*.
// Vrací axios-like tvar { data } a vyhazuje chyby s err.response.data,
// přesně jak komponenty očekávají.
import { pb } from '@/api/pb';

export const callFlowmapRoute = async (path, payload, { timeoutMs } = {}) => {
  // timeoutMs: po uplynutí požadavek uřízneme na klientovi (err.isTimeout) —
  // bez toho by uživatel čekal na serverový limit (u AI 120 s) bez vysvětlení.
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const data = await pb.send(path, {
      method: 'POST',
      body: payload || {},
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
    return { data };
  } catch (err) {
    const body = err?.response || {};
    const e = new Error(body.error || body.message || err?.message || 'Chyba serveru');
    e.status = err?.status;
    e.response = { data: body };
    e.isTimeout = !!(ctrl?.signal?.aborted && (err?.isAbort || err?.name === 'AbortError'));
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
};
