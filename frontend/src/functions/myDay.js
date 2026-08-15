import { pb } from '@/api/pb';
import { todayKey } from '@/lib/taskActions';

// „Můj den" ze serveru — hotové sekce a počty.
//
// Dřív si tenhle přehled počítal prohlížeč sám a kvůli tomu stahoval až 200 map
// (JSON bloby!) a 1000 úkolů. Změřeno na 500 uzlech / 2000 úkolech: první
// načtení na telefonu na mobilních datech trvalo ~11 s (viz
// product/tests/scale-limits.js). Výpočet teď žije jen na serveru
// (pb_hooks/helpers.js:buildMyDay) — tady je k němu jen tenký přístup, který
// používá panel na Home i /tasks a stejně tak zjednodušený (light) režim.
//
// `today` posíláme ZE ZAŘÍZENÍ: server běží v UTC a po půlnoci SELČ by se jeho
// „dnešek" rozešel s tím, co má člověk na hodinkách.
//
// `since` = MOJE půlnoc přepočtená do UTC. Samotné datum nestačí: razítka změn
// jsou v UTC, takže hranice „dnešek od 00:00Z" je pro nás posunutá o zónu a
// mezi půlnocí a druhou ranní vycházel seznam „Hotovo dnes" prázdný — což je
// zrovna čas, kdy se tu nejvíc pracuje.
const mojePulnocVUtc = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

export const fetchMyDay = () =>
  pb.send(`/api/kb/my-day?today=${todayKey()}&since=${encodeURIComponent(mojePulnocVUtc())}`, { method: 'GET' });
