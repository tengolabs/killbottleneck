import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { i18nReady } from '@/i18n'
import { initTheme } from '@/lib/theme'
import { isNativeShell } from '@/lib/nativeShell'

initTheme()

// Service worker = podmínka pro „přidat na plochu" a offline čtení posledního
// přehledu. Registruje se AŽ po načtení, aby nesoupeřil o linku s prvním
// vykreslením. Na LAN přes http (mimo secure context) se prostě nespustí —
// klik-test mobilu proto dělat přes HTTPS doménu, ne přes IP.
// Viz [[reference-flowmap-secure-context-apis]].
// Nativní chování obalu (back button, resume refetch, zrcadlení session,
// lokální notifikace) — vše v lib/nativeApp.js. Dynamický import → samostatný
// chunk, web si ho nikdy nestáhne.
if (isNativeShell()) {
  import('@/lib/nativeApp')
    .then((m) => m.initNativeApp())
    .catch(() => { /* bez nativních vychytávek appka funguje dál */ });
}

// V nativním obalu (Capacitor) se SW neregistruje: assets jsou v APK a jeho
// cache-first by po aktualizaci appky servírovala starý frontend.
if (!isNativeShell() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* bez SW appka funguje dál */ });
  });
}

// Boot-gate: první render až s načteným jazykovým balíkem (katalogy nejsou
// ve vstupním bundlu — lite dieta). Žádný Suspense/flash, jen krátké čekání
// na jeden malý chunk; motiv (initTheme výš) je aplikovaný okamžitě.
const vykresli = () => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <App />
  )
}
// .catch je tu POVINNÝ: první render nově čeká na stažení jazykového balíku,
// a když se nestáhne (stará PWA cache po nasazení, výpadek sítě), bez tohohle
// se nevykreslí VŮBEC NIC — bílá stránka místo aplikace. Raději appka
// s klíči místo překladů než prázdno. (nález revize 4. 8. 2026)
i18nReady.catch((e) => { console.error('jazykový balík se nenačetl', e); }).then(vykresli)
