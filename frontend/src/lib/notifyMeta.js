// Jediný zdroj pravdy o typech notifikací pro FE — zvoneček, stránka /notifications
// i panel preferencí. Dřív byla mapa ikon zadrátovaná uvnitř NotificationBell,
// takže každý nový typ se musel dopisovat na víc míst (a na některé se zapomnělo).
//
// Pořadí v NOTIFY_TYPES = pořadí řádků v nastavení notifikací.
// Server má vlastní seznam v pb_hooks/helpers.js (NOTIFY_TYPES) — držet v syncu!
import {
  KeyRound,
  MessageSquare, UserPlus, Target, PlayCircle, Timer,
  Share2, Bot, CalendarClock, CheckCircle2, AlertTriangle, Zap,
} from 'lucide-react';

export const NOTIFY_TYPES = [
  'task_assigned',
  'task_comment',
  'node_assigned',
  'node_unblocked',
  'node_comment',
  'map_shared',
  'map_created',
  'automation_ready',
  'deadline',
  'deadline_request',
  'deadline_request_resolved',
  'ai_request',
  'agent_done',
  'agent_failed',
  'rule_notice',
  'rule_broken',
  'timer_autostop',
];

const META = {
  task_assigned: { icon: UserPlus, className: 'text-primary' },
  task_comment: { icon: MessageSquare, className: 'text-primary' },
  node_assigned: { icon: Target, className: 'text-primary' },
  node_unblocked: { icon: PlayCircle, className: 'text-green-600' },
  node_comment: { icon: MessageSquare, className: 'text-primary' },
  map_shared: { icon: Share2, className: 'text-primary' },
  map_created: { icon: Target, className: 'text-primary' },
  deadline: { icon: CalendarClock, className: 'text-amber-600' },
  deadline_request: { icon: CalendarClock, className: 'text-violet-600' },
  deadline_request_resolved: { icon: CalendarClock, className: 'text-green-600' },
  ai_request: { icon: Bot, className: 'text-violet-600' },
  automation_ready: { icon: Bot, className: 'text-green-600' },
  agent_done: { icon: CheckCircle2, className: 'text-green-600' },
  agent_failed: { icon: AlertTriangle, className: 'text-red-600' },
  timer_autostop: { icon: Timer, className: 'text-amber-600' },
  // automatizační pravidla: zpráva z akce „pošli notifikaci" / rozbité pravidlo
  rule_notice: { icon: Zap, className: 'text-sky-600' },
  rule_broken: { icon: AlertTriangle, className: 'text-amber-600' },
  // bezpečnostní poplach „někdo jiný ti změnil heslo" — červená, ať nezapadne
  // mezi běžné zprávy; vypnout ho nejde (server: NOTIFY_ALWAYS)
  password_reset: { icon: KeyRound, className: 'text-red-600' },
  // přetokový souhrn nad denním stropem (B1) — systémový typ, NENÍ v NOTIFY_TYPES
  // (nemá per-typ preference; vzniká právě proto, že ostatních přišlo moc)
  overflow: { icon: AlertTriangle, className: 'text-amber-600' },
};

// Neznámý typ (starší server, novější klient) nesmí shodit render — fallback ikona.
export const notifyMeta = (type) => META[type] || { icon: UserPlus, className: 'text-muted-foreground' };

// Kam notifikace vede po kliknutí. Typy vázané na uzel/mapu otevírají mapu
// s vybraným uzlem, ostatní úkoly.
export const notifyTarget = (n) => {
  const nodeBound = n.type?.startsWith('node_') || n.type?.startsWith('agent_') ||
    n.type === 'map_created' || n.type === 'map_shared' || n.type === 'ai_request' ||
    n.type === 'automation_ready' || n.type?.startsWith('deadline_request') ||
    n.type?.startsWith('rule_'); // pravidla jsou vždy vázaná na mapu (příp. uzel)
  if (nodeBound && n.map_id) return `/map/${n.map_id}${n.node_id ? `?node=${n.node_id}` : ''}`;
  if (n.type === 'deadline') {
    if (n.task_id) return `/tasks?task=${n.task_id}`;
    if (n.map_id) return `/map/${n.map_id}${n.node_id ? `?node=${n.node_id}` : ''}`;
    return '/tasks';
  }
  return n.task_id ? `/tasks?task=${n.task_id}` : '/tasks';
};
