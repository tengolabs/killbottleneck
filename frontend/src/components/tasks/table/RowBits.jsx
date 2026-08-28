import { TableHead } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Check, ArrowUpDown, ArrowUp, ArrowDown, Palette, Timer } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EmojiNabidka } from '@/components/shared/EmojiPicker';
import { statusConfig } from '@/lib/statusMeta';
import { getDeadlineStatus } from '@/lib/nodeMeta';
import { useTimer } from '@/lib/TimerContext';
import { useToast } from '@/components/ui/use-toast';
import { useTranslation } from 'react-i18next';

// Stopky u řádku (úkol I cíl-uzel mapy) — VŽDY viditelné hodinky: klik = start
// měření (běžící timer jinde se zavře); běží-li na TÉTO položce, hodinky se
// točí červeně a klik je zastaví. Přes globální TimerContext — widget
// v hlavičce se aktualizuje sám. Měření nemění stav položky.
export function RowTimerButton({ target }) {
  const { running, start, stop } = useTimer();
  const { toast } = useToast();
  const { t } = useTranslation('tasks');
  const isMine = target.task_id
    ? running?.task_id === target.task_id
    : !!target.node_id && running?.node_id === target.node_id;
  const handle = async (e) => {
    e.stopPropagation();
    try {
      if (isMine) await stop();
      else await start(target);
    } catch (err) {
      toast({ title: t('common:misc.timerToggleFailed'), description: err?.message, variant: 'destructive' });
    }
  };
  return (
    <Button variant="ghost" size="icon"
      className={`h-7 w-7 ${isMine ? 'text-red-500 hover:text-red-600' : 'text-muted-foreground hover:text-primary'}`}
      title={isMine ? t('taskTable.timerStop') : t('taskTable.timerStart')} onClick={handle}>
      <Timer className={`w-3.5 h-3.5 ${isMine ? 'animate-spin' : ''}`} />
    </Button>
  );
}

export const deadlineClass = (task) => {
  const st = getDeadlineStatus(task.deadline, task.status);
  if (st === 'overdue') return 'text-red-600 dark:text-red-400 font-medium';
  if (st === 'upcoming') return 'text-orange-600 dark:text-orange-400 font-medium';
  return 'text-muted-foreground';
};

export function StatusBadge({ task, onCycle }) {
  const { t } = useTranslation('tasks');
  const s = statusConfig[task.status] || statusConfig.todo;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onCycle?.(task); }}
      title={onCycle ? t('taskTable.statusCycleTitle') : t('taskTable.statusNodeTitle')}
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${onCycle ? 'hover:opacity-80' : 'cursor-default'} ${s.badge}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {task.status === 'done' && <Check className="w-3 h-3" />}
      {s.label}
    </button>
  );
}

// Rychlá paleta ikony uzlu (jen emoji) — vedle tužky na řádku uzlu v tabulce.
export function NodeIconPopover({ item, onSetNodeIcon }) {
  const { t } = useTranslation('tasks');
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title={t('taskTable.nodeIconTitle')}
          className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
        >
          <Palette className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2" onClick={(e) => e.stopPropagation()}>
        <EmojiNabidka value={item.icon} onChange={(e) => onSetNodeIcon(item, e)} />
      </PopoverContent>
    </Popover>
  );
}

export function SortHead({ label, sortKey, className, sort, onSort }) {
  return (
    <TableHead className={className}>
      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => onSort(sortKey)}>
        {label}
        {sort.key !== sortKey ? <ArrowUpDown className="w-3 h-3 opacity-40" />
          : sort.dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      </button>
    </TableHead>
  );
}
