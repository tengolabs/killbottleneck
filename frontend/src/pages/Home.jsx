import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Plus, Target, Trash2, Loader2, Map as MapIcon, Users, Sparkles, Share2, Eye, Building2, ShieldCheck, Archive, ChevronDown, ChevronUp, BarChart3 } from 'lucide-react';
import ShareDialog from '@/components/goal-map/ShareDialog';
import TemplatesSection from '@/components/goal-map/TemplatesSection';
import { useAuth } from '@/lib/AuthContext';
import AppHeader from '@/components/shared/AppHeader';
import NewMapActions from '@/components/shared/NewMapActions';
import { useMapCreation } from '@/hooks/useMapCreation';
import BufferPanel, { useBufferNodes } from '@/components/goal-map/BufferPanel';
import TimeLogPanel from '@/components/time/TimeLogPanel';
import ReportRailButton from '@/components/shared/ReportRailButton';
import MyDaySection from '@/components/shared/MyDaySection';
import MapCard from '@/components/home/MapCard';
import { useTasks } from '@/hooks/useTasks';
import { useToast } from '@/components/ui/use-toast';
import { nactiKlic, ulozKlic } from '@/lib/storageKeys';
import SkinPattern from '@/components/shared/SkinPattern';

export default function Home() {
  const navigate = useNavigate();
  const { t } = useTranslation('home');
  const { toast } = useToast();
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const [maps, setMaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const { ai, creating, openCreate, openAi, dialogs: mapCreationDialogs } = useMapCreation();
  const [shareMapId, setShareMapId] = useState(null);
  // sbalování sekcí projektů (jako panel Můj den) — pamatuje se v localStorage
  const [collapsedSections, setCollapsedSections] = useState(() => {
    try { return JSON.parse(nactiKlic('kb-home-collapsed') || '{}'); } catch { return {}; }
  });
  const toggleSection = (key) => setCollapsedSections((s) => {
    const next = { ...s, [key]: !s[key] };
    ulozKlic('kb-home-collapsed', JSON.stringify(next));
    return next;
  });
  const [searchParams] = useSearchParams();
  const view = searchParams.get('view') === 'templates' ? 'templates' : 'maps'; // taby řídí URL (naviguje se sem i z /tasks)
  const [org, setOrg] = useState(null);
  const buffer = useBufferNodes(user);
  const { items: taskItems, refresh: refreshTasks } = useTasks(user);
  const [bufferOpen, setBufferOpen] = useState(() => nactiKlic('kb-buffer-open') === '1');
  // levé panely se vzájemně vylučují (překrývaly by se) a otevřený odsouvá obsah
  const [timeLogOpen, setTimeLogOpen] = useState(() =>
    nactiKlic('kb-timelog-open') === '1' && nactiKlic('kb-buffer-open') !== '1');
  const toggleBuffer = useCallback(() => {
    setBufferOpen((v) => {
      ulozKlic('kb-buffer-open', v ? '0' : '1');
      if (!v) { setTimeLogOpen(false); ulozKlic('kb-timelog-open', '0'); }
      return !v;
    });
  }, []);
  const toggleTimeLog = useCallback(() => {
    setTimeLogOpen((v) => {
      ulozKlic('kb-timelog-open', v ? '0' : '1');
      if (!v) { setBufferOpen(false); ulozKlic('kb-buffer-open', '0'); }
      return !v;
    });
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadMaps();
    } else {
      setLoading(false);  // nepřihlášený nic nenačítá — titulka je jen rozcestník
    }
    base44.org.get().then(setOrg).catch(() => {});
  }, [isAuthenticated]);

  const loadMaps = async () => {
    try {
      const data = await base44.entities.GoalMap.list('-updated_date', 50);
      setMaps(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };


  // mé nehotové úkoly a cíle v mapě — badge „X úkolů" v sekci Kde působím.
  // Dedup uzel+úkol: úkol pověšený na můj uzel je detail uzlu, počítá ho uzel;
  // osiřelý node_id (uzel smazán) se počítá samostatně.
  const myOpenCount = (m) => {
    const email = user?.email;
    const nodes = (m.nodes || []).filter((n) => n.type !== 'note');
    const myNodeIds = new Set(nodes.filter((n) => n.data?.owner === email).map((n) => n.id));
    const nodeCount = nodes.filter((n) => n.data?.owner === email && n.data?.status !== 'done').length;
    const taskCount = taskItems.filter((task) =>
      task.map_id === m.id && task.assignee_email === email && task.status !== 'done'
      && !(task.node_id && myNodeIds.has(task.node_id))).length;
    return nodeCount + taskCount;
  };
  const isParticipating = (m) =>
    (m.shared_with || []).includes(user?.email)
    || (m.nodes || []).some((n) => n.type !== 'note' && n.data?.owner === user?.email)
    || taskItems.some((task) => task.map_id === m.id && task.assignee_email === user?.email);

  // archivované projekty se na dashboardu neukazují — žijí na stránce /archive.
  // Org struktura (kind='org') taky ne: není to projekt (Richard 15. 8.) —
  // vstup má pod panáčkem a ve Správě organizace.
  const activeMaps = maps.filter((m) => !m.archived && m.kind !== 'org');
  const archivedCount = maps.filter((m) => m.archived).length;
  const myMaps = activeMaps.filter((m) => m.created_by_id === user?.id);
  // projekty, kde mám roli: sdílené se mnou, nebo mám přiřazený cíl/úkol
  const participatingMaps = activeMaps.filter((m) => m.created_by_id !== user?.id && isParticipating(m));
  // mapy sdílené celé organizaci, kde žádnou roli nemám
  const orgMaps = activeMaps.filter((m) => m.created_by_id !== user?.id && !isParticipating(m) && m.team_access);

  const handleArchive = async (mapId) => {
    // Potvrzení stejně jako u mazání — archivace projekt schová z titulky
    // a bez dotazu je to omylem jedno kliknutí (Richard 27. 7. 2026).
    if (!window.confirm(t('confirmArchiveProject'))) return;
    try {
      await base44.entities.GoalMap.update(mapId, { archived: true });
      setMaps((prev) => prev.map((m) => (m.id === mapId ? { ...m, archived: true } : m)));
      toast({ title: t('editor:toasts.archived'), description: t('editor:toasts.archivedDesc') });
    } catch (e) {
      console.error(e);
      toast({ title: t('toasts.archiveFailed'), variant: 'destructive' });
    }
  };

  const handleDelete = async (mapId) => {
    if (!window.confirm(t('confirmDeleteProject'))) return;
    try {
      await base44.entities.GoalMap.delete(mapId);
      setMaps(maps.filter((m) => m.id !== mapId));
    } catch (e) {
      console.error(e);
    }
  };

  if (!isAuthenticated) {
    // Nepřihlášený jde ROVNOU na přihlašovací formulář (Richard 8. 8. 2026:
    // mezistránka „Přihlásit / Registrace" nedávala smysl — /login má odkaz
    // na registraci sám). Naplňuje původní rozhodnutí z 31. 7. „titulka se
    // očistí na login"; demo je zrušené, veřejné mapy ani šablony sem nepatří
    // (instance zákazníka není výkladní skříň). Během ověřování session se
    // NESMÍ přesměrovat — přihlášenému by login problikl při každém načtení.
    if (isLoadingAuth) return null;
    return <Navigate to="/login" replace />;
  }

  return (
    <div className={`min-h-screen bg-background relative transition-[padding] ${bufferOpen ? 'sm:pl-72' : timeLogOpen ? 'sm:pl-80' : ''}`}>
      <SkinPattern />
      <AppHeader
        active={view === 'templates' ? 'templates' : 'projects'}
        org={org}
        actions={
          <NewMapActions
            onCreate={openCreate}
            onAi={openAi}
            ai={ai}
            creating={creating}
          />
        }
      />
      {/* převod nápadu vyžaduje výběr projektu → dokončí se v dialogu na /tasks */}
      <BufferPanel buffer={buffer} canEdit={false} onConvert={(item) => navigate(`/tasks?convert=${item.id}`)} open={bufferOpen} onToggle={toggleBuffer} fixed leftOffset={timeLogOpen ? 320 : 0} />
      {user && <TimeLogPanel fixed open={timeLogOpen} onToggle={toggleTimeLog} leftOffset={bufferOpen ? 288 : 0} />}
      {user && <ReportRailButton fixed top="top-40" leftOffset={bufferOpen ? 288 : timeLogOpen ? 320 : 0} />}
      <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        {view === 'templates' ? (
          <TemplatesSection />
        ) : loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {user && (
              <MyDaySection
                user={user}
                ideas={buffer.items}
                onOpenIdea={() => { if (!bufferOpen) toggleBuffer(); }}
                orgName={org?.name}
                orgLogo={org?.logo_url}
                // Klik vede DO MAPY na uzel — u úkolu i u cíle stejně. Záměr
                // z commitu e55e509 („dialog zůstává jen u úkolů bez mapy") se
                // splnil až teď: od doby, co má úkol vždycky uzel, není důvod,
                // aby se dvě položky vedle sebe chovaly po kliknutí jinak.
                // Editace je v mapě (tužka / dvojklik) a v tabulce úkolů.
                // Záloha na osiřelý úkol bez uzlu (stará data) zůstává.
                onOpenTask={(item) => (item.mapId && item.nodeId
                  ? navigate(`/map/${item.mapId}?node=${item.nodeId}`)
                  : navigate(`/tasks?task=${item.id}`))}
                onOpenNode={(item) => navigate(`/map/${item.mapId}?node=${item.id}`)}
                // řádková akce mohla sáhnout na úkol i na uzel mapy → načíst obojí
                onChanged={() => { refreshTasks(); loadMaps(); }}
                onChipClick={(kind) => navigate(
                  kind === 'delegated'
                    ? '/tasks?owner=delegated'
                    : kind === 'delegatedOverdue'
                      ? '/tasks?owner=delegated&deadline=overdue'
                    : kind === 'done'
                      ? '/tasks?assignee=me&status=done'   // kam zmizela odbavená práce
                      : ['overdue', 'today', 'week'].includes(kind)
                        ? `/tasks?assignee=me&deadline=${kind}`
                        : '/tasks?assignee=me'
                )}
              />
            )}
            {maps.length === 0 ? (
              <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4">
              <MapIcon className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="font-heading text-lg font-semibold mb-1">
              {t('empty.title')}
            </h3>
            <p className="text-muted-foreground text-sm mb-4">
              {t('empty.desc')}
            </p>
            <div className="flex items-center gap-2 justify-center">
              <Button onClick={openCreate} disabled={creating}>
                {creating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                {t('empty.createFirst')}
              </Button>
              {(ai.has('generate') || ai.has('from_text')) && (
                <Button variant="outline" onClick={() => openAi()} disabled={creating}>
                  <Sparkles className="w-4 h-4" />
                  {t('newMap.withAi')}
                </Button>
              )}
            </div>
          </div>
            ) : (
              <div className="space-y-10">
              {myMaps.length > 0 && (
                <div>
                  <button onClick={() => toggleSection('my')} className="w-full flex items-center justify-between mb-4 group">
                    <h2 className="font-heading text-sm font-semibold text-muted-foreground uppercase tracking-wide group-hover:text-foreground">
                      {t('sections.myProjects')} <span className="normal-case font-normal">({myMaps.length})</span>
                    </h2>
                    {collapsedSections.my ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />}
                  </button>
                  {!collapsedSections.my && (<>
                  <p className="text-xs text-muted-foreground -mt-3 mb-4">{t('sections.myProjectsDesc')}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {myMaps.map((m) => (
                      <MapCard
                        key={m.id}
                        map={m}
                        icon={Target}
                        meta={t('misc.goalsMeta', { count: m.nodes?.length || 0 })}
                        onClick={() => navigate(`/map/${m.id}`)}
                        badges={
                          <div className="flex items-center gap-0.5">
                            {myOpenCount(m) > 0 && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium" title={t('badges.myOpenTitle')}>
                                {t('badges.tasksCount', { count: myOpenCount(m) })}
                              </span>
                            )}
                            {!(m.shared_with?.length) && !m.team_access && !m.is_public && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary text-muted-foreground text-xs font-medium" title={t('badges.private')}>
                                <ShieldCheck className="w-3.5 h-3.5" />
                              </span>
                            )}
                            {(m.shared_with?.length || 0) > 0 && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-accent text-accent-foreground text-xs font-medium" title={t('editor:share.sharedWith', { count: m.shared_with.length })}>
                                <Users className="w-3.5 h-3.5" />
                                {m.shared_with.length}
                              </span>
                            )}
                            {m.team_access && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium" title={t('badges.teamAccess', { mode: m.team_access === 'edit' ? t('misc.accessEdit') : t('misc.accessRead') })}>
                                <Building2 className="w-3.5 h-3.5" />
                              </span>
                            )}
                            {m.is_public && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300 text-xs font-medium" title={t('badges.public')}>
                                <Eye className="w-3.5 h-3.5" />
                              </span>
                            )}
                          </div>
                        }
                        actions={
                          <>
                            {/* nejčastější akce vlevo: „v jaké fázi to je" na jeden klik */}
                            <button
                              onClick={(e) => { e.stopPropagation(); navigate(`/map/${m.id}?view=dashboard`); }}
                              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                              title={t('mapCard.dashboardTitle')}
                            >
                              <BarChart3 className="w-4 h-4" /> {t('mapCard.dashboard')}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setShareMapId(m.id); }}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                              title={t('editor:toolbar.share')}
                              aria-label={t('editor:toolbar.share')}
                            >
                              <Share2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleArchive(m.id); }}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                              title={t('editor:toasts.archiveAction')}
                              aria-label={t('editor:toasts.archiveAction')}
                            >
                              <Archive className="w-4 h-4" />
                            </button>
                            {/* koš úplně stranou (ml-auto) — co nejdál od Dashboardu */}
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}
                              className="ml-auto inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive transition-colors"
                              title={t('common:actions.delete')}
                              aria-label={t('common:actions.delete')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        }
                      />
                    ))}
                  </div>
                  </>)}
                </div>
              )}

              {participatingMaps.length > 0 && (
                <div>
                  <button onClick={() => toggleSection('participating')} className="w-full flex items-center justify-between mb-4 group">
                    <h2 className="font-heading text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2 group-hover:text-foreground">
                      <Users className="w-4 h-4" />
                      {t('sections.participating')} <span className="normal-case font-normal">({participatingMaps.length})</span>
                    </h2>
                    {collapsedSections.participating ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />}
                  </button>
                  {!collapsedSections.participating && (<>
                  <p className="text-xs text-muted-foreground -mt-3 mb-4">{t('sections.participatingDesc')}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {participatingMaps.map((m) => {
                      const count = myOpenCount(m);
                      return (
                        <MapCard
                          key={m.id}
                          map={m}
                          icon={Users}
                          iconWrapClass="bg-accent"
                          iconClass="text-accent-foreground"
                          meta={`${t('misc.goalsMeta', { count: m.nodes?.length || 0 })} · ${m.created_by}`}
                          onClick={() => navigate(`/map/${m.id}`)}
                          badges={count > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium" title={t('badges.myOpenTitle')}>
                              {t('badges.tasksCount', { count })}
                            </span>
                          ) : undefined}
                        />
                      );
                    })}
                  </div>
                  </>)}
                </div>
              )}

              {orgMaps.length > 0 && (
                <div>
                  <button onClick={() => toggleSection('org')} className="w-full flex items-center justify-between mb-4 group">
                    <h2 className="font-heading text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2 group-hover:text-foreground">
                      <Building2 className="w-4 h-4" />
                      {t('sections.orgProjects')} <span className="normal-case font-normal">({orgMaps.length})</span>
                    </h2>
                    {collapsedSections.org ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />}
                  </button>
                  {!collapsedSections.org && (<>
                  <p className="text-xs text-muted-foreground -mt-3 mb-4">{t('sections.orgProjectsDesc')}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {orgMaps.map((m) => (
                      <MapCard
                        key={m.id}
                        map={m}
                        icon={Building2}
                        meta={`${t('misc.goalsMeta', { count: m.nodes?.length || 0 })} · ${m.created_by}`}
                        onClick={() => navigate(`/map/${m.id}`)}
                        badges={<span className="text-xs text-muted-foreground">{m.team_access === 'edit' ? t('misc.accessEdit') : t('misc.accessRead')}</span>}
                      />
                    ))}
                  </div>
                  </>)}
                </div>
              )}

              {archivedCount > 0 && (
                <Button
                  variant="link"
                  className="justify-start px-0 h-auto text-sm text-muted-foreground"
                  onClick={() => navigate('/archive')}
                >
                  <Archive className="w-4 h-4" /> {t('sections.archiveLink', { count: archivedCount })}
                </Button>
              )}
              </div>
            )}
          </>
        )}
      </div>
      <ShareDialog
        open={!!shareMapId}
        mapId={shareMapId}
        onClose={() => setShareMapId(null)}
      />
      {mapCreationDialogs}
    </div>
  );
}