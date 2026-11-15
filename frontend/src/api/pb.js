import PocketBase from 'pocketbase';
import { getServerUrl } from '@/lib/serverUrl';

// V produkci servíruje frontend přímo PocketBase (pb_public) → stejný origin.
// V dev režimu jde API přes vite proxy (viz vite.config.js), origin sedí taky.
// V nativním obalu (Capacitor) je frontend bundlovaný v APK a server si volí
// uživatel — pak platí uložená adresa (viz lib/serverUrl.js).
export const pb = new PocketBase(getServerUrl() || window.location.origin);

pb.autoCancellation(false);

// A request refused as "not signed in" while this tab still believes it is signed in means
// the sign-in stopped being valid under an open tab (the administrator reset the password,
// the token ran out). PocketBase then answers collection reads with an empty 200, so the
// app looked empty instead of asking to sign in (finding F4-04). This only RAISES the
// question — AuthContext asks the server and signs out solely on its explicit refusal,
// never on a network failure.
export const AUTH_CHECK_EVENT = 'kb:auth-check';
pb.afterSend = (response, data) => {
  try {
    const refused = response?.status === 401 && !String(response.url || '').includes('/auth-refresh');
    if (pb.authStore.token && (refused || !pb.authStore.isValid)) {
      window.dispatchEvent(new Event(AUTH_CHECK_EVENT));
    }
  } catch { /* the hook must never break a request */ }
  return data;
};
