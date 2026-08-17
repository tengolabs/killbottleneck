import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLazyNs } from '@/i18n/lazyNs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, ArrowUp, ArrowDown, Zap, Loader2 } from 'lucide-react';
import DatePicker from '@/components/DatePicker';
import OwnerSelect from '@/components/OwnerSelect';
import { base44 } from '@/api/base44Client';
import { pb } from '@/api/pb';
import { useToast } from '@/components/ui/use-toast';
import { rulesApi, parseOutline, outlineToText } from './rulesApi';

// dynamický cíl = rozřeší se až za běhu pravidla (zástupce / pozice org struktury)
const isDynamicTarget = (v) => v === 'deputy_of_node_owner'
  || String(v || '').startsWith('position:') || String(v || '').startsWith('deputy_of_position:');

// Skladač pravidla „KDYŽ (trigger) → POKUD (AND podmínky) → UDĚLEJ (akce)".
// Výčty a limity drží server (validateRuleInput) — builder nabízí totéž a chybu
// serveru ukáže doslova. Žádný měsíční metr na běhy neexistuje (závazné).
const TRIGGERS = ['node_status_changed', 'node_unblocked', 'deadline_approaching', 'node_created', 'file_uploaded', 'schedule'];
const ACTIONS = ['set_status', 'set_owner', 'set_deadline', 'move_node', 'create_subnodes', 'notify', 'run_agent'];
const COND_FIELDS = ['status', 'owner', 'deadline', 'executor_kind', 'parent'];
const COND_OPS = ['eq', 'ne', 'empty', 'not_empty', 'before', 'after'];
// podmínka „nadřazený uzel" (kanban: karta POD sloupcem) umí jen je/není
const OPS_FOR = (field) => (field === 'parent' ? ['eq', 'ne'] : COND_OPS);
const STATUSES = ['todo', 'in_progress', 'done'];

const selectCls = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm';

// Šablonka pod-uzlů z API/MCP může nést i owner/deadline/status/... nebo
// explicitní parent — outline textarea umí jen tituly. Takovou akci needitujeme
// destruktivně: dokud uživatel text nezmění, uloží se PŮVODNÍ items i parent.
const subnodesRich = (a) => (a.parent && a.parent !== 'trigger_node')
  || (a.items || []).some((it) => Object.keys(it || {}).some((k) => k !== 'title' && k !== 'children'));
const withOutline = (a) => (a.type === 'create_subnodes'
  ? { ...a, _outline: outlineToText(a.items), _origItems: a.items, _origParent: a.parent, _rich: subnodesRich(a) }
  : a);

export default function RuleBuilder({ mapId, nodes = [], members = [], mapAccess, onShareAdd, onContactsChanged, rule, defaults = {}, onSaved, onCancel, onEnableWaiting }) {
  const { t } = useTranslation(['rules', 'editor']);
  const nsReady = useLazyNs('rules');
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [trigger, setTrigger] = useState({ type: 'node_status_changed' });
  const [conds, setConds] = useState([]);
  const [actions, setActions] = useState([{ type: 'notify', to: 'map_owner', message: '' }]);
  const [saving, setSaving] = useState(false);
  const [fixWait, setFixWait] = useState(true);
  const [agents, setAgents] = useState([]);
  useEffect(() => {
    base44.aiAgents.list().then(setAgents).catch(() => setAgents([]));
  }, []);
  // pozice org struktury pro dynamické cíle (prázdné = struktura neexistuje)
  const [orgPositions, setOrgPositions] = useState([]);
  useEffect(() => {
    pb.send('/api/kb/org-structure', { method: 'GET' })
      .then((res) => setOrgPositions(res.positions || []))
      .catch(() => setOrgPositions([]));
  }, []);
  const positionLabel = (r) => r.title || r.node_id;
  // uložené pravidlo může odkazovat pozici, která už neexistuje (nebo /org-structure
  // selhal) — select bez odpovídající option by TIŠE ukázal první volbu; přiznat
  const positionKnown = (v) => v === 'deputy_of_node_owner'
    || orgPositions.some((r) => v === `position:${r.node_id}` || v === `deputy_of_position:${r.node_id}`);
  const dynFallbackOption = (v) => (isDynamicTarget(v) && !positionKnown(v)
    ? <option value={v}>{t('rules.unknownPosition')}</option> : null);
  const positionOptGroups = orgPositions.length > 0 && (
    <>
      <optgroup label={t('rules.grpPositionHolder')}>
        {orgPositions.map((r) => <option key={`p-${r.node_id}`} value={`position:${r.node_id}`}>{positionLabel(r)}</option>)}
      </optgroup>
      <optgroup label={t('rules.grpPositionDeputy')}>
        {orgPositions.map((r) => <option key={`d-${r.node_id}`} value={`deputy_of_position:${r.node_id}`}>{positionLabel(r)}</option>)}
      </optgroup>
    </>
  );
  useEffect(() => {
    if (rule) {
      setName(rule.name || '');
      setNodeId(rule.node_id || '');
      setTrigger(rule.trigger || { type: 'node_status_changed' });
      setConds(rule.conditions || []);
      setActions((rule.actions || []).map(withOutline));
    } else if (defaults.template) {
      // „Ze šablony": předvyplnit obsah šablony — uložením vznikne v mapě
      // OBYČEJNÉ pravidlo (kopie), šablona zůstává v knihovně beze změny
      const tpl = defaults.template;
      setName(tpl.name || '');
      setNodeId(defaults.node_id || '');
      setTrigger(tpl.trigger || { type: 'node_status_changed' });
      setConds(tpl.conditions || []);
      setActions((tpl.actions || []).map(withOutline));
    } else {
      setName('');
      setNodeId(defaults.node_id || '');
      // trigger_type: propojka z kategorie Chování přednastaví „po odblokování"
      setTrigger({ type: defaults.trigger_type || 'node_status_changed' });
      setConds([]);
      setActions([{ type: 'notify', to: 'map_owner', message: '' }]);
    }
    setFixWait(true);
  }, [rule, defaults.node_id, defaults.trigger_type, defaults.template]);

  // uzly mapy pro scope/parent výběr (bez poznámek; vrchol jen jako parent nedává smysl)
  const nodeOptions = nodes.filter((n) => n.type !== 'note' && n.type !== 'apexNode')
    .map((n) => ({ id: n.id, title: n.data?.title || n.id }));

  const setAct = (i, patch) => setActions((prev) => prev.map((a, x) => (x === i ? { ...a, ...patch } : a)));
  // CÍL AKCE u setrů: tento uzel (default) / nadřazený / konkrétní uzel mapy —
  // „když D2 bude hotovo, samo to změní uzel NAD na probíhá" (Richard 15. 8.)
  const targetSelect = (a, i) => (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground shrink-0">{t('rules.onNode')}</span>
      <select className={selectCls} value={a.target || 'trigger_node'} data-testid={`rule-target-${i}`}
        onChange={(e) => setAct(i, { target: e.target.value === 'trigger_node' ? undefined : e.target.value })}>
        <option value="trigger_node">{t('rules.targetTrigger')}</option>
        <option value="parent">{t('rules.targetParent')}</option>
        {nodeOptions.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
      </select>
    </div>
  );
  const moveAct = (i, dir) => setActions((prev) => {
    const next = prev.slice();
    const j = i + dir;
    if (j < 0 || j >= next.length) return prev;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const body = {
        map: mapId,
        id: rule?.id,
        name,
        node_id: nodeId,
        trigger,
        conditions: conds,
        actions: actions.map((a) => {
          if (a.type !== 'create_subnodes') { const { _outline, ...rest } = a; return rest; }
          // outline needitovaný → pošli původní bohatá pole i parent beze změny
          if (a._origItems && a._outline === outlineToText(a._origItems)) {
            return { type: a.type, parent: a._origParent || 'trigger_node', items: a._origItems };
          }
          return { type: a.type, parent: 'trigger_node', items: parseOutline(a._outline) };
        }),
        enabled: rule ? rule.enabled : true,
      };
      const saved = await rulesApi.save(body);
      // slíbená náprava z varování: uzel bez čekání by pravidlo „po odblokování"
      // nikdy nespustil — zapne se standardní cestou editoru (autosave)
      if (fixWait && onEnableWaiting && trigger.type === 'node_unblocked' && nodeId
        && !(nodes.find((n) => n.id === nodeId)?.data?.waitForChildren)) {
        onEnableWaiting(nodeId);
      }
      toast({ title: t(rule ? 'rules.saved' : 'rules.created') });
      onSaved?.(saved);
    } catch (e) {
      // důvod ze serveru doslova — validace je tam (jedna pravda o tvaru)
      toast({ title: t('rules.saveFailed'), description: e?.response?.error || e?.message, variant: 'destructive' });
    }
    setSaving(false);
  };

  const trigType = trigger.type || 'node_status_changed';

  if (!nsReady) return null;
  return (
    <div className="space-y-4" data-testid="rule-builder">
      <div className="space-y-2">
        <Label htmlFor="rule-name">{t('rules.nameLabel')}</Label>
        <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('rules.namePlaceholder')} maxLength={120} />
      </div>

      <div className="space-y-2 rounded-lg border p-3">
        <Label className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" /> {t('rules.whenLabel')}</Label>
        <select className={selectCls} value={trigType} onChange={(e) => setTrigger({ type: e.target.value })} data-testid="rule-trigger">
          {TRIGGERS.map((tr) => <option key={tr} value={tr}>{t(`rules.triggers.${tr}`)}</option>)}
        </select>
        {trigType === 'node_status_changed' && (
          <select className={selectCls} value={trigger.status || ''} onChange={(e) => setTrigger({ type: trigType, ...(e.target.value ? { status: e.target.value } : {}) })}>
            <option value="">{t('rules.anyStatusChange')}</option>
            {STATUSES.map((st) => <option key={st} value={st}>{t(`rules.statusTo`, { status: t(`common:status.${st === 'in_progress' ? 'inProgress' : st}`) })}</option>)}
          </select>
        )}
        {trigType === 'deadline_approaching' && (
          <div className="space-y-1">
            <div className="flex gap-2">
              <select className={selectCls} value={trigger.when || 'before'} onChange={(e) => setTrigger({ ...trigger, type: trigType, when: e.target.value })}>
                <option value="before">{t('rules.dlBefore')}</option>
                <option value="overdue">{t('rules.dlOverdue')}</option>
              </select>
              <Input type="number" min={0} max={365} className="w-24" value={trigger.days ?? 1}
                onChange={(e) => setTrigger({ ...trigger, type: trigType, days: Math.max(0, Math.min(365, parseInt(e.target.value, 10) || 0)) })} />
              <span className="self-center text-sm text-muted-foreground">{t('rules.days')}</span>
            </div>
            {/* „nic se nestalo" z Richardova klik-testu: termínové spouštěče
                nejedou hned při uložení — říct to rovnou u formuláře */}
            <p className="text-xs text-muted-foreground">{t('rules.dlEvalHint')}</p>
          </div>
        )}
        {trigType === 'schedule' && (
          <div className="flex flex-wrap gap-2">
            <select className={`${selectCls} w-auto`} value={trigger.freq || 'daily'} onChange={(e) => setTrigger({ type: trigType, freq: e.target.value, hour: trigger.hour, ...(e.target.value === 'weekly' ? { weekday: trigger.weekday || 1 } : {}) })}>
              <option value="daily">{t('rules.daily')}</option>
              <option value="weekly">{t('rules.weekly')}</option>
            </select>
            {trigger.freq === 'weekly' && (
              <select className={`${selectCls} w-auto`} value={trigger.weekday || 1} onChange={(e) => setTrigger({ ...trigger, type: trigType, weekday: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{t(`rules.weekday${d}`)}</option>)}
              </select>
            )}
            <div className="flex items-center gap-1.5">
              <Input type="number" min={0} max={23} className="w-20" value={trigger.hour ?? 5}
                onChange={(e) => setTrigger({ ...trigger, type: trigType, hour: Math.max(0, Math.min(23, parseInt(e.target.value, 10) || 0)) })} />
              <span className="text-sm text-muted-foreground">{t('rules.hourHint')}</span>
            </div>
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('rules.scopeLabel')}</Label>
          <select className={selectCls} value={nodeId} onChange={(e) => setNodeId(e.target.value)} data-testid="rule-scope">
            <option value="">{t('rules.scopeWholeMap')}</option>
            {nodeOptions.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
          </select>
        </div>
        {/* „Po odblokování" stojí na přepínači „Čekat na podřízené" (kategorie
            Chování) — pravidlo na uzlu bez něj by se TIŠE nikdy nespustilo
            (nález Richarda 14. 8.). Výchozí náprava: zapnout čekání s uložením. */}
        {trigType === 'node_unblocked' && nodeId
          && !(nodes.find((n) => n.id === nodeId)?.data?.waitForChildren) && (
          <div className="rounded-md border border-amber-300/60 bg-amber-500/5 p-2 space-y-1.5" data-testid="rule-wait-warn">
            <p className="text-xs text-amber-700 dark:text-amber-400">{t('rules.waitMissingWarn')}</p>
            {onEnableWaiting && (
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={fixWait} onChange={(e) => setFixWait(e.target.checked)} />
                {t('rules.waitMissingFix')}
              </label>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-lg border p-3">
        <div className="flex items-center justify-between">
          <Label>{t('rules.ifLabel')}</Label>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => setConds((p) => [...p, { field: 'status', op: 'eq', value: 'done' }])}>
            <Plus className="w-3.5 h-3.5" /> {t('rules.addCondition')}
          </Button>
        </div>
        {conds.length === 0 && <p className="text-xs text-muted-foreground">{t('rules.noConditions')}</p>}
        {conds.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select className={`${selectCls} w-auto`} value={c.field} onChange={(e) => {
              const field = e.target.value;
              // přepnutí pole nesmí nechat nekompatibilní operátor/hodnotu;
              // u selectů s výchozí volbou musí hodnota odpovídat tomu, co je vidět
              const value = field === 'status' ? 'todo' : field === 'executor_kind' ? 'human' : '';
              setConds((p) => p.map((x, xi) => (xi === i
                ? { field, op: OPS_FOR(field).includes(x.op) ? x.op : 'eq', value } : x)));
            }}>
              {COND_FIELDS.map((f) => <option key={f} value={f}>{t(`rules.condFields.${f}`)}</option>)}
            </select>
            <select className={`${selectCls} w-auto`} value={c.op} onChange={(e) => setConds((p) => p.map((x, xi) => (xi === i ? { ...x, op: e.target.value } : x)))}>
              {OPS_FOR(c.field).map((o) => <option key={o} value={o}>{t(`rules.condOps.${o}`)}</option>)}
            </select>
            {c.op !== 'empty' && c.op !== 'not_empty' && (
              c.field === 'deadline' && (c.op === 'before' || c.op === 'after')
                ? <DatePicker value={c.value || ''} onChange={(v) => setConds((p) => p.map((x, xi) => (xi === i ? { ...x, value: v } : x)))} className="h-9 w-40" />
                : c.field === 'status'
                  ? (
                    <select className={`${selectCls} w-auto`} value={c.value || 'todo'} onChange={(e) => setConds((p) => p.map((x, xi) => (xi === i ? { ...x, value: e.target.value } : x)))}>
                      {STATUSES.map((st) => <option key={st} value={st}>{t(`common:status.${st === 'in_progress' ? 'inProgress' : st}`)}</option>)}
                    </select>
                  )
                  : c.field === 'parent'
                    ? (
                      // kanban: „karta POD sloupcem D1" — hodnota je uzel mapy
                      <select className={`${selectCls} w-auto`} value={c.value || ''} data-testid={`rule-cond-parent-${i}`} onChange={(e) => setConds((p) => p.map((x, xi) => (xi === i ? { ...x, value: e.target.value } : x)))}>
                        <option value="">{t('rules.pickNode')}</option>
                        {nodeOptions.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
                      </select>
                    )
                  : c.field === 'executor_kind'
                    ? (
                      <select className={`${selectCls} w-auto`} value={c.value || 'human'} onChange={(e) => setConds((p) => p.map((x, xi) => (xi === i ? { ...x, value: e.target.value } : x)))}>
                        <option value="human">{t('nodeDialog.executor.human')}</option>
                        <option value="automation">{t('nodeDialog.executor.automation')}</option>
                      </select>
                    )
                    : (
                      <div className="w-64">
                        <OwnerSelect id={`rule-cond-owner-${i}`} value={c.value || ''}
                          onChange={(v) => setConds((p) => p.map((x, xi) => (xi === i ? { ...x, value: v } : x)))}
                          mapAccess={mapAccess} members={members} onShareAdd={onShareAdd} onContactsChanged={onContactsChanged} />
                      </div>
                    )
            )}
            <button className="text-muted-foreground hover:text-destructive p-1" onClick={() => setConds((p) => p.filter((_, xi) => xi !== i))} title={t('rules.removeRow')}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-2 rounded-lg border p-3">
        <div className="flex items-center justify-between">
          <Label>{t('rules.doLabel')}</Label>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => setActions((p) => [...p, { type: 'set_status', status: 'done' }])}>
            <Plus className="w-3.5 h-3.5" /> {t('rules.addAction')}
          </Button>
        </div>
        {actions.map((a, i) => (
          <div key={i} className="space-y-2 rounded-md border p-2" data-testid="rule-action">
            <div className="flex items-center gap-2">
              <select className={`${selectCls} flex-1`} value={a.type} onChange={(e) => {
                const type = e.target.value;
                const fresh = type === 'set_status' ? { type, status: 'done' }
                  : type === 'set_owner' ? { type, owner: '' }
                    : type === 'set_deadline' ? { type, relative_days: 7 }
                      : type === 'move_node' ? { type, to: '' }
                        : type === 'create_subnodes' ? { type, _outline: '' }
                          : type === 'notify' ? { type, to: 'map_owner', message: '' }
                            : { type, agent_name: '' };
                setActions((p) => p.map((x, xi) => (xi === i ? fresh : x)));
              }}>
                {ACTIONS.map((ac) => <option key={ac} value={ac}>{t(`rules.actions.${ac}`)}</option>)}
              </select>
              <button className="text-muted-foreground p-1 disabled:opacity-30" disabled={i === 0} onClick={() => moveAct(i, -1)} title={t('rules.moveUp')}><ArrowUp className="w-3.5 h-3.5" /></button>
              <button className="text-muted-foreground p-1 disabled:opacity-30" disabled={i === actions.length - 1} onClick={() => moveAct(i, 1)} title={t('rules.moveDown')}><ArrowDown className="w-3.5 h-3.5" /></button>
              <button className="text-muted-foreground hover:text-destructive p-1 disabled:opacity-30" disabled={actions.length <= 1} onClick={() => setActions((p) => p.filter((_, xi) => xi !== i))} title={t('rules.removeRow')}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            {a.type === 'set_status' && (
              <div className="space-y-2">
              {targetSelect(a, i)}
              <select className={selectCls} value={a.status || 'done'} onChange={(e) => setAct(i, { status: e.target.value })}>
                {STATUSES.map((st) => <option key={st} value={st}>{t(`common:status.${st === 'in_progress' ? 'inProgress' : st}`)}</option>)}
              </select>
              </div>
            )}
            {a.type === 'set_owner' && (
              <div className="space-y-2">
                {targetSelect(a, i)}
                {/* DYNAMICKÝ CÍL: „zástupce zodpovědné osoby" se rozřeší až za
                    běhu pravidla (výměna lidí pravidlo nerozbije) — hodnota jde
                    do stejného pole owner, server jí rozumí (DYNAMIC_RULE_TARGETS) */}
                <select className={selectCls} value={isDynamicTarget(a.owner) ? a.owner : 'person'}
                  data-testid={`rule-owner-kind-${i}`}
                  onChange={(e) => setAct(i, { owner: e.target.value === 'person' ? '' : e.target.value })}>
                  <option value="person">{t('rules.targetPerson')}</option>
                  <option value="deputy_of_node_owner">{t('rules.targetDeputyOfOwner')}</option>
                  {positionOptGroups}
                  {dynFallbackOption(a.owner)}
                </select>
                {isDynamicTarget(a.owner)
                  ? <p className="text-xs text-muted-foreground">{t('rules.deputyTargetHint')}</p>
                  : (
                    // stejný výběr jako v dialogu uzlu (tým + externí kontakty),
                    // žádný volný text — nález Richarda: „nemohu vybírat lidi z organizace"
                    <OwnerSelect id={`rule-set-owner-${i}`} value={a.owner || ''} onChange={(v) => setAct(i, { owner: v })}
                      mapAccess={mapAccess} members={members} onShareAdd={onShareAdd} onContactsChanged={onContactsChanged} />
                  )}
              </div>
            )}
            {a.type === 'set_deadline' && (
              <div className="space-y-2">
              {targetSelect(a, i)}
              <div className="flex flex-wrap items-center gap-2">
                {/* Tři režimy: interval (opakování — v0.35), +N dní, pevné datum.
                    ⚠️ Při přepnutí VŽDY explicitně nulovat ostatní pole — server
                    bere advance přednostně a „viselé" advance by tiše vyhrálo
                    nad tím, co uživatel vidí (nález panelu 17. 8.). */}
                <select className={`${selectCls} w-auto`}
                  value={a.advance !== undefined ? 'advance' : (a.relative_days !== undefined ? 'relative' : 'date')}
                  onChange={(e) => setAct(i, e.target.value === 'advance'
                    ? { advance: 'weekly', relative_days: undefined, date: undefined }
                    : (e.target.value === 'relative'
                      ? { relative_days: 7, date: undefined, advance: undefined }
                      : { date: '', relative_days: undefined, advance: undefined }))}>
                  <option value="advance">{t('rules.dlAdvance')}</option>
                  <option value="relative">{t('rules.dlRelative')}</option>
                  <option value="date">{t('rules.dlFixed')}</option>
                </select>
                {a.advance !== undefined
                  ? (
                    <div className="flex items-center gap-1.5">
                      <select className={`${selectCls} w-auto`} value={a.advance}
                        onChange={(e) => setAct(i, { advance: e.target.value })}>
                        <option value="daily">{t('rules.dlAdvanceDaily')}</option>
                        <option value="weekly">{t('rules.dlAdvanceWeekly')}</option>
                        <option value="monthly">{t('rules.dlAdvanceMonthly')}</option>
                      </select>
                      <span className="text-xs text-muted-foreground">{t('rules.dlAdvanceHint')}</span>
                    </div>
                  )
                  : a.relative_days !== undefined
                    ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm text-muted-foreground">+</span>
                        <Input type="number" min={0} max={3650} className="w-24" value={a.relative_days}
                          onChange={(e) => setAct(i, { relative_days: Math.max(0, Math.min(3650, parseInt(e.target.value, 10) || 0)) })} />
                        <span className="text-sm text-muted-foreground">{t('rules.days')}</span>
                      </div>
                    )
                    : <DatePicker value={a.date || ''} onChange={(v) => setAct(i, { date: v })} className="h-9 w-40" />}
              </div>
              </div>
            )}
            {a.type === 'move_node' && (
              <div className="space-y-1">
                {/* KANBAN POSUN: přesune uzel, který pravidlo spustil, pod
                    vybraný uzel — „po Hotovo jede karta na další disciplínu" */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">{t('rules.moveTo')}</span>
                  <select className={selectCls} value={a.to || ''} data-testid={`rule-move-to-${i}`} onChange={(e) => setAct(i, { to: e.target.value })}>
                    <option value="">{t('rules.pickNode')}</option>
                    {nodeOptions.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
                  </select>
                </div>
                <p className="text-xs text-muted-foreground">{t('rules.moveHint')}</p>
              </div>
            )}
            {a.type === 'create_subnodes' && (
              <div className="space-y-1">
                <Textarea rows={4} value={a._outline || ''} placeholder={t('rules.outlinePlaceholder')}
                  onChange={(e) => setAct(i, { _outline: e.target.value })} />
                <p className="text-xs text-muted-foreground">{t('rules.outlineHint')}</p>
                {a._rich && <p className="text-xs text-amber-600 dark:text-amber-500">{t('rules.outlineRichWarn')}</p>}
              </div>
            )}
            {a.type === 'notify' && (
              <div className="space-y-2">
                <select className={selectCls} value={['node_owner', 'map_owner'].includes(a.to) || isDynamicTarget(a.to) ? a.to : 'custom'}
                  onChange={(e) => setAct(i, { to: e.target.value === 'custom' ? '' : e.target.value })}>
                  <option value="node_owner">{t('rules.toNodeOwner')}</option>
                  {/* dynamický cíl — rozřeší se za běhu; víc zástupců (per pozice) = upozorní se všichni */}
                  <option value="deputy_of_node_owner">{t('rules.toDeputyOfOwner')}</option>
                  <option value="map_owner">{t('rules.toMapOwner')}</option>
                  <option value="custom">{t('rules.toEmail')}</option>
                  {positionOptGroups}
                  {dynFallbackOption(a.to)}
                </select>
                {!(['node_owner', 'map_owner'].includes(a.to) || isDynamicTarget(a.to)) && (
                  // jen ČLENOVÉ týmu: notifikace pro adresu bez účtu v instanci
                  // se nedá doručit (externí kontakty schválně nejsou v nabídce)
                  <select className={selectCls} value={a.to || ''} onChange={(e) => setAct(i, { to: e.target.value })}>
                    <option value="">{t('rules.pickMember')}</option>
                    {members.filter((m) => !m.external).map((m) => (
                      <option key={m.email} value={m.email}>{m.full_name ? `${m.full_name} (${m.email})` : m.email}</option>
                    ))}
                  </select>
                )}
                <Input value={a.message || ''} maxLength={500} placeholder={t('rules.messagePlaceholder')} onChange={(e) => setAct(i, { message: e.target.value })} />
                <p className="text-xs text-muted-foreground">{t('rules.notifyHint')}</p>
              </div>
            )}
            {a.type === 'run_agent' && (
              <div className="space-y-1">
                <Input list="kb-rule-agents" value={a.agent_name || ''} placeholder={t('rules.agentPlaceholder')} onChange={(e) => setAct(i, { agent_name: e.target.value })} />
                <p className="text-xs text-muted-foreground">{t('rules.agentHint')}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      <datalist id="kb-rule-agents">
        {agents.map((a) => <option key={a.id} value={a.name} />)}
      </datalist>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>{t('common:actions.cancel')}</Button>
        <Button onClick={handleSave} disabled={!name.trim() || saving} data-testid="rule-save">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          {t(rule ? 'common:actions.save' : 'rules.createButton')}
        </Button>
      </div>
    </div>
  );
}
