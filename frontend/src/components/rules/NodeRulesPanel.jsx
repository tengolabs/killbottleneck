import { useTranslation } from 'react-i18next';
import { useLazyNs } from '@/i18n/lazyNs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Zap, Plus, AlertTriangle, History } from 'lucide-react';

// Pravidla týkající se JEDNOHO uzlu — obsah kategorie „Vykonavatel a
// automatizace" ve velkém okně uzlu (druhá kontextová cesta k pravidlům;
// hlavní přehled má blesk na liště mapy). Zakládání/editace se dějí
// v RulesDialog — tady jen výběr toho, co se váže k uzlu.
export default function NodeRulesPanel({ rules = [], nodeId, onOpenRules }) {
  const { t } = useTranslation(['rules', 'editor']);
  const nsReady = useLazyNs('rules');
  // Celomapové pravidlo (bez scope) na tenhle uzel míří TAKY — musí tu být
  // vidět, jinak „vytvořil jsem pravidlo a v uzlu ho nevidím" (nález Richarda
  // 14. 8. 2026 při klik-testu). Odlišuje ho štítek „celá mapa".
  const mine = rules.filter((r) => !r.node_id || r.node_id === nodeId);
  if (!nsReady) return null;
  return (
    <div className="rounded-lg border p-3 space-y-2" data-testid="node-rules-panel">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5" /> {t('rules.nodePanelTitle')}
        </Label>
        <Button variant="outline" size="sm" className="gap-1 shrink-0" onClick={() => onOpenRules?.(nodeId, true)} data-testid="node-rules-new">
          <Plus className="w-3.5 h-3.5" /> {t('rules.newRule')}
        </Button>
      </div>
      {mine.length === 0 && <p className="text-xs text-muted-foreground">{t('rules.nodePanelEmpty')}</p>}
      {mine.map((r) => (
        <div key={r.id} className="text-xs flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${r.enabled ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
          <span className="flex-1 min-w-0 truncate">{r.name}</span>
          {!r.node_id && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t('rules.wholeMapTag')}</span>
          )}
          {r.last_error && <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" title={r.last_error} />}
          {/* log běhů PŘÍMO z uzlu — bez něj se k němu člověk musel „prokopat"
              přes celomapový přehled (nález Richarda 15. 8.) */}
          <button
            type="button"
            className="shrink-0 text-muted-foreground hover:text-primary p-0.5"
            title={t('rules.runsTitle')}
            data-testid={`node-rule-runs-${r.id}`}
            onClick={() => onOpenRules?.(nodeId, false, undefined, r.id)}
          >
            <History className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-3">
        {/* kanban se zapíná z uzlu ŘADY (sloupce) — průvodce si řadu dopočítá */}
        <button type="button" className="text-xs underline text-muted-foreground hover:text-foreground" onClick={() => onOpenRules?.(nodeId, false, undefined, undefined, true)} data-testid="node-rules-kanban">
          {t('rules.kanban.button')}
        </button>
        <button type="button" className="text-xs underline text-muted-foreground hover:text-foreground" onClick={() => onOpenRules?.('', false)}>
          {t('rules.allMapRules')}
        </button>
        <button type="button" className="text-xs underline text-muted-foreground hover:text-foreground" onClick={() => onOpenRules?.('', false, undefined, '')} data-testid="node-rules-runs">
          {t('rules.showRuns')}
        </button>
      </div>
    </div>
  );
}
