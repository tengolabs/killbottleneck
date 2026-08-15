import { useTranslation } from 'react-i18next';
import { useLazyNs } from '@/i18n/lazyNs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Zap, Plus, AlertTriangle } from 'lucide-react';

// Propojka „Čekat na podřízené" ↔ pravidla (nález Richarda 14. 8. 2026:
// obě věci spolu souvisí, ale v UI to nebylo vidět). Bydlí v kategorii
// Chování POD přepínačem čekání: ukazuje pravidla se spouštěčem „uzel se
// odblokuje", která na uzel míří (scoped i celomapová), a nabízí založit
// nové s předvyplněným spouštěčem i uzlem.
export default function UnblockRulesHint({ rules = [], nodeId, onOpenRules }) {
  const { t } = useTranslation(['rules', 'editor']);
  const nsReady = useLazyNs('rules');
  const mine = rules.filter((r) => r.trigger?.type === 'node_unblocked' && (!r.node_id || r.node_id === nodeId));
  if (!nsReady) return null;
  return (
    <div className="rounded-lg border p-3 space-y-2" data-testid="wait-rules-hint">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5" /> {t('rules.afterUnblockTitle')}
        </Label>
        <Button variant="outline" size="sm" className="gap-1 shrink-0" onClick={() => onOpenRules?.(nodeId, true, 'node_unblocked')} data-testid="wait-rules-new">
          <Plus className="w-3.5 h-3.5" /> {t('rules.afterUnblockNew')}
        </Button>
      </div>
      {mine.length === 0 && <p className="text-xs text-muted-foreground">{t('rules.afterUnblockEmpty')}</p>}
      {mine.map((r) => (
        <div key={r.id} className="text-xs flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${r.enabled ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
          <span className="flex-1 min-w-0 truncate">{r.name}</span>
          {!r.node_id && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t('rules.wholeMapTag')}</span>
          )}
          {r.last_error && <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" title={r.last_error} />}
        </div>
      ))}
    </div>
  );
}
