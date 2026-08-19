import { useState, useEffect } from 'react';
import { pb } from '@/api/pb';

// Smí se z téhle instance hlásit chyba? Zapíná to KB_REPORT_TO na serveru;
// bez ní routa neexistuje a nabízet tlačítko by bylo klamání.
//
// Vlastní hook, protože se ptají DVĚ místa — nabídka pod panáčkem a lišta
// v mapě (Richard 18. 8. 2026: „a když bys dal ještě ikonku sem?"). Dvě kopie
// téhož fetche by se dřív nebo později rozešly.
export function useReportConfig(aktivni = true) {
  const [cfg, setCfg] = useState({ enabled: false, version: '' });
  useEffect(() => {
    if (!aktivni) return undefined;
    let zivy = true;
    pb.send('/api/kb/config', { method: 'GET' })
      .then((c) => { if (zivy) setCfg({ enabled: !!c.report_enabled, version: c.version || '' }); })
      .catch(() => { if (zivy) setCfg({ enabled: false, version: '' }); });
    return () => { zivy = false; };
  }, [aktivni]);
  return cfg;
}
