import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bug } from 'lucide-react';
import { useReportConfig } from '@/hooks/useReportConfig';
import { useAuth } from '@/lib/AuthContext';
import { useLazyNs } from '@/i18n/lazyNs';
import ReportDialog from './ReportDialog';

// Nahlásit chybu z levé lišty — vedle zásobníku, časovače a dashboardu.
//
// Richard 18. 8. 2026: „a když bys dal ještě ikonku sem? i v mapě i v přehledu."
// Pod panáčkem to zůstává taky; tohle je druhá, bližší cesta k témuž dialogu.
// Aplikace si sama vezme, na které stránce člověk byl — proto dává smysl mít
// tlačítko přímo tam, kde na chybu narazil.
//
// Ukáže se JEN tam, kam je komu psát (KB_REPORT_TO + funkční pošta), takže
// v cizím self-hostu lišta vypadá přesně jako dosud.
// ⚠️ `top` musí být třída, kterou Tailwind SKUTEČNĚ vygeneruje. Škála skáče
// 64 → 72 → 80, takže „top-76" se tiše nevygeneruje a tlačítko skončí bez
// pozice — v mapě pak nebylo vidět vůbec (nahlásil Richard 18. 8. 2026).
// Pro mezihodnoty se píše hranatá závorka: top-[19rem].
export default function ReportRailButton({ top = 'top-40', leftOffset = 0, fixed = false }) {
  const { t } = useTranslation('popis');
  const nsReady = useLazyNs('popis');
  const { enabled, version } = useReportConfig();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  if (!enabled) return null;

  const pos = fixed ? 'fixed' : 'absolute';
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{ left: leftOffset }}
        title={nsReady ? t('report.titulek') : undefined}
        data-rail-report
        className={`${pos} ${top} z-30 flex items-center rounded-r-lg border bg-card px-2 py-2.5 text-muted-foreground hover:text-primary shadow-md transition-all ${leftOffset ? '' : 'border-l-0'}`}
      >
        <Bug className="w-4 h-4" />
      </button>
      <ReportDialog open={open} onClose={() => setOpen(false)} userEmail={user?.email} version={version} />
    </>
  );
}
