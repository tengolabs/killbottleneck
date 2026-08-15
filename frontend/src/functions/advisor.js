import { callFlowmapRoute } from './flowmapApi';

// AI generování musí mít strop na klientovi: při výpadku cloudové AI by jinak
// spinner točil, dokud to nevzdá server (120 s) — a i pak s matoucí hláškou.
// Přepis nahrávky (transcribe) legitimně trvá minuty, proto má vlastní limit
// shodný s Whisperem na bráně (600 s).
const DEFAULT_TIMEOUT_MS = 90_000;
const TRANSCRIBE_TIMEOUT_MS = 600_000;

// Testovací zkratka: e2e sady si limit sníží přes localStorage, aby výpadek
// nemusely simulovat 90 sekund.
const overrideMs = () => {
  try { return Number(localStorage.getItem('kb_ai_timeout_ms')) || 0; } catch { return 0; }
};

export const advisor = (payload) => callFlowmapRoute('/api/kb/advisor', payload, {
  timeoutMs: overrideMs()
    || (payload?.mode === 'transcribe' ? TRANSCRIBE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS),
});
