// Chování nativního obalu (Capacitor): back button, obnova po resume, zrcadlení
// session do nativních Preferences a systémová notifikace při nových nepřečtených.
// Dynamický import z main.jsx JEN v obalu — web si tenhle chunk nikdy nestáhne.
import i18next from 'i18next';
import { App as CapApp } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Preferences } from '@capacitor/preferences';
import { base44 } from '@/api/base44Client';
import { pb } from '@/api/pb';

import { SERVER_URL_KEY } from '@/lib/serverUrl';

const AUTH_KEY = 'pocketbase_auth'; // výchozí klíč LocalAuthStore v PB SDK
const SERVER_KEY = SERVER_URL_KEY;

// Pojistka proti úklidu WebView storage (Android umí data WebView smazat, aniž
// by odinstaloval appku): server + session se zrcadlí do nativních Preferences.
// Obnova musí proběhnout PŘED během appky — pb.js čte localStorage při module
// load — proto se po obnově dělá jeden reload.
const restoreFromPreferences = async () => {
  if (localStorage.getItem(SERVER_KEY)) return false;
  const server = await Preferences.get({ key: SERVER_KEY });
  if (!server.value) return false;
  localStorage.setItem(SERVER_KEY, server.value);
  const auth = await Preferences.get({ key: AUTH_KEY });
  if (auth.value) localStorage.setItem(AUTH_KEY, auth.value);
  window.location.reload();
  return true;
};

const mirrorAuth = () => {
  const v = localStorage.getItem(AUTH_KEY);
  (v
    ? Preferences.set({ key: AUTH_KEY, value: v })
    : Preferences.remove({ key: AUTH_KEY })
  ).catch(() => {});
};

const unreadCount = () => base44.entities.Notification.count({ rawFilter: 'read = false' });

export const initNativeApp = async () => {
  if (await restoreFromPreferences()) return; // stránka se právě přenačítá

  // samoléčba zrcadla: kdyby zápis při volbě serveru nestihl reload
  const server = localStorage.getItem(SERVER_KEY);
  if (server) Preferences.set({ key: SERVER_KEY, value: server }).catch(() => {});

  CapApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else CapApp.minimizeApp();
  });

  mirrorAuth();
  pb.authStore.onChange(mirrorAuth);

  // Android po zamčení displeje utne SSE spojení i timery WebView; realtime
  // eventy z té doby jsou pryč. Po návratu se proto komponentám řekne, ať si
  // znovu načtou data, a při nárůstu nepřečtených se ukáže systémová notifikace.
  let lastUnread = null;
  const baseline = () => {
    if (!pb.authStore.isValid) { lastUnread = null; return; }
    unreadCount().then((n) => { lastUnread = n; }).catch(() => {});
  };

  CapApp.addListener('resume', async () => {
    window.dispatchEvent(new Event('kb-native-resume'));
    if (!pb.authStore.isValid) { lastUnread = null; return; }
    try {
      const n = await unreadCount();
      const prev = lastUnread;
      lastUnread = n;
      if (prev != null && n > prev) {
        let perm = await LocalNotifications.checkPermissions();
        if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions();
        if (perm.display === 'granted') {
          // pevné id: nové upozornění nahradí staré, nevrší se
          await LocalNotifications.schedule({
            notifications: [{
              id: 1,
              title: 'killBottleneck',
              body: i18next.t('notify:native.newUnread', { count: n - prev }),
            }],
          });
        }
      }
    } catch { /* offline apod. — příště */ }
  });

  baseline();
  pb.authStore.onChange(baseline);
};
