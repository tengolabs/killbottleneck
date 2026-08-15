import { memo, useEffect, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position } from '@xyflow/react';
import { Plus, Pencil, ChevronDown, Loader2, Flag, TrendingUp, AlertTriangle, List, Wand2, Check, MessageSquare, CheckSquare, Timer } from 'lucide-react';
import { useGoalMap } from './GoalMapContext';
import { useTimer } from '@/lib/TimerContext';
import { useToast } from '@/components/ui/use-toast';
import { statusConfig } from '@/lib/statusMeta';
import { getActiveSkin } from '@/lib/theme';
import { tridaVrcholu, tridyCitelnosti } from '@/lib/citelnost';
import { PATTERN_ART } from '@/components/shared/SkinPattern';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

// Typy mise/vize/strategie/cíl zrušeny; vrchol = „projekt". Barvy tu zůstávají
// jen jako default accent podle staré hodnoty goalType (existující mapy beze
// změny), dokud se accent nesjednotí (etapa B2). Nová data mají goalType ''.
const goalTypeConfig = {
  mise: { color: '#8b5cf6' },
  vize: { color: '#6366f1' },
  strategie: { color: '#14b8a6' },
  cil: { color: 'hsl(239 84% 67%)' },
};

// action = interní enum (jde do AI požadavku) — labely přes editor:node.aiActions.*
const aiMenuItems = [
  { action: 'subgoals', icon: List },
  { action: 'milestones', icon: Flag },
  { action: 'kpi', icon: TrendingUp },
  { action: 'risks', icon: AlertTriangle },
  { action: 'rewrite', icon: Wand2 },
];

function ApexGoalNode({ id, data, selected }) {
  const { t } = useTranslation('editor');
  // memo() + getActiveSkin(): bez odběru by po změně skinu (paleta v editoru)
  // zůstala v kruhu STARÁ ozdoba až do změny dat uzlu (checkup před v0.13.2)
  const [, bumpSkin] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    window.addEventListener('kb-skin-changed', bumpSkin);
    return () => window.removeEventListener('kb-skin-changed', bumpSkin);
  }, []);
  // orgMap: vrchol ORG STRUKTURY není projekt — bez štítku Projekt, stavu,
  // pokroku, AI kouzel i stopek (nález Richardova klik-testu 15. 8.)
  const { onAddChild, onEditNode, onExpandNode, onToggleCollapse, onCycleStatus, childCount, collapsed, expandingNodeId, searchQuery, readOnly, getProgress, myTasksOnly, currentUserEmail, commentCounts, taskStats, onShowNodeTasks, activeMapId, direction, citelnost, orgMap } = useGoalMap();
  const isH = direction === 'horizontal';
  // Měření času na vrcholu = práce na projektu jako celku; stav uzlu nemění
  const timer = useTimer();
  const { toast } = useToast();
  const timerRunsHere = timer.running?.node_id === id;
  const handleTimer = (e) => {
    e.stopPropagation();
    (timerRunsHere
      ? timer.stop()
      : timer.start({ map_id: activeMapId || '', node_id: id, label: data.title || data.apexText || '' })
    ).catch((err) => toast({ title: t('common:misc.timerToggleFailed'), description: err?.message, variant: 'destructive' }));
  };
  const isExpanding = expandingNodeId === id;
  const count = childCount(id);
  const isCollapsed = collapsed(id);
  const hasChildren = count > 0;
  const isSearching = searchQuery.trim().length > 0;
  const isMatch = !isSearching || (data.apexText || '').toLowerCase().includes(searchQuery.toLowerCase());
  const isMyTask = !myTasksOnly || (data.owner && data.owner === currentUserEmail);
  const typeKey = goalTypeConfig[data.goalType] ? data.goalType : 'cil';
  const config = goalTypeConfig[typeKey];
  const accent = data.color || config.color;
  const isDone = data.status === 'done';
  const progress = getProgress(id);
  const status = statusConfig[data.status] || statusConfig.todo;
  // Vrchol = KRUH (Richard 31. 7.: „hlavní uzel vypadá stejně, zapadlý — udělat
  // kruh, větší a dominantní, využít ozdoby šablon"). Prstenec = celkový pokrok,
  // uvnitř jemná malůvka aktivního skinu. Užší než stará karta (260 vs 340 px)
  // → v zobrazení na šířku zabírá MÍŇ místa.
  const SIZE = 260;
  const R = 122;
  const CIRC = 2 * Math.PI * R;
  const ringColor = progress === 100 ? '#22c55e' : accent;
  const patternKey = getActiveSkin()?.light?.pattern;
  const Decor = patternKey && PATTERN_ART[patternKey] ? PATTERN_ART[patternKey].Art : null;
  const titleText = data.apexText || t('node.noText');
  // velikost podle DÉLKY textu (kruh je pevný, dlouhý název se musí vejít)
  // POSUNUTÁ o zvolený stupeň Čitelnosti — viz lib/citelnost.js
  const titleSize = tridaVrcholu(titleText.length, citelnost);
  // ve stupni „jen název" zmizí z kruhu odznaky i blok pokroku (Richard 13. 8.)
  const jenNazev = !!tridyCitelnosti(citelnost).jenNazevVrcholu;

  return (
    <div
      className={`relative rounded-full transition-all ${
        selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''
      } ${isSearching && !isMatch ? 'opacity-30' : isSearching && isMatch ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-background' : ''} ${myTasksOnly && !isMyTask ? 'opacity-30' : ''}`}
      style={{ width: SIZE, height: SIZE }}
    >
      <Handle type="target" position={isH ? Position.Left : Position.Top} className="!w-2.5 !h-2.5 !bg-primary !border-2 !border-background" />

      {/* prstenec celkového pokroku po obvodu */}
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 -rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="hsl(var(--secondary))" strokeWidth="8" />
        {hasChildren && progress > 0 && !orgMap && (
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none"
            stroke={ringColor} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={`${(CIRC * progress) / 100} ${CIRC}`}
          />
        )}
      </svg>

      {/* tělo kruhu */}
      <div
        className="absolute inset-[14px] rounded-full bg-card border-2 shadow-lg overflow-hidden flex flex-col items-center justify-center text-center px-7 gap-1.5"
        style={{ borderColor: accent }}
        onDoubleClick={() => !readOnly && onEditNode?.(id)}
      >
        {/* ozdoba z malůvky aktivního skinu, oříznutá kruhem */}
        {Decor && (
          <div aria-hidden className="absolute inset-0 flex items-end opacity-[0.09] pointer-events-none" style={{ color: 'hsl(var(--primary))' }}>
            <Decor />
          </div>
        )}
        {!jenNazev && (
        <div className="relative z-10 flex items-center gap-2">
          <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: accent + '1a', color: accent }}>
            {t(orgMap ? 'node.orgBadge' : 'node.projectBadge')}
          </span>
          {!orgMap && (
          <button
            onClick={(e) => { e.stopPropagation(); onCycleStatus?.(id); }}
            disabled={readOnly}
            title={t('tasks:taskTable.statusCycleTitle')}
            className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${status.badge} ${readOnly ? 'cursor-default' : 'hover:opacity-80 cursor-pointer'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
            {isDone && <Check className="w-3 h-3" />}
            {status.label}
          </button>
          )}
        </div>
        )}
        <p className={`relative z-10 font-heading font-bold ${titleSize} text-foreground leading-snug whitespace-pre-wrap ${jenNazev ? 'line-clamp-4' : 'line-clamp-3'} ${isDone ? 'line-through opacity-50' : ''}`}>
          {data.icon && <span className="mr-1.5 leading-none">{data.icon}</span>}
          {titleText}
        </p>
        {hasChildren && !jenNazev && !orgMap && (
          <p className="relative z-10 text-xl font-bold tabular-nums leading-none" style={{ color: ringColor }}>
            {progress}%
            <span className="block text-[10px] font-medium text-muted-foreground mt-0.5">{t('node.overallProgress')}</span>
          </p>
        )}
        {!readOnly && (
          <div className="relative z-10 flex items-center gap-1.5 mt-0.5">
            <button
              onClick={(e) => { e.stopPropagation(); onAddChild(id); }}
              title={t(orgMap ? 'node.orgAddSub' : 'tasks:taskTable.addSubgoal')}
              className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
            {onExpandNode && !orgMap && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    disabled={isExpanding}
                    title={t('node.aiActionsTitle')}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
                  >
                    {isExpanding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {aiMenuItems.map(({ action, icon: Icon }) => (
                    <DropdownMenuItem key={action} onClick={() => onExpandNode(id, action)}>
                      <Icon className="w-4 h-4" />
                      {t(`node.aiActions.${action}`)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <button onClick={(e) => { e.stopPropagation(); onEditNode(id); }} title={t('common:actions.edit')} className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            {!orgMap && (
            <button
              onClick={handleTimer}
              title={timerRunsHere ? t('node.timerStop') : t('node.timerStart')}
              className={`inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors ${timerRunsHere ? 'bg-red-500/15 text-red-500' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
            >
              <Timer className={`w-3.5 h-3.5 ${timerRunsHere ? 'animate-spin' : ''}`} />
            </button>
            )}
            {/* koš tu ZÁMĚRNĚ není (Richard 2. 8.): vrchol jde přejmenovat,
                smazat jen s celou mapou — editor to hlídá i pro Delete/výběr */}
          </div>
        )}
      </div>
      {commentCounts && commentCounts[id] > 0 && (
        <div className="absolute -top-2 -right-2 z-10">
          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground shadow-sm">
            <MessageSquare className="w-2.5 h-2.5" />
            {commentCounts[id]}
          </span>
        </div>
      )}
      {onShowNodeTasks && taskStats?.[id]?.total > 0 && (
        <div className="absolute -top-2 -left-2 z-10">
          <button
            onClick={(e) => { e.stopPropagation(); onShowNodeTasks(id); }}
            title={t('node.nodeTasksTitle')}
            className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white shadow-sm hover:opacity-90 ${
              taskStats[id].done === taskStats[id].total ? 'bg-green-500' : 'bg-amber-500'
            }`}
          >
            <CheckSquare className="w-2.5 h-2.5" />
            {taskStats[id].done}/{taskStats[id].total}
          </button>
        </div>
      )}

      <Handle type="source" position={isH ? Position.Right : Position.Bottom} className="!w-2.5 !h-2.5 !bg-primary !border-2 !border-background" />
      {hasChildren && (
        <button onClick={(e) => { e.stopPropagation(); onToggleCollapse(id); }} className={`absolute z-20 flex items-center justify-center w-8 h-8 rounded-full border-2 border-background bg-primary text-primary-foreground shadow-md hover:bg-primary/90 transition-colors ${isH ? 'top-1/2 -right-4 -translate-y-1/2' : 'left-1/2 -bottom-4 -translate-x-1/2'}`} title={isCollapsed ? t('tasks:taskTable.expandBranch') : t('tasks:taskTable.collapseBranch')}>
          <ChevronDown className={`w-5 h-5 transition-transform ${isCollapsed ? '' : 'rotate-180'}`} />
          {isCollapsed && (
            <span className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1 flex items-center justify-center text-[10px] font-bold rounded-full bg-amber-500 text-white border-2 border-background">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </button>
      )}
    </div>
  );
}

export default memo(ApexGoalNode);