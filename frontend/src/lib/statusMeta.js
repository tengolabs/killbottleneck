// Jediný zdroj pravdy pro stavy — sdílí uzly map i úkoly.
// (Dřív duplikováno v GoalMapEditor/GoalNode/NodeEditDialog s nejednotnými labely.)
// label = getter, ať čte VŽDY aktuální jazyk (modul se vyhodnotí jen jednou).
import i18next from 'i18next';

export const STATUSES = [
  {
    value: 'todo',
    get label() { return i18next.t('common:status.todo'); },
    color: '#3b82f6',
    dot: 'bg-blue-500',
    badge: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    border: 'border-slate-300 dark:border-slate-600',
    headerBg: 'bg-slate-500/10',
    activeClass: 'border-blue-500 ring-2 ring-blue-500/20 bg-blue-50 dark:bg-blue-950/50',
  },
  {
    value: 'in_progress',
    get label() { return i18next.t('common:status.inProgress'); },
    color: '#f59e0b',
    dot: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
    border: 'border-amber-300 dark:border-amber-700',
    headerBg: 'bg-amber-500/10',
    activeClass: 'border-amber-500 ring-2 ring-amber-500/20 bg-amber-50 dark:bg-amber-950/50',
  },
  {
    value: 'done',
    get label() { return i18next.t('common:status.done'); },
    color: '#22c55e',
    dot: 'bg-green-500',
    badge: 'bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300',
    border: 'border-green-300 dark:border-green-700',
    headerBg: 'bg-green-500/10',
    activeClass: 'border-green-500 ring-2 ring-green-500/20 bg-green-50 dark:bg-green-950/50',
  },
];

export const statusConfig = Object.fromEntries(STATUSES.map((s) => [s.value, s]));

// todo → in_progress → done → todo
export const cycleStatus = (value) =>
  value === 'todo' ? 'in_progress' : value === 'in_progress' ? 'done' : 'todo';
