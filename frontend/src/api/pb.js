import PocketBase from 'pocketbase';
import { getServerUrl } from '@/lib/serverUrl';

// V produkci servíruje frontend přímo PocketBase (pb_public) → stejný origin.
// V dev režimu jde API přes vite proxy (viz vite.config.js), origin sedí taky.
// V nativním obalu (Capacitor) je frontend bundlovaný v APK a server si volí
// uživatel — pak platí uložená adresa (viz lib/serverUrl.js).
export const pb = new PocketBase(getServerUrl() || window.location.origin);

pb.autoCancellation(false);
