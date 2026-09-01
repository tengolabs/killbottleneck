// Jedna hranice pro volání /api/kb/* mimo entitní CRUD (analýza kódu 27. 8. 2026,
// F2-04: čtyři způsoby volání a dvě chybové konvence). Vrací PŘÍMO tělo odpovědi
// (žádný axios obal `{ data }`); chyba je Error s `status`, `response` (tělo
// ze serveru: `error`/`message`) a `isTimeout` — stejný tvar jako holý `pb.send`.
// ⚠️ Jádro (kbSend) a datové čtení Můj den/Organizace jsou v malých modulech
// (api/kbSend.js, api/myDay.js): lite režim je importuje přímo — kdyby ležely
// tady, rollup by mu do sdíleného chunku přibalil i advisor a spol. (+5 kB nad
// strop lite-bundle.js). Odsud se jen re-exportují, ať má plná appka jeden import.
export { kbSend } from '@/api/kbSend';
export { fetchMyDay, fetchPortfolio } from '@/api/myDay';
import { kbSend } from '@/api/kbSend';

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

export const advisor = (payload) => kbSend('/api/kb/advisor', {
  body: payload,
  timeoutMs: overrideMs() || (payload?.mode === 'transcribe' ? TRANSCRIBE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS),
});

// Ruční přegenerování denního AI sumáře přihlášeného uživatele (tlačítko
// „Aktualizovat" na dashboardu /tasks). Vrací { summary | note | error }.
export const refreshMySummary = () => kbSend('/api/kb/my-summary/refresh');

export const getPublicMap = (payload) => kbSend('/api/kb/public-maps', { body: payload });

export const shareMap = (payload) => kbSend('/api/kb/share', { body: payload });

// Změna stavu uzlu cílenou routou (kdo smí, rozhoduje server: garant nebo
// řešitel úkolu na uzlu) — do 1. 9. 2026 opsané na třech místech (editor,
// zjednodušený dialog uzlu, fallback řádkových akcí v taskActions).
export const nodeStatus = (mapId, nodeId, status) => kbSend('/api/kb/node-status', { body: { mapId, nodeId, status } });

// Organizační struktura (tabulka ve Správě organizace je pohled nad org mapou;
// zápisy jdou do týchž uzlů, které kreslí editor) + idempotentní založení
// org mapy. Volají Správa organizace, panáček (UserMenu) a RuleBuilder.
export const getOrgStructure = () => kbSend('/api/kb/org-structure', { method: 'GET' });
export const orgAssign = (nodeId, field, value) => kbSend('/api/kb/org-structure/assign', { body: { node_id: nodeId, [field]: value } });
export const orgAdd = (parentNodeId) => kbSend('/api/kb/org-structure/add', { body: { parent_node_id: parentNodeId || '' } });
export const orgRemove = (nodeId) => kbSend('/api/kb/org-structure/remove', { body: { node_id: nodeId } });
export const createOrgMap = () => kbSend('/api/kb/org-map');

// Personální agenda (Správa uživatelů) — bezpečná podmnožina členů, obnova
// hesla rukou správce, osobní zástupce a účel organizace (dotazník účelu
// posílá replace:true = server smí nahradit nedotčenou úvodní mapu).
export const getMembers = () => kbSend('/api/kb/members', { method: 'GET' });
export const resetUserPassword = (email) => kbSend('/api/kb/reset-user-password', { body: { email } });
export const memberDeputy = (id, deputy) => kbSend('/api/kb/member-deputy', { body: { id, deputy } });
export const savePurpose = (purpose, { replace } = {}) => kbSend('/api/kb/purpose', { body: { purpose, ...(replace ? { replace: true } : {}) } });

