import { useEffect, useState } from 'react';
import { loadKbConfig } from '@/hooks/useKbConfig';

// New-version check for SELF-HOSTED instances.
//
// The BROWSER asks, not the server: the instance never sends anything about
// itself anywhere, so there is no telemetry to justify in an open source
// product. The price is that we only learn about it while someone is signed
// in — which is enough for a self-hoster, who updates by hand anyway.
//
// Disabled in three cases (the server decides in /api/kb/config):
//   1. hosted instance (KB_HOSTED=1) — we update it, the notice would only
//      confuse the customer,
//   2. the self-hoster turned it off (KB_UPDATE_CHECK=0),
//   3. a development build without a git tag (version "dev" or empty).

const CACHE_KEY = 'kb-version-check';
const CACHE_MS = 24 * 60 * 60 * 1000; // GitHub API má 60 dotazů/h na IP — stačí 1× denně

// "v0.11" → čísla [0, 11]. Předběžná přípona (-alpha/-beta/-rc) se
// pamatuje zvlášť: stejné číslo BEZ ní je novější (v0.33 > v0.33-beta),
// jinak by se beta instance o finálním vydání téhož čísla nedozvěděla.
// Gitové přípony buildů ("-3-g1234abc") předběžné nejsou — build kousek
// za tagem nemá věčně hlásit vlastní tag jako novinku.
function parts(tag) {
  const m = String(tag || '').match(/(\d+(?:\.\d+)*)(-(?:alpha|beta|rc)[0-9.]*)?/i);
  return m ? { nums: m[1].split('.').map(Number), pre: !!m[2] } : null;
}

export function isNewer(latest, current) {
  const a = parts(latest);
  const b = parts(current);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i += 1) {
    const x = a.nums[i] || 0;
    const y = b.nums[i] || 0;
    if (x !== y) return x > y;
  }
  return b.pre && !a.pre;
}

// Build bez tagu se nehlídá — jinak by vývojová instance věčně hlásila,
// že je zastaralá.
function jeVydanaVerze(v) {
  return !!v && v !== 'dev' && !v.endsWith('-dirty') && !!parts(v);
}

export default function useVersionCheck() {
  const [stav, setStav] = useState({ version: '', latest: '', hasUpdate: false, url: '' });

  useEffect(() => {
    let zivy = true;
    loadKbConfig()
      .then((c) => {
        if (!zivy) return null;
        const version = c.version || '';
        setStav((s) => ({ ...s, version }));
        if (!c.update_check || !jeVydanaVerze(version)) return null;

        // Odpověď GitHubu si držíme den, ať opakované otevření dialogu
        // nesestřelí limit dotazů sdílené kancelářské IP.
        try {
          const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
          if (cache && Date.now() - cache.at < CACHE_MS && cache.repo === c.update_repo) {
            return cache;
          }
        } catch {
          // rozbitá cache není důvod nic nehlásit — prostě se zeptáme znovu
        }

        // ⚠️ Ptáme se na SEZNAM vydání, ne na /releases/latest. Ten endpoint u repa,
        // které má zatím jen předběžná vydání, vrací 404 — a prohlížeč takový
        // požadavek zapíše do konzole jako červenou chybu. Self-hoster pak vidí
        // „rozbitou" aplikaci, i když šlo o správné chování (nic nenabídnout).
        // Seznam vrací 200 a předběžná/rozpracovaná vydání si odfiltrujeme sami.
        return fetch(`https://api.github.com/repos/${c.update_repo}/releases?per_page=10`, {
          headers: { Accept: 'application/vnd.github+json' },
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((seznam) => {
            // KB_UPDATE_PRERELEASE=1: also offer release candidates (-rc); default = stable releases only.
            const rel = Array.isArray(seznam)
              ? seznam.find((x) => x && !x.draft && (c.update_prerelease || !x.prerelease))
              : null;
            if (!rel) return null;
            const zaznam = {
              at: Date.now(),
              repo: c.update_repo,
              tag: rel.tag_name || '',
              url: rel.html_url || '',
            };
            try {
              localStorage.setItem(CACHE_KEY, JSON.stringify(zaznam));
            } catch {
              // plné/zakázané úložiště nesmí shodit kontrolu
            }
            return zaznam;
          })
          .catch(() => null); // bez sítě / GitHub mimo provoz = mlčet, ne rozbít dialog
      })
      .then((zaznam) => {
        if (!zivy || !zaznam) return;
        setStav((s) => ({
          ...s,
          latest: zaznam.tag,
          url: zaznam.url,
          hasUpdate: isNewer(zaznam.tag, s.version),
        }));
      })
      .catch(() => {});
    return () => {
      zivy = false;
    };
  }, []);

  return stav;
}
