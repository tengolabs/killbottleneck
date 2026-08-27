import { useState, useEffect, useMemo, useCallback, useRef, forwardRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Calendar,
  CalendarClock,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  Flame,
  Users,
  ImageDown,
  Lightbulb,
  Loader2,
  Map as MapIcon,
  Pause,
  RefreshCw,
  Send,
  Sun,
  Sunrise,
  Target,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import TaskRowActions from '@/components/shared/TaskRowActions';
import { sortFocusFirst, focusStateOf } from '@/lib/focus';
import { base44 } from '@/api/base44Client';
import { refreshMySummary } from '@/functions/dailySummary';
import { fetchMyDay } from '@/functions/myDay';
import { useAiModes } from '@/hooks/useAiEnabled';
import { captureElementPng, shareElementPng, canShareImages } from '@/lib/dashboardExport';
import { getDeadlineStatus, formatDeadline } from '@/lib/nodeMeta';
import { todayNameDay } from '@/lib/nameDays';
import { intlLocale } from '@/lib/locale';
import { useToast } from '@/components/ui/use-toast';
import { nactiKlic, ulozKlic } from '@/lib/storageKeys';

const PER_SECTION = 5;

// „Můj den" — JEDEN osobní přehled sdílený Home i stránkou Úkoly (nahrazuje
// dřívější MyWorkSection + TasksDashboard). Vše je KLIKACÍ: chipy s čísly
// filtrují/odkazují, položky otevírají úkol/uzel (chování dodá stránka přes
// onOpenTask/onOpenNode/onChipClick). AI je jen volitelný řádek povzbuzení
// (bez AI se prostě nezobrazí) — úkoly nikdy nevyjmenovává.
//
// ⚠️ CO JE MOJE PRÁCE se počítá NA SERVERU (pb_hooks/helpers.js:buildMyDay) —
// tahle komponenta jen kreslí. Dřív tu byla druhá kopie téhož výpočtu (dedup
// uzel+úkol, „zadal jsem", bucketování podle termínu) a kvůli ní se do
// prohlížeče stahovaly všechny mapy a úkoly. Sémantiku měnit na serveru,
// ne tady — jinak se panel rozejde s AI sumářem i s lite režimem.
// storageKey + defaultCollapsed: každá stránka si pamatuje sbalení SAMA (Richard
// 11. 8.: „když to minimalizuji v jednom, je to v obou propojené" — Projekty mají
// být rozbalené, Úkoly sbalené; jeden sdílený klíč to svazoval dohromady).
export default function MyDaySection({ user, ideas = [], onOpenTask, onOpenNode, onOpenIdea, onChipClick, onChanged, orgName = '', orgLogo = '', storageKey = 'kb-myday', defaultCollapsed = false }) {
  const { t, i18n } = useTranslation('myday');
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();
  const { toast } = useToast();
  const ai = useAiModes();
  const [collapsed, setCollapsed] = useState(() => {
    const v = nactiKlic(storageKey);
    return v === null ? defaultCollapsed : v === '1';
  });
  // exporting = null | { mode: 'download'|'share', anon: bool }
  const [exporting, setExporting] = useState(null);
  const exportRef = useRef(null);
  const shareable = canShareImages(); // jen HTTPS/localhost — jinde se Sdílet nenabízí

  const [summary, setSummary] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const aiAvailable = ai.has('chat');
  useEffect(() => {
    if (!aiAvailable || !user) return;
    base44.entities.DailySummary.list('-date', 1)
      .then(async (list) => {
        const last = list?.[0] || null;
        setSummary(last);
        // Dnešní povzbuzení ještě není (ranní cron generuje jen nedávno aktivním
        // účtům) → dogenerovat při otevření. Jednou za sezení; chyba se tiše
        // spolkne — panel funguje i bez AI.
        // 'en-CA' = datový klíč YYYY-MM-DD (formát DB), NE zobrazení — neměnit dle jazyka!
        const today = new Date().toLocaleDateString('en-CA');
        if ((!last || last.date !== today) && !sessionStorage.getItem('kb-summary-autogen')) {
          sessionStorage.setItem('kb-summary-autogen', '1');
          setRefreshing(true);
          try {
            const { data } = await refreshMySummary();
            if (data?.summary) setSummary({ ...data.summary, updated_date: data.summary.updated });
          } catch { /* ticho — zůstane poslední/žádný */ }
          setRefreshing(false);
        }
      })
      .catch(() => {});
     
  }, [aiAvailable, user]);

  const handleRefreshSummary = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const { data } = await refreshMySummary();
      setSummary(data?.summary ? { ...data.summary, updated_date: data.summary.updated } : null);
    } catch (e) {
      toast({ title: t('panel.summaryFailed'), description: e?.response?.data?.error || e?.message, variant: 'destructive' });
    } finally {
      setRefreshing(false);
    }
  };

  // Data přehledu ze serveru. Sémantika (dedup uzel+úkol, „zadal jsem",
  // bucketování) je v pb_hooks/helpers.js:buildMyDay — tady se jen kreslí.
  const [day, setDay] = useState(null);
  const [dayError, setDayError] = useState(false);
  const reloadDay = useCallback(() => {
    if (!user?.email) return;
    fetchMyDay()
      .then((d) => { setDay(d); setDayError(false); })
      .catch(() => setDayError(true));
  }, [user]);
  useEffect(() => { reloadDay(); }, [reloadDay]);

  // Nápady ze zásobníku vrací server taky, ale otevírací dialog potřebuje CELÝ
  // záznam (popis, barva) — ten má stránka. Proto lookup přes id.
  const ideaById = useMemo(() => Object.fromEntries((ideas || []).map((b) => [b.id, b])), [ideas]);

  const sections = useMemo(() => {
    const S = day?.sections || {};
    // fokusovaný řádek plave na začátek své sekce (nejdůležitější úkol dne)
    const F = (arr) => sortFocusFirst(arr || [], user);
    return [
      { key: 'overdue', label: t('sections.overdue'), icon: Flame, cls: 'text-red-600 dark:text-red-400', items: F(S.overdue) },
      { key: 'today', label: t('sections.today'), icon: CalendarClock, cls: 'text-amber-600 dark:text-amber-400', items: F(S.today) },
      // „Zítra" přibylo s plánováním: když si můžu práci naplánovat na zítra,
      // musím ji zítra někde vidět (Richard 27. 7. 2026).
      { key: 'tomorrow', label: t('sections.tomorrow'), icon: Sunrise, cls: 'text-sky-600 dark:text-sky-400', items: F(S.tomorrow) },
      { key: 'week', label: t('sections.week'), icon: Clock, cls: 'text-blue-600 dark:text-blue-400', items: F(S.week) },
      { key: 'blocking', label: t('sections.blocking'), icon: TriangleAlert, cls: 'text-orange-600 dark:text-orange-400', items: S.blocking || [] },
      { key: 'delegated', label: t('sections.delegated'), icon: Send, cls: 'text-violet-600 dark:text-violet-400', items: S.delegated || [] },
      // „Nehýbe se" (A4) je ZÁMĚRNĚ poslední: není to fronta na dnešek, ale
      // přiznání, kde nástroj přestal odpovídat realitě. Do 27. 7. 2026 ho
      // uměl jen lite režim — panel na počítači tak ukazoval MÍŇ než mobil,
      // což je přesně naopak, než jak se ty dva režimy mají lišit.
      { key: 'stuck', label: t('sections.stuck'), icon: Pause, cls: 'text-muted-foreground', items: S.stuck || [] },
    ].filter((s) => s.items.length > 0);
  }, [day, t, user]);

  useEffect(() => {
    if (!exporting) return;
    (async () => {
      try {
        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `${t('export.fileName')}-${dateStr}${exporting.anon ? t('export.fileAnonSuffix') : ''}.png`;
        if (exporting.mode === 'share') {
          await shareElementPng(exportRef.current, fileName, t('export.shareTitle'));
        } else {
          await captureElementPng(exportRef.current, fileName);
        }
      } catch (e) {
        // zavření nativního sdílecího dialogu není chyba
        if (e?.name !== 'AbortError') {
          toast({ title: t('export.failed'), description: e?.message, variant: 'destructive' });
        }
      } finally {
        setExporting(null);
      }
    })();
     
  }, [exporting]);

  // Panel se ukáže hned po přihlášení (i s nulami — datum, svátek, prázdné chipy);
  // nový uživatel tak nezůstane bez „Můj den", dokud nedostane první úkol.
  if (!user?.email) return null;

  // Počty počítá server (a jsou tedy shodné s tím, co vidí AI sumář i light
  // režim). Dokud odpověď nedorazí, panel se ukáže s nulami — nový uživatel
  // tak nezůstane bez „Můj den" a nic neposkakuje.
  const counts = day?.counts || { overdue: 0, today: 0, week: 0, open: 0, done: 0, delegatedOverdue: 0 };
  const chips = [
    { key: 'overdue', label: t('sections.overdue'), value: counts.overdue, icon: Flame, cls: 'text-red-600 dark:text-red-400' },
    // „u druhých po termínu" — velké číslo dosud počítalo jen vlastní práci, takže
    // vedoucí viděl „Po termínu 0", zatímco týmu hořely 4 úkoly (nález P3-01).
    // Z vlastní delegace („Zadal jsem"), soukromí map to neporušuje.
    { key: 'delegatedOverdue', label: t('sections.delegatedOverdue'), value: counts.delegatedOverdue || 0, icon: Users, cls: 'text-rose-600 dark:text-rose-400' },
    { key: 'today', label: t('sections.today'), value: counts.today, icon: CalendarClock, cls: 'text-amber-600 dark:text-amber-400' },
    { key: 'week', label: t('sections.week'), value: counts.week, icon: Clock, cls: 'text-blue-600 dark:text-blue-400' },
    // „hotovo: N" je KLIKACÍ — Richard 27. 7. 2026: „v plném zobrazení nic
    // nebrání tomu, aby hotovo fungovalo jako odkaz". Vede na hotovou práci,
    // takže se dá dohledat, kam odbavená věc zmizela.
    { key: 'open', label: t('sections.open'), value: counts.open, icon: Circle, cls: 'text-primary',
      sub: t('panel.doneCount', { count: counts.done }), subKey: 'done' },
  ];

  const toggle = () => {
    setCollapsed((c) => {
      ulozKlic(storageKey, c ? '0' : '1');
      return !c;
    });
  };

  const deadlineClass = (item) => {
    const st = getDeadlineStatus(item.deadline, item.status);
    if (st === 'overdue') return 'text-red-600 dark:text-red-400';
    if (st === 'upcoming') return 'text-orange-600 dark:text-orange-400';
    return 'text-muted-foreground';
  };

  const openItem = (item) => {
    // nápad otevírá stránka nad CELÝM záznamem ze zásobníku (server posílá jen
    // to, co panel kreslí) — proto dopárování přes id
    if (item.kind === 'idea') onOpenIdea?.({ ...item, raw: ideaById[item.id] });
    else if (item.kind === 'node' || item.isNode) onOpenNode?.(item);
    else onOpenTask?.(item);
  };

  return (
    <div className="rounded-xl border bg-card mb-6">
      <div className="flex items-center gap-2 px-4 py-3">
        <button onClick={toggle} className="flex items-center gap-2 min-w-0 group text-left" title={collapsed ? t('panel.expand') : t('panel.collapse')}>
          <Sun className="w-4 h-4 text-primary shrink-0" />
          <h2 className="font-heading text-sm font-semibold group-hover:text-foreground">{t('panel.title')}</h2>
          <span className="text-xs text-muted-foreground hidden sm:inline truncate">
            {new Date().toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}
            {i18n.language === 'cs' && todayNameDay() && <> · {t('panel.nameDay')} <span className="font-medium">{todayNameDay()}</span></>}
          </span>
        </button>
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8" disabled={!!exporting} title={t('export.buttonTitle')}>
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageDown className="w-4 h-4" />}
                <span className="hidden lg:inline">{t('export.button')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setExporting({ mode: 'download', anon: false })}>
                {t('export.downloadPng')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setExporting({ mode: 'download', anon: true })} title={t('export.anonTitle')}>
                {t('export.downloadAnon')}
              </DropdownMenuItem>
              {shareable && (
                <>
                  <DropdownMenuItem onClick={() => setExporting({ mode: 'share', anon: false })}>
                    {t('export.share')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setExporting({ mode: 'share', anon: true })}>
                    {t('export.shareAnon')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={toggle} title={collapsed ? t('panel.expand') : t('panel.collapse')}>
            {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {chips.map((c) => (
              <button
                key={c.key}
                onClick={() => onChipClick?.(c.key)}
                className="rounded-lg border bg-background p-2.5 text-left hover:border-primary/50 hover:bg-secondary/40 transition-colors"
                title={c.key === 'open' ? t('panel.showAllTitle') : t('panel.filterTitle', { label: c.label.toLowerCase() })}
              >
                <div className={`flex items-center gap-1.5 text-xs font-medium ${c.cls}`}>
                  <c.icon className="w-3.5 h-3.5" /> {c.label}
                </div>
                <div className="text-xl font-heading font-bold mt-0.5">
                  {c.value}
                  {c.sub && (
                    <span
                      role={c.subKey ? 'link' : undefined}
                      tabIndex={c.subKey ? 0 : undefined}
                      onClick={c.subKey ? (e) => { e.stopPropagation(); onChipClick?.(c.subKey); } : undefined}
                      onKeyDown={c.subKey ? (e) => { if (e.key === 'Enter') { e.stopPropagation(); onChipClick?.(c.subKey); } } : undefined}
                      className={`ml-2 text-[11px] font-normal text-muted-foreground ${c.subKey ? 'underline underline-offset-2 hover:text-primary cursor-pointer' : ''}`}
                    >
                      {c.sub}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* tiché selhání by lhalo: panel s nulami vypadá jako „nemám co dělat" */}
          {dayError && (
            <div className="flex items-center gap-2 text-sm rounded-lg bg-destructive/10 text-destructive px-3 py-2">
              <span className="flex-1">{t('panel.loadFailed')}</span>
              <Button variant="ghost" size="sm" className="h-7" onClick={reloadDay}>{t('panel.retry')}</Button>
            </div>
          )}

          {aiAvailable && (
            <div className="flex items-start gap-2 text-sm rounded-lg bg-secondary/40 px-3 py-2">
              <span className="leading-relaxed flex-1 min-w-0 whitespace-pre-wrap">
                {refreshing ? t('panel.thinking') : (summary?.text || t('panel.noSummaryYet'))}
              </span>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={handleRefreshSummary} disabled={refreshing} title={t('panel.refreshTitle')}>
                {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              </Button>
            </div>
          )}

          {sections.map((s) => (
            <div key={s.key}>
              <p className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide mb-1 ${s.cls}`}>
                <s.icon className="w-3.5 h-3.5" /> {s.label} ({s.items.length})
              </p>
              <div className="rounded-lg border bg-background divide-y">
                {s.items.slice(0, PER_SECTION).map((item) => (
                  // Řádek = otevření detailu (button) + lišta akcí VEDLE něj.
                  // Akce nesmí být uvnitř otevíracího tlačítka (vnořené <button>
                  // je neplatné HTML a klik by propadl do otevření položky).
                  <div
                    key={`${item.kind}-${item.id}`}
                    className="group flex items-center hover:bg-secondary/50 transition-colors"
                  >
                  <button
                    onClick={() => openItem(item)}
                    className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2 text-left"
                  >
                    {item.kind === 'node'
                      ? <Target className="w-4 h-4 text-primary shrink-0" />
                      : item.kind === 'delegated'
                        ? <Send className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" />
                        : item.kind === 'idea'
                          ? <Lightbulb className="w-4 h-4 text-amber-500 shrink-0" />
                          : <CheckSquare className="w-4 h-4 text-muted-foreground shrink-0" />}
                    <span className="text-sm font-medium truncate">{item.title}</span>
                    {focusStateOf(user, item) && (
                      <span
                        data-focus-badge={focusStateOf(user, item)}
                        title={t(`panel.focusBadge.${focusStateOf(user, item)}`)}
                        className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 shrink-0"
                      >
                        ★ {t(`panel.focusBadge.${focusStateOf(user, item)}`)}
                      </span>
                    )}
                    {item.kind === 'idea' && (
                      <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 shrink-0">
                        {t('panel.ideaBadge')}
                      </span>
                    )}
                    {item.kind === 'delegated' && item.assignee && (() => {
                      // externí kontakt jménem z adresáře (server posílá assignee_label);
                      // bez něj anonymně — pseudo-e-mail se neukazuje nikdy
                      const who = item.assignee_label || (item.external ? t('nav:externalContacts.unknown') : item.assignee);
                      return (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300 shrink-0 max-w-[160px]"
                          title={t('panel.delegatedTo', { email: who })}
                        >
                          <Send className="w-3 h-3 shrink-0" /> <span className="truncate">{who}</span>
                        </span>
                      );
                    })()}
                    {item.blocks && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300 shrink-0"
                        title={t('panel.blocksTitle', { node: item.blocks })}
                      >
                        <TriangleAlert className="w-3 h-3" /> {t('panel.blocks', { node: item.blocks })}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-3 shrink-0">
                      {item.mapTitle && (
                        <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted-foreground max-w-[160px]">
                          <MapIcon className="w-3 h-3 shrink-0" /><span className="truncate">{item.mapTitle}</span>
                        </span>
                      )}
                      {item.deadline && (
                        <span className={`inline-flex items-center gap-1 text-[11px] ${deadlineClass(item)}`}>
                          <Calendar className="w-3 h-3" /> {formatDeadline(item.deadline)}
                        </span>
                      )}
                    </span>
                  </button>
                  {/* Vidět VŽDY, ne až na najetí myší — na dotyku hover neexistuje
                      a i na počítači nemá uživatel jak tušit, že tam akce jsou. */}
                  <TaskRowActions
                    item={item}
                    className="pr-2"
                    // Hláška říká, CO se stalo, a u odbavení nabídne vrácení —
                    // jinak úkol jen zmizí a člověk neví kam (Richard 27. 7. 2026).
                    onDone={(res, note, undo) => {
                      if (note) {
                        toast({
                          title: note,
                          action: undo ? (
                            <button
                              type="button"
                              onClick={async () => { try { await undo(); } finally { { reloadDay(); onChanged?.(); } } }}
                              className="shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-secondary"
                            >
                              {tCommon('rowActions.undo')}
                            </button>
                          ) : undefined,
                        });
                      }
                      { reloadDay(); onChanged?.(); }
                    }}
                    onError={(e) => toast({ title: t('rowActions.failed', { ns: 'common' }), description: e?.message, variant: 'destructive' })}
                  />
                  </div>
                ))}
                {s.items.length > PER_SECTION && (
                  <button
                    onClick={() => onChipClick?.(s.key === 'blocking' ? 'open' : s.key)}
                    className="w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-primary text-center"
                  >
                    {t('panel.more', { count: s.items.length - PER_SECTION })}
                  </button>
                )}
              </div>
            </div>
          ))}

          <div className="flex items-center gap-4">
            <button onClick={() => onChipClick?.('open')} className="text-xs font-medium text-primary hover:underline">
              {t('panel.allMyTasks')}
            </button>
            <button onClick={() => navigate('/my-map')} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              <MapIcon className="w-3.5 h-3.5" /> {t('myMap.link')} →
            </button>
          </div>
        </div>
      )}

      {/* skrytý render pro PNG export — mobilní šířka na výšku, vynucené světlé barvy */}
      {exporting && (
        <div className="fixed top-0 -left-[9999px]">
          <ExportCard
            ref={exportRef}
            counts={counts}
            done={counts.done}
            sections={sections.filter((s) => s.key !== 'delegated')}
            summaryText={exporting.anon ? '' : (summary?.text || '')}
            orgName={orgName}
            orgLogo={orgLogo}
            anonymous={exporting.anon}
          />
        </div>
      )}
    </div>
  );
}

// Karta pro export: záměrně žádné barevné tokeny (bg-card…) ani dark: varianty —
// obrázek musí být světlý i pro uživatele v tmavém režimu. Na rozdíl od panelu
// vypisuje KONKRÉTNÍ názvy úkolů — obrázek se čte bez aplikace. anonymous=true
// (pro socky/sdílení): STEJNÁ struktura vč. ikon, badge a termínů, jen názvy
// úkolů/projektů nahradí „začerněné" pruhy a AI text se vynechá (nese jména) —
// obrázek sdělí „lítám v tom", ale nic neprozradí.
// AI text nese jména úkolů → do anonymního obrázku místo něj pořekadlo dne
// (z katalogu myday:proverbs, rotuje podle data; bez autorů, bez AI, bez úniku).

const redactWidth = (len) => Math.min(180, Math.max(40, Math.round((len * 7) / 20) * 20));
const Redacted = ({ len, className = '' }) => (
  <span className={`inline-block h-3 rounded-full bg-slate-300 shrink-0 ${className}`} style={{ width: redactWidth(len || 8) }} />
);

const ExportCard = forwardRef(function ExportCard({ counts, done, sections, summaryText, orgName, orgLogo, anonymous = false }, ref) {
  const { t, i18n } = useTranslation('myday');
  const proverbs = t('proverbs', { returnObjects: true });
  const rows = [
    { label: t('sections.overdue'), value: counts.overdue, color: '#dc2626' },
    { label: t('sections.delegatedOverdue'), value: counts.delegatedOverdue || 0, color: '#e11d48' },
    { label: t('sections.today'), value: counts.today, color: '#d97706' },
    { label: t('sections.week'), value: counts.week, color: '#2563eb' },
    { label: t('sections.open'), value: counts.open, color: '#0f172a' },
  ];
  const sectionColor = { overdue: '#dc2626', today: '#d97706', week: '#2563eb', blocking: '#ea580c' };
  return (
    <div ref={ref} className="w-[480px] bg-white text-slate-900 p-6 font-sans">
      <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
        {orgLogo && <img src={orgLogo} alt="" className="w-10 h-10 rounded-lg object-contain border border-slate-200 shrink-0" />}
        <div>
          <p className="font-heading text-lg font-bold">{t('panel.title')}</p>
          <p className="text-xs text-slate-500">
            {orgName ? `${orgName} · ` : ''}
            {new Date().toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {i18n.language === 'cs' && todayNameDay() ? ` · ${t('panel.nameDay')} ${todayNameDay()}` : ''}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 mt-4">
        {rows.map((r) => (
          <div key={r.label} className="rounded-lg border border-slate-200 p-2">
            <p className="text-[10px] font-medium text-slate-500">{r.label}</p>
            <p className="text-2xl font-heading font-bold" style={{ color: r.color }}>{r.value}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500 mt-1.5">{t('panel.doneCount', { count: done })}</p>

      {anonymous ? (
        <p className="text-sm leading-relaxed mt-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
          💪 {proverbs[Math.floor(Date.now() / 86400000) % proverbs.length]}
        </p>
      ) : summaryText && (
        <p className="text-sm leading-relaxed whitespace-pre-wrap mt-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">{summaryText}</p>
      )}

      {sections.map((s) => (
        <div key={s.key} className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: sectionColor[s.key] || '#64748b' }}>
            {s.label} ({s.items.length})
          </p>
          <div className="mt-1 space-y-1.5">
            {s.items.slice(0, 8).map((item) => {
              const overdue = item.deadline && getDeadlineStatus(item.deadline, item.status) === 'overdue';
              return (
                <div key={`${item.kind}-${item.id}`} className="flex items-center gap-2">
                  {item.kind === 'node'
                    ? <Target className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                    : item.kind === 'idea'
                      ? <Lightbulb className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      : <CheckSquare className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                  {anonymous
                    ? <span className="flex-1 min-w-0"><Redacted len={item.title.length} /></span>
                    : <span className="text-sm font-medium truncate flex-1 min-w-0">{item.title}</span>}
                  {item.kind === 'idea' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0">{t('panel.ideaBadge')}</span>}
                  {item.blocks && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 shrink-0">{t('export.blocksBadge')}</span>}
                  {item.mapTitle && (anonymous
                    ? <Redacted len={item.mapTitle.length} className="opacity-60" />
                    : <span className="text-[11px] text-slate-400 truncate max-w-[120px] shrink-0">{item.mapTitle}</span>)}
                  {item.deadline && (
                    <span className={`text-[11px] shrink-0 ${overdue ? 'font-semibold text-red-600' : 'text-slate-500'}`}>
                      {formatDeadline(item.deadline)}
                    </span>
                  )}
                </div>
              );
            })}
            {s.items.length > 8 && <p className="text-[11px] text-slate-400">{t('export.more', { count: s.items.length - 8 })}</p>}
          </div>
        </div>
      ))}

      <p className="text-[10px] text-slate-400 mt-5 pt-3 border-t border-slate-200">{t('export.footer')}</p>
    </div>
  );
});
