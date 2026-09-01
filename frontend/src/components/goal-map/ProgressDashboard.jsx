import { useMemo, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, Clock, AlertTriangle, CheckCircle2, Circle, Loader, CheckSquare, Sparkles, Loader2, FileDown } from 'lucide-react';
import { getInitials, formatDeadline } from '@/lib/nodeMeta';
import { intlLocale } from '@/lib/locale';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAiModes } from '@/hooks/useAiEnabled';
import { useAuth } from '@/lib/AuthContext';
import { advisor } from '@/api/kb';
import { statusConfig } from '@/lib/statusMeta';
import ChangesSection from '@/components/goal-map/ChangesSection';
import { saveDashboardPdf } from '@/lib/dashboardPdf';
import { useToast } from '@/components/ui/use-toast';

// interní klíč pro skupinu „bez vlastníka" (nesmí kolidovat s e-mailem);
// zobrazuje se přeložený přes t('dashboard.unassigned')
const UNASSIGNED = '__unassigned__';

function ProgressBar({ value, label, color = 'bg-primary' }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground truncate">{label}</span>
        <span className="text-muted-foreground ml-2 shrink-0">{value}%</span>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function StatusDot({ status }) {
  if (status === 'done') return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
  if (status === 'in_progress') return <Loader className="w-3.5 h-3.5 text-amber-500" />;
  return <Circle className="w-3.5 h-3.5 text-blue-500" />;
}

// Dashboard ukazuje obě vrstvy: postup uzlů (strategie) i postup PRÁCE — úkol
// je uzel s řešitelem nebo termínem (slovník v0.34/v0.35). Kolekce `tasks` je od
// 17. 8. 2026 prázdná legacy; dashboard ji četl a u projektu s osmi úkoly hlásil
// „Zatím žádné úkoly" (nález P2-01, analýza 20. 8. 2026).
export default function ProgressDashboard({ nodes, edges, mapTitle = '', mapId = '' }) {
  const { t } = useTranslation('home');
  const ai = useAiModes();
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [summarizing, setSummarizing] = useState(false);
  const sheetRef = useRef(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const { toast } = useToast();

  const handlePdf = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      // React musí stihnout dokreslit hlavičku pro PDF, než se dělá snímek
      await new Promise((r) => setTimeout(r, 80));
      await saveDashboardPdf(sheetRef.current, mapTitle);
    } catch (e) {
      toast({ title: t('dashboard.pdfFailed'), description: e?.message, variant: 'destructive' });
    } finally {
      setPdfBusy(false);
    }
  };

  // AI souhrn stavu projektu — jde přes mód chat (žádná změna AI kontraktu)
  const handleAiSummary = async () => {
    if (summarizing) return;
    setSummarizing(true);
    try {
      const parentMap = {};
      for (const e of edges) parentMap[e.target] = e.source;
      const compactNodes = nodes
        .filter((n) => n.type !== 'note')
        .map((n) => ({ id: n.id, title: n.data?.title || n.data?.apexText || '', status: n.data?.status || 'todo', parentId: parentMap[n.id] || null }));
      // práce = uzly s řešitelem nebo termínem (týž předpis jako karta níže)
      const taskLines = nodes
        .filter((n) => n.type !== 'note' && (n.data?.owner || n.data?.deadline))
        .map((n) => {
          const d = n.data || {};
          const st = d.status || 'todo';
          return `- ${d.title || d.apexText || ''} [${statusConfig[st]?.label || st}]${d.owner ? ` @${d.owner}` : ''}${d.deadline ? ` ${t('common:export.deadlineNote', { date: d.deadline })}` : ''}`;
        }).join('\n');
      const data = await advisor({
        mode: 'chat',
        message:
          t('dashboard.aiPrompt', { title: mapTitle }) +
          (taskLines ? `\n\n${t('dashboard.aiPromptTasks')}\n${taskLines}` : `\n\n${t('dashboard.aiPromptNoTasks')}`),
        map: { nodes: compactNodes, edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })) },
      });
      if (data?.error || !data?.reply) {
        setSummary(`⚠️ ${data?.error || t('dashboard.aiNoSummary')}`);
      } else {
        setSummary(data.reply);
      }
    } catch (err) {
      setSummary(`⚠️ ${err.response?.error || err.message || t('editor:aiChat.connectionError')}`);
    } finally {
      setSummarizing(false);
    }
  };

  const stats = useMemo(() => {
    const childrenMap = {};
    const parentMap = {};
    for (const edge of edges) {
      if (!childrenMap[edge.source]) childrenMap[edge.source] = [];
      childrenMap[edge.source].push(edge.target);
      parentMap[edge.target] = edge.source;
    }

    // Find root nodes (no parent)
    const roots = nodes.filter((n) => !parentMap[n.id]);

    const countDescendants = (nodeId) => {
      let count = 0;
      const stack = [...(childrenMap[nodeId] || [])];
      while (stack.length > 0) {
        const current = stack.pop();
        count += 1;
        stack.push(...(childrenMap[current] || []));
      }
      return count;
    };

    const computeCompletion = (nodeId) => {
      const children = childrenMap[nodeId] || [];
      if (children.length === 0) {
        const node = nodes.find((n) => n.id === nodeId);
        return { total: 1, done: node?.data?.status === 'done' ? 1 : 0 };
      }
      let total = 0, done = 0;
      for (const childId of children) {
        const r = computeCompletion(childId);
        total += r.total;
        done += r.done;
      }
      return { total, done };
    };

    const pct = (r) => (r.total > 0 ? Math.round((r.done / r.total) * 100) : 0);

    const overall = computeCompletion(roots[0]?.id);
    const overallPct = pct(overall);

    // Pillars = direct children of root (or roots themselves if multiple)
    let pillars = [];
    if (roots.length === 1 && childrenMap[roots[0].id]) {
      pillars = childrenMap[roots[0].id].map((childId) => {
        const node = nodes.find((n) => n.id === childId);
        const r = computeCompletion(childId);
        return { id: childId, title: node?.data?.title || node?.data?.apexText || t('misc.untitled'), pct: pct(r) };
      });
    } else {
      pillars = roots.map((root) => {
        const r = computeCompletion(root.id);
        return { id: root.id, title: root.data?.title || root.data?.apexText || t('misc.untitled'), pct: pct(r) };
      });
    }

    // Owner breakdown
    const ownerMap = {};
    for (const node of nodes) {
      const owner = node.data?.owner || UNASSIGNED;
      if (!ownerMap[owner]) ownerMap[owner] = { done: 0, in_progress: 0, todo: 0 };
      const status = node.data?.status || 'todo';
      if (status === 'done') ownerMap[owner].done++;
      else if (status === 'in_progress') ownerMap[owner].in_progress++;
      else ownerMap[owner].todo++;
    }
    const owners = Object.entries(ownerMap).map(([email, counts]) => ({
      email,
      ...counts,
      total: counts.done + counts.in_progress + counts.todo,
    }));

    // Deadlines
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const overdue = [];
    const upcoming = [];

    const pushDeadline = (item) => {
      if (item.diffDays < 0) overdue.push(item);
      else if (item.diffDays <= 3) upcoming.push(item);
    };
    const diffDaysOf = (deadline) => {
      const dl = new Date(deadline + 'T00:00:00');
      dl.setHours(0, 0, 0, 0);
      return Math.round((dl - now) / 86400000);
    };

    for (const node of nodes) {
      const deadline = node.data?.deadline;
      if (!deadline || node.data?.status === 'done') continue;
      pushDeadline({
        id: node.id,
        kind: 'node',
        title: node.data?.title || node.data?.apexText || t('misc.untitled'),
        owner: node.data?.owner || '',
        deadline,
        diffDays: diffDaysOf(deadline),
      });
    }
    overdue.sort((a, b) => a.diffDays - b.diffDays);
    upcoming.sort((a, b) => a.diffDays - b.diffDays);

    // vrstva práce (exekuce): úkol = uzel s řešitelem nebo termínem — týž
    // předpis jako stránka Úkoly (Tasks.jsx nodeTrees). Rozpad podle lidí je
    // výše v „Podle garanta", tady jen celkový postup.
    const work = nodes.filter((n) => n.type !== 'note' && (n.data?.owner || n.data?.deadline));
    const taskDone = work.filter((n) => n.data?.status === 'done').length;
    const taskInProgress = work.filter((n) => n.data?.status === 'in_progress').length;
    const taskPct = work.length > 0 ? Math.round((taskDone / work.length) * 100) : 0;

    const totalNodes = nodes.length;
    const totalDone = nodes.filter((n) => n.data?.status === 'done').length;
    const totalInProgress = nodes.filter((n) => n.data?.status === 'in_progress').length;
    const totalTodo = nodes.filter((n) => n.data?.status === 'todo' || !n.data?.status).length;

    return {
      overallPct,
      pillars,
      owners,
      overdue,
      upcoming,
      totalNodes,
      totalDone,
      totalInProgress,
      totalTodo,
      taskTotal: work.length,
      taskDone,
      taskInProgress,
      taskTodo: work.length - taskDone - taskInProgress,
      taskPct,
    };
  }, [nodes, edges]);

  if (nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <BarChart3 className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">{t('dashboard.emptyMap')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-background">
      {/* Snímá se OBSAH (1024 px), ne scrollovací rám (široký jako okno).
          Užší snímek roztažený na šířku stránky = VĚTŠÍ písmo v PDF; že se to
          rozlije na víc stran, je v pořádku (Richard 27. 7. 2026).
          ⚠️ Klon se renderuje odpojeně a `max-w-5xl` v něm šířku NEDRŽÍ —
          saveDashboardPdf ji proto připíná napevno, jinak se PDF ořízne zprava. */}
      <div ref={sheetRef} className="max-w-5xl mx-auto space-y-6">
        {/* Hlavička jen do PDF: na obrazovce je název projektu v liště editoru,
            ale v odeslaném souboru by chyběl a příjemce by nevěděl, čeho se týká. */}
        {pdfBusy && (
          <div className="border-b pb-3">
            <p className="font-heading text-xl font-bold">{mapTitle}</p>
            <p className="text-xs text-muted-foreground">
              {new Date().toLocaleDateString(intlLocale(), { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        )}
        {/* Stav projektu k poslání dál — přesně to, co se jinak opisuje ručně
            do chatu a na poradu. Tlačítko je vidět vždy (na dotyku hover není)
            a do samotného PDF se nedostane (export-ignore). */}
        <div className="flex justify-end export-ignore">
          <Button variant="outline" size="sm" onClick={handlePdf} disabled={pdfBusy} title={t('dashboard.pdfTitle')}>
            {pdfBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            {t('dashboard.pdf')}
          </Button>
        </div>
        {/* „Kde stojíme" (níž) + „co se pohnulo" (tady) = stav, se kterým se dá
            jít na poradu, aniž by ho člověk musel opisovat jinam.
            Jen u uložených projektů — veřejně sdílená ani osobní mapa historii nemají. */}
        {mapId && <ChangesSection mapId={mapId} />}
        {ai.has('chat') && user && (
          <div className="flex justify-end export-ignore">
            <Button variant="outline" size="sm" onClick={handleAiSummary} disabled={summarizing}>
              {summarizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {t('dashboard.aiSummary')}
            </Button>
          </div>
        )}
        {/* Overall + status counts */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <BarChart3 className="w-4 h-4" /> {t('dashboard.overall')}
            </div>
            <div className="text-3xl font-heading font-bold text-foreground">{stats.overallPct}%</div>
            <ProgressBar value={stats.overallPct} label={t('dashboard.totalLabel')} color="bg-green-500" />
          </div>
          <div className="rounded-xl border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CheckCircle2 className="w-4 h-4 text-green-500" /> {t('common:status.done')}
            </div>
            <div className="text-3xl font-heading font-bold text-foreground">{stats.totalDone}</div>
            <p className="text-xs text-muted-foreground">{t('dashboard.ofNodes', { count: stats.totalNodes })}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Loader className="w-4 h-4 text-amber-500" /> {t('common:status.inProgress')}
            </div>
            <div className="text-3xl font-heading font-bold text-foreground">{stats.totalInProgress}</div>
            <p className="text-xs text-muted-foreground">{t('dashboard.inProgressNote')}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Circle className="w-4 h-4 text-blue-500" /> {t('dashboard.todoHeading')}
            </div>
            <div className="text-3xl font-heading font-bold text-foreground">{stats.totalTodo}</div>
            <p className="text-xs text-muted-foreground">{t('dashboard.notStarted')}</p>
          </div>
        </div>

        {/* Úkoly (exekuce) */}
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-heading font-semibold text-foreground">
            <CheckSquare className="w-4 h-4 text-primary" /> {t('dashboard.projectTasks')}
            {stats.taskTotal > 0 && <span className="font-normal text-muted-foreground">{t('dashboard.doneRatio', { done: stats.taskDone, total: stats.taskTotal })}</span>}
          </h3>
          {stats.taskTotal === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('dashboard.noTasksHint')}
            </p>
          ) : (
            <>
              <ProgressBar
                value={stats.taskPct}
                label={t('dashboard.taskBarLabel', { inProgress: stats.taskInProgress, todo: stats.taskTodo })}
                color={stats.taskPct === 100 ? 'bg-green-500' : stats.taskPct >= 50 ? 'bg-amber-500' : 'bg-primary'}
              />
            </>
          )}
        </div>

        {/* Pillars */}
        {stats.pillars.length > 0 && (
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-sm font-heading font-semibold text-foreground">{t('dashboard.pillarsHeading')}</h3>
            <div className="space-y-3">
              {stats.pillars.map((p) => (
                <ProgressBar
                  key={p.id}
                  value={p.pct}
                  label={p.title}
                  color={p.pct === 100 ? 'bg-green-500' : p.pct >= 50 ? 'bg-amber-500' : 'bg-primary'}
                />
              ))}
            </div>
          </div>
        )}

        {/* Owner breakdown */}
        {stats.owners.length > 0 && (
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h3 className="text-sm font-heading font-semibold text-foreground">{t('dashboard.ownersHeading')}</h3>
            <div className="space-y-2">
              {stats.owners.map((o) => (
                <div key={o.email} className="flex items-center gap-3 p-2 rounded-lg bg-secondary/50">
                  <span
                    className="w-8 h-8 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center shrink-0"
                    title={o.email}
                  >
                    {getInitials(o.email === UNASSIGNED ? '' : o.email) || '—'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{o.email === UNASSIGNED ? t('dashboard.unassigned') : o.email}</p>
                    <p className="text-xs text-muted-foreground">{t('dashboard.nodesCount', { count: o.total })}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs shrink-0">
                    <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="w-3 h-3" />{o.done}</span>
                    <span className="flex items-center gap-1 text-amber-600"><Loader className="w-3 h-3" />{o.in_progress}</span>
                    <span className="flex items-center gap-1 text-blue-600"><Circle className="w-3 h-3" />{o.todo}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Deadline lists */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/30 p-4 space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-heading font-semibold text-red-700 dark:text-red-300">
              <AlertTriangle className="w-4 h-4" /> {t('dashboard.overdueHeading', { count: stats.overdue.length })}
            </h3>
            {stats.overdue.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">{t('dashboard.noOverdue')}</p>
            ) : (
              <div className="space-y-1.5">
                {stats.overdue.map((item) => (
                  <div key={`${item.kind}-${item.id}`} className="flex items-center gap-2 p-2 rounded-lg bg-card border border-red-100 dark:border-red-900/60">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {item.title}
                        {item.kind === 'task' && <span className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{t('dashboard.taskBadge')}</span>}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {item.owner && <span className="flex items-center gap-1">
                          <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[8px] font-bold flex items-center justify-center">{getInitials(item.owner)}</span>
                          {item.owner}
                        </span>}
                        <span className="text-red-600 dark:text-red-400 font-medium">{formatDeadline(item.deadline)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-xl border border-orange-200 bg-orange-50/50 dark:border-orange-900 dark:bg-orange-950/30 p-4 space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-heading font-semibold text-orange-700 dark:text-orange-300">
              <Clock className="w-4 h-4" /> {t('dashboard.upcomingHeading', { count: stats.upcoming.length })}
            </h3>
            {stats.upcoming.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">{t('dashboard.noUpcoming')}</p>
            ) : (
              <div className="space-y-1.5">
                {stats.upcoming.map((item) => (
                  <div key={`${item.kind}-${item.id}`} className="flex items-center gap-2 p-2 rounded-lg bg-card border border-orange-100 dark:border-orange-900/60">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {item.title}
                        {item.kind === 'task' && <span className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{t('dashboard.taskBadge')}</span>}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {item.owner && <span className="flex items-center gap-1">
                          <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[8px] font-bold flex items-center justify-center">{getInitials(item.owner)}</span>
                          {item.owner}
                        </span>}
                        <span className="text-orange-600 font-medium">{formatDeadline(item.deadline)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <Dialog open={summary !== null} onOpenChange={(v) => !v && setSummary(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> {t('dashboard.aiSummary')}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm whitespace-pre-wrap leading-relaxed max-h-[60vh] overflow-y-auto">{summary}</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}