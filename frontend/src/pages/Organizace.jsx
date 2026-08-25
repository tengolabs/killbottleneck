// „ORGANIZACE" — pohled shora pro admina a manažera (nálezy P2-02 + P3-03).
// Maketa schválená Richardem 25. 8. 2026 (8099/kb-sedm-pohledu/krok3/) je
// závazná 1:1: 4 dlaždice → po termínu napříč projekty → projekty podle % hotovo
// → co se nehýbe → lidé s nejvíc resty → co se změnilo za 7 dní; tlačítko Report
// (Markdown / CSV) ze stejného JSON. Čísla počítá server (helpers.js:buildPortfolio)
// JEN z týmových a sdílených projektů — soukromé ani do součtů; tahle stránka
// jen kreslí. Člen (role user) položku v liště nemá a tady dostane „bez oprávnění".
// V lite režimu stránka není („kdo dělá, vidí seznam").
import { useEffect, useCallback, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Flame, PauseCircle, Folder, Users, Download, ChevronDown, Map as MapIcon, Target, CheckSquare,
  Building2, Share2, History, Shield, ArrowLeft, Loader2, UserPlus, Lock,
} from 'lucide-react';
import AppHeader from '@/components/shared/AppHeader';
import SkinPattern from '@/components/shared/SkinPattern';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { fetchPortfolio } from '@/functions/portfolio';
import { useLazyNs } from '@/i18n/lazyNs';
import { labelForEmail } from '@/lib/memberLabel';
import { getInitials, formatDeadline } from '@/lib/nodeMeta';
import { fmtDate } from '@/lib/locale';
import { exportPortfolioMarkdown, exportPortfolioCsv, changeValue, actorLabel, whenLabel, accessLabel, excludedLabel } from '@/lib/portfolioExport';

const MAX_ROWS = 10;

const Avatar = ({ label, dashed }) => (
  dashed
    ? <span className="w-6 h-6 rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground inline-flex items-center justify-center shrink-0"><UserPlus className="w-3 h-3" /></span>
    : <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-[10px] font-bold inline-flex items-center justify-center shrink-0">{getInitials(label)}</span>
);

export default function Organizace() {
  const { t } = useTranslation('organizace', { keyPrefix: 'organizace' });
  const { t: tAuth } = useTranslation('auth');
  const nsReady = useLazyNs('organizace');
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [members, setMembers] = useState([]);
  const [org, setOrg] = useState(null);
  const canSee = user?.role === 'admin' || user?.role === 'manager';

  useEffect(() => {
    if (!canSee) return;
    fetchPortfolio().then((d) => { setData(d); setFailed(false); }).catch(() => setFailed(true));
    base44.users.listMembers().then(setMembers).catch(() => {});
    base44.org.get().then(setOrg).catch(() => {});
  }, [canSee]);

  // jméno člověka: adresář členů → jméno externího kontaktu ze serveru → e-mail
  const nameOf = useCallback((email, row) => {
    if (!email) return t('unassigned');
    if (row?.owner_label) return row.owner_label;
    return labelForEmail(members, email);
  }, [members, t]);
  const days = (n) => t('days', { count: n });

  if (!nsReady) return null;

  if (!canSee) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader active="organizace" />
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4" data-testid="organizace-noperm">
          <Shield className="w-12 h-12 text-muted-foreground" />
          <p className="text-muted-foreground">{t('noPermission')}</p>
          <Button onClick={() => navigate('/')}>
            <ArrowLeft className="w-4 h-4" /> {tAuth('userAdmin.backToOverview')}
          </Button>
        </div>
      </div>
    );
  }

  const s = data?.sections;
  const c = data?.counts;
  const todayLabel = fmtDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' });
  const who = (row) => (
    row.owner
      ? <Link to={`/tasks?assignee=${encodeURIComponent(row.owner)}`} className="inline-flex items-center gap-1.5 whitespace-nowrap hover:underline"><Avatar label={nameOf(row.owner, row)} /><span>{nameOf(row.owner, row)}</span></Link>
      : <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted-foreground"><Avatar dashed /><span>{t('unassigned')}</span></span>
  );
  // Klik na položku = skok do mapy PŘÍMO NA UZEL (deep-link ?node=, editor ho
  // vycentruje a zvýrazní) — Richard 25. 8.: „má se ten uzel přiblížit".
  const itemHref = (row) => `/map/${row.mapId}${row.nodeId ? `?node=${row.nodeId}` : ''}`;
  const mapLink = (row) => (
    <Link to={`/map/${row.mapId}`} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary whitespace-nowrap">
      <MapIcon className="w-3 h-3" />{row.mapTitle}
    </Link>
  );
  const kpis = c ? [
    { key: 'overdue', label: t('kpi.overdue'), sub: t('kpi.overdueSub'), value: c.overdue, icon: Flame, cls: 'text-red-600 dark:text-red-400', numCls: 'text-red-600 dark:text-red-400', href: '#s-overdue' },
    { key: 'stuck', label: t('kpi.stuck'), sub: t('kpi.stuckSub'), value: c.stuck, icon: PauseCircle, cls: 'text-muted-foreground', href: '#s-stuck' },
    { key: 'projects', label: t('kpi.projects'), sub: t('kpi.open', { count: c.open }), value: c.projects, icon: Folder, cls: 'text-blue-600 dark:text-blue-400', href: '#s-projects' },
    { key: 'people', label: t('kpi.people'), sub: t('kpi.peopleSub'), value: c.people, icon: Users, cls: 'text-violet-600 dark:text-violet-400', href: '#s-people' },
  ] : [];
  const barCls = (pct) => (pct === 100 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-primary');
  const th = 'text-left font-medium text-muted-foreground text-xs px-2 py-1.5 border-b';
  const td = 'px-2 py-2 border-b border-border/60 align-middle';

  return (
    <div className="min-h-screen bg-background relative">
      <SkinPattern />
      <AppHeader active="organizace" org={org} />
      <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8" data-testid="organizace-page">
        {failed && <div className="rounded-lg bg-destructive/10 text-destructive px-3 py-2 text-sm mb-4">{t('loadFailed')}</div>}
        {!data && !failed && <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}

        {data && (
          <>
            {data.truncated && (
              <div className="flex items-center gap-2 text-sm rounded-lg border border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2 mb-4" data-testid="organizace-truncated">
                <Lock className="w-3.5 h-3.5" /> {t('truncated')}
              </div>
            )}
            <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
              <div>
                <h1 className="font-heading text-2xl font-bold tracking-tight">{t('title')}</h1>
                <p className="text-sm">
                  {t('projects', { count: c.projects })} ({t('team', { count: data.scope.team })}, {t('shared', { count: data.scope.shared })}) · {todayLabel}
                  <br /><span className="text-muted-foreground">{t('privateNote')}</span>
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9" data-testid="organizace-report">
                    <Download className="w-4 h-4" /> {t('report')} <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => exportPortfolioMarkdown({ data, nameOf, orgName: org?.name })}>{t('reportMd')}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportPortfolioCsv({ data, nameOf })}>{t('reportCsv')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {c.projects === 0 ? (
              <div className="rounded-xl border bg-card p-4 text-center py-12 flex flex-col items-center gap-2" data-testid="organizace-empty">
                <Folder className="w-10 h-10 text-muted-foreground" />
                <p className="font-semibold">{t('emptyTitle')}</p>
                <p className="text-sm text-muted-foreground max-w-xl">{t('emptyHint')}</p>
                <Button className="mt-2" onClick={() => navigate('/')}>{t('emptyCta')}</Button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6" data-testid="organizace-kpis">
                  {kpis.map((k) => (
                    <a key={k.key} href={k.href} className="rounded-lg border bg-background p-2.5 hover:border-primary/50 hover:bg-secondary/40 transition-colors flex flex-col" data-testid={`organizace-kpi-${k.key}`}>
                      <span className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${k.cls}`}><k.icon className="w-3 h-3" /> {k.label}</span>
                      <span className={`text-3xl font-heading font-bold leading-tight mt-0.5 ${k.numCls || ''}`} data-testid={`organizace-kpi-${k.key}-n`}>{k.value}</span>
                      <span className="text-[11px] text-muted-foreground">{k.sub}</span>
                    </a>
                  ))}
                </div>

                <section className="rounded-xl border bg-card p-4 mb-4" id="s-overdue" data-testid="organizace-overdue">
                  <h2 className="flex items-center gap-2 text-sm font-heading font-semibold text-red-600 dark:text-red-400 mb-3">
                    <Flame className="w-4 h-4" /> {t('sections.overdue')}
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-secondary text-foreground">{c.overdue}</span>
                  </h2>
                  {c.overdue === 0 ? <p className="text-sm text-muted-foreground">{t('emptyOverdue')}</p> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr><th className={th}>{t('cols.what')}</th><th className={`${th} hidden md:table-cell`}>{t('cols.project')}</th><th className={th}>{t('cols.who')}</th><th className={th}>{t('cols.deadline')}</th><th className={th}>{t('cols.overdue')}</th></tr></thead>
                        <tbody>
                          {s.overdue.slice(0, MAX_ROWS).map((o) => (
                            <tr key={`${o.kind}-${o.id}`} className="hover:bg-secondary/50">
                              <td className={td}><Link to={itemHref(o)} data-testid="organizace-item" className="inline-flex items-center gap-1.5 font-medium hover:underline">{o.kind === 'task' ? <CheckSquare className="w-3.5 h-3.5 text-muted-foreground" /> : <Target className="w-3.5 h-3.5 text-primary" />}{o.title}</Link></td>
                              <td className={`${td} hidden md:table-cell`}>{mapLink(o)}</td>
                              <td className={td}>{who(o)}</td>
                              <td className={`${td} whitespace-nowrap text-red-600 dark:text-red-400`}>{formatDeadline(o.deadline)}</td>
                              <td className={`${td} whitespace-nowrap text-red-600 dark:text-red-400 font-semibold`}>{days(o.daysOver)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {s.overdue.length > MAX_ROWS && <Link to="/tasks?deadline=overdue" className="inline-block mt-2 text-xs font-medium text-primary hover:underline">{t('more', { count: s.overdue.length - MAX_ROWS })}</Link>}
                    </div>
                  )}
                </section>

                <section className="rounded-xl border bg-card p-4 mb-4" id="s-projects" data-testid="organizace-projects">
                  <h2 className="flex items-center gap-2 text-sm font-heading font-semibold mb-3">
                    <Folder className="w-4 h-4" /> {t('sections.projects')} <span className="text-xs font-normal text-muted-foreground">{t('sections.projectsSort')}</span>
                  </h2>
                  <div className="flex flex-col gap-2">
                    {s.projects.map((p) => (
                      <Link key={p.id} to={`/map/${p.id}?view=dashboard`} className="block rounded-lg border bg-background px-3.5 py-3 hover:border-primary/50 transition-colors" data-testid="organizace-project">
                        <div className="flex items-center gap-2.5 mb-1.5">
                          <MapIcon className="w-4 h-4 text-primary shrink-0" />
                          <span className="font-heading font-bold truncate">{p.title}</span>
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary whitespace-nowrap">
                            {p.access === 'team' ? <Building2 className="w-3 h-3" /> : <Share2 className="w-3 h-3" />}
                            {accessLabel(p)}
                          </span>
                          <span className="flex-1" />
                          <span className="font-heading text-xl font-bold tabular-nums">{p.pct}<span className="text-sm font-semibold text-muted-foreground">%</span></span>
                        </div>
                        <div className="h-2 rounded-full bg-secondary overflow-hidden"><div className={`h-full rounded-full transition-all ${barCls(p.pct)}`} style={{ width: `${p.pct}%` }} /></div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground mt-1.5">
                          <span>{t('projMeta', { done: p.done, total: p.total })}</span><span>·</span>
                          <span className={p.overdue ? 'text-red-600 dark:text-red-400 font-semibold' : ''}>{t('projOverdue', { count: p.overdue })}</span><span>·</span>
                          <span className={p.stuck ? 'font-semibold text-foreground' : ''}>{t('projStuck', { count: p.stuck })}</span><span>·</span>
                          <span>{t('projOpen', { count: p.open })}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>

                <section className="rounded-xl border bg-card p-4 mb-4" id="s-stuck" data-testid="organizace-stuck">
                  <h2 className="flex flex-wrap items-center gap-2 text-sm font-heading font-semibold mb-3">
                    <PauseCircle className="w-4 h-4" /> {t('sections.stuck')}
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-secondary text-foreground">{c.stuck}</span>
                    <span className="text-xs font-normal text-muted-foreground">{t('sections.stuckSub')}</span>
                  </h2>
                  {c.stuck === 0 ? <p className="text-sm text-muted-foreground">{t('emptyStuck')}</p> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr><th className={th}>{t('cols.what')}</th><th className={`${th} hidden md:table-cell`}>{t('cols.project')}</th><th className={th}>{t('cols.who')}</th><th className={th}>{t('cols.deadline')}</th><th className={th}>{t('cols.idle')}</th></tr></thead>
                        <tbody>
                          {s.stuck.map((o) => (
                            <tr key={`${o.kind}-${o.id}`} className="hover:bg-secondary/50">
                              <td className={td}><Link to={itemHref(o)} className="inline-flex items-center gap-1.5 font-medium hover:underline"><PauseCircle className="w-3.5 h-3.5 text-muted-foreground" />{o.title}</Link></td>
                              <td className={`${td} hidden md:table-cell`}>{mapLink(o)}</td>
                              <td className={td}>{who(o)}</td>
                              <td className={`${td} whitespace-nowrap text-muted-foreground`}>{o.deadline ? formatDeadline(o.deadline) : t('noDeadline')}</td>
                              <td className={`${td} whitespace-nowrap font-semibold`}>{t('idle', { days: days(o.daysIdle) })}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="rounded-xl border bg-card p-4 mb-4" id="s-people" data-testid="organizace-people">
                  <h2 className="flex items-center gap-2 text-sm font-heading font-semibold text-violet-600 dark:text-violet-400 mb-3">
                    <Users className="w-4 h-4" /> {t('sections.people')}
                  </h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr><th className={th}>{t('cols.who')}</th><th className={`${th} text-right`}>{t('cols.overdue')}</th><th className={`${th} text-right`}>{t('cols.stuck')}</th><th className={`${th} text-right`}>{t('cols.open')}</th><th className={`${th} text-right`}>{t('cols.projects')}</th></tr></thead>
                      <tbody>
                        {s.people.map((p) => (
                          <tr key={p.email || '-'} className="hover:bg-secondary/50" data-testid="organizace-person">
                            <td className={td}>{who({ owner: p.email, owner_label: p.owner_label })}</td>
                            <td className={`${td} text-right tabular-nums ${p.overdue ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-muted-foreground'}`}>{p.overdue}{p.worst ? <span className="text-[11px] font-normal text-muted-foreground"> ({t('worst', { days: days(p.worst) })})</span> : null}</td>
                            <td className={`${td} text-right tabular-nums ${p.stuck ? 'font-semibold' : 'text-muted-foreground'}`}>{p.stuck}</td>
                            <td className={`${td} text-right tabular-nums`}>{p.open}</td>
                            <td className={`${td} text-right tabular-nums text-muted-foreground`}>{p.maps}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="rounded-xl border bg-card p-4 mb-4" id="s-changes" data-testid="organizace-changes">
                  <h2 className="flex items-center gap-2 text-sm font-heading font-semibold mb-3">
                    <History className="w-4 h-4" /> {t('sections.changes')}
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-secondary text-foreground">{c.changes}</span>
                  </h2>
                  {c.changes === 0 ? <p className="text-sm text-muted-foreground">{t('emptyChanges')}</p> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr><th className={th}>{t('cols.when')}</th><th className={th}>{t('cols.what')}</th><th className={`${th} hidden md:table-cell`}>{t('cols.project')}</th><th className={th}>{t('cols.change')}</th><th className={`${th} hidden sm:table-cell`}>{t('cols.who')}</th></tr></thead>
                        <tbody>
                          {s.changes.slice(0, MAX_ROWS).map((ch, i) => (
                            <tr key={`${ch.kind}-${ch.id}-${ch.when}-${i}`} className="hover:bg-secondary/50">
                              <td className={`${td} whitespace-nowrap text-muted-foreground`}>{whenLabel(ch.when, data.today)}</td>
                              <td className={td}><Link to={itemHref({ mapId: ch.mapId, nodeId: ch.kind === 'node' ? ch.id : '' })} className={`hover:underline ${ch.field === 'status' && ch.to === 'done' ? 'line-through opacity-70' : ''}`}>{ch.title}</Link></td>
                              <td className={`${td} hidden md:table-cell`}>{mapLink(ch)}</td>
                              <td className={`${td} text-muted-foreground`}>{t(`changeField.${ch.field}`)}{ch.field === 'status' || ch.field === 'deadline' || ch.field === 'owner' || ch.field === 'parent' ? <>: {changeValue(ch, ch.from, nameOf)} → <b className="text-foreground">{changeValue(ch, ch.to, nameOf)}</b></> : null}</td>
                              <td className={`${td} hidden sm:table-cell whitespace-nowrap`}>{actorLabel(ch.actor, nameOf)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {s.changes.length > MAX_ROWS && <p className="mt-2 text-xs text-muted-foreground">{t('more', { count: s.changes.length - MAX_ROWS })}</p>}
                    </div>
                  )}
                </section>

                <p className="text-xs text-muted-foreground mt-6" data-testid="organizace-footer">
                  {t('footer', { team: data.scope.team, shared: data.scope.shared })}
                  {data.scope.excluded?.length ? ` ${excludedLabel(data.scope.excluded)}` : ''}
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
