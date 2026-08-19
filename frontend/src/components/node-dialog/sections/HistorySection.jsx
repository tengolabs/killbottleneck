import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  History, CheckCircle2, CalendarClock, UserRound, Plus, Trash2, ArrowRightLeft,
  MessageSquare, Paperclip, FileText, Palette, Smile, Bot, Zap, Loader2,
} from 'lucide-react';
import { pb } from '@/api/pb';
import { fmtDateTime } from '@/lib/locale';
import { formatDeadline } from '@/lib/nodeMeta';
import { useLazyNs } from '@/i18n/lazyNs';
import { STATUSES } from '@/lib/statusMeta';

// ŽIVOTOPIS CÍLE — jedna časová osa: kdo, kdy (VČETNĚ ČASU) a co udělal.
//
// Read-only, data si tahá sám — do useNodeEditState nesahá, takže „Uložit"
// v okně cíle se ho vůbec netýká.
//
// ⚠️ Nezaměňovat s „Co se změnilo" na dashboardu projektu: to je souhrn za
// CELÝ projekt do skupin (report na poradu). Tohle je log JEDNOHO cíle.
const IKONY = {
  status: CheckCircle2, deadline: CalendarClock, owner: UserRound,
  title: FileText, created: Plus, deleted: Trash2, parent: ArrowRightLeft,
  description: FileText, icon: Smile, color: Palette, executor: Bot, waiting: Zap,
  comment: MessageSquare, attachment: Paperclip, rule: Zap,
};
const BARVY = {
  status: 'text-green-600 dark:text-green-400',
  deadline: 'text-orange-600 dark:text-orange-400',
  owner: 'text-violet-600 dark:text-violet-400',
  created: 'text-blue-600 dark:text-blue-400',
  deleted: 'text-muted-foreground',
  parent: 'text-sky-600 dark:text-sky-400',
  rule: 'text-amber-600 dark:text-amber-400',
  comment: 'text-sky-600 dark:text-sky-400',
  attachment: 'text-slate-600 dark:text-slate-300',
};

export default function HistorySection({ mapId, nodeId }) {
  const { t } = useTranslation('historie');
  const nsReady = useLazyNs('historie');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!mapId || !nodeId) { setLoading(false); return; }
    let zivy = true;
    setLoading(true);
    pb.send(`/api/kb/node-history?map=${encodeURIComponent(mapId)}&node=${encodeURIComponent(nodeId)}`, { method: 'GET' })
      .then((d) => { if (zivy) { setData(d); setFailed(false); } })
      .catch(() => { if (zivy) setFailed(true); })
      .finally(() => { if (zivy) setLoading(false); });
    return () => { zivy = false; };
  }, [mapId, nodeId]);

  if (!nsReady) return null;

  // Datum I ČAS — v tom je celý rozdíl proti souhrnu na dashboardu
  // (Richard 19. 8. 2026: „potřebuji tam ne jen datumy, ale i časy").
  // fmtDateTime (toLocaleString), NE fmtDate: toLocaleDateString je od data
  // a hodiny s minutami do něj nepatří — v V8 projdou, jinde se na ně spolehnout
  // nedá. Obojí uvnitř volá parsePbDate, takže mezera místo `T` v razítku
  // PocketBase nedělá ze Safari Invalid Date.
  const kdy = (iso) => fmtDateTime(iso, {
    day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const stavLabel = (v) => STATUSES.find((s) => s.value === v)?.label || v || t('historie.prazdnaHodnota');

  // Kdo to udělal. `via` má přednost před actorem: u zásahu pravidla nese
  // actor_email autora pravidla, a tvrdit, že tam klikal člověk, by byla lež.
  const kdoLabel = (it) => {
    if (it.via && it.via.indexOf('rule:') === 0) return t('historie.kdo.pravidlo');
    if (it.via && it.via.indexOf('agent:') === 0) return `${t('historie.kdo.agent')} ${it.via.slice(6)}`;
    return it.actor || t('historie.kdo.system');
  };

  const popis = (it) => {
    if (it.kind === 'comment') return t('historie.udalost.komentar');
    if (it.kind === 'attachment') {
      return t(it.isLink ? 'historie.udalost.odkaz' : 'historie.udalost.priloha', { nazev: it.name });
    }
    if (it.kind === 'rule') {
      const klic = it.status === 'ok' ? 'pravidloOk' : it.status === 'failed' ? 'pravidloFailed' : 'pravidloSkipped';
      return t(`historie.udalost.${klic}`, { nazev: it.name });
    }
    const f = it.field;
    if (f === 'created' || f === 'deleted') return t(`historie.udalost.${f}`);
    if (f === 'status') {
      return it.from
        ? t('historie.udalost.status', { z: stavLabel(it.from), na: stavLabel(it.to) })
        : t('historie.udalost.statusNovy', { na: stavLabel(it.to) });
    }
    if (f === 'deadline') {
      if (!it.to) return t('historie.udalost.deadlineZrusen');
      if (!it.from) return t('historie.udalost.deadlineNovy', { na: formatDeadline(it.to) });
      return t('historie.udalost.deadline', { z: formatDeadline(it.from), na: formatDeadline(it.to) });
    }
    if (f === 'owner') {
      if (!it.to) return t('historie.udalost.ownerZrusen');
      if (!it.from) return t('historie.udalost.ownerNovy', { na: it.to });
      return t('historie.udalost.owner', { z: it.from, na: it.to });
    }
    if (f === 'title' || f === 'parent') {
      return t(`historie.udalost.${f}`, {
        z: it.from || t('historie.prazdnaHodnota'),
        na: it.to || t('historie.prazdnaHodnota'),
      });
    }
    if (t(`historie.udalost.${f}`) !== `historie.udalost.${f}`) return t(`historie.udalost.${f}`);
    return t('historie.udalost.neznama');
  };

  const ikonaPro = (it) => IKONY[it.kind === 'change' ? it.field : it.kind] || History;
  const barvaPro = (it) => BARVY[it.kind === 'change' ? it.field : it.kind] || 'text-muted-foreground';

  const items = data?.items || [];

  return (
    <div className="space-y-3" data-section="historie">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <History className="w-4 h-4" />
        {t('historie.nadpis')}
      </div>
      <p className="text-xs text-muted-foreground">{t('historie.popis')}</p>

      {loading && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />{t('historie.nacitam')}
        </p>
      )}
      {!loading && failed && <p className="text-sm text-destructive">{t('historie.chyba')}</p>}
      {!loading && !failed && items.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('historie.prazdno')}</p>
      )}

      {!loading && !failed && items.length > 0 && (
        <ol className="space-y-2" data-historie-seznam>
          {items.map((it, i) => {
            const Ikona = ikonaPro(it);
            return (
              <li key={`${it.when}-${i}`} className="flex items-start gap-2.5 rounded-lg border p-2.5" data-historie-radek>
                <Ikona className={`w-4 h-4 mt-0.5 shrink-0 ${barvaPro(it)}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm break-words">{popis(it)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    <time dateTime={it.when} data-historie-cas>{kdy(it.when)}</time>
                    {' · '}{kdoLabel(it)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {data?.truncated && <p className="text-xs text-muted-foreground">{t('historie.oriznuto')}</p>}
    </div>
  );
}
