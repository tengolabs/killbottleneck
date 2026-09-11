import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { DndContext, DragOverlay, pointerWithin } from '@dnd-kit/core';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Diamond,
  CheckSquare,
  ArrowUpRight,
  CalendarCheck2,
  Check,
  ListFilter,
  Search,
  X,
  Clock,
  AlertTriangle,
  CheckCircle2,
  FolderKanban,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
} from 'lucide-react';
import { STATUSES, statusConfig } from '@/lib/statusMeta';
import { intlLocale } from '@/lib/locale';
import { nactiKlic, ulozKlic } from '@/lib/storageKeys';
import { slozStitky, barvaProjektu } from '@/lib/kalendar';
import { projectName } from '@/lib/projectColors';
import { dateKey, parseDateKey, monthDays, weekDays, movePeriod, addDays } from './calendarDates';
import { useKalendarDnd } from './kalendar/useKalendarDnd';
import { DenCil, Tazitelny } from './kalendar/dnd';
import './TaskCalendar.css';

// Mobil (< 640 px): Měsíc = tečky + klepnutí na den otevře detail dne, Týden =
// svislý seznam dnů (CSS @media), tažení v Měsíci vypnuté (tečky se netahají).
function useMedia(dotaz) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(dotaz).matches);
  useEffect(() => {
    const mq = window.matchMedia(dotaz);
    const h = (e) => setM(e.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [dotaz]);
  return m;
}

const VIEWS = ['month', 'week', 'day', 'agenda'];

// Modern status palette
const STATUS_COLORS = {
  todo: '#3b82f6',        // Vibrant Blue
  in_progress: '#f59e0b', // Modern Amber
  done: '#10b981',        // Emerald Green
};

// Project color palette (Google-style distinct hues)
const PROJECT_PALETTE = [
  '#4f46e5', // Indigo
  '#0284c7', // Sky Blue
  '#059669', // Teal/Emerald
  '#d97706', // Amber
  '#7c3aed', // Violet
  '#db2777', // Pink/Rose
  '#0891b2', // Cyan
  '#ea580c', // Orange
];

export default function TaskCalendar({ items = [], maps = [], onOpen, onCreate, onPresun, kontextPresunu }) {
  // texty kalendáře v2 = líný ns `kalendar` (tasks.json se veze do lite — strop 510 kB);
  // z `tasks` zůstává jen společné calendar.more/dow/todayButton (sdílí TaskTimeline) a tasksPage.*
  const { t } = useTranslation('kalendar');
  const { t: tTasks } = useTranslation('tasks');
  const todayKey = dateKey(new Date());
  const today = parseDateKey(todayKey) || new Date();

  const [cursor, setCursor] = useState(() => parseDateKey(todayKey));
  const [selectedKey, setSelectedKey] = useState(todayKey);
  const [miniCursor, setMiniCursor] = useState(() => parseDateKey(todayKey));
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const saved = nactiKlic('kb-calendar-sidebar');
    return saved !== null ? saved === 'true' : true;
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState(() => {
    const saved = nactiKlic('kb-calendar-view');
    return VIEWS.includes(saved) ? saved : 'month';
  });

  // Filters: statuses and projects
  const [visibleStatuses, setVisibleStatuses] = useState(() => new Set(STATUSES.map((s) => s.value)));
  // Skryté projekty (prázdná množina = vše vidět) — nová mapa je tak viditelná bez synchronizace.
  const [hiddenProjects, setHiddenProjects] = useState(() => new Set());

  // Day popover / modal state
  const [activeDayModalKey, setActiveDayModalKey] = useState(null);

  const panelRef = useRef(null);
  const searchInputRef = useRef(null);
  const locale = intlLocale();

  // Project map metadata: color, title
  const projectMeta = useMemo(() => {
    const meta = {};
    maps.forEach((map, idx) => {
      // barva a název projektu jako všude v aplikaci (goalmaps.color, emoji
      // v názvu se nekreslí); paleta jen pro mapy bez vlastní barvy
      meta[map.id] = {
        title: projectName(map) || t('v2.noProject'),
        color: barvaProjektu(map) || PROJECT_PALETTE[idx % PROJECT_PALETTE.length],
      };
    });
    return meta;
  }, [maps, t]);

  const getProjectName = useCallback((item) => {
    const mapId = item.raw?.map_id;
    return projectMeta[mapId]?.title || t('v2.noProject');
  }, [projectMeta, t]);

  const getProjectColor = useCallback((item) => {
    const mapId = item.raw?.map_id;
    return projectMeta[mapId]?.color || '#64748b';
  }, [projectMeta]);

  // Valid and filtered items
  const validItems = useMemo(() => {
    return items.filter((item) => parseDateKey(item.deadline));
  }, [items]);

  // Přetažení termínu (dnd-kit, mechanika z feat/kalendar): štítek = tvar pro
  // lib/kalendar.js (matice vyhodnotPresun). Bez onPresun/kontextPresunu se nic
  // netáhne — kalendář se chová jako dodávka.
  const mobil = useMedia('(max-width: 639px)');
  const dndZapnuto = typeof onPresun === 'function' && typeof kontextPresunu === 'function' && !(mobil && view === 'month');
  const stitky = useMemo(() => {
    const m = new Map();
    for (const st of slozStitky(validItems, { ukazPlan: false, dnes: todayKey })) m.set(st.item.key, st);
    return m;
  }, [validItems, todayKey]);
  const mapsById = useMemo(() => Object.fromEntries(maps.map((m) => [m.id, m])), [maps]);
  // hotové se netahají; uzel jen když je mapa i s uzly v paměti (fáze 2 načtení);
  // úkolový záznam bez mapy by matice odmítla „mapaChybi“ → rovnou vypnout
  const smiTahnout = useCallback((item) => dndZapnuto && item.status !== 'done' && !!item.map_id
    && (item.kind !== 'node' || Array.isArray(mapsById[item.map_id]?.nodes)), [dndZapnuto, mapsById]);
  const dnd = useKalendarDnd({
    kontextPro: kontextPresunu || (() => ({})),
    onAkce: onPresun || (() => {}),
  });

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return validItems.filter((item) => {
      // Status filter
      const st = item.status in STATUS_COLORS ? item.status : 'todo';
      if (!visibleStatuses.has(st)) return false;

      // Project filter
      const mapId = item.raw?.map_id;
      if (mapId && hiddenProjects.has(mapId)) return false;

      // Search query
      if (q) {
        const titleMatch = (item.title || '').toLowerCase().includes(q);
        const projMatch = getProjectName(item).toLowerCase().includes(q);
        if (!titleMatch && !projMatch) return false;
      }

      return true;
    });
  }, [validItems, visibleStatuses, hiddenProjects, searchQuery, getProjectName]);

  // Group items by deadline day
  const byDay = useMemo(() => {
    const result = {};
    filteredItems.forEach((item) => {
      (result[item.deadline] ||= []).push(item);
    });
    Object.values(result).forEach((list) => {
      list.sort((a, b) => {
        // Unfinished first, then overdue, then title
        if (a.status === 'done' && b.status !== 'done') return 1;
        if (a.status !== 'done' && b.status === 'done') return -1;
        return a.title.localeCompare(b.title, locale);
      });
    });
    return result;
  }, [filteredItems, locale]);

  // Grid dates
  const grid = useMemo(() => monthDays(cursor), [cursor]);
  const miniGrid = useMemo(() => monthDays(miniCursor), [miniCursor]);
  const week = useMemo(() => weekDays(cursor), [cursor]);

  const periodDays = useMemo(() => {
    if (view === 'week') return week;
    if (view === 'day') return [cursor];
    return grid.filter((date) => date.getMonth() === cursor.getMonth());
  }, [view, week, cursor, grid]);

  const periodKeys = useMemo(() => new Set(periodDays.map(dateKey)), [periodDays]);
  const periodItems = useMemo(() => filteredItems.filter((item) => periodKeys.has(item.deadline)), [filteredItems, periodKeys]);

  // Status statistics for current period
  const statusCounts = useMemo(() => {
    return Object.fromEntries(
      STATUSES.map((status) => [
        status.value,
        validItems.filter((item) => periodKeys.has(item.deadline) && (item.status || 'todo') === status.value).length,
      ])
    );
  }, [validItems, periodKeys]);

  // Project statistics
  const projectCounts = useMemo(() => {
    const counts = {};
    maps.forEach((m) => {
      counts[m.id] = validItems.filter((item) => periodKeys.has(item.deadline) && item.raw?.map_id === m.id).length;
    });
    return counts;
  }, [maps, validItems, periodKeys]);

  // Overdue count
  const overdueCount = useMemo(() => {
    return periodItems.filter((item) => item.deadline < todayKey && item.status !== 'done').length;
  }, [periodItems, todayKey]);

  const completedCount = useMemo(() => {
    return periodItems.filter((item) => item.status === 'done').length;
  }, [periodItems]);

  // Period label
  const periodLabel = useMemo(() => {
    if (view === 'day') {
      return cursor.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
    if (view === 'week') {
      const start = week[0];
      const end = week[6];
      if (start.getMonth() === end.getMonth()) {
        return `${start.getDate()}. – ${end.getDate()}. ${start.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}`;
      }
      return `${start.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    }
    return cursor.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  }, [view, cursor, week, locale]);

  // Navigation handlers
  const selectDay = (date, reveal = false) => {
    const key = dateKey(date);
    setSelectedKey(key);
    setCursor(date);
    setMiniCursor(date);
    if (reveal && panelRef.current) {
      panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  const move = (delta) => {
    selectDay(movePeriod(cursor, view, delta));
  };

  const changeView = (next) => {
    setView(next);
    ulozKlic('kb-calendar-view', next);
  };

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      ulozKlic('kb-calendar-sidebar', String(next));
      return next;
    });
  };

  const toggleStatus = (status) => {
    setVisibleStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        if (next.size > 1) next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  };

  const toggleProject = (mapId) => {
    setHiddenProjects((prev) => {
      const next = new Set(prev);
      if (next.has(mapId)) {
        next.delete(mapId);
      } else {
        next.add(mapId);
      }
      return next;
    });
  };

  const toggleAllProjects = () => {
    setHiddenProjects((prev) => (prev.size === 0 ? new Set(maps.map((m) => m.id)) : new Set()));
  };

  // Klávesy t/m/w/d/a jen když uživatel nepíše, není otevřený dialog/modal
  // a neprobíhá tažení; handler přes ref → listener se registruje jednou.
  const handleKeyDown = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const el = event.target;
    if (!el || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return;
    if (typeof el.closest === 'function' && el.closest('[role="dialog"]')) return;
    if (event.key === 'Escape') {
      if (activeDayModalKey) { event.preventDefault(); setActiveDayModalKey(null); }
      return;
    }
    if (activeDayModalKey || dnd.aktivni) return;
    if (event.key === 't' || event.key === 'T') {
      event.preventDefault();
      selectDay(today);
    } else if (event.key === 'm' || event.key === 'M') {
      changeView('month');
    } else if (event.key === 'w' || event.key === 'W') {
      changeView('week');
    } else if (event.key === 'd' || event.key === 'D') {
      changeView('day');
    } else if (event.key === 'a' || event.key === 'A') {
      changeView('agenda');
    }
  };
  const keyHandlerRef = useRef(handleKeyDown);
  keyHandlerRef.current = handleKeyDown;

  useEffect(() => {
    const onKey = (event) => keyHandlerRef.current(event);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Event chip rendering (Google Calendar style)
  const renderEventChip = (item, options = {}) => {
    const isDone = item.status === 'done';
    const isOverdue = item.deadline < todayKey && !isDone;
    const projColor = getProjectColor(item);
    const statusColor = STATUS_COLORS[item.status] || STATUS_COLORS.todo;
    const accentColor = options.colorByProject ? projColor : statusColor;

    const chip = (h) => (
      <button
        type="button"
        ref={h?.ref}
        className="gcal-event-chip"
        style={{
          '--event-color': accentColor,
          '--proj-color': projColor,
          ...(h?.style || {}),
        }}
        data-done={isDone}
        data-overdue={isOverdue}
        data-dragging={h?.isDragging || undefined}
        data-tazitelny={h ? !h.disabled : undefined}
        data-testid={`gcal-chip-${item.key}`}
        onClick={(e) => {
          e.stopPropagation();
          onOpen?.(item);
        }}
        title={`${item.title} · ${getProjectName(item)} · ${(statusConfig[item.status] || statusConfig.todo).label}${isOverdue ? ` (${t('v2.overdue')})` : ''}`}
        {...(h?.props || {})}
      >
        <span className="gcal-chip-icon">
          {isDone ? (
            <Check size={11} strokeWidth={2.8} />
          ) : item.kind === 'node' ? (
            <Diamond size={10} strokeWidth={2.4} />
          ) : (
            <CheckSquare size={10} strokeWidth={2} />
          )}
        </span>

        <span className="gcal-chip-title">{item.title}</span>

        {isOverdue && (
          <span className="gcal-chip-overdue-dot" title={t('v2.overdue')} />
        )}
      </button>
    );
    // overlay = kopie pod kurzorem během tažení (bez druhého useDraggable se stejným id)
    if (options.overlay) return chip(null);
    const stitek = stitky.get(item.key);
    if (!stitek) return <span key={item.key}>{chip(null)}</span>;
    return (
      <Tazitelny key={item.key} stitek={stitek} disabled={!smiTahnout(item)}>
        {chip}
      </Tazitelny>
    );
  };

  // Detailed event card for Day & Agenda views
  const renderDetailCard = (item) => {
    const isDone = item.status === 'done';
    const isOverdue = item.deadline < todayKey && !isDone;
    const projColor = getProjectColor(item);
    const statusColor = STATUS_COLORS[item.status] || STATUS_COLORS.todo;
    const statusLabel = (statusConfig[item.status] || statusConfig.todo).label;

    return (
      <button
        type="button"
        key={item.key}
        className="gcal-detail-card"
        style={{
          '--status-color': statusColor,
          '--proj-color': projColor,
        }}
        data-done={isDone}
        data-overdue={isOverdue}
        onClick={() => onOpen?.(item)}
      >
        <div className="gcal-card-indicator" />
        <div className="gcal-card-icon">
          {isDone ? (
            <CheckCircle2 size={16} className="text-emerald-500" />
          ) : item.kind === 'node' ? (
            <Diamond size={15} style={{ color: projColor }} />
          ) : (
            <CheckSquare size={15} style={{ color: statusColor }} />
          )}
        </div>

        <div className="gcal-card-content">
          <div className="gcal-card-title-row">
            <span className="gcal-card-title">{item.title}</span>
            {isOverdue && (
              <span className="gcal-badge-overdue">
                <AlertTriangle size={11} /> {t('v2.overdue')}
              </span>
            )}
          </div>
          <div className="gcal-card-meta">
            <span className="gcal-project-tag">
              <span className="gcal-project-dot" style={{ backgroundColor: projColor }} />
              {getProjectName(item)}
            </span>
            <span className="gcal-status-pill">{statusLabel}</span>
            <span className="gcal-card-date">
              <Clock size={11} /> {item.deadline}
            </span>
          </div>
        </div>

        <div className="gcal-card-action">
          <ArrowUpRight size={15} />
        </div>
      </button>
    );
  };

  // Active modal day items
  const activeModalItems = activeDayModalKey ? byDay[activeDayModalKey] || [] : [];
  const activeModalDate = activeDayModalKey ? parseDateKey(activeDayModalKey) : null;

  return (
    <DndContext
      sensors={dnd.sensors}
      collisionDetection={pointerWithin}
      onDragStart={dnd.onDragStart}
      onDragOver={dnd.onDragOver}
      onDragEnd={dnd.onDragEnd}
      onDragCancel={dnd.onDragCancel}
    >
    <section className="gcal-wrapper" aria-label={t('v2.title')} data-drag={dnd.aktivni ? 'true' : undefined}>
      {/* Top Main Navigation Bar (Google Calendar style) */}
      <header className="gcal-topbar">
        <div className="gcal-topbar-left">
          <button
            type="button"
            className="gcal-icon-btn gcal-sidebar-toggle"
            onClick={toggleSidebar}
            title={t('v2.toggleSidebar')}
            aria-label={t('v2.toggleSidebar')}
          >
            {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>

          <div className="gcal-brand-header">
            <div className="gcal-logo-box">
              <CalendarDays size={20} />
            </div>
            <div className="gcal-brand-text">
              <h2>{t('v2.title')}</h2>
              <span className="gcal-brand-sub">{t('v2.liveData')}</span>
            </div>
          </div>

          <div className="gcal-nav-group">
            <button
              type="button"
              className="gcal-btn-today"
              onClick={() => selectDay(today)}
            >
              {tTasks('calendar.todayButton')}
            </button>

            <div className="gcal-nav-arrows">
              <button
                type="button"
                className="gcal-icon-btn"
                onClick={() => move(-1)}
                aria-label={t(`v2.previous.${view}`)}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                className="gcal-icon-btn"
                onClick={() => move(1)}
                aria-label={t(`v2.next.${view}`)}
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <h3 className="gcal-current-period-title">{periodLabel}</h3>
          </div>
        </div>

        {/* Center: Quick Search Bar */}
        <div className="gcal-search-box">
          <Search size={15} className="gcal-search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            className="gcal-search-input"
            placeholder={t('v2.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="gcal-search-clear"
              onClick={() => {
                setSearchQuery('');
                searchInputRef.current?.focus();
              }}
              aria-label={t('v2.close')}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Right: View Switcher and Create Button */}
        <div className="gcal-topbar-right">
          <div className="gcal-view-selector" role="group" aria-label={t('v2.viewLabel')}>
            {VIEWS.map((mode) => (
              <button
                type="button"
                key={mode}
                className="gcal-view-btn"
                data-active={view === mode}
                onClick={() => changeView(mode)}
              >
                {t(`v2.views.${mode}`)}
              </button>
            ))}
          </div>

          {onCreate && (
            <button
              type="button"
              className="gcal-create-primary-btn"
              onClick={() => onCreate(selectedKey)}
            >
              <Plus size={16} strokeWidth={2.5} />
              <span>{t('v2.createButton')}</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Workspace Layout (Sidebar + Calendar Canvas) */}
      <div className={`gcal-main-layout ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
        {/* Left Sidebar */}
        {sidebarOpen && (
          <aside className="gcal-sidebar" aria-label={t('v2.navigation')}>
            {onCreate && (
              <button
                type="button"
                className="gcal-fab-create"
                onClick={() => onCreate(selectedKey)}
              >
                <div className="gcal-fab-plus">
                  <Plus size={20} strokeWidth={2.5} />
                </div>
                <span>{tTasks('tasksPage.newTask')}</span>
              </button>
            )}

            {/* Google-style Mini Calendar */}
            <div className="gcal-mini-calendar">
              <div className="gcal-mini-header">
                <strong>{miniCursor.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</strong>
                <div className="gcal-mini-arrows">
                  <button
                    type="button"
                    className="gcal-mini-arrow-btn"
                    onClick={() => setMiniCursor(movePeriod(miniCursor, 'month', -1))}
                    aria-label={t('v2.miniPrev')}
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    type="button"
                    className="gcal-mini-arrow-btn"
                    onClick={() => setMiniCursor(movePeriod(miniCursor, 'month', 1))}
                    aria-label={t('v2.miniNext')}
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>

              <div className="gcal-mini-weekdays">
                {Array.from({ length: 7 }, (_, i) => (
                  <span key={i}>{tTasks(`calendar.dow.${i}`)}</span>
                ))}
              </div>

              <div className="gcal-mini-grid">
                {miniGrid.map((date) => {
                  const key = dateKey(date);
                  const isOutside = date.getMonth() !== miniCursor.getMonth();
                  const isToday = key === todayKey;
                  const isSelected = key === selectedKey;
                  const hasItems = !!byDay[key]?.length;

                  return (
                    <button
                      type="button"
                      key={key}
                      className="gcal-mini-cell"
                      data-outside={isOutside}
                      data-today={isToday}
                      data-selected={isSelected}
                      data-has-items={hasItems}
                      onClick={() => selectDay(date)}
                    >
                      <span>{date.getDate()}</span>
                      {hasItems && <span className="gcal-mini-dot" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Projects Filter (My Calendars) */}
            <div className="gcal-sidebar-section">
              <div className="gcal-section-header">
                <span className="gcal-section-title">
                  <FolderKanban size={14} /> {t('v2.filterProjects')}
                </span>
                {maps.length > 1 && (
                  <button
                    type="button"
                    className="gcal-filter-toggle-all"
                    onClick={toggleAllProjects}
                  >
                    {hiddenProjects.size === 0 ? t('v2.projectsNone') : t('v2.projectsAll')}
                  </button>
                )}
              </div>

              <div className="gcal-project-list">
                {maps.map((map) => {
                  const meta = projectMeta[map.id] || {};
                  const isChecked = !hiddenProjects.has(map.id);
                  const count = projectCounts[map.id] || 0;

                  return (
                    <label key={map.id} className="gcal-filter-row" style={{ '--gcal-accent': meta.color }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleProject(map.id)}
                        className="gcal-checkbox"
                      />
                      <span className="gcal-custom-checkbox" style={{ borderColor: meta.color, backgroundColor: isChecked ? meta.color : 'transparent' }}>
                        {isChecked && <Check size={10} color="#fff" strokeWidth={3} />}
                      </span>
                      <span className="gcal-filter-label" title={map.title}>{map.title}</span>
                      <span className="gcal-filter-count">{count}</span>
                    </label>
                  );
                })}
                {maps.length === 0 && (
                  <p className="gcal-empty-hint">{t('v2.noProject')}</p>
                )}
              </div>
            </div>

            {/* Statuses Filter */}
            <div className="gcal-sidebar-section">
              <div className="gcal-section-header">
                <span className="gcal-section-title">
                  <ListFilter size={14} /> {t('v2.showStatuses')}
                </span>
              </div>

              <div className="gcal-status-list">
                {STATUSES.map((status) => {
                  const isChecked = visibleStatuses.has(status.value);
                  const color = STATUS_COLORS[status.value] || '#3b82f6';
                  const count = statusCounts[status.value] || 0;

                  return (
                    <label key={status.value} className="gcal-filter-row" style={{ '--gcal-accent': color }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleStatus(status.value)}
                        className="gcal-checkbox"
                      />
                      <span className="gcal-custom-checkbox" style={{ borderColor: color, backgroundColor: isChecked ? color : 'transparent' }}>
                        {isChecked && <Check size={10} color="#fff" strokeWidth={3} />}
                      </span>
                      <span className="gcal-filter-label">{status.label}</span>
                      <span className="gcal-filter-count">{count}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Quick Metrics Card */}
            <div className="gcal-metrics-card">
              <div className="gcal-metrics-header">
                <Sparkles size={14} className="text-amber-500" />
                <span>{t('v2.quickStats')}</span>
              </div>
              <div className="gcal-metrics-body">
                <div className="gcal-metric-item">
                  <span className="gcal-metric-num">{periodItems.length}</span>
                  <span className="gcal-metric-text">{t('v2.totalDeadlines', { count: periodItems.length })}</span>
                </div>
                {overdueCount > 0 && (
                  <div className="gcal-metric-item overdue">
                    <span className="gcal-metric-num text-rose-500">{overdueCount}</span>
                    <span className="gcal-metric-text text-rose-500">{t('v2.overdueCount', { count: overdueCount })}</span>
                  </div>
                )}
                <div className="gcal-progress-wrapper">
                  <div className="gcal-progress-header">
                    <span>{t('v2.completedCount', { count: completedCount })}</span>
                    <span>{periodItems.length > 0 ? Math.round((completedCount / periodItems.length) * 100) : 0}%</span>
                  </div>
                  <div className="gcal-progress-track">
                    <div
                      className="gcal-progress-bar"
                      style={{ width: `${periodItems.length > 0 ? (completedCount / periodItems.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </aside>
        )}

        {/* Main Calendar View Area */}
        <div className="gcal-content-pane">
          {/* ==================== MONTH VIEW ==================== */}
          {view === 'month' && (
            <div className="gcal-month-view">
              <div className="gcal-month-weekdays-header">
                {Array.from({ length: 7 }, (_, i) => (
                  <div key={i} className="gcal-month-weekday-cell">
                    {tTasks(`calendar.dow.${i}`)}
                  </div>
                ))}
              </div>

              <div className="gcal-month-grid">
                {grid.map((date, index) => {
                  const key = dateKey(date);
                  const isOutside = date.getMonth() !== cursor.getMonth();
                  const isToday = key === todayKey;
                  const isSelected = key === selectedKey;
                  const isWeekend = index % 7 >= 5;
                  const dayItems = byDay[key] || [];
                  const visibleChips = dayItems.slice(0, 3);
                  const moreCount = dayItems.length - visibleChips.length;

                  return (
                    <DenCil
                      key={key}
                      den={key}
                      cil={dnd.cil}
                      disabled={!dndZapnuto}
                      className="gcal-month-cell"
                      data-outside={isOutside}
                      data-today={isToday}
                      data-selected={isSelected}
                      data-weekend={isWeekend}
                      onClick={() => { selectDay(date); if (mobil && dayItems.length > 0) setActiveDayModalKey(key); }}
                      onDoubleClick={() => onCreate?.(key)}
                    >
                      <div className="gcal-cell-header">
                        {onCreate && (
                          <button
                            type="button"
                            className="gcal-cell-quick-add"
                            title={t('v2.addOn', { date: key })}
                            onClick={(e) => {
                              e.stopPropagation();
                              onCreate(key);
                            }}
                          >
                            <Plus size={13} />
                          </button>
                        )}

                        <span
                          className="gcal-cell-date-badge"
                          data-today={isToday}
                          data-selected={isSelected}
                        >
                          {date.getDate()}
                        </span>
                      </div>

                      <div className="gcal-cell-events">
                        {visibleChips.map((item) => renderEventChip(item))}
                        {moreCount > 0 && (
                          <button
                            type="button"
                            className="gcal-more-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              selectDay(date);
                              setActiveDayModalKey(key);
                            }}
                          >
                            {tTasks('calendar.more', { moreCount })}
                          </button>
                        )}
                      </div>
                    </DenCil>
                  );
                })}
              </div>
            </div>
          )}

          {/* ==================== WEEK VIEW ==================== */}
          {view === 'week' && (
            <div className="gcal-week-view">
              <div className="gcal-week-header-row">
                {week.map((date) => {
                  const key = dateKey(date);
                  const isToday = key === todayKey;
                  const isSelected = key === selectedKey;

                  return (
                    <button
                      key={key}
                      type="button"
                      className="gcal-week-header-cell"
                      data-today={isToday}
                      data-selected={isSelected}
                      onClick={() => selectDay(date)}
                    >
                      <span className="gcal-week-dow">
                        {date.toLocaleDateString(locale, { weekday: 'short' }).toUpperCase()}
                      </span>
                      <span className="gcal-week-num-badge" data-today={isToday}>
                        {date.getDate()}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="gcal-week-columns-grid">
                {week.map((date) => {
                  const key = dateKey(date);
                  const isToday = key === todayKey;
                  const dayItems = byDay[key] || [];

                  return (
                    <DenCil
                      key={key}
                      den={key}
                      cil={dnd.cil}
                      disabled={!dndZapnuto}
                      className="gcal-week-column"
                      data-today={isToday}
                      onClick={() => selectDay(date)}
                    >
                      <div className="gcal-week-col-day">
                        <span className="gcal-week-num-badge" data-today={isToday}>{date.getDate()}</span>
                        <span className="gcal-week-col-day-name">{date.toLocaleDateString(locale, { weekday: 'long' })}</span>
                      </div>
                      <div className="gcal-week-column-content">
                        {dayItems.map((item) => (
                          <Tazitelny key={item.key} stitek={stitky.get(item.key)} disabled={!smiTahnout(item)}>
                          {(h) => (
                          <div
                            ref={h.ref}
                            className="gcal-week-event-card"
                            style={{
                              '--status-color': STATUS_COLORS[item.status] || STATUS_COLORS.todo,
                              '--proj-color': getProjectColor(item),
                              ...h.style,
                            }}
                            data-done={item.status === 'done'}
                            data-dragging={h.isDragging || undefined}
                            data-tazitelny={!h.disabled}
                            data-testid={`gcal-chip-${item.key}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpen?.(item);
                            }}
                            {...h.props}
                          >
                            <div className="gcal-week-card-head">
                              <span
                                className="gcal-week-project-badge"
                                style={{ backgroundColor: `${getProjectColor(item)}18`, color: getProjectColor(item) }}
                              >
                                {getProjectName(item)}
                              </span>
                              {item.deadline < todayKey && item.status !== 'done' && (
                                <AlertTriangle size={12} className="text-rose-500" />
                              )}
                            </div>
                            <h4 className="gcal-week-event-title">{item.title}</h4>
                            <div className="gcal-week-card-foot">
                              <span className="gcal-week-status-pill">
                                {(statusConfig[item.status] || statusConfig.todo).label}
                              </span>
                            </div>
                          </div>
                          )}
                          </Tazitelny>
                        ))}

                        {dayItems.length === 0 && (
                          <div className="gcal-week-empty-column">
                            <span className="gcal-week-free-text">{t('v2.freeDay')}</span>
                            {onCreate && (
                              <button
                                type="button"
                                className="gcal-week-quick-add-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onCreate(key);
                                }}
                              >
                                <Plus size={13} /> {t('v2.add')}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </DenCil>
                  );
                })}
              </div>
            </div>
          )}

          {/* ==================== DAY VIEW ==================== */}
          {view === 'day' && (
            <div className="gcal-day-view">
              <div className="gcal-day-hero">
                <div className="gcal-day-hero-info">
                  <div className="gcal-day-badge-row">
                    {selectedKey === todayKey && (
                      <span className="gcal-badge-today">{t('v2.today')}</span>
                    )}
                    {selectedKey === dateKey(addDays(today, 1)) && (
                      <span className="gcal-badge-tomorrow">{t('v2.tomorrow')}</span>
                    )}
                    {selectedKey === dateKey(addDays(today, -1)) && (
                      <span className="gcal-badge-yesterday">{t('v2.yesterday')}</span>
                    )}
                    <span className="gcal-badge-count">
                      {t('v2.itemCount', { total: (byDay[selectedKey] || []).length })}
                    </span>
                  </div>
                  <h3 className="gcal-day-hero-date">
                    {cursor.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  </h3>
                </div>

                {onCreate && (
                  <button
                    type="button"
                    className="gcal-btn-add-large"
                    onClick={() => onCreate(selectedKey)}
                  >
                    <Plus size={16} />
                    <span>{t('v2.addTask')}</span>
                  </button>
                )}
              </div>

              <div className="gcal-day-cards-container">
                {(byDay[selectedKey] || []).length > 0 ? (
                  <div className="gcal-day-grid-list">
                    {(byDay[selectedKey] || []).map((item) => renderDetailCard(item))}
                  </div>
                ) : (
                  <div className="gcal-empty-card">
                    <CalendarCheck2 size={42} className="gcal-empty-icon" />
                    <h4>{t('v2.emptyDay')}</h4>
                    <p>{t('v2.emptyDescription')}</p>
                    {onCreate && (
                      <button
                        type="button"
                        className="gcal-create-primary-btn"
                        onClick={() => onCreate(selectedKey)}
                      >
                        <Plus size={16} /> {tTasks('tasksPage.newTask')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ==================== AGENDA VIEW ==================== */}
          {view === 'agenda' && (
            <div className="gcal-agenda-view">
              {periodDays
                .filter((d) => (byDay[dateKey(d)] || []).length > 0)
                .map((d) => {
                  const key = dateKey(d);
                  const dayItems = byDay[key] || [];
                  const isToday = key === todayKey;

                  return (
                    <div key={key} className="gcal-agenda-day-block" data-today={isToday}>
                      <div className="gcal-agenda-date-col">
                        <div className="gcal-agenda-date-badge" data-today={isToday}>
                          <span className="gcal-agenda-dow">{d.toLocaleDateString(locale, { weekday: 'short' })}</span>
                          <span className="gcal-agenda-num">{d.getDate()}</span>
                          <span className="gcal-agenda-month">{d.toLocaleDateString(locale, { month: 'short' })}</span>
                        </div>
                        {isToday && <span className="gcal-agenda-pill-today">{t('v2.today')}</span>}
                      </div>

                      <div className="gcal-agenda-events-col">
                        {dayItems.map((item) => renderDetailCard(item))}
                      </div>
                    </div>
                  );
                })}

              {periodDays.filter((d) => (byDay[dateKey(d)] || []).length > 0).length === 0 && (
                <div className="gcal-empty-card">
                  <CalendarCheck2 size={42} className="gcal-empty-icon" />
                  <h4>{t('v2.emptyTitle')}</h4>
                  <p>{t('v2.noMatchingItems')}</p>
                  {onCreate && (
                    <button
                      type="button"
                      className="gcal-create-primary-btn"
                      onClick={() => onCreate(selectedKey)}
                    >
                      <Plus size={16} /> {tTasks('tasksPage.newTask')}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Floating Day Detail Modal / Popover (Google Calendar style) */}
      {activeDayModalKey && (
        <div
          className="gcal-modal-backdrop"
          onClick={() => setActiveDayModalKey(null)}
        >
          <div
            className="gcal-day-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="gcal-modal-header">
              <div className="gcal-modal-title-group">
                <span className="gcal-modal-badge">
                  {activeDayModalKey === todayKey ? t('v2.today') : t('v2.dayDetail')}
                </span>
                <h3 className="gcal-modal-title">
                  {activeModalDate ? activeModalDate.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : activeDayModalKey}
                </h3>
              </div>
              <button
                type="button"
                className="gcal-modal-close-btn"
                onClick={() => setActiveDayModalKey(null)}
                aria-label={t('v2.close')}
              >
                <X size={18} />
              </button>
            </div>

            <div className="gcal-modal-body">
              {activeModalItems.length > 0 ? (
                <div className="gcal-modal-items-list">
                  {activeModalItems.map((item) => renderDetailCard(item))}
                </div>
              ) : (
                <p className="gcal-modal-empty">{t('v2.emptyDay')}</p>
              )}
            </div>

            <div className="gcal-modal-footer">
              {onCreate && (
                <button
                  type="button"
                  className="gcal-create-primary-btn"
                  onClick={() => {
                    onCreate(activeDayModalKey);
                    setActiveDayModalKey(null);
                  }}
                >
                  <Plus size={16} /> {t('v2.addOn', { date: activeDayModalKey })}
                </button>
              )}
              <button
                type="button"
                className="gcal-btn-today"
                onClick={() => setActiveDayModalKey(null)}
              >
                {t('v2.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
    <DragOverlay dropAnimation={null}>
      {dnd.aktivni ? <div className="gcal-drag-overlay">{renderEventChip(dnd.aktivni.item, { overlay: true })}</div> : null}
    </DragOverlay>
    </DndContext>
  );
}
