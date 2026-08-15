import { callFlowmapRoute } from './flowmapApi';

// Ruční přegenerování denního AI sumáře přihlášeného uživatele (tlačítko
// „Aktualizovat" na dashboardu /tasks). Vrací { data: { summary | note | error } }.
export const refreshMySummary = () => callFlowmapRoute('/api/kb/my-summary/refresh');
