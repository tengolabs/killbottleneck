import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { Bell, CheckCheck, ArrowRight } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import { pb } from '@/api/pb';
import { useAuth } from '@/lib/AuthContext';
import { intlLocale, parsePbDate } from '@/lib/locale';
import { notifyMeta, notifyTarget } from '@/lib/notifyMeta';

const PREVIEW = 20; // kolik se vejde do rozbalovátka; zbytek je na /notifications

const formatWhen = (dateStr) => {
  const d = parsePbDate(dateStr); // PB posílá „… …Z" s mezerou — new Date() by dal Invalid Date
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (!Number.isFinite(mins)) return '';
  if (mins < 1) return i18next.t('home:bell.justNow');
  if (mins < 60) return i18next.t('home:bell.minutesAgo', { count: mins });
  if (mins < 60 * 24) return i18next.t('home:bell.hoursAgo', { count: Math.round(mins / 60) });
  return d.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' });
};

// Zvonek s notifikacemi — realtime přes PocketBase. Náhled posledních 20;
// úplný seznam, filtry a nastavení jsou na /notifications.
export default function NotificationBell() {
  const { t } = useTranslation(['home', 'notify']);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const timerRef = useRef(null);

  const load = useCallback(() => {
    base44.entities.Notification.list('-created_date', PREVIEW).then(setItems).catch(() => {});
    // počet nepřečtených musí jít ze serveru: kdybychom ho počítali z načtené
    // dvacítky, uživatel s 50 nepřečtenými by na zvonku viděl 20
    base44.entities.Notification.count({ rawFilter: 'read = false' }).then(setUnread).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    load();
    let unsubscribe;
    // hromadné „označit vše přečtené" vygeneruje N realtime událostí naráz —
    // bez debounce by se pro každou pustil samostatný refetch
    const debounced = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(load, 200);
    };
    pb.collection('notifications').subscribe('*', debounced).then((u) => { unsubscribe = u; }).catch(() => {});
    // nativní obal: po návratu z pozadí je SSE mrtvé a eventy propadly → refetch
    // (event střílí lib/nativeApp.js, na webu nikdy nenastane)
    window.addEventListener('kb-native-resume', debounced);
    return () => {
      clearTimeout(timerRef.current);
      window.removeEventListener('kb-native-resume', debounced);
      if (unsubscribe) unsubscribe();
    };
  }, [user, load]);

  if (!user) return null;

  const openItem = (n) => {
    if (!n.read) {
      base44.entities.Notification.update(n.id, { read: true }).catch(() => {});
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read: true } : i)));
      setUnread((u) => Math.max(0, u - 1));
    }
    navigate(notifyTarget(n));
  };

  const markAllRead = () => {
    base44.notifications.markAllRead().catch(() => {});
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    setUnread(0);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="relative" title={t('bell.title')}>
          <Bell className="w-4 h-4" />
          {unread > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-semibold">{t('bell.title')}</span>
          {unread > 0 && (
            <button onClick={markAllRead} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <CheckCheck className="w-3.5 h-3.5" /> {t('bell.markAllRead')}
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">{t('bell.empty')}</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {items.map((n) => {
              const { icon: Icon, className } = notifyMeta(n.type);
              return (
                <button
                  key={n.id}
                  onClick={() => openItem(n)}
                  className={`w-full text-left flex items-start gap-2 px-3 py-2.5 border-b last:border-0 hover:bg-secondary/50 transition-colors ${
                    n.read ? 'opacity-60' : ''
                  }`}
                >
                  <span className="mt-0.5 shrink-0"><Icon className={`w-3.5 h-3.5 ${className}`} /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs break-words whitespace-pre-line">{n.text}</span>
                    <span className="block text-[10px] text-muted-foreground mt-0.5">{formatWhen(n.created_date)}</span>
                  </span>
                  {!n.read && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                </button>
              );
            })}
          </div>
        )}
        <button
          onClick={() => navigate('/notifications')}
          className="w-full flex items-center justify-center gap-1 px-3 py-2 border-t text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
        >
          {t('notify:page.showAll')} <ArrowRight className="w-3 h-3" />
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
