import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { Bell, CheckCheck, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { pb } from '@/api/pb';
import { useAuth } from '@/lib/AuthContext';
import AppHeader from '@/components/shared/AppHeader';
import NotificationPrefs from '@/components/shared/NotificationPrefs';
import { intlLocale, parsePbDate } from '@/lib/locale';
import { NOTIFY_TYPES, notifyMeta, notifyTarget } from '@/lib/notifyMeta';

const PER_PAGE = 30;

const formatWhen = (dateStr) => {
  const d = parsePbDate(dateStr);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (!Number.isFinite(mins)) return '';
  if (mins < 1) return i18next.t('home:bell.justNow');
  if (mins < 60) return i18next.t('home:bell.minutesAgo', { count: mins });
  if (mins < 60 * 24) return i18next.t('home:bell.hoursAgo', { count: Math.round(mins / 60) });
  return d.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
};

// Úplný seznam notifikací se stránkováním — zvoneček ukazuje jen posledních 20,
// takže starší nepřečtené byly dřív nedosažitelné a „označit vše" je minulo.
export default function Notifications() {
  const { t } = useTranslation(['notify', 'home']);
  const { user } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState(null); // { items, page, totalPages, totalItems }
  const [page, setPage] = useState(1);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [unread, setUnread] = useState(0);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const timerRef = useRef(null);

  // filtry skládáme do jednoho PB výrazu; hodnoty jsou z pevného číselníku
  // (NOTIFY_TYPES), takže tu nemůže vzniknout injektáž z uživatelského vstupu
  const rawFilter = [
    onlyUnread ? 'read = false' : '',
    typeFilter ? `type = "${typeFilter}"` : '',
  ].filter(Boolean).join(' && ');

  const load = useCallback(() => {
    base44.entities.Notification
      .listPage('-created_date', page, PER_PAGE, rawFilter ? { rawFilter } : {})
      .then(setData)
      .catch(() => setData({ items: [], page: 1, totalPages: 1, totalItems: 0 }));
    base44.entities.Notification.count({ rawFilter: 'read = false' }).then(setUnread).catch(() => {});
  }, [page, rawFilter]);

  useEffect(load, [load]);

  useEffect(() => {
    pb.send('/api/kb/config', { method: 'GET' })
      .then((cfg) => setEmailEnabled(!!cfg.email_enabled))
      .catch(() => setEmailEnabled(false));
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    let unsubscribe;
    // read-all je jeden UPDATE, ale realtime z něj pošle událost za každý řádek
    const debounced = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(load, 200);
    };
    pb.collection('notifications').subscribe('*', debounced).then((u) => { unsubscribe = u; }).catch(() => {});
    return () => {
      clearTimeout(timerRef.current);
      if (unsubscribe) unsubscribe();
    };
  }, [user, load]);

  const openItem = (n) => {
    if (!n.read) {
      base44.entities.Notification.update(n.id, { read: true }).catch(() => {});
      setUnread((u) => Math.max(0, u - 1));
    }
    navigate(notifyTarget(n));
  };

  const markAllRead = async () => {
    try {
      await base44.notifications.markAllRead();
    } catch (err) {
      console.error(err);
    }
    setUnread(0);
    load();
  };

  const items = data?.items || [];
  const totalPages = data?.totalPages || 1;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader backTo="/" />
      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
            <Bell className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-heading text-2xl font-bold tracking-tight">{t('page.title')}</h1>
            <p className="text-muted-foreground text-sm">
              {unread > 0 ? t('page.unreadCount', { count: unread }) : t('page.subtitle')}
            </p>
          </div>
          {unread > 0 && (
            <Button variant="outline" size="sm" onClick={markAllRead} className="gap-1.5 shrink-0">
              <CheckCheck className="w-4 h-4" />
              <span className="hidden sm:inline">{t('page.markAllRead')}</span>
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Button
            variant={onlyUnread ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setOnlyUnread((v) => !v); setPage(1); }}
          >
            {onlyUnread ? t('filter.unread') : t('filter.all')}
          </Button>
          <Select
            value={typeFilter || 'all'}
            onValueChange={(v) => { setTypeFilter(v === 'all' ? '' : v); setPage(1); }}
          >
            <SelectTrigger className="w-56 h-9">
              <SelectValue placeholder={t('filter.allTypes')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filter.allTypes')}</SelectItem>
              {NOTIFY_TYPES.map((type) => (
                <SelectItem key={type} value={type}>{t(`type.${type}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {data === null ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4">
              <Bell className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm">
              {onlyUnread ? t('page.emptyUnread') : t('page.empty')}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border bg-card divide-y overflow-hidden">
            {items.map((n) => {
              const { icon: Icon, className } = notifyMeta(n.type);
              return (
                <button
                  key={n.id}
                  onClick={() => openItem(n)}
                  className={`w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors ${
                    n.read ? 'opacity-60' : ''
                  }`}
                >
                  <span className="mt-0.5 shrink-0"><Icon className={`w-4 h-4 ${className}`} /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm break-words whitespace-pre-line">{n.text}</span>
                    <span className="block text-[11px] text-muted-foreground mt-0.5">
                      {t(`type.${n.type}`)} · {formatWhen(n.created_date)}
                    </span>
                  </span>
                  {!n.read && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                </button>
              );
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="gap-1">
              <ChevronLeft className="w-4 h-4" /> {t('page.prev')}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t('page.pageOf', { page: data.page, total: totalPages })}
            </span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="gap-1">
              {t('page.next')} <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}

        <div className="mt-10">
          <NotificationPrefs emailEnabled={emailEnabled} />
        </div>
      </div>
    </div>
  );
}
