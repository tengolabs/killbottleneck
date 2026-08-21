import { memo, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MembersContext, labelForEmail } from '@/lib/memberLabel';
import { isExternalOwner } from '@/lib/externalContacts';
import { Handle, Position } from '@xyflow/react';
import { Plus, Pencil, Trash2, ChevronDown, Loader2, Flag, TrendingUp, AlertTriangle, List, Wand2, Check, Calendar, CalendarClock, MessageSquare, Inbox, Unlink, CheckSquare, Timer, Bot, Zap, RotateCw , Paperclip, Handshake } from 'lucide-react';
import { useGoalMap } from './GoalMapContext';
import { useTimer } from '@/lib/TimerContext';
import { useToast } from '@/components/ui/use-toast';
import { getDeadlineStatus, getInitials, formatDeadline } from '@/lib/nodeMeta';
import { popisJakoText } from '@/lib/popisFormat';
import { statusConfig } from '@/lib/statusMeta';
import { tridyCitelnosti } from '@/lib/citelnost';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

// action = interní enum (jde do AI požadavku) — labely přes editor:node.aiActions.*
const aiMenuItems = [
  { action: 'subgoals', icon: List },
  { action: 'milestones', icon: Flag },
  { action: 'kpi', icon: TrendingUp },
  { action: 'risks', icon: AlertTriangle },
  { action: 'rewrite', icon: Wand2 },
];

function GoalNode({ id, data, selected }) {
  const { t } = useTranslation('editor');
  const { onAddChild, onEditNode, onDeleteNode, onExpandNode, onToggleCollapse, onCycleStatus, statusCycleNodeIds, childCount, collapsed, expandingNodeId, searchQuery, readOnly, getProgress, myTasksOnly, currentUserEmail, commentCounts, fileCounts, onStashNode, onDetachNode, hasParent, taskStats, onShowNodeTasks, waitingSet, runningAgentNodes, ruleNodes, recurrenceNodes, activeMapId, direction, compactNode, citelnost, orgMap } = useGoalMap();
  // směr stromu: 'horizontal' = strom doprava (mobil) → konektory vlevo/vpravo, jinak nahoře/dole
  const isH = direction === 'horizontal';
  // velikost písma v uzlu (tlačítko Čitelnost v liště) — šířka karty se NEMĚNÍ,
  // roste jen písmo; viz lib/citelnost.js, proč zvětšovat celý uzel nemá smysl
  const cit = tridyCitelnosti(citelnost);
  // Na kartě se popis ukazuje BEZ značek formátování: vejdou se sem jeden až dva
  // řádky a „**důraz**" by tu vypadal jako vada. Obrázkový export navíc snímá
  // kartu tak, jak je vykreslená. U odkazu zůstane popisek, ne dlouhá adresa —
  // o to při psaní [evidence](…) šlo.
  // ⚠️ Ořez vstupu: server pouští popis do 10 000 znaků a rozbor textu samých
  // značek stojí u té délky desítky ms — krát dvě stě uzlů na plátně by to bylo
  // znát při každém překreslení. Na kartu se stejně vejdou dva řádky.
  const popisText = useMemo(
    () => popisJakoText(String(data.description || '').slice(0, 2000)),
    [data.description],
  );
  // Měření času na uzlu — jen doplňkové, NIKDY nemění stav uzlu (rozhodnutí
  // Richarda). Funguje i v read-only mapě (měřím svůj čas, mapu neměním).
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
  const status = statusConfig[data.status] || statusConfig.todo;
  const hasChildren = count > 0;
  const isSearching = searchQuery.trim().length > 0;
  const isMatch = !isSearching || (data.title || '').toLowerCase().includes(searchQuery.toLowerCase());
  const customColor = data.color;
  const isDone = data.status === 'done';
  // krok vykonává automatizace (legacy uzly nemají pole vůbec = člověk;
  // 'ai'/'cron' z mezistavu vývoje jsou taky automatizace)
  const isAutomated = ['automation', 'ai', 'cron'].includes(data.executorKind);
  // někdo si u kroku přeje automatizaci a čeká, až ji správce postaví
  const wantsAutomation = !!data.automationWanted;
  const progress = getProgress(id);
  const isMyTask = !myTasksOnly || (data.owner && data.owner === currentUserEmail);
  // Čtenář mapy s vlastní prací dostane akce JEN u svých kroků — množina přijde
  // z editoru (null = bez omezení: vlastník, editor, spolupracovník).
  const mujPracovniUzel = !statusCycleNodeIds || statusCycleNodeIds.has(id);
  const members = useContext(MembersContext);
  const ownerLabel = labelForEmail(members, data.owner);
  const deadlineStatus = getDeadlineStatus(data.deadline, data.status);
  const deadlineBadgeClass = deadlineStatus === 'overdue' ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300' : deadlineStatus === 'upcoming' ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';

  const nodeStyle = customColor
    ? { backgroundColor: customColor + '22', borderColor: customColor }
    : undefined;

  // ORGANIZAČNÍ STRUKTURA: uzel = pozice/funkce, ne práce. Vlastní karta —
  // beze stavu, termínů, časomíry a AI; ukazuje držitele a zástupce POZICE.
  // Šířka zůstává 220 px (layout parity server↔FE se nemění).
  if (orgMap) {
    const holderLabel = data.holder ? labelForEmail(members, data.holder) : '';
    const deputyLabel = data.deputy ? labelForEmail(members, data.deputy) : '';
    const isFunction = data.positionKind === 'function';
    return (
      <div
        className={`relative w-[220px] rounded-xl border-2 bg-card shadow-md transition-all overflow-visible ${
          selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''
        } ${isSearching && !isMatch ? 'opacity-30' : isSearching && isMatch ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-background' : ''}`}
        style={nodeStyle}
        data-testid="org-node"
      >
        <Handle type="target" position={isH ? Position.Left : Position.Top} className="!w-2.5 !h-2.5 !bg-primary !border-2 !border-background" />
        <div className="px-3 py-2 flex items-center justify-between">
          <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full ${isFunction ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300' : 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'}`}>
            {isFunction ? t('node.orgFunction') : t('node.orgPosition')}
          </span>
          {!readOnly && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!window.confirm(t('node.confirmDelete', { title: data.title || '' }))) return;
                onDeleteNode(id);
              }}
              className="text-muted-foreground hover:text-destructive transition-colors"
              title={t('node.deleteTitle')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="px-3 pb-2" onDoubleClick={() => { if (mujPracovniUzel) onEditNode?.(id); }}>
          <h3 data-nazev-uzlu title={data.title} className={`font-heading font-semibold ${cit.nazev} text-foreground ${cit.nazevRadky}`}>
            {data.icon && <span className="mr-1.5 leading-none">{data.icon}</span>}
            {data.title}
          </h3>
          <div className="mt-2 space-y-1">
            {data.holder ? (
              <p className="flex items-center gap-1.5 text-xs text-foreground" title={data.holder}>
                <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[9px] font-bold flex items-center justify-center shrink-0">{getInitials(holderLabel)}</span>
                <span className="truncate">{holderLabel}</span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground italic">{t('node.orgVacant')}</p>
            )}
            {data.deputy && (
              <p className="text-[11px] text-muted-foreground truncate" title={data.deputy}>
                {t('node.orgDeputy')}: {deputyLabel}
              </p>
            )}
          </div>
        </div>
        {!readOnly && (
          <div className="px-3 pb-3 flex gap-2">
            <button title={t('node.orgAddSub')} onClick={(e) => { e.stopPropagation(); onAddChild(id); }} className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-medium px-2 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
              <Plus className="w-3.5 h-3.5" />
              {t('node.orgAddSub')}
            </button>
            <button data-testid="org-node-edit" title={t('common:actions.edit')} onClick={(e) => { e.stopPropagation(); onEditNode(id); }} className="inline-flex items-center justify-center text-xs font-medium px-2 py-1.5 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors">
              <Pencil className="w-3.5 h-3.5" />
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

  return (
    <div
      className={`relative w-[220px] rounded-xl border-2 bg-card shadow-md transition-all overflow-visible ${
        customColor ? '' : status.border
      } ${selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''} ${
        isSearching && !isMatch ? 'opacity-30' : isSearching && isMatch ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-background' : ''
      } ${myTasksOnly && !isMyTask ? 'opacity-30' : ''} ${compactNode ? 'cursor-pointer hover:ring-2 hover:ring-primary/50' : ''}`}
      style={nodeStyle}
    >
      <Handle type="target" position={isH ? Position.Left : Position.Top} className="!w-2.5 !h-2.5 !bg-primary !border-2 !border-background" />

      <div className={`px-3 py-2 flex items-center justify-between ${status.headerBg}`}>
        {/* spolupracovník (work) má mapu readOnly, ale stav SVÝCH uzlů cykluje
            routou /node-status — řídí se tedy přítomností handleru, ne readOnly */}
        <button
          onClick={(e) => { e.stopPropagation(); if (mujPracovniUzel) onCycleStatus?.(id); }}
          disabled={!onCycleStatus || !mujPracovniUzel}
          title={t('tasks:taskTable.statusCycleTitle')}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${status.badge} ${!onCycleStatus || !mujPracovniUzel ? 'cursor-default' : 'hover:opacity-80 cursor-pointer'}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
          {isDone && <Check className="w-3 h-3" />}
          {status.label}
        </button>
        <div className="flex items-center gap-1.5">
          {/* Hodiny zůstávají i na CIZÍM kroku, i tomu, kdo mapu needituje —
              ROZHODNUTÍ Richarda 20. 8. 2026, ne přehlédnutí. Výkaz času je
              čistě osobní záznam (`time_entries`: vidí ho jen jeho autor, do
              mapy ani k zadavateli nejde), takže si smím vykázat i čas strávený
              nad cizím krokem (konzultace, revize). Neuklízet jako nekonzistenci
              vůči štítku stavu a tužce — ty se u cizího kroku schovávají právem,
              tohle ne. Hlídá test ukol-bez-prav.js. */}
          <button
            onClick={handleTimer}
            className={timerRunsHere ? 'text-red-500' : 'text-muted-foreground hover:text-primary transition-colors'}
            title={timerRunsHere ? t('node.timerStop') : t('node.timerStart')}
          >
            <Timer className={`w-3.5 h-3.5 ${timerRunsHere ? 'animate-spin' : ''}`} />
          </button>
          {/* spolupracovník (work): viditelná cesta k detailu uzlu — akce musí
              být vidět pořád, dvojklik nikdo neobjeví (zásada z lite režimu) */}
          {readOnly && onEditNode && mujPracovniUzel && (
            <button
              onClick={(e) => { e.stopPropagation(); onEditNode(id); }}
              className="text-muted-foreground hover:text-primary transition-colors"
              title={t('node.workDetailTitle')}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          {!readOnly && onDetachNode && hasParent?.(id) && (
            <button
              onClick={(e) => { e.stopPropagation(); onDetachNode(id); }}
              className="text-muted-foreground hover:text-primary transition-colors"
              title={t('node.detachTitle')}
            >
              <Unlink className="w-3.5 h-3.5" />
            </button>
          )}
          {/* Odložení i smazání se PTAJÍ. Na mobilu nejsou tooltipy a ikonky
              jsou drobné — bez potvrzení šlo omylem rozebrat hotovou mapu
              a smazání bylo nevratné (nález Richarda 7. 8. 2026 v noci). */}
          {!readOnly && onStashNode && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!window.confirm(t('node.confirmStash', { title: data.title || '' }))) return;
                onStashNode(id);
              }}
              className="text-muted-foreground hover:text-primary transition-colors"
              title={t('tasks:taskTable.stashTitle')}
            >
              <Inbox className="w-3.5 h-3.5" />
            </button>
          )}
          {!readOnly && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!window.confirm(t('node.confirmDelete', { title: data.title || '' }))) return;
                onDeleteNode(id);
              }}
              className="text-muted-foreground hover:text-destructive transition-colors"
              title={t('node.deleteTitle')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Dvojklik se řídí přítomností handleru (vzor stavového odznaku výš) A
          `mujPracovniUzel`: spolupracovník (work) má mapu readOnly, ale detail
          uzlu od 14. 8. 2026 otevírá — dostane zjednodušené okno. ČTENÁŘ se svou
          prací jen u SVÝCH kroků; bez té podmínky si dvojklikem otevřel okno
          cizího kroku s tlačítky stavu, která server odmítne (panel 20. 8. 2026). */}
      <div className="px-3 py-3" onDoubleClick={() => { if (mujPracovniUzel) onEditNode?.(id); }}>
        {/* Bublina s CELÝM názvem: čím větší písmo, tím míň znaků se do karty
            vejde (šířka zůstává 220 px), takže dlouhý název se ořízne. Popisek
            svou bublinu měl, název ne — a ve vyšších stupních je oříznutý
            právě on (nález panelu 13. 8. 2026). Na výšku karty to nic nestojí. */}
        <h3 data-nazev-uzlu title={data.title} className={`font-heading font-semibold ${cit.nazev} text-foreground ${compactNode ? 'line-clamp-1' : cit.nazevRadky} ${isDone ? 'line-through opacity-50' : ''}`}>
          {data.icon && <span className="mr-1.5 leading-none">{data.icon}</span>}
          {data.title}
        </h3>
        {data.description && (cit.skrytPopis ? (
          /* Popisek je schovaný, ale uzel to musí PŘIZNAT — bez značky by
             uživatel nepoznal, že o informaci přišel, a tichý rozdíl se pak
             těžko hledá (Richard 12. 8. 2026: „tři tečky pod názvem").
             Celý text zůstává dostupný v bublině. */
          <p
            data-popis-skryt
            title={popisText}
            aria-label={t('node.descriptionHidden')}
            className={`mt-1 text-[10px] leading-none text-muted-foreground ${isDone ? 'opacity-50' : ''}`}
          >
            …
          </p>
        ) : (
          <p data-popis-uzlu className={`mt-1 ${cit.popis} text-muted-foreground ${cit.popisRadky} ${isDone ? 'opacity-50' : ''}`}>
            {popisText}
          </p>
        ))}
      </div>

      {(deadlineStatus || waitingSet?.has(id) || data.owner || data.blocks || isAutomated || wantsAutomation) && (
        <div className="px-3 pb-1 flex items-center gap-1.5 flex-wrap">
          {deadlineStatus && (
            <span title={`${t('tasks:taskDialog.labelDeadline')}: ${formatDeadline(data.deadline)}`} className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${deadlineBadgeClass}`}>
              <Calendar className="w-2.5 h-2.5" />
              {formatDeadline(data.deadline)}
            </span>
          )}
          {/* iniciály GARANTA — u ai/cron uzlu zůstávají, jen se vedle nich objeví
              odznak vykonavatele (odpovědný je pořád člověk).
              Jméno místo mailu (Richard 8. 8. 2026): iniciály i bublina se berou
              ze zobrazovaného jména z adresáře členů; e-mail je jen fallback. */}
          {/* EXTERNÍ garant vypadá jinak (Richard 21. 8. 2026): plné kolečko
              budí dojem, že „na tom někdo dělá" — přitom externímu kontaktu
              nikdy nic nechodí a o úkolu neví. Kroužek s iniciálami nestačil
              (klik-test 21. 8. večer) → celý štítek se jménem a slovem
              „externě", ve stejném jazyce jako štítky termínu/automatizace. */}
          {data.owner && (isExternalOwner(data.owner) ? (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border border-dashed border-amber-600/70 bg-amber-500/15 text-amber-700 dark:text-amber-400 max-w-[11rem]"
              title={t('nav:externalContacts.cardHint', { name: ownerLabel })}
            >
              <Handshake className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">{t('nav:externalContacts.cardBadge', { name: ownerLabel })}</span>
            </span>
          ) : (
            <span
              className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[9px] font-bold flex items-center justify-center shrink-0"
              title={ownerLabel === data.owner ? data.owner : `${ownerLabel} (${data.owner})`}
            >
              {getInitials(ownerLabel)}
            </span>
          ))}
          {isAutomated && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300 max-w-[10rem]"
              title={`${t('editor:nodeDialog.executor.automation')}${data.executorName ? ` — ${data.executorName}` : ''}`}
            >
              <Bot className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">{data.executorName || t('editor:nodeDialog.executor.automation')}</span>
              {/* běžící automatizace — tečka tepe, dokud agent neohlásí výsledek */}
              {runningAgentNodes?.has(id) && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
              )}
            </span>
          )}
          {/* blesk = na uzel míří automatizační pravidlo (když X → udělej Y);
              detail v okně uzlu (kategorie Automatizace) a v přehledu na liště */}
          {/* 🔁 = cíl se opakuje: po Hotovo se sám vrátí s termínem posunutým
              v rytmu původního termínu (v0.35; spravuje přepínač v Zadání) */}
          {recurrenceNodes?.has(id) && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
              title={t('editor:node.recurrenceBadgeHint')}
              data-testid="node-recurrence-badge"
            >
              <RotateCw className="w-2.5 h-2.5 shrink-0" />
            </span>
          )}
          {ruleNodes?.has(id) && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"
              title={t('editor:node.ruleBadgeHint')}
              data-testid="node-rule-badge"
            >
              <Zap className="w-2.5 h-2.5 shrink-0" />
            </span>
          )}
          {wantsAutomation && !isAutomated && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              title={t('editor:nodeDialog.automationWantedHint')}
            >
              <Bot className="w-2.5 h-2.5 shrink-0" />
              {t('editor:node.automationWantedBadge')}
            </span>
          )}
          {/* otevřená žádost o změnu termínu — zadavatel ji vyřídí v dialogu uzlu */}
          {!!data.deadlineChangeWanted && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"
              title={t('editor:node.deadlineRequestBadgeHint', { date: data.deadlineChangeWanted })}
            >
              <CalendarClock className="w-2.5 h-2.5 shrink-0" />
              {t('editor:node.deadlineRequestBadge')}
            </span>
          )}
          {waitingSet?.has(id) && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
              title={t('tasks:taskTable.waitingTitle')}
            >
              {t('tasks:taskTable.waitingBadge')}
            </span>
          )}
          {data.blocks && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300"
              title={t('node.blockingTitle', { node: data.blocks })}
            >
              {t('node.blockingBadge')}
            </span>
          )}
        </div>
      )}
      {/* Komentáře a přílohy vpravo nahoře. Přílohu bylo dosud poznat jen
          otevřením detailu (Richard 18. 8. 2026: „a to je škoda"). */}
      {((commentCounts && commentCounts[id] > 0) || (fileCounts && fileCounts[id] > 0)) && (
        <div className="absolute -top-2 -right-2 z-10 flex items-center gap-1">
          {fileCounts && fileCounts[id] > 0 && (
            <span
              data-odznak-prilohy
              title={`${t('nodeDialog.files.label')}: ${fileCounts[id]}`}
              className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground shadow-sm"
            >
              <Paperclip className="w-2.5 h-2.5" />
              {fileCounts[id]}
            </span>
          )}
          {commentCounts && commentCounts[id] > 0 && (
            <span title={t('tasks:comments.heading', { count: commentCounts[id] })} className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground shadow-sm">
              <MessageSquare className="w-2.5 h-2.5" />
              {commentCounts[id]}
            </span>
          )}
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

      {hasChildren && !compactNode && !cit.skrytPokrok && (
        <div className="px-3 pb-1">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: progress === 100 ? '#22c55e' : '#f59e0b' }} />
            </div>
            <span className="text-[10px] font-medium text-muted-foreground tabular-nums">{progress}%</span>
          </div>
        </div>
      )}

      {!readOnly && (
        <div className="px-3 pb-3 flex gap-2">
          <button title={t('tasks:taskTable.addSubgoal')} onClick={(e) => { e.stopPropagation(); onAddChild(id); }} className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-medium px-2 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
            <Plus className="w-3.5 h-3.5" />
            {t('tasks:taskTable.addSubgoal')}
          </button>
          {onExpandNode && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  disabled={isExpanding}
                  title={t('node.aiActionsTitle')}
                  className="inline-flex items-center justify-center text-xs font-medium px-2 py-1.5 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
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
          <button title={t('common:actions.edit')} onClick={(e) => { e.stopPropagation(); onEditNode(id); }} className="inline-flex items-center justify-center text-xs font-medium px-2 py-1.5 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors">
            <Pencil className="w-3.5 h-3.5" />
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

export default memo(GoalNode);