import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  // Varování buildu se NEtlumí (analýza kódu 2, F6-02: `logLevel: 'error'` schoval
  // i varování o pořadí vyhodnocení kruhových modulů). Zbývající známé varování:
  // kruh api/kb.js ↔ api/myDay.js a i18n/index.js ↔ lang.js — řeší vlna E.
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Nad výchozích 500 kB jsou (měření analýzy 2, 27. 9. 2026, minifikované):
    // fontkit 764 kB a pdf (pdfjs + pdf-lib) 518 kB — oba ZÁMĚRNĚ, načítají se
    // líně (import()) až při práci s PDF, proto o nich varování nechceme.
    // ⚠️ Pod 800 kB se vejde i hlavní chunk index (532 kB) — ten limit netlumí
    // vědomě, jen shodou okolností; při jeho dalším růstu limit NEzvedat, ale
    // odlehčit hlavní balík.
    chunkSizeWarningLimit: 800,
  },
  server: {
    // dev režim: API požadavky posílat na lokální PocketBase
    proxy: {
      '/api': 'http://127.0.0.1:8090',
    },
  },
});
