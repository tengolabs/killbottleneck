import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useTimer, formatElapsed } from '@/lib/TimerContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { useTranslation } from 'react-i18next';
import { Square, Timer, Check } from 'lucide-react';

const NONE = '__none__';

// Stopky v hlavičce — na všech stránkách. Bez běžícího timeru = malé tlačítko
// „spustit hned" (use-case: volá klient → jeden klik a čas se počítá, komu ho
// přiřadit se vybere za běhu nebo při zastavení). S běžícím timerem = tikající
// čas + popover s přiřazením (projekt/klient/poznámka) a zastavením.
export default function TimerWidget() {
  const { t } = useTranslation('tasks');
  const { user } = useAuth();
  const { running, elapsed, start, assign, stop } = useTimer();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [mapId, setMapId] = useState('');
  const [clientId, setClientId] = useState('');
  const [maps, setMaps] = useState([]);
  const [clients, setClients] = useState([]);
  const [busy, setBusy] = useState(false);

  // výběry předvyplnit z běžícího záznamu; číselníky až při otevření popoveru
  useEffect(() => {
    if (!open || !running) return;
    setNote(running.note || '');
    setMapId(running.map_id || '');
    setClientId(running.client_id || '');
    base44.entities.GoalMap.list('-updated_date', 200, { fields: 'id,title,archived,client' })
      .then((list) => setMaps((list || []).filter((m) => !m.archived)))
      .catch(() => {});
    base44.entities.Client.list('name').then(setClients).catch(() => {});
  }, [open, running]);

  if (!user) return null;

  const patch = () => {
    const mapTitle = maps.find((m) => m.id === mapId)?.title || '';
    const clientName = clients.find((c) => c.id === clientId)?.name || '';
    return {
      map_id: mapId,
      client_id: clientId,
      note,
      label: (running?.label || mapTitle || clientName || note || '').slice(0, 200),
    };
  };

  const handleStart = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await start();
      toast({ title: t('timerWidget.started'), description: t('timerWidget.startedDesc') });
    } catch (e) {
      toast({ title: t('timerWidget.startFailed'), description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const handleAssign = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await assign(patch());
      toast({ title: t('timerWidget.assigned'), description: t('timerWidget.assignedDesc') });
      setOpen(false);
    } catch (e) {
      toast({ title: t('tasksPage.assignFailed'), description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const rec = await stop(patch());
      setOpen(false);
      // nepřiřazené měření s poznámkou server uložil i jako nápad do zásobníku
      const toInbox = rec && !rec.map_id && !rec.task_id && !rec.node_id && rec.note;
      toast({
        title: t('timerWidget.timeRecorded'),
        description: `${t('common:time.minutesShort', { count: rec?.duration_min ?? 0 })}${rec?.label ? ` — ${rec.label}` : ''}${toInbox ? t('timerWidget.inboxSuffix') : ''}`,
      });
    } catch (e) {
      toast({ title: t('timerWidget.stopFailed'), description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  if (!running) {
    return (
      <Button variant="outline" size="icon" onClick={handleStart} disabled={busy} title={t('timerWidget.startTitle')} aria-label={t('timerWidget.startAria')}>
        <Timer className="w-4 h-4" />
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 text-primary border-primary/40" title={running.label || t('timerWidget.runningTitle')}>
          <Timer className="w-4 h-4 animate-pulse" />
          <span className="font-mono text-sm tabular-nums">{formatElapsed(elapsed)}</span>
          <span className="hidden lg:inline max-w-[140px] truncate text-xs text-muted-foreground">{running.label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div>
          <p className="text-sm font-medium">{running.label || t('timeLog.heading')}</p>
          <p className="text-xs text-muted-foreground">{t('timerWidget.runningFor', { time: formatElapsed(elapsed) })}</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t('common:labels.project')}</Label>
          <Select value={mapId || NONE} onValueChange={(v) => {
            const id = v === NONE ? '' : v;
            setMapId(id);
            // klient se předvyplní z projektu (jde přepsat níže)
            const mc = maps.find((m) => m.id === id)?.client_id;
            if (mc) setClientId(mc);
          }}>
            <SelectTrigger className="h-9"><SelectValue placeholder={t('common:misc.noProject')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('common:misc.noProject')}</SelectItem>
              {maps.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.title || t('common:misc.untitled')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t('common:labels.client')}</Label>
          <Select value={clientId || NONE} onValueChange={(v) => setClientId(v === NONE ? '' : v)}>
            <SelectTrigger className="h-9"><SelectValue placeholder={t('common:misc.noClient')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('common:misc.noClient')}</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="timer-note" className="text-xs">{t('common:labels.note')}</Label>
          <Input id="timer-note" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={t('timerWidget.notePlaceholder')} onKeyDown={(e) => e.key === 'Enter' && handleStop()} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={handleAssign} disabled={busy} title={t('timerWidget.assignTitle')}>
            <Check className="w-4 h-4" /> {t('common:actions.save')}
          </Button>
          <Button className="flex-1" onClick={handleStop} disabled={busy}>
            <Square className="w-4 h-4" /> {t('timerWidget.stopButton')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
