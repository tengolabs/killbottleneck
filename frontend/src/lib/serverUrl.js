// Adresa serveru pro nativní obal (Capacitor). Web ji nikdy nenastavuje —
// tam je server vždy window.location.origin. localStorage (ne Preferences),
// protože pb.js ji čte synchronně při module load.
import { isNativeShell } from './nativeShell.js';

// Jediný zdroj pravdy pro klíč adresy serveru a cloud doménu — importují si je
// nativeApp.js (zrcadlo Preferences), ServerPicker i signup. Duplikát, který se
// při změně zapomene, tu už jednou málem byl.
export const SERVER_URL_KEY = 'kb-server-url';
export const CLOUD_SUFFIX = '.killbottleneck.com';

const KEY = SERVER_URL_KEY;

export const getServerUrl = () => {
  if (!isNativeShell()) return null;
  try { return localStorage.getItem(KEY); } catch { return null; }
};

// Zrcadlení do nativních Preferences — pojistka proti úklidu WebView storage
// (obnovu při startu dělá lib/nativeApp.js). Dynamický import drží Capacitor
// mimo webový bundle. Vrací promise: caller, který hned poté dělá reload, na
// ni MUSÍ počkat — jinak se zápis nestihne (u clear by smazaný server po
// restartu obživl z Preferences).
const mirror = (url) => {
  if (!isNativeShell()) return Promise.resolve();
  return import('@capacitor/preferences').then(({ Preferences }) => (
    url ? Preferences.set({ key: KEY, value: url }) : Preferences.remove({ key: KEY })
  )).catch(() => {});
};

export const setServerUrl = (url) => { localStorage.setItem(KEY, url); return mirror(url); };
export const clearServerUrl = () => { localStorage.removeItem(KEY); return mirror(null); };

// Jednotný původ serveru pro skládané odkazy (sdílení mapy, pozvánky, agent
// callback). V obalu je window.location.origin = https://localhost — odkazy
// musí ukazovat na server, ne na WebView.
export const serverOrigin = () => getServerUrl() || window.location.origin;

// Privátní rozsahy, kde je tolerované http:// (LAN self-host, Tailscale).
// Android network security config neumí IP rozsahy, proto se to hlídá tady.
const isPrivateHost = (host) => {
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return true;
  const m = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  return a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127);
};

// Vstup od uživatele: plná adresa, holé jméno hostitele, nebo jen jméno
// instance (bez tečky) -> {jmeno}.killbottleneck.com. Bez schématu = https.
// Vrací { ok, url } nebo { ok: false, error: <klíč do auth.serverPicker> }.
export const normalizeServerUrl = (input) => {
  let s = (input || '').trim().replace(/\/+$/, '');
  if (!s) return { ok: false, error: 'errorEmpty' };
  if (!s.includes('.') && !s.includes(':') && !s.includes('/')) {
    s = `${s}${CLOUD_SUFFIX}`;
  }
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: 'errorInvalid' }; }
  if (u.pathname !== '/' || u.search || u.hash) return { ok: false, error: 'errorInvalid' };
  if (u.protocol === 'http:' && !isPrivateHost(u.hostname)) {
    return { ok: false, error: 'errorHttpPublic' };
  }
  return { ok: true, url: u.origin };
};
