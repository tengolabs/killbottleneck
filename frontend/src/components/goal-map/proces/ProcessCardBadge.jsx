import { useTranslation } from 'react-i18next';
import { todayStr } from '@/lib/rhythm';

// Štítek PROCESU na kartě projektu (Projekty, Archiv): „🔁 Proces" + jestli
// běží včas. Počítá se z uzlů mapy, které karta už má (bez dotazu navíc):
// otevřené kroky po termínu → „N po termínu", jinak s termíny → „běží včas",
// bez jediného termínu → „jen popis" (zmapovaný proces bez hlídaných kroků).
export default function ProcessCardBadge({ map, archived = false }) {
  const { t } = useTranslation('home');
  if (map?.kind !== 'process') return null;
  const dnes = todayStr();
  const kroky = (map.nodes || []).filter((n) => n.type !== 'note' && n.type !== 'apexNode' && n.data?.nodeType !== 'apex');
  const poTerminu = kroky.filter((n) => n.data?.deadline && n.data.deadline < dnes && n.data?.status !== 'done').length;
  const sTerminem = kroky.some((n) => n.data?.deadline);
  return (
    <span className="inline-flex items-center gap-1" data-testid="card-process-badge">
      <span className="inline-flex items-center px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium">🔁 {t('process.badge')}</span>
      {!archived && (poTerminu > 0 ? (
        <span className="inline-flex items-center px-2 py-1 rounded-md bg-red-500/10 text-red-700 dark:text-red-400 text-xs font-medium" data-testid="card-process-late">{t('process.lateCount', { count: poTerminu })}</span>
      ) : sTerminem ? (
        <span className="inline-flex items-center px-2 py-1 rounded-md bg-green-500/10 text-green-700 dark:text-green-400 text-xs font-medium">{t('process.onTime')}</span>
      ) : (
        <span className="inline-flex items-center px-2 py-1 rounded-md bg-secondary text-muted-foreground text-xs font-medium">{t('process.describesOnly')}</span>
      ))}
    </span>
  );
}
