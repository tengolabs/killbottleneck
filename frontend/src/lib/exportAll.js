import { pb } from '@/api/pb';
import { saveBlob, dateStamp } from '@/lib/saveFile';

// „Stáhnout všechna moje data" — GET /api/kb/export (session) → jeden JSON
// killbottleneck.export/1 → uložit jako soubor. Token jde v hlavičce, ne
// v adrese (auth token v URL by skončil v logách proxy). Odpověď se bere jako
// PROUD do Blobu (ne pb.send → objekt → stringify), ať velký export nedrží
// prohlížeč třikrát v paměti; název souboru dává server (Content-Disposition).
// Funguje i po vypršení zkušebky (čtení middleware nezastaví).
export async function downloadAllMyData() {
  const res = await fetch(pb.buildURL('/api/kb/export'), { headers: { Authorization: pb.authStore.token || '' } });
  if (!res.ok) {
    const err = new Error(`export ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const cd = res.headers.get('content-disposition') || '';
  const m = /filename="?([^";]+)"?/.exec(cd);
  const den = dateStamp(); // místní den (dřív UTC → po 22:00 SELČ včerejšek)
  const name = (m && m[1]) || `killbottleneck-export-${den}.json`;
  await saveBlob(await res.blob(), name);
  return name;
}

// „Nahrát data z exportu" — celý soubor killbottleneck.export/1 → POST /api/kb/import-all
// (projekty s pravidly + zásobník; ostatní zůstává v souboru). Zápis → po vypršení zkušebky 402.
export async function uploadAllMyData(data) {
  return pb.send('/api/kb/import-all', { method: 'POST', body: data });
}
