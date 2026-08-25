import { pb } from '@/api/pb';
import { todayKey } from '@/lib/taskActions';

// „Organizace" ze serveru — pohled shora pro admina a manažera. Výpočet žije
// jen na serveru (pb_hooks/helpers.js:buildPortfolio): jen týmové a sdílené
// projekty, soukromé ani do součtů. Tady je jen tenký přístup.
// `today` posíláme ZE ZAŘÍZENÍ (server běží v UTC) — stejně jako Můj den.
export const fetchPortfolio = () =>
  pb.send(`/api/kb/portfolio?today=${todayKey()}`, { method: 'GET' });
