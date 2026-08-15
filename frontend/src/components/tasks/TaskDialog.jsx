import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Calendar, X as XIcon, Inbox, RotateCw, Timer } from 'lucide-react';
import { STATUSES } from '@/lib/statusMeta';
import DatePicker from '@/components/DatePicker';
import { useTimer } from '@/lib/TimerContext';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { useTranslation } from 'react-i18next';
import OdkazyVPopisu from '@/components/shared/OdkazyVPopisu';

// hodnota „bez výběru" pro shadcn Select (neumí prázdný string jako item value)
const NONE = '__none__';

// Uzly mapy, ke kterým jde úkol přivázat. Poznámky ne — a VRCHOL taky ne:
// vrchol se plní splněním svých cílů, úkoly na něm nemají co dělat
// („na vrchol jde věšet jen uzly", Richard 13. 8. 2026).
const nodeOptions = (map, t) =>
  (map?.nodes || [])
    .filter((n) => n.type === 'goalNode' && n.data?.nodeType !== 'apex')
    .map((n) => ({ id: n.id, title: n.data?.title || t('common:misc.untitled') }));

const CUSTOM = '__custom__';

export default function TaskDialog({ open, task, defaults, maps = [], emailOptions = [], members = [], onSave, onStash, onClose, children }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('todo');
  const [deadline, setDeadline] = useState('');
  const [assignee, setAssignee] = useState('');
  const [recurrence, setRecurrence] = useState('');
  const [mapId, setMapId] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [saving, setSaving] = useState(false);
  const [customAssignee, setCustomAssignee] = useState(false);

  const isSubtask = !!task?.parent_id || !!defaults?.parent_id;
  const memberEmails = useMemo(() => members.map((m) => m.email), [members]);
  const timer = useTimer();
  const { toast } = useToast();
  const { t } = useTranslation('tasks');
  const timerRunsHere = !!task && timer.running?.task_id === task.id;

  useEffect(() => {
    if (!open) return;
    const a = task?.assignee_email || '';
    // defaults.title/description/deadline: předvyplnění při převodu nápadu ze zásobníku
    setTitle(task?.title ?? defaults?.title ?? '');
    setDescription(task?.description ?? defaults?.description ?? '');
    setStatus(task?.status || 'todo');
    setDeadline(task?.deadline ?? defaults?.deadline ?? '');
    setRecurrence(task?.recurrence || '');
    setAssignee(a);
    setCustomAssignee(!!a && members.length > 0 && !members.some((m) => m.email === a));
    setMapId(task?.map_id ?? defaults?.map_id ?? '');
    setNodeId(task?.node_id ?? defaults?.node_id ?? '');
    setSaving(false);
  }, [open, task, defaults, members]);

  const selectedMap = useMemo(() => maps.find((m) => m.id === mapId), [maps, mapId]);
  const nodes = useMemo(() => nodeOptions(selectedMap, t), [selectedMap, t]);
  const nodeMissing = nodeId && selectedMap && !nodes.some((n) => n.id === nodeId);

  // Termín je dohoda se zadavatelem (created_by) — existující termín smí změnit
  // nebo smazat jen on, případně vlastník projektu. První nastavení je volné.
  // Server drží totéž pravidlo (err.taskDeadlineOwnerOnly), tohle je jen slušnost.
  const { user } = useAuth();
  const origDeadline = task?.deadline || '';
  const canEditDeadline = !task || !origDeadline
    || user?.email === task.created_by
    || (!!selectedMap && user?.email === selectedMap.created_by);

  // Uzel je povinný jen tam, kde se DÁ vybrat: u existujícího úkolu, jehož uzel
  // mezitím někdo smazal (nodeMissing), by povinnost zablokovala i odbavení —
  // osiřelý stav produkt vědomě snáší, nový úkol v něm ale založit nejde.
  const nodeRequired = !isSubtask && !!mapId && !nodeMissing;

  const handleSave = async () => {
    if (!title.trim() || saving || (!isSubtask && !mapId) || (nodeRequired && !nodeId)) return;
    setSaving(true);
    try {
      const data = {
        title: title.trim(),
        description,
        status,
        deadline,
        assignee_email: assignee.trim(),
      };
      if (!isSubtask) {
        data.map_id = mapId;
        data.node_id = mapId ? nodeId : '';
        data.recurrence = recurrence;
      }
      if (!task && defaults?.parent_id) data.parent_id = defaults.parent_id;
      await onSave(data, task?.id);
      onClose();
    } catch (e) {
      // serverové odmítnutí (např. err.taskNotOnApex u legacy dat) NESMÍ být
      // němé — dřív se tu chyba spolkla a uživatel nevěděl, proč se nic nestalo
      const zprava = e?.response?.message || e?.message || '';
      if (zprava) toast({ title: zprava, variant: 'destructive' });
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {task ? t('taskDialog.titleEdit') : isSubtask ? t('taskDialog.titleNewSub') : t('taskDialog.titleNew')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="task-title">{t('taskDialog.labelTitle')}</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('taskDialog.titlePlaceholder')}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-desc">{t('taskDialog.labelDescription')}</Label>
            <Textarea
              id="task-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('taskDialog.descPlaceholder')}
              rows={3}
            />
            <OdkazyVPopisu text={description} />
          </div>

          <div className="space-y-1.5">
            <Label>{t('taskDialog.labelStatus')}</Label>
            <div className="grid grid-cols-3 gap-2">
              {STATUSES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setStatus(s.value)}
                  className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-xs font-medium transition-all ${
                    status === s.value ? s.activeClass : 'border-border hover:border-muted-foreground/40'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="task-deadline" className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" /> {t('taskDialog.labelDeadline')}
              </Label>
              <div className="flex items-center gap-1">
                <DatePicker id="task-deadline" value={deadline} onChange={setDeadline} className="flex-1" disabled={!canEditDeadline} />
                {deadline && canEditDeadline && (
                  <Button variant="ghost" size="icon" className="shrink-0 h-9 w-9" title={t('taskDialog.clearDeadline')} onClick={() => setDeadline('')}>
                    <XIcon className="w-4 h-4" />
                  </Button>
                )}
              </div>
              {!canEditDeadline && (
                <p className="text-xs text-muted-foreground">{t('taskDialog.deadlineOwnerOnly', { email: task?.created_by })}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-assignee">{t('taskDialog.labelAssignee')}</Label>
              {members.length > 0 && !customAssignee ? (
                <Select
                  value={assignee || NONE}
                  onValueChange={(v) => {
                    if (v === CUSTOM) {
                      setCustomAssignee(true);
                      setAssignee('');
                    } else {
                      setAssignee(v === NONE ? '' : v);
                    }
                  }}
                >
                  <SelectTrigger id="task-assignee">
                    <SelectValue placeholder={t('taskDialog.nobody')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t('taskDialog.nobody')}</SelectItem>
                    {members.filter((m) => !m.external).map((m) => (
                      <SelectItem key={m.email} value={m.email}>
                        {m.full_name ? `${m.full_name} (${m.email})` : m.email}
                      </SelectItem>
                    ))}
                    {members.some((m) => m.external) && (
                      <>
                        <SelectSeparator />
                        <SelectGroup>
                          <SelectLabel>{t('nav:externalContacts.group')}</SelectLabel>
                          {members.filter((m) => m.external).map((m) => (
                            <SelectItem key={m.email} value={m.email}>{m.name}</SelectItem>
                          ))}
                        </SelectGroup>
                      </>
                    )}
                    <SelectItem value={CUSTOM}>{t('taskDialog.customEmail')}</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex items-center gap-1">
                  <Input
                    id="task-assignee"
                    type="email"
                    list="task-assignee-options"
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                    placeholder="email@example.com"
                  />
                  {members.length > 0 && (
                    <Button variant="ghost" size="icon" className="shrink-0 h-9 w-9" title={t('taskDialog.pickFromTeam')}
                      onClick={() => { setCustomAssignee(false); setAssignee(memberEmails.includes(assignee) ? assignee : ''); }}>
                      <XIcon className="w-4 h-4" />
                    </Button>
                  )}
                  <datalist id="task-assignee-options">
                    {emailOptions.map((em) => <option key={em} value={em} />)}
                  </datalist>
                </div>
              )}
            </div>
          </div>

          {!isSubtask && (
            <div className="space-y-1.5">
              <Label htmlFor="task-recurrence" className="flex items-center gap-1.5">
                <RotateCw className="w-3.5 h-3.5" /> {t('taskDialog.labelRecurrence')}
              </Label>
              <Select value={recurrence || NONE} onValueChange={(v) => setRecurrence(v === NONE ? '' : v)}>
                <SelectTrigger id="task-recurrence">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('taskDialog.recurrenceNone')}</SelectItem>
                  <SelectItem value="daily">{t('taskDialog.recurrenceDaily')}</SelectItem>
                  <SelectItem value="weekly">{t('taskDialog.recurrenceWeekly')}</SelectItem>
                  <SelectItem value="monthly">{t('taskDialog.recurrenceMonthly')}</SelectItem>
                </SelectContent>
              </Select>
              {recurrence && (
                <p className="text-xs text-muted-foreground">
                  {t('taskDialog.recurrenceHint')}
                </p>
              )}
            </div>
          )}

          {!isSubtask && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('taskDialog.labelMap')}</Label>
                {/* úkol vždy patří do projektu (rychlé poznámky = zásobník nápadů) */}
                <Select
                  value={mapId || undefined}
                  onValueChange={(v) => {
                    setMapId(v);
                    setNodeId('');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('taskDialog.pickProject')} />
                  </SelectTrigger>
                  <SelectContent>
                    {maps.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.title || t('common:misc.untitled')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('taskDialog.labelNode')}</Label>
                {nodeMissing ? (
                  <div className="space-y-1">
                    <span className="block text-xs text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900 rounded-md px-2 py-2">
                      {t('taskDialog.nodeDeletedBox')}
                    </span>
                    {/* Osiřelý úkol jde jedině PŘESUNOUT na jiný cíl — „odpojit"
                        (nechat bez uzlu) zmizelo 13. 8. 2026: úkol vždy patří
                        na konkrétní cíl a vrchol úkoly nepřijímá. */}
                    <Select value={NONE} onValueChange={(v) => { if (v !== NONE) setNodeId(v); }}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('taskDialog.moveToNode')} />
                      </SelectTrigger>
                      <SelectContent>
                        {nodes.map((n) => (
                          <SelectItem key={n.id} value={n.id}>{n.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <Select
                    value={nodeId || undefined}
                    onValueChange={(v) => setNodeId(v === NONE ? '' : v)}
                    disabled={!mapId}
                  >
                    {/* value musí být undefined (ne sentinel NONE), jinak Radix
                        potlačí placeholder a POVINNÉ pole vypadá jen prázdně —
                        nález z generování screenshotů 14. 8. */}
                    <SelectTrigger>
                      <SelectValue placeholder={mapId ? t('taskDialog.pickNode') : t('taskDialog.pickMapFirst')} />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Volba „celá mapa (bez uzlu)" ani VRCHOL tu záměrně
                          nejsou: projekt → uzel → úkol, vrchol se plní
                          splněním svých cílů (Richard 27. 7. + 13. 8. 2026).
                          Bez vybraného cíle uložení neprojde — server totéž
                          odmítá (err.taskNeedsNode / err.taskNotOnApex). */}
                      {nodes.map((n) => (
                        <SelectItem key={n.id} value={n.id}>{n.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          )}

          {children}
        </div>

        <DialogFooter className="sm:justify-between">
          <div className="flex items-center gap-1">
            {task && (
              <Button
                variant="ghost"
                className={timerRunsHere ? 'text-red-500 hover:text-red-600' : 'text-muted-foreground'}
                onClick={() => (timerRunsHere ? timer.stop() : timer.start({ task_id: task.id, map_id: task.map_id || '', label: task.title }))
                  .catch((err) => toast({ title: t('common:misc.timerToggleFailed'), description: err?.message, variant: 'destructive' }))}
                title={timerRunsHere ? t('taskDialog.timerStopTitle') : t('taskDialog.timerStartTitle')}
              >
                <Timer className={`w-4 h-4 ${timerRunsHere ? 'animate-spin' : ''}`} />
                {timerRunsHere ? t('taskDialog.timerStopButton') : t('taskDialog.timerButton')}
              </Button>
            )}
            {task && !task.parent_id && onStash && (
              <Button
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => onStash({ ...task, title: title.trim() || task.title, description, deadline })}
                title={t('taskDialog.stashHint')}
              >
                <Inbox className="w-4 h-4" /> {t('taskDialog.stashButton')}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>{t('common:actions.cancel')}</Button>
            <Button onClick={handleSave} disabled={!title.trim() || saving || (!isSubtask && !mapId) || (nodeRequired && !nodeId)}>
              {task ? t('common:actions.save') : t('common:actions.create')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
