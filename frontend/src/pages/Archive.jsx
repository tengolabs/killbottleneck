import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Archive as ArchiveIcon, ArchiveRestore, Loader2, Target, Hash, FolderOpen } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import AppHeader from '@/components/shared/AppHeader';
import MapCard from '@/components/home/MapCard';
import { useToast } from '@/components/ui/use-toast';
import { compareLocale, fmtDateShort } from '@/lib/locale';

// Archiv dokončených projektů. Mapy z číslované šablony se seskupují do sérií
// (Nabídka 1, 2, 3…) podle pole `series`; nadpis skupiny drží snapshot
// `series_title`, takže série drží pohromadě i po smazání šablony.
export default function Archive() {
  const navigate = useNavigate();
  const { t } = useTranslation('home');
  const { toast } = useToast();
  const { user } = useAuth();
  const [maps, setMaps] = useState(null);

  const load = () => {
    base44.entities.GoalMap.filter({ archived: true }, '-updated_date', 200)
      .then(setMaps)
      .catch(() => setMaps([]));
  };
  useEffect(load, []);

  const { series, other } = useMemo(() => {
    // skupina = šablona + rok (nový rok začíná novou řadu — Richard 2026-07-20)
    const bySeries = {};
    const loose = [];
    for (const m of maps || []) {
      if (m.series) {
        const key = `${m.series}|${m.series_year || 0}`;
        (bySeries[key] = bySeries[key] || []).push(m);
      } else {
        loose.push(m);
      }
    }
    const grouped = Object.entries(bySeries).map(([id, items]) => {
      const year = items[0]?.series_year || 0;
      const name = items.find((m) => m.series_title)?.series_title || t('archive.seriesFallback');
      return {
        id, // klíč skupiny = id šablony + rok (stejnojmenné řady se nesmí slít)
        title: year ? `${name} · ${year}` : name,
        items: [...items].sort((a, b) => (a.series_number || 0) - (b.series_number || 0)),
      };
    }).sort((a, b) => compareLocale(b.title, a.title)); // novější rok nahoře
    return { series: grouped, other: loose };
  }, [maps, t]);

  const handleRestore = async (m) => {
    try {
      await base44.entities.GoalMap.update(m.id, { archived: false });
      setMaps((prev) => prev.filter((x) => x.id !== m.id));
      toast({ title: t('editor:toasts.unarchived') });
    } catch (e) {
      console.error(e);
      toast({ title: t('toasts.restoreFailed'), variant: 'destructive' });
    }
  };

  const cardBadges = (m) => (
    <div className="flex items-center gap-0.5">
      {m.series_number > 0 && (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium" title={t('archive.seriesNumberTitle')}>
          <Hash className="w-3 h-3" />{m.series_number}
        </span>
      )}
      {m.created_by_id === user?.id && (
        <button
          onClick={(e) => { e.stopPropagation(); handleRestore(m); }}
          className="text-muted-foreground hover:text-primary p-1 opacity-0 group-hover:opacity-100 transition-opacity"
          title={t('editor:toolbar.restoreFromArchive')}
        >
          <ArchiveRestore className="w-4 h-4" />
        </button>
      )}
    </div>
  );

  const cardMeta = (m) =>
    t('misc.goalsMeta', { count: m.nodes?.length || 0 })
    + (m.archived_at ? ` · ${t('archive.archivedOn', { date: fmtDateShort(m.archived_at) })}` : '');

  const grid = (items) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((m) => (
        <MapCard
          key={m.id}
          map={m}
          icon={Target}
          meta={cardMeta(m)}
          badges={cardBadges(m)}
          onClick={() => navigate(`/map/${m.id}`)}
        />
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <AppHeader backTo="/" />
      <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
            <ArchiveIcon className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight">{t('archive.title')}</h1>
            <p className="text-muted-foreground text-sm">{t('archive.subtitle')}</p>
          </div>
        </div>

        {maps === null ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : maps.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4">
              <ArchiveIcon className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="font-heading text-lg font-semibold mb-1">{t('archive.emptyTitle')}</h3>
            <p className="text-muted-foreground text-sm mb-4">
              {t('archive.emptyDesc')}
            </p>
            <Button variant="outline" onClick={() => navigate('/')}>{t('archive.backToProjects')}</Button>
          </div>
        ) : (
          <div className="space-y-10">
            {series.map((g) => (
              <div key={g.id}>
                <h2 className="font-heading text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4 flex items-center gap-2">
                  <FolderOpen className="w-4 h-4" /> {g.title}
                </h2>
                {grid(g.items)}
              </div>
            ))}
            {other.length > 0 && (
              <div>
                <h2 className="font-heading text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4 flex items-center gap-2">
                  <ArchiveIcon className="w-4 h-4" /> {t('archive.otherHeading')}
                </h2>
                {grid(other)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
