import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLazyNs } from '@/i18n/lazyNs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Columns3, ArrowRight, Loader2 } from 'lucide-react';
import OwnerSelect from '@/components/OwnerSelect';
import { useToast } from '@/components/ui/use-toast';
import { rulesApi } from './rulesApi';

const selectCls = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm';

// Průvodce „Zapnout kanban na této řadě" (Richard 14. 8. 2026): stálá mapa
// (8D/FMEA), sloupce = sourozenci v jedné řadě, karty putují doprava. Průvodce
// je JEN ZAKLADAČ — vyrobí N−1 obyčejných pravidel („Kanban: D1 → D2":
// dokončeno pod D1 → přesuň pod D2 + předej člověku sloupce + vrať na
// Založeno), která pak žijí v přehledu pravidel jako každá jiná. Žádný nový
// koncept v datech mapy.
export default function KanbanWizard({ mapId, nodes = [], edges = [], members, mapAccess, onShareAdd, onContactsChanged, existingRules = [], maxRules = 50, defaultNodeId, onDone, onCancel }) {
  const { t } = useTranslation(['rules', 'editor']);
  const nsReady = useLazyNs('rules');
  const { toast } = useToast();
  const [seed, setSeed] = useState(defaultNodeId || '');
  const [owners, setOwners] = useState({}); // id cílového sloupce → e-mail (volitelné)
  const [saving, setSaving] = useState(false);

  const titleOf = (n) => n?.data?.title || n?.id;
  const nodeOptions = nodes.filter((n) => n.type !== 'note' && n.type !== 'apexNode');

  // Řada = sourozenci vybraného sloupce (děti téhož rodiče, bez poznámek),
  // v pořadí čtení. Pořadí se bere z pozic — po opravě zarovnání odpovídá
  // pořadí hran; u ručně rozmístěné mapy platí to, co uživatel VIDÍ.
  const row = useMemo(() => {
    if (!seed) return [];
    const par = edges.find((e) => e.target === seed)?.source;
    if (!par) return [];
    return edges
      .filter((e) => e.source === par)
      .map((e) => nodes.find((n) => n.id === e.target))
      .filter((n) => n && n.type !== 'note')
      .sort((a, b) => ((a.position?.x || 0) - (b.position?.x || 0)) || ((a.position?.y || 0) - (b.position?.y || 0)));
  }, [seed, nodes, edges]);

  const rulesNeeded = Math.max(0, row.length - 1);
  const overLimit = existingRules.length + rulesNeeded > maxRules;
  // druhé „Zapnout kanban" na téže řadě by pravidla ZDVOJILO (posun je díky
  // noop neškodný, ale přehled se zaneřádí a předání osoby jede dvakrát)
  const rowIds = new Set(row.map((n) => n.id));
  const uzZapnuto = existingRules.some((r) => r.enabled
    && (r.actions || []).some((a) => a.type === 'move_node')
    && (r.conditions || []).some((c) => c.field === 'parent' && rowIds.has(c.value)));

  const handleCreate = async () => {
    if (saving || rulesNeeded < 1 || overLimit) return;
    setSaving(true);
    const made = [];
    try {
      for (let i = 0; i < row.length - 1; i++) {
        const from = row[i];
        const to = row[i + 1];
        const actions = [{ type: 'move_node', to: to.id }];
        if (owners[to.id]) actions.push({ type: 'set_owner', owner: owners[to.id] });
        actions.push({ type: 'set_status', status: 'todo' });
        made.push(await rulesApi.save({
          map: mapId,
          name: t('rules.kanban.ruleName', { from: titleOf(from), to: titleOf(to) }).slice(0, 120),
          trigger: { type: 'node_status_changed', status: 'done' },
          conditions: [{ field: 'parent', op: 'eq', value: from.id }],
          actions,
        }));
      }
      toast({ title: t('rules.kanban.created', { count: made.length }) });
      onDone?.(made);
    } catch (e) {
      // co už vzniklo, zůstává (vidět v přehledu, jde smazat) — přiznat důvod
      toast({ title: t('rules.saveFailed'), description: e?.response?.error || e?.message, variant: 'destructive' });
      if (made.length) onDone?.(made);
    }
    setSaving(false);
  };

  if (!nsReady) return null;
  return (
    <div className="space-y-4" data-testid="kanban-wizard">
      <p className="text-xs text-muted-foreground">{t('rules.kanban.hint')}</p>
      <div className="space-y-2">
        <Label htmlFor="kanban-seed">{t('rules.kanban.pickRow')}</Label>
        <select id="kanban-seed" className={selectCls} value={seed} onChange={(e) => setSeed(e.target.value)} data-testid="kanban-seed">
          <option value="">{t('rules.kanban.pickRowPlaceholder')}</option>
          {nodeOptions.map((n) => <option key={n.id} value={n.id}>{titleOf(n)}</option>)}
        </select>
      </div>
      {seed && row.length < 2 && (
        <p className="text-xs text-amber-600 dark:text-amber-500">{t('rules.kanban.notEnough')}</p>
      )}
      {row.length >= 2 && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">{t('rules.kanban.ownersHint')}</p>
          {row.slice(1).map((to, i) => (
            <div key={to.id} className="flex flex-wrap items-center gap-2" data-testid="kanban-step">
              <span className="text-sm min-w-0 truncate flex items-center gap-1.5">
                <span className="truncate max-w-40">{titleOf(row[i])}</span>
                <ArrowRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate max-w-40 font-medium">{titleOf(to)}</span>
              </span>
              <div className="w-64 ml-auto">
                <OwnerSelect id={`kanban-owner-${to.id}`} value={owners[to.id] || ''}
                  onChange={(v) => setOwners((p) => ({ ...p, [to.id]: v }))}
                  mapAccess={mapAccess} members={members} onShareAdd={onShareAdd} onContactsChanged={onContactsChanged} />
              </div>
            </div>
          ))}
        </div>
      )}
      {uzZapnuto && (
        <p className="text-xs text-amber-600 dark:text-amber-500" data-testid="kanban-dup-warn">{t('rules.kanban.alreadyWarn')}</p>
      )}
      {overLimit && (
        <p className="text-xs text-destructive">{t('rules.kanban.limitWarn', { max: maxRules })}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>{t('common:actions.cancel')}</Button>
        <Button onClick={handleCreate} disabled={rulesNeeded < 1 || overLimit || saving} data-testid="kanban-create">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Columns3 className="w-4 h-4" />}
          {t('rules.kanban.create', { count: rulesNeeded })}
        </Button>
      </div>
    </div>
  );
}
