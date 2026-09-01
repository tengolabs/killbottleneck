import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CalendarRange,
  Clock,
  Folder,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { statusConfig } from '@/lib/statusMeta';
import { intlLocale, fmtDate } from '@/lib/locale';
import { getInitials, getDeadlineStatus, formatDeadline } from '@/lib/nodeMeta';

// Pomocné funkce pro lokální manipulaci s daty bez posunu časových pásem
const parseDateLocal = (str) => {
  if (!str) return null;
  const parts = str.split('T')[0].split('-');
  if (parts.length < 3) return null;
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
};

const fmtDateKey = (d) => {
  if (!d) return '';
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const addDays = (d, n) => {
  const res = new Date(d);
  res.setDate(res.getDate() + n);
  return res;
};

const diffDays = (d1, d2) => {
  const utc1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const utc2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
  return Math.round((utc2 - utc1) / 86400000);
};

// Číslo ISO týdne v roce
function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

export default function TaskTimeline({
  tasks = [],
  byParent = {},
  maps = [],
  nodeTrees = {},
  onEdit,
  onOpenNode,
  search = '',
  statusFilter = '__all__',
  assigneeFilter = '__all__',
}) {
  const { t } = useTranslation('tasks');
  const scrollContainerRef = useRef(null);
  const leftPanelRef = useRef(null);
  const trackRef = useRef(null);

  // Měřítko časové osy: 'day' (dny), 'week' (týdny), 'month' (měsíce)
  const [scale, setScale] = useState('week');
  // Sbalené/rozbalené projekty (mapy)
  const [collapsedMaps, setCollapsedMaps] = useState({});
  // Aktivní hovered položka pro tooltip / detail
  const [hoveredItem, setHoveredItem] = useState(null);

  // Responzivní stav levého panelu na mobilu: 'full' (otevřený), 'compact' (úzký), 'hidden' (skrytý)
  const [mobileSidebar, setMobileSidebar] = useState('compact');

  // Stav pro myší tažení a dotyková gesta (Drag to pan)
  const [isPanning, setIsPanning] = useState(false);
  const [panStartX, setPanStartX] = useState(0);
  const [panScrollLeft, setPanScrollLeft] = useState(0);

  // Stav pro horní interaktivní scroller pruh
  const [scrollProgress, setScrollProgress] = useState({ left: 0, visibleWidth: 0 });

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const todayKey = fmtDateKey(today);

  // 1. Shromáždění všech položek hierarchicky dle projektů
  const timelineGroups = useMemo(() => {
    const groups = [];
    const lowerSearch = (search || '').toLowerCase().trim();

    maps.forEach((map) => {
      const roots = nodeTrees[map.id] || [];
      const mapTasks = tasks.filter((tk) => tk.map_id === map.id);
      const items = [];

      const traverseNodes = (nodes, depth = 0) => {
        nodes.forEach((node) => {
          const dl = node.deadline ? parseDateLocal(node.deadline) : null;
          const created = node.created ? parseDateLocal(node.created) : (dl ? addDays(dl, -3) : null);
          const start = node.planned_on ? parseDateLocal(node.planned_on) : (created || dl || today);
          const end = dl || (start ? addDays(start, 1) : addDays(today, 1));

          const nodeTasks = mapTasks.filter((tk) => tk.node_id === node.id);

          const matches =
            (!lowerSearch || (node.title || '').toLowerCase().includes(lowerSearch)) &&
            (statusFilter === '__all__' || node.status === statusFilter) &&
            (assigneeFilter === '__all__' || node.assignee_email === assigneeFilter);

          if (matches || nodeTasks.length > 0 || (dl && !lowerSearch)) {
            items.push({
              id: node.id,
              key: `node-${map.id}-${node.id}`,
              title: node.title || t('timeline.unnamedGoal', 'Cíl projektu'),
              type: 'node',
              kind: 'node',
              depth,
              status: node.status || 'todo',
              assignee: node.assignee_email,
              deadline: node.deadline,
              startDate: start,
              endDate: end,
              mapId: map.id,
              mapTitle: map.title,
              mapColor: map.color || '#3b82f6',
              hasDeadline: !!node.deadline,
              raw: node,
            });
          }

          nodeTasks.forEach((task) => {
            const taskDl = task.deadline ? parseDateLocal(task.deadline) : null;
            const taskCreated = task.created ? parseDateLocal(task.created) : (taskDl ? addDays(taskDl, -2) : null);
            const taskStart = task.planned_on ? parseDateLocal(task.planned_on) : (taskCreated || taskDl || today);
            const taskEnd = taskDl || (taskStart ? addDays(taskStart, 1) : addDays(today, 1));

            const taskMatches =
              (!lowerSearch || (task.title || '').toLowerCase().includes(lowerSearch)) &&
              (statusFilter === '__all__' || task.status === statusFilter) &&
              (assigneeFilter === '__all__' || task.assignee_email === assigneeFilter);

            if (taskMatches) {
              items.push({
                id: task.id,
                key: `task-${task.id}`,
                title: task.title || t('timeline.unnamedTask', 'Úkol'),
                type: 'task',
                kind: 'task',
                depth: depth + 1,
                status: task.status || 'todo',
                assignee: task.assignee_email,
                deadline: task.deadline,
                startDate: taskStart,
                endDate: taskEnd,
                mapId: map.id,
                mapTitle: map.title,
                mapColor: map.color || '#3b82f6',
                hasDeadline: !!task.deadline,
                raw: task,
              });

              const subs = byParent[task.id] || [];
              subs.forEach((sub) => {
                const subDl = sub.deadline ? parseDateLocal(sub.deadline) : null;
                const subStart = sub.planned_on ? parseDateLocal(sub.planned_on) : (subDl ? addDays(subDl, -1) : taskStart);
                const subEnd = subDl || (subStart ? addDays(subStart, 1) : addDays(today, 1));

                items.push({
                  id: sub.id,
                  key: `sub-${sub.id}`,
                  title: sub.title || t('timeline.unnamedTask', 'Podúkol'),
                  type: 'task',
                  kind: 'task',
                  depth: depth + 2,
                  status: sub.status || 'todo',
                  assignee: sub.assignee_email,
                  deadline: sub.deadline,
                  startDate: subStart,
                  endDate: subEnd,
                  mapId: map.id,
                  mapTitle: map.title,
                  mapColor: map.color || '#3b82f6',
                  hasDeadline: !!sub.deadline,
                  raw: sub,
                });
              });
            }
          });

          if (node.children && node.children.length > 0) {
            traverseNodes(node.children, depth + 1);
          }
        });
      };

      traverseNodes(roots, 0);

      const unassignedMapTasks = mapTasks.filter((tk) => !tk.node_id);
      unassignedMapTasks.forEach((task) => {
        const taskDl = task.deadline ? parseDateLocal(task.deadline) : null;
        const taskStart = task.planned_on ? parseDateLocal(task.planned_on) : (taskDl ? addDays(taskDl, -2) : today);
        const taskEnd = taskDl || (taskStart ? addDays(taskStart, 1) : addDays(today, 1));

        items.push({
          id: task.id,
          key: `task-${task.id}`,
          title: task.title,
          type: 'task',
          kind: 'task',
          depth: 0,
          status: task.status || 'todo',
          assignee: task.assignee_email,
          deadline: task.deadline,
          startDate: taskStart,
          endDate: taskEnd,
          mapId: map.id,
          mapTitle: map.title,
          mapColor: map.color || '#3b82f6',
          hasDeadline: !!task.deadline,
          raw: task,
        });
      });

      if (items.length > 0) {
        groups.push({
          mapId: map.id,
          title: map.title || t('common:misc.untitled'),
          color: map.color || '#3b82f6',
          items,
        });
      }
    });

    return groups;
  }, [maps, tasks, nodeTrees, byParent, search, statusFilter, assigneeFilter, t, today]);

  // 2. Výpočet celkového časového rozsahu (minDate až maxDate)
  const { minDate, maxDate, totalDays, datesArray } = useMemo(() => {
    let min = addDays(today, -14);
    let max = addDays(today, 35);

    timelineGroups.forEach((g) => {
      g.items.forEach((it) => {
        if (it.startDate && it.startDate < min) min = it.startDate;
        if (it.endDate && it.endDate > max) max = it.endDate;
      });
    });

    const minDayOfWeek = (min.getDay() + 6) % 7;
    const alignedMin = addDays(min, -minDayOfWeek - (scale === 'month' ? 30 : 7));

    const maxDayOfWeek = (max.getDay() + 6) % 7;
    const alignedMax = addDays(max, (6 - maxDayOfWeek) + (scale === 'month' ? 45 : 14));

    const count = diffDays(alignedMin, alignedMax) + 1;
    const dates = [];
    for (let i = 0; i < count; i++) {
      dates.push(addDays(alignedMin, i));
    }

    return {
      minDate: alignedMin,
      maxDate: alignedMax,
      totalDays: count,
      datesArray: dates,
    };
  }, [timelineGroups, today, scale]);

  // Šířka 1 dne pro jednotlivá měřítka
  const columnWidth = useMemo(() => {
    switch (scale) {
      case 'month':
        return 10;
      case 'week':
        return 28;
      case 'day':
      default:
        return 44;
    }
  }, [scale]);

  const timelineWidth = totalDays * columnWidth;

  const updateScrollProgress = useCallback(() => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
      if (scrollWidth > 0) {
        const leftPercent = (scrollLeft / scrollWidth) * 100;
        const widthPercent = (clientWidth / scrollWidth) * 100;
        setScrollProgress({ left: leftPercent, visibleWidth: Math.min(100, widthPercent) });
      }
    }
  }, []);

  const handleScrollSync = (e) => {
    updateScrollProgress();
    if (leftPanelRef.current && e.target === scrollContainerRef.current) {
      leftPanelRef.current.scrollTop = scrollContainerRef.current.scrollTop;
    }
  };

  const handleLeftPanelScroll = (e) => {
    if (scrollContainerRef.current && e.target === leftPanelRef.current) {
      scrollContainerRef.current.scrollTop = leftPanelRef.current.scrollTop;
    }
  };

  const scrollToToday = useCallback(() => {
    if (scrollContainerRef.current && totalDays > 0) {
      const daysToToday = diffDays(minDate, today);
      const targetPos = daysToToday * columnWidth - (scrollContainerRef.current.clientWidth / 2) + 60;
      scrollContainerRef.current.scrollTo({
        left: Math.max(0, targetPos),
        behavior: 'smooth',
      });
    }
  }, [minDate, today, columnWidth, totalDays]);

  useEffect(() => {
    scrollToToday();
  }, [scale]);

  // Myší a dotyková gesta (Pan / Touch Swipe)
  const handleMouseDown = (e) => {
    if (e.target.closest('button') || e.target.closest('.group')) return;
    setIsPanning(true);
    setPanStartX(e.pageX - (scrollContainerRef.current?.offsetLeft || 0));
    setPanScrollLeft(scrollContainerRef.current?.scrollLeft || 0);
  };

  const handleMouseMove = (e) => {
    if (!isPanning || !scrollContainerRef.current) return;
    e.preventDefault();
    const x = e.pageX - (scrollContainerRef.current.offsetLeft || 0);
    const walk = (x - panStartX) * 1.5;
    scrollContainerRef.current.scrollLeft = panScrollLeft - walk;
    updateScrollProgress();
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  // Touch eventy pro telefony
  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      setIsPanning(true);
      setPanStartX(e.touches[0].pageX - (scrollContainerRef.current?.offsetLeft || 0));
      setPanScrollLeft(scrollContainerRef.current?.scrollLeft || 0);
    }
  };

  const handleTouchMove = (e) => {
    if (!isPanning || !scrollContainerRef.current || e.touches.length !== 1) return;
    const x = e.touches[0].pageX - (scrollContainerRef.current.offsetLeft || 0);
    const walk = (x - panStartX) * 1.2;
    scrollContainerRef.current.scrollLeft = panScrollLeft - walk;
    updateScrollProgress();
  };

  const handleTouchEnd = () => {
    setIsPanning(false);
  };

  const handleTrackClick = (e) => {
    if (trackRef.current && scrollContainerRef.current) {
      const rect = trackRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const ratio = clickX / rect.width;
      const targetScroll = ratio * scrollContainerRef.current.scrollWidth - (scrollContainerRef.current.clientWidth / 2);
      scrollContainerRef.current.scrollTo({
        left: Math.max(0, targetScroll),
        behavior: 'smooth',
      });
    }
  };

  const handleStepScroll = (daysCount) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({
        left: daysCount * columnWidth,
        behavior: 'smooth',
      });
    }
  };

  const scrollToProject = (mapId) => {
    setCollapsedMaps((prev) => ({ ...prev, [mapId]: false }));
    const group = timelineGroups.find((g) => g.mapId === mapId);
    if (group && group.items.length > 0 && scrollContainerRef.current) {
      const firstItem = group.items[0];
      const days = diffDays(minDate, firstItem.startDate || today);
      const target = days * columnWidth - 60;
      scrollContainerRef.current.scrollTo({
        left: Math.max(0, target),
        behavior: 'smooth',
      });
    }
  };

  const toggleCollapse = (mapId) => {
    setCollapsedMaps((prev) => ({ ...prev, [mapId]: !prev[mapId] }));
  };

  const expandAll = () => setCollapsedMaps({});
  const collapseAll = () => {
    const all = {};
    timelineGroups.forEach((g) => { all[g.mapId] = true; });
    setCollapsedMaps(all);
  };

  // 3. Generování bloků pro týdenní a měsíční hlavičky
  const { monthBlocks, weekBlocks, quarterBlocks } = useMemo(() => {
    const months = [];
    const weeks = [];
    const quarters = [];

    let curMonth = null;
    let curMonthStart = 0;

    let curWeek = null;
    let curWeekStart = 0;

    let curQuarter = null;
    let curQuarterStart = 0;

    datesArray.forEach((d, idx) => {
      const mKey = `${d.getFullYear()}-${d.getMonth()}`;
      if (curMonth !== mKey) {
        if (curMonth !== null) {
          months.push({
            key: curMonth,
            label: datesArray[curMonthStart].toLocaleDateString(intlLocale(), { month: 'long', year: 'numeric' }),
            shortLabel: datesArray[curMonthStart].toLocaleDateString(intlLocale(), { month: 'short' }),
            left: curMonthStart * columnWidth,
            width: (idx - curMonthStart) * columnWidth,
            monthIndex: datesArray[curMonthStart].getMonth(),
          });
        }
        curMonth = mKey;
        curMonthStart = idx;
      }

      const wNum = getWeekNumber(d);
      const wKey = `${d.getFullYear()}-W${wNum}`;
      if (curWeek !== wKey) {
        if (curWeek !== null) {
          const wStartD = datesArray[curWeekStart];
          const wEndD = datesArray[idx - 1];
          weeks.push({
            key: curWeek,
            weekNum: getWeekNumber(wStartD),
            label: t('timeline.weekLabel', '{{num}}. týden', { num: getWeekNumber(wStartD) }),
            dateRange: `${wStartD.getDate()}.${wStartD.getMonth() + 1}. – ${wEndD.getDate()}.${wEndD.getMonth() + 1}.`,
            left: curWeekStart * columnWidth,
            width: (idx - curWeekStart) * columnWidth,
            weekIndex: weeks.length,
          });
        }
        curWeek = wKey;
        curWeekStart = idx;
      }

      const qNum = Math.floor(d.getMonth() / 3) + 1;
      const qKey = `${d.getFullYear()}-Q${qNum}`;
      if (curQuarter !== qKey) {
        if (curQuarter !== null) {
          quarters.push({
            key: curQuarter,
            label: `Q${Math.floor(datesArray[curQuarterStart].getMonth() / 3) + 1} ${datesArray[curQuarterStart].getFullYear()}`,
            left: curQuarterStart * columnWidth,
            width: (idx - curQuarterStart) * columnWidth,
          });
        }
        curQuarter = qKey;
        curQuarterStart = idx;
      }
    });

    if (curMonth !== null) {
      months.push({
        key: curMonth,
        label: datesArray[curMonthStart].toLocaleDateString(intlLocale(), { month: 'long', year: 'numeric' }),
        shortLabel: datesArray[curMonthStart].toLocaleDateString(intlLocale(), { month: 'short' }),
        left: curMonthStart * columnWidth,
        width: (datesArray.length - curMonthStart) * columnWidth,
        monthIndex: datesArray[curMonthStart].getMonth(),
      });
    }

    if (curWeek !== null) {
      const wStartD = datesArray[curWeekStart];
      const wEndD = datesArray[datesArray.length - 1];
      weeks.push({
        key: curWeek,
        weekNum: getWeekNumber(wStartD),
        label: t('timeline.weekLabel', '{{num}}. týden', { num: getWeekNumber(wStartD) }),
        dateRange: `${wStartD.getDate()}.${wStartD.getMonth() + 1}. – ${wEndD.getDate()}.${wEndD.getMonth() + 1}.`,
        left: curWeekStart * columnWidth,
        width: (datesArray.length - curWeekStart) * columnWidth,
        weekIndex: weeks.length,
      });
    }

    if (curQuarter !== null) {
      quarters.push({
        key: curQuarter,
        label: `Q${Math.floor(datesArray[curQuarterStart].getMonth() / 3) + 1} ${datesArray[curQuarterStart].getFullYear()}`,
        left: curQuarterStart * columnWidth,
        width: (datesArray.length - curQuarterStart) * columnWidth,
      });
    }

    return { monthBlocks: months, weekBlocks: weeks, quarterBlocks: quarters };
  }, [datesArray, columnWidth]);

  const todayLeft = diffDays(minDate, today) * columnWidth + columnWidth / 2;

  // Šířka levého panelu dle režimu
  const leftPanelWidthClass = useMemo(() => {
    if (mobileSidebar === 'hidden') return 'hidden md:flex md:w-72 lg:w-80';
    if (mobileSidebar === 'compact') return 'w-24 sm:w-64 md:w-72 lg:w-80';
    return 'w-72 sm:w-80';
  }, [mobileSidebar]);

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden flex flex-col">
      {/* 1. HORNÍ OVLÁDACÍ LIŠTA */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b border-border bg-muted/25">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Tlačítko pro přepnutí levého panelu na mobilu */}
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs md:hidden gap-1"
            onClick={() => setMobileSidebar((prev) => (prev === 'compact' ? 'hidden' : prev === 'hidden' ? 'full' : 'compact'))}
            title={t('timeline.sidebarToggleTitle', 'Přepnout zobrazení seznamu projektů na mobilu')}
          >
            {mobileSidebar === 'hidden' ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
            <span className="text-[11px]">{mobileSidebar === 'hidden' ? t('timeline.sidebarShow', 'Seznam') : mobileSidebar === 'compact' ? t('timeline.sidebarExpand', 'Rozbalit') : t('timeline.sidebarNarrow', 'Zúžit')}</span>
          </Button>

          {/* Měřítko (Dny, Týdny, Měsíce) */}
          <div className="flex items-center rounded-lg border border-border bg-background p-0.5 shadow-xs">
            <Button
              variant={scale === 'day' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2 sm:px-2.5 text-xs font-semibold"
              onClick={() => setScale('day')}
            >
              {t('timeline.scaleDays', 'Dny')}
            </Button>
            <Button
              variant={scale === 'week' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2 sm:px-2.5 text-xs font-semibold"
              onClick={() => setScale('week')}
            >
              {t('timeline.scaleWeeks', 'Týdny')}
            </Button>
            <Button
              variant={scale === 'month' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2 sm:px-2.5 text-xs font-semibold"
              onClick={() => setScale('month')}
            >
              {t('timeline.scaleMonths', 'Měsíce')}
            </Button>
          </div>

          <div className="h-4 w-px bg-border mx-0.5 sm:mx-1 hidden sm:block" />

          {/* Rychlé navigační posuny */}
          <div className="flex items-center gap-0.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-1.5 sm:px-2 text-xs gap-1"
              onClick={() => handleStepScroll(scale === 'month' ? -30 : scale === 'week' ? -7 : -1)}
              title={scale === 'month' ? t('timeline.prevMonth', 'Předchozí měsíc') : scale === 'week' ? t('timeline.prevWeek', 'Předchozí týden') : t('timeline.prevDay', 'Předchozí den')}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span className="hidden md:inline">
                {scale === 'month' ? '-1 M' : scale === 'week' ? '-1 T' : '-1 D'}
              </span>
            </Button>

            <Button
              variant="default"
              size="sm"
              className="h-7 px-2 sm:px-2.5 text-xs font-medium gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={scrollToToday}
              title={t('timeline.todayTitle', 'Vystředit na aktuální den')}
            >
              <Clock className="w-3 h-3 text-rose-300 animate-pulse" />
              <span>{t('calendar.todayButton', 'Dnes')}</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-7 px-1.5 sm:px-2 text-xs gap-1"
              onClick={() => handleStepScroll(scale === 'month' ? 30 : scale === 'week' ? 7 : 1)}
              title={scale === 'month' ? t('timeline.nextMonth', 'Další měsíc') : scale === 'week' ? t('timeline.nextWeek', 'Další týden') : t('timeline.nextDay', 'Další den')}
            >
              <span className="hidden md:inline">
                {scale === 'month' ? '+1 M' : scale === 'week' ? '+1 T' : '+1 D'}
              </span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Skok na projekt */}
          {timelineGroups.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                  <Folder className="w-3 h-3 text-primary" />
                  <span className="hidden sm:inline">Projekt</span>
                  <ChevronDown className="w-3 h-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {timelineGroups.map((g) => (
                  <DropdownMenuItem
                    key={g.mapId}
                    onClick={() => scrollToProject(g.mapId)}
                    className="flex items-center gap-2 cursor-pointer text-xs"
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                    <span className="truncate flex-1 font-medium">{g.title}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{g.items.length}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Pravá část lišty: Sbalit/Rozbalit a Legenda */}
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 sm:px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
            onClick={expandAll}
            title={t('timeline.expandAll', 'Rozbalit všechny projekty')}
          >
            <Maximize2 className="w-3 h-3" />
            <span className="hidden sm:inline">{t('timeline.expandAll', 'Rozbalit')}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 sm:px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
            onClick={collapseAll}
            title={t('timeline.collapseAll', 'Sbalit všechny projekty')}
          >
            <Minimize2 className="w-3 h-3" />
            <span className="hidden sm:inline">{t('timeline.collapseAll', 'Sbalit')}</span>
          </Button>

          <div className="hidden xl:flex items-center gap-3 pl-3 border-l border-border text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              {t('common:status.todo', 'K řešení')}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              {t('common:status.inProgress', 'Rozpracováno')}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
              {t('common:status.done', 'Hotovo')}
            </span>
          </div>
        </div>
      </div>

      {/* 2. HORNÍ INTERAKTIVNÍ MINI-SCROLLER TRACK */}
      <div
        ref={trackRef}
        onClick={handleTrackClick}
        className="h-3 bg-muted/40 border-b border-border/80 relative cursor-pointer group hover:bg-muted/70 transition-colors select-none"
        title={t('timeline.scrollerTitle', 'Kliknutím skočíte na časové ose')}
      >
        <div
          style={{
            left: `${scrollProgress.left}%`,
            width: `${Math.max(8, scrollProgress.visibleWidth)}%`,
          }}
          className="absolute top-0.5 bottom-0.5 rounded-full bg-primary/40 group-hover:bg-primary/70 transition-all shadow-xs"
        />
        {totalDays > 0 && (
          <div
            style={{ left: `${(diffDays(minDate, today) / totalDays) * 100}%` }}
            className="absolute top-0 bottom-0 w-1 bg-rose-500 shadow-xs z-10 pointer-events-none"
          />
        )}
      </div>

      {/* 3. HLAVNÍ SPLIT OBLAST */}
      <div className="flex flex-1 overflow-hidden relative max-h-[calc(100vh-210px)] min-h-[480px]">
        {/* LEVÝ PANEL: Projekty a Úkoly */}
        <div
          ref={leftPanelRef}
          onScroll={handleLeftPanelScroll}
          className={`${leftPanelWidthClass} shrink-0 border-r border-border bg-card z-20 flex flex-col select-none shadow-[2px_0_8px_-2px_rgba(0,0,0,0.06)] overflow-y-auto transition-[width] duration-150`}
        >
          {/* Sticky hlavička levého panelu */}
          <div className="sticky top-0 z-30 h-[70px] px-2.5 sm:px-3.5 border-b border-border flex items-center justify-between bg-muted/80 backdrop-blur-xs font-semibold text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5 truncate">
              <Folder className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="truncate">{t('timeline.itemHeader', 'Projekt / Cíl / Úkol')}</span>
            </span>
            <span className="hidden sm:inline">{t('timeline.statusHeader', 'Stav')}</span>
          </div>

          {/* Seznam projektů */}
          <div className="divide-y divide-border/40">
            {timelineGroups.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                {t('timeline.empty', 'Žádné položky.')}
              </div>
            ) : (
              timelineGroups.map((group) => {
                const isCollapsed = !!collapsedMaps[group.mapId];
                return (
                  <div key={group.mapId} className="group/map">
                    {/* Řádek projektu */}
                    <div
                      onClick={() => toggleCollapse(group.mapId)}
                      className="h-10 px-2 sm:px-3 flex items-center justify-between gap-1.5 bg-muted/60 hover:bg-muted/90 cursor-pointer transition-colors border-l-4"
                      style={{ borderLeftColor: group.color }}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <ChevronDown
                          className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform ${
                            isCollapsed ? '-rotate-90' : ''
                          }`}
                        />
                        <Folder className="w-3.5 h-3.5 shrink-0" style={{ color: group.color }} />
                        <span className="font-bold text-xs truncate text-foreground">
                          {group.title}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-background border border-border text-muted-foreground shrink-0 hidden sm:inline-block">
                        {group.items.length}
                      </span>
                    </div>

                    {/* Řádky položek */}
                    {!isCollapsed &&
                      group.items.map((item) => {
                        const statusCfg = statusConfig[item.status] || statusConfig.todo;
                        const dlStatus = getDeadlineStatus(item.deadline, item.status);
                        const isOverdue = dlStatus === 'overdue';

                        return (
                          <div
                            key={item.key}
                            onClick={() => {
                              if (item.type === 'node') onOpenNode?.(item.raw);
                              else onEdit?.(item.raw);
                            }}
                            className={`h-9 px-2 sm:px-3 flex items-center justify-between gap-1.5 hover:bg-muted/50 cursor-pointer transition-colors text-xs ${
                              hoveredItem?.key === item.key ? 'bg-primary/10' : ''
                            }`}
                            style={{
                              paddingLeft:
                                mobileSidebar === 'compact'
                                  ? `${6 + item.depth * 6}px`
                                  : `${14 + item.depth * 14}px`,
                            }}
                          >
                            <div className="flex items-center gap-1 min-w-0">
                              {item.type === 'node' ? (
                                <span className="text-[10px] text-primary font-bold shrink-0">◇</span>
                              ) : (
                                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                              )}
                              <span
                                className={`truncate ${
                                  item.status === 'done'
                                    ? 'line-through text-muted-foreground/60'
                                    : item.type === 'node'
                                    ? 'font-medium text-foreground'
                                    : 'font-normal text-foreground/90'
                                }`}
                                title={item.title}
                              >
                                {item.title}
                              </span>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              {item.assignee && (
                                <span
                                  className="w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-secondary text-[8px] sm:text-[9px] font-medium flex items-center justify-center text-muted-foreground border border-border"
                                  title={item.assignee}
                                >
                                  {getInitials(item.assignee)}
                                </span>
                              )}
                              <span
                                className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full ${statusCfg.dot} ${
                                  isOverdue ? 'ring-2 ring-red-500 ring-offset-1 animate-pulse' : ''
                                }`}
                                title={`${statusCfg.label}${isOverdue ? ' (' + t('tasksPage.filterOverdue') + ')' : ''}`}
                              />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* PRAVÝ PANEL: Horizontální Gantt rastr s dotykovým a myším tažením */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScrollSync}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className={`flex-1 overflow-x-auto overflow-y-auto bg-background/60 relative select-none ${
            isPanning ? 'cursor-grabbing' : 'cursor-grab'
          }`}
        >
          <div style={{ width: `${timelineWidth}px` }} className="relative min-h-full">
            {/* 1. STICKY ZÁHLAVÍ ČASOVÉ OSY */}
            <div className="sticky top-0 z-30 bg-card shadow-xs">
              {/* Horní řádek: Měsíce / Kvartály */}
              <div className="h-7 border-b border-border bg-muted/60 relative flex">
                {scale === 'month'
                  ? quarterBlocks.map((block) => (
                      <div
                        key={block.key}
                        style={{ left: `${block.left}px`, width: `${block.width}px` }}
                        className="absolute top-0 bottom-0 border-r-2 border-border/80 px-3 flex items-center text-[11px] font-bold text-foreground truncate uppercase tracking-wider bg-muted/40"
                      >
                        {block.label}
                      </div>
                    ))
                  : monthBlocks.map((block) => (
                      <div
                        key={block.key}
                        style={{ left: `${block.left}px`, width: `${block.width}px` }}
                        className={`absolute top-0 bottom-0 border-r-2 border-border px-3 flex items-center text-[11px] font-bold text-foreground truncate uppercase tracking-wider ${
                          block.monthIndex % 2 === 0 ? 'bg-muted/50' : 'bg-muted/20'
                        }`}
                      >
                        {block.label}
                      </div>
                    ))}
              </div>

              {/* Dolní řádek: Dny / Týdny / Měsíce */}
              <div className="h-[43px] border-b border-border bg-muted/30 relative flex">
                {scale === 'week' &&
                  weekBlocks.map((wb) => (
                    <div
                      key={wb.key}
                      style={{ left: `${wb.left}px`, width: `${wb.width}px` }}
                      className={`absolute top-0 bottom-0 border-r-2 border-border/80 flex flex-col justify-center px-1.5 sm:px-2 text-center ${
                        wb.weekIndex % 2 === 0 ? 'bg-muted/40' : 'bg-muted/10'
                      }`}
                    >
                      <span className="text-[10px] sm:text-[11px] font-bold text-foreground leading-tight">
                        {wb.label}
                      </span>
                      <span className="text-[9px] sm:text-[10px] text-muted-foreground font-mono leading-tight">
                        {wb.dateRange}
                      </span>
                    </div>
                  ))}

                {scale === 'month' &&
                  monthBlocks.map((mb) => (
                    <div
                      key={mb.key}
                      style={{ left: `${mb.left}px`, width: `${mb.width}px` }}
                      className={`absolute top-0 bottom-0 border-r-2 border-border/90 flex flex-col justify-center px-2 text-center ${
                        mb.monthIndex % 2 === 0 ? 'bg-muted/50' : 'bg-muted/20'
                      }`}
                    >
                      <span className="text-xs font-bold text-foreground leading-tight truncate">
                        {mb.label}
                      </span>
                    </div>
                  ))}

                {scale === 'day' &&
                  datesArray.map((d, i) => {
                    const key = fmtDateKey(d);
                    const isToday = key === todayKey;
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                    const isMonday = d.getDay() === 1;

                    return (
                      <div
                        key={i}
                        style={{ left: `${i * columnWidth}px`, width: `${columnWidth}px` }}
                        className={`absolute top-0 bottom-0 flex flex-col items-center justify-center text-[10px] ${
                          isMonday ? 'border-l-2 border-l-primary/30' : 'border-r border-border/40'
                        } ${isWeekend ? 'bg-muted/50 text-muted-foreground/60' : 'text-muted-foreground'} ${
                          isToday ? 'bg-primary/15 font-bold text-primary' : ''
                        }`}
                      >
                        <span className="text-[9px] leading-tight">
                          {t(`calendar.dow.${(d.getDay() + 6) % 7}`)}
                        </span>
                        <span
                          className={`leading-tight ${
                            isToday
                              ? 'inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] shadow-xs'
                              : 'font-semibold'
                          }`}
                        >
                          {d.getDate()}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* 2. VERTIKÁLNÍ VODICÍ MŘÍŽKA */}
            <div className="absolute top-[70px] bottom-0 left-0 right-0 pointer-events-none">
              {scale === 'week' &&
                weekBlocks.map((wb) => (
                  <div
                    key={wb.key}
                    style={{ left: `${wb.left}px`, width: `${wb.width}px` }}
                    className={`absolute top-0 bottom-0 border-r-2 border-border/60 ${
                      wb.weekIndex % 2 === 0 ? 'bg-muted/10' : ''
                    }`}
                  />
                ))}

              {scale === 'month' &&
                monthBlocks.map((mb) => (
                  <div
                    key={mb.key}
                    style={{ left: `${mb.left}px`, width: `${mb.width}px` }}
                    className={`absolute top-0 bottom-0 border-r-2 border-border/70 ${
                      mb.monthIndex % 2 === 0 ? 'bg-muted/15' : ''
                    }`}
                  />
                ))}

              {scale === 'day' &&
                datesArray.map((d, i) => {
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  const isMonday = d.getDay() === 1;
                  return (
                    <div
                      key={i}
                      style={{ left: `${i * columnWidth}px`, width: `${columnWidth}px` }}
                      className={`absolute top-0 bottom-0 ${
                        isMonday ? 'border-l-2 border-l-border/80' : 'border-r border-border/20'
                      } ${isWeekend ? 'bg-muted/20' : ''}`}
                    />
                  );
                })}

              {todayLeft >= 0 && todayLeft <= timelineWidth && (
                <div
                  style={{ left: `${todayLeft}px` }}
                  className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-20 shadow-[0_0_10px_rgba(244,63,94,0.7)]"
                >
                  <div className="sticky top-[72px] -translate-x-1/2 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[9px] font-bold shadow-sm whitespace-nowrap">
                    {t('calendar.todayButton', 'Dnes')}
                  </div>
                </div>
              )}
            </div>

            {/* 3. VODOROVNÉ GANTT PRUHY */}
            <div className="divide-y divide-border/40 relative z-10">
              {timelineGroups.map((group) => {
                const isCollapsed = !!collapsedMaps[group.mapId];
                return (
                  <div key={group.mapId}>
                    <div className="h-10 bg-muted/20 border-l-2 border-border/40" />

                    {!isCollapsed &&
                      group.items.map((item) => {
                        const startDays = diffDays(minDate, item.startDate);
                        const endDays = diffDays(minDate, item.endDate);
                        const duration = Math.max(1, endDays - startDays);

                        const left = startDays * columnWidth;
                        const width = Math.max(scale === 'month' ? 14 : 28, duration * columnWidth);

                        const dlStatus = getDeadlineStatus(item.deadline, item.status);
                        const isOverdue = dlStatus === 'overdue';

                        const progress =
                          item.status === 'done'
                            ? 100
                            : item.status === 'in_progress'
                            ? 50
                            : item.status === 'waiting'
                            ? 25
                            : 0;

                        return (
                          <div
                            key={item.key}
                            className="h-9 relative flex items-center hover:bg-primary/5 transition-colors"
                            onMouseEnter={() => setHoveredItem(item)}
                            onMouseLeave={() => setHoveredItem(null)}
                            onClick={() => setHoveredItem(item)}
                          >
                            <div
                              onClick={() => {
                                if (item.type === 'node') onOpenNode?.(item.raw);
                                else onEdit?.(item.raw);
                              }}
                              style={{ left: `${left}px`, width: `${width}px` }}
                              className={`absolute h-6 rounded-md shadow-xs cursor-pointer flex items-center px-1.5 sm:px-2 text-[11px] font-medium transition-all group hover:ring-2 hover:ring-primary hover:z-30 ${
                                item.status === 'done'
                                  ? 'bg-emerald-600 text-white'
                                  : item.status === 'in_progress'
                                  ? 'bg-amber-600 text-white'
                                  : 'bg-slate-600 text-white dark:bg-slate-700'
                              } ${isOverdue ? 'ring-2 ring-rose-500 ring-offset-1' : ''}`}
                            >
                              {progress > 0 && progress < 100 && (
                                <div
                                  style={{ width: `${progress}%` }}
                                  className="absolute top-0 bottom-0 left-0 bg-white/20 rounded-l-md pointer-events-none"
                                />
                              )}

                              <div className="relative z-10 flex items-center justify-between w-full min-w-0 gap-1">
                                <span className="truncate leading-none drop-shadow-xs font-medium">
                                  {item.type === 'node' ? '◇ ' : ''}
                                  {item.title}
                                </span>
                                {item.deadline && (
                                  <span className="text-[9px] opacity-90 shrink-0 font-mono hidden sm:group-hover:inline">
                                    {fmtDate(item.deadline + 'T00:00:00', { day: 'numeric', month: 'numeric' })}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 4. SPODNÍ STAVOVÝ ŘÁDEK */}
      <div className="px-3 sm:px-4 py-2 border-t border-border bg-muted/15 text-xs flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
          <span className="flex items-center gap-1.5 font-medium">
            <CalendarRange className="w-3.5 h-3.5 text-primary" />
            <span>
              {fmtDate(minDate, { day: 'numeric', month: 'short', year: 'numeric' })} –{' '}
              {fmtDate(maxDate, { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </span>

          {hoveredItem && (
            <span className="inline-flex items-center gap-1.5 text-foreground font-semibold animate-fade-in truncate max-w-[280px] sm:max-w-md">
              <span className="text-primary font-bold">•</span>
              <span className="truncate">{hoveredItem.title}</span>
              {hoveredItem.deadline && (
                <span className="text-muted-foreground font-normal shrink-0">
                  ({t('taskTable.colDeadline', 'Termín')}: {formatDeadline(hoveredItem.deadline)})
                </span>
              )}
            </span>
          )}
        </div>

        <div className="text-[11px] text-muted-foreground hidden sm:block">
          💡 Posouvejte tažením prstem nebo myší.
        </div>
      </div>
    </div>
  );
}
