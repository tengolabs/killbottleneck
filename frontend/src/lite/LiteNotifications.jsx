// Zprávy v lite režimu — plochý seznam a „označit vše". Žádné filtry,
// stránkování ani nastavení kanálů; to je v plné verzi.
//
// Klik na zprávu záměrně NIKAM nenaviguje: cíl je uzel v mapě nebo detail
// úkolu, a ani jedno v lite režimu neexistuje. Zpráva se jen označí za
// přečtenou — otevřít se dá v plné verzi.
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Check } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { pb } from '@/api/pb';
import { fmtDate } from '@/lib/locale';

const PER_PAGE = 30;

export default function LiteNotifications() {
  const { t } = useTranslation('lite');
  const [items, setItems] = useState([]);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    base44.entities.Notification
      .listPage('-created_date', 1, PER_PAGE)
      .then((d) => { setItems(d.items || []); setFailed(false); })
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);
  // nativní obal: po návratu z pozadí refetch (event z lib/nativeApp.js)
  useEffect(() => {
    window.addEventListener('kb-native-resume', load);
    return () => window.removeEventListener('kb-native-resume', load);
  }, [load]);

  const markAll = async () => {
    try {
      await pb.send('/api/kb/notifications/read-all', { method: 'POST', body: {} });
      load();
    } catch { setFailed(true); }
  };

  const open = (n) => {
    if (n.read) return;
    base44.entities.Notification.update(n.id, { read: true }).catch(() => {});
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
  };

  const unread = items.filter((n) => !n.read).length;

  return (
    <div className="max-w-xl mx-auto">
      <header className="px-4 pt-5 pb-3 flex items-center gap-3">
        <h1 className="font-heading text-xl font-bold flex-1">{t('notifications.title')}</h1>
        {unread > 0 && (
          <button onClick={markAll} className="inline-flex items-center gap-1 text-xs font-medium text-primary">
            <Check className="w-4 h-4" /> {t('notifications.markAll')}
          </button>
        )}
      </header>

      {failed && (
        <div className="mx-4 mb-3 rounded-lg bg-destructive/10 text-destructive px-3 py-2 flex items-center gap-2 text-sm">
          <span className="flex-1">{t('loadFailed')}</span>
          <button onClick={load} className="font-medium underline">{t('retry')}</button>
        </div>
      )}

      {items.length === 0 && !failed && (
        <div className="px-4 py-16 text-center text-muted-foreground">
          <Bell className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-base">{t('notifications.empty')}</p>
        </div>
      )}

      <div className="bg-card border-y">
        {items.map((n) => (
          <button
            key={n.id}
            onClick={() => open(n)}
            className={`w-full text-left flex items-start gap-3 px-4 py-3 border-b last:border-b-0 ${n.read ? '' : 'bg-primary/5'}`}
          >
            <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.read ? 'bg-transparent' : 'bg-primary'}`} />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] leading-snug">{n.text}</span>
              <span className="block text-[11px] text-muted-foreground mt-0.5">{fmtDate(n.created_date, { day: 'numeric', month: 'short' })}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
