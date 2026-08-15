import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLazyNs } from '@/i18n/lazyNs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Zap, Plus, Pencil, Trash2, AlertTriangle, History, Loader2, BookmarkPlus, LayoutTemplate, Columns3 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { rulesApi } from './rulesApi';
import RuleBuilder from './RuleBuilder';
import KanbanWizard from './KanbanWizard';

// lidský souhrn triggeru do řádku seznamu
function triggerSummary(t, trig) {
  const type = trig?.type || '?';
  let s = t(`rules.triggers.${type}`);
  if (type === 'node_status_changed' && trig.status) {
    s += ` (${t(`common:status.${trig.status === 'in_progress' ? 'inProgress' : trig.status}`)})`;
  }
  if (type === 'deadline_approaching') s += ` (${trig.when === 'overdue' ? t('rules.dlOverdue') : t('rules.dlBefore')} ${trig.days ?? 1} ${t('rules.days')})`;
  if (type === 'schedule') s += ` (${trig.freq === 'weekly' ? t(`rules.weekday${trig.weekday || 1}`) : t('rules.daily')})`;
  return s;
}

// Přehled VŠECH pravidel mapy — otevírá blesk na liště mapy (jen editor).
// Domov mapových/časových triggerů; z okna uzlu sem vede odkaz. Součást
// dialogu je i log běhů (rule_runs) — přiznané skipped/failed řádky.
export default function RulesDialog({ open, mapId, nodes, edges, members, mapAccess, onShareAdd, onContactsChanged, defaults, onClose, onRulesChanged, onEnableWaiting }) {
  const { t } = useTranslation(['rules', 'editor']);
  const nsReady = useLazyNs('rules');
  const { toast } = useToast();
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);   // null = seznam; {} = nové; rule = editace
  // předvolby builderu: propojka (uzel/Chování) je předá jen PRVNÍMU automaticky
  // otevřenému builderu; ruční „+ Nové pravidlo" v přehledu trigger nedědí
  const [builderDefaults, setBuilderDefaults] = useState({});
  const [runsFor, setRunsFor] = useState(null);   // null = log skrytý; '' = celá mapa; id = pravidlo
  const [runs, setRuns] = useState([]);
  // šablony pravidel: null = panel skrytý; [] = načteno (Richard 14. 8.:
  // „chci mít pravidlo jako šablonu a tu si načíst v dané mapě")
  const [templates, setTemplates] = useState(null);
  // průvodce „Zapnout kanban na řadě" — zakladač N−1 pravidel posunu
  const [wizard, setWizard] = useState(false);

  const reload = useCallback(() => {
    if (!mapId) return;
    setLoading(true);
    rulesApi.list(mapId)
      .then((r) => { setRules(r); onRulesChanged?.(r); })
      .catch(() => setRules([]))
      .finally(() => setLoading(false));
  }, [mapId, onRulesChanged]);
  useEffect(() => {
    if (open) {
      setBuilderDefaults({ node_id: defaults?.node_id || '', trigger_type: defaults?.trigger_type || '' });
      setEditing(defaults?.openNew ? {} : null);
      setWizard(!!defaults?.openKanban);
      // panel uzlu umí otevřít dialog ROVNOU s logem ('' = celá mapa, id = pravidlo)
      setRunsFor(defaults?.showRunsRule === undefined ? null : defaults.showRunsRule);
      reload();
    }
  }, [open, reload, defaults?.openNew, defaults?.node_id, defaults?.trigger_type, defaults?.showRunsRule, defaults?.openKanban]);
  useEffect(() => {
    if (runsFor === null || !mapId) { setRuns([]); return; }
    rulesApi.runs(mapId, runsFor || undefined).then(setRuns).catch(() => setRuns([]));
  }, [runsFor, mapId]);

  const handleToggle = async (rule, enabled) => {
    try {
      await rulesApi.toggle(mapId, rule.id, enabled);
      reload();
    } catch (e) {
      toast({ title: t('rules.saveFailed'), description: e?.response?.error || e?.message, variant: 'destructive' });
    }
  };
  const handleDelete = async (rule) => {
    if (!window.confirm(t('rules.confirmDelete', { name: rule.name }))) return;
    try {
      await rulesApi.remove(rule.id);
      reload();
    } catch (e) {
      toast({ title: t('rules.deleteFailed'), variant: 'destructive' });
    }
  };
  // pravidlo → knihovna šablon: ukládá se TVAR (bez mapy a bez scope uzlu)
  const handleSaveAsTemplate = async (rule) => {
    try {
      await rulesApi.templateSave({ name: rule.name, trigger: rule.trigger, conditions: rule.conditions, actions: rule.actions });
      toast({ title: t('rules.templateSaved', { name: rule.name }) });
      if (templates !== null) rulesApi.templates().then(setTemplates).catch(() => {});
    } catch (e) {
      toast({ title: t('rules.templateSaveFailed'), description: e?.response?.error || e?.message, variant: 'destructive' });
    }
  };
  const toggleTemplates = () => {
    if (templates !== null) { setTemplates(null); return; }
    rulesApi.templates().then(setTemplates).catch(() => setTemplates([]));
  };
  const handleDeleteTemplate = async (tpl) => {
    if (!window.confirm(t('rules.confirmDeleteTemplate', { name: tpl.name }))) return;
    try {
      await rulesApi.templateRemove(tpl.id);
      rulesApi.templates().then(setTemplates).catch(() => {});
    } catch (e) {
      // smí jen autor nebo admin — důvod ze serveru doslova
      toast({ title: t('rules.templateDeleteFailed'), description: e?.response?.error || e?.message, variant: 'destructive' });
    }
  };

  if (!nsReady) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl flex flex-col max-h-[90dvh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-4 h-4" /> {t('rules.dialogTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
          {wizard ? (
            <KanbanWizard
              mapId={mapId}
              nodes={nodes}
              edges={edges}
              members={members}
              mapAccess={mapAccess}
              onShareAdd={onShareAdd}
              onContactsChanged={onContactsChanged}
              existingRules={rules}
              defaultNodeId={builderDefaults.node_id}
              onDone={() => { setWizard(false); reload(); }}
              onCancel={() => setWizard(false)}
            />
          ) : editing !== null ? (
            <RuleBuilder
              mapId={mapId}
              nodes={nodes}
              members={members}
              mapAccess={mapAccess}
              onShareAdd={onShareAdd}
              onContactsChanged={onContactsChanged}
              rule={editing.id ? editing : null}
              defaults={editing.id ? {} : builderDefaults}
              onSaved={() => { setEditing(null); reload(); }}
              onCancel={() => setEditing(null)}
              onEnableWaiting={onEnableWaiting}
            />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">{t('rules.dialogHint')}</p>
                <div className="flex gap-2 shrink-0">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setWizard(true)} data-testid="rules-kanban">
                    <Columns3 className="w-4 h-4" /> {t('rules.kanban.button')}
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={toggleTemplates} data-testid="rules-templates">
                    <LayoutTemplate className="w-4 h-4" /> {t('rules.fromTemplate')}
                  </Button>
                  <Button size="sm" className="gap-1.5" onClick={() => { setBuilderDefaults((p) => ({ node_id: p.node_id || '' })); setEditing({}); }} data-testid="rules-new">
                    <Plus className="w-4 h-4" /> {t('rules.newRule')}
                  </Button>
                </div>
              </div>
              {templates !== null && (
                <div className="rounded-lg border p-3 space-y-2" data-testid="templates-panel">
                  <p className="text-xs text-muted-foreground">{t('rules.templatesHint')}</p>
                  {templates.length === 0 && <p className="text-sm text-muted-foreground">{t('rules.templatesEmpty')}</p>}
                  {templates.map((tpl) => (
                    <div key={tpl.id} className="flex items-center gap-2 text-sm" data-testid="template-row">
                      <span className="flex-1 min-w-0 truncate">
                        {tpl.name}
                        <span className="text-xs text-muted-foreground"> — {t('rules.rowWhen')} {triggerSummary(t, tpl.trigger)} · {t('rules.rowDo')} {(tpl.actions || []).map((a) => t(`rules.actions.${a.type}`)).join(', ')}</span>
                      </span>
                      <Button variant="outline" size="sm" className="shrink-0" data-testid="template-load"
                        onClick={() => { setBuilderDefaults((p) => ({ node_id: p.node_id || '', template: tpl })); setEditing({}); }}>
                        {t('rules.loadTemplate')}
                      </Button>
                      <button className="text-muted-foreground hover:text-destructive p-1 shrink-0" onClick={() => handleDeleteTemplate(tpl)} title={t('rules.templateDeleteTitle')}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
              {!loading && rules.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('rules.empty')}</p>
              )}
              {rules.map((r) => (
                <div key={r.id} className="rounded-lg border p-3 space-y-1.5" data-testid="rule-row">
                  <div className="flex items-center gap-2">
                    <Switch checked={r.enabled} onCheckedChange={(v) => handleToggle(r, v)} title={t('rules.toggleTitle')} />
                    <span className="flex-1 min-w-0 truncate text-sm font-medium">{r.name}</span>
                    <button className="text-muted-foreground hover:text-primary p-1" onClick={() => handleSaveAsTemplate(r)} title={t('rules.saveAsTemplate')} data-testid="rule-save-template">
                      <BookmarkPlus className="w-3.5 h-3.5" />
                    </button>
                    <button className="text-muted-foreground hover:text-primary p-1" onClick={() => setRunsFor(r.id)} title={t('rules.runsTitle')}>
                      <History className="w-3.5 h-3.5" />
                    </button>
                    <button className="text-muted-foreground hover:text-primary p-1" onClick={() => setEditing(r)} title={t('common:actions.edit')}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button className="text-muted-foreground hover:text-destructive p-1" onClick={() => handleDelete(r)} title={t('rules.deleteTitle')}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('rules.rowWhen')} {triggerSummary(t, r.trigger)}
                    {r.node_id ? ` · ${t('rules.rowNode')} ${(nodes.find((n) => n.id === r.node_id)?.data?.title) || r.node_id}` : ''}
                    {' · '}{t('rules.rowDo')} {(r.actions || []).map((a) => t(`rules.actions.${a.type}`)).join(', ')}
                  </p>
                  {r.last_error && (
                    <p className="text-xs text-amber-600 dark:text-amber-500 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {t('rules.lastError', { error: r.last_error })}
                    </p>
                  )}
                </div>
              ))}
              <div className="pt-1">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setRunsFor(runsFor === null ? '' : null)}>
                  <History className="w-3.5 h-3.5" /> {runsFor === null ? t('rules.showRuns') : t('rules.hideRuns')}
                </Button>
              </div>
              {runsFor !== null && (
                <div className="rounded-lg border divide-y" data-testid="rule-runs">
                  {runs.length === 0 && <p className="p-2.5 text-xs text-muted-foreground">{t('rules.noRuns')}</p>}
                  {runs.map((run) => (
                    <div key={run.id} className="px-2.5 py-1.5 text-xs flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${
                        run.status === 'ok' ? 'bg-green-500' : run.status === 'failed' ? 'bg-red-500' : 'bg-amber-500'
                      }`} title={run.status} />
                      <span className="flex-1 min-w-0 truncate">
                        {run.rule_name || '—'}{run.node_title ? ` · ${run.node_title}` : ''}
                        {run.status !== 'ok' && run.detail ? ` — ${run.detail}` : run.detail ? ` → ${run.detail}` : ''}
                      </span>
                      <span className="text-muted-foreground shrink-0">{String(run.created || '').slice(0, 16)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
