import { useTranslation } from 'react-i18next';
import { Search, X, Filter, BarChart3 } from 'lucide-react';
import BufferPanel from '@/components/goal-map/BufferPanel';
import TimeLogPanel from '@/components/time/TimeLogPanel';
import ReportRailButton from '@/components/shared/ReportRailButton';

// Levá lišta plátna: zásobník, časovač, lupa, filtr Moje úkoly, dashboard,
// nahlásit chybu. Čistě prezentační: JSX přesunuto 1:1 z GoalMapEditor (F1-07).
export default function LeftRail({
  bufferEnabled, dashboardOpen, buffer, canEdit, insertBufferItem, bufferOpen, toggleBuffer,
  timeLogOpen, user, isPublicView, activeMapId, mapId, nodes, toggleTimeLog,
  railLeft, searchOpen, setSearchOpen, searchQuery, setSearchQuery,
  myTasksOnly, setMyTasksOnly, setDashboardOpen,
}) {
  const { t } = useTranslation('editor');
  return (
    <>
        {bufferEnabled && !dashboardOpen && (
          <BufferPanel
            buffer={buffer}
            canEdit={canEdit}
            onInsert={insertBufferItem}
            // Jednoklikový „převod na úkol" z editoru ODEBRÁN (Richard 7. 8.
            // 2026 v noci): tiše zakládal úkolový záznam na vrcholu — nikde
            // nebyl vidět a model říká „zakládáme uzly". Návrat do mapy dělá
            // vložení (šipka). Vědomý převod s výběrem projektu zůstává na
            // stránce Úkoly (otevírá plný dialog).
            open={bufferOpen}
            onToggle={toggleBuffer}
            leftOffset={timeLogOpen ? 320 : 0}
          />
        )}
        {user && !isPublicView && !dashboardOpen && (
          <TimeLogPanel mapId={activeMapId || mapId} nodes={nodes} open={timeLogOpen} onToggle={toggleTimeLog} leftOffset={bufferOpen ? 288 : 0} />
        )}
        {/* Levá lišta pod zásobníkem (top-16) a časovačem (top-28): LUPA
            rozbalí vyhledávání, FILTR přepíná Moje úkoly (Richard 11. 8. —
            z horní lišty pryč, „je to jen filtr"). Aktivní stav je vidět na
            ikoně, panely lištu odsouvají stejně jako ouška. */}
        {!dashboardOpen && (() => {
          const railCls = railLeft ? '' : 'border-l-0';
          return (
            <>
              {searchOpen ? (
                <div style={{ left: railLeft }} className={`absolute top-40 z-30 flex items-center gap-1 rounded-r-lg border ${railCls} bg-card pl-1 pr-1 py-1.5 shadow-md`}>
                  {/* lupa je přepínač: druhý klik pole zavře (dotaz zůstává platný
                      a zavřená lupa ho ukazuje podbarvením); křížek maže a zavírá */}
                  <button
                    onClick={() => setSearchOpen(false)}
                    className="p-1 shrink-0 text-primary hover:text-foreground"
                    title={t('toolbar.searchPlaceholder')}
                  >
                    <Search className="w-4 h-4" />
                  </button>
                  <input
                    autoFocus
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') { setSearchQuery(''); setSearchOpen(false); } }}
                    placeholder={t('toolbar.searchPlaceholder')}
                    className="h-7 w-44 bg-transparent text-sm outline-none"
                  />
                  <button
                    onClick={() => { setSearchQuery(''); setSearchOpen(false); }}
                    className="p-1 text-muted-foreground hover:text-foreground"
                    title={t('common:actions.close')}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setSearchOpen(true)}
                  style={{ left: railLeft }}
                  title={t('toolbar.searchPlaceholder')}
                  className={`absolute top-40 z-30 flex items-center rounded-r-lg border ${railCls} bg-card px-2 py-2.5 shadow-md hover:bg-secondary transition-all`}
                >
                  <Search className={`w-4 h-4 ${searchQuery ? 'text-primary' : 'text-muted-foreground'}`} />
                </button>
              )}
              {user && (
                <button
                  onClick={() => setMyTasksOnly((v) => !v)}
                  style={{ left: railLeft }}
                  title={t('toolbar.myTasksTitle')}
                  className={`absolute top-52 z-30 flex items-center rounded-r-lg border ${railCls} px-2 py-2.5 shadow-md transition-all ${myTasksOnly ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-secondary'}`}
                >
                  <Filter className="w-4 h-4" />
                </button>
              )}
            </>
          );
        })()}
        {/* Dashboard v levé liště POD filtrem (Richard 11. 8.) — vědomě MIMO
            guard !dashboardOpen: při otevřeném dashboardu zůstává viditelný
            (podbarvený) a druhým klikem ho zavřeš. Panely jsou v tu chvíli
            schované, takže lišta sedí u kraje. */}
        <button
          onClick={() => setDashboardOpen((v) => !v)}
          style={{ left: dashboardOpen ? 0 : railLeft }}
          title={t('toolbar.dashboardTitle')}
          className={`absolute top-64 z-30 flex items-center rounded-r-lg border px-2 py-2.5 shadow-md transition-all ${dashboardOpen ? 'bg-primary text-primary-foreground border-l-0' : `bg-card text-muted-foreground hover:bg-secondary ${(bufferOpen || timeLogOpen) ? '' : 'border-l-0'}`}`}
        >
          <BarChart3 className="w-4 h-4" />
        </button>
        {/* Nahlásit chybu rovnou z mapy — pod dashboardem (Richard 18. 8. 2026).
            Stránku si aplikace vezme sama, takže hlášení odsud nese mapu. */}
        {user && <ReportRailButton top="top-[19rem]" leftOffset={railLeft} />}
    </>
  );
}
