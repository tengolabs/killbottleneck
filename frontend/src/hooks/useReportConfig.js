import { useKbConfig } from '@/hooks/useKbConfig';

// Smí se z téhle instance hlásit chyba? Zapíná to KB_REPORT_TO na serveru;
// bez ní routa neexistuje a nabízet tlačítko by bylo klamání.
//
// Ptají se DVĚ místa — nabídka pod panáčkem a lišta v mapě (Richard 18. 8. 2026:
// „a když bys dal ještě ikonku sem?") — obě přes sdílený config (jeden dotaz).
export function useReportConfig(aktivni = true) {
  const { config } = useKbConfig(aktivni);
  return { enabled: !!config?.report_enabled, version: config?.version || '' };
}
