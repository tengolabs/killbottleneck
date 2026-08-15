import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { pickedDocToLink } from '@/lib/drivePicker';

// „Vybrat z Google Disku" — otevře Google Picker a vybraný soubor předá jako
// ODKAZ (url + název). Nic se nenahrává: hostovaná verze cizí soubory záměrně
// neukládá, soubor zůstává na Disku uživatele a tady vznikne jen příloha-odkaz
// (stejná cesta jako ruční „Přidat odkaz"). Oprávnění sdílení souboru zůstávají
// věcí uživatele — odkaz otevře jen ten, komu soubor na Disku nasdílel.
//
// Scope `drive.file` je nejmenší možný: aplikace vidí JEN soubory, které
// uživatel v pickeru sám vybere, nikdy celý Disk.
//
// Externí skripty (gapi + GIS) se načítají až po PRVNÍM kliknutí — kdo Picker
// nepoužije, nestáhne z Googlu ani bajt. Bez konfigurace (cfg=null) se tlačítko
// vůbec nevykreslí, self-host bez Google klíčů je beze změny.

const SCOPE = 'https://www.googleapis.com/auth/drive.file';

let scriptsPromise = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`load failed: ${src}`));
    document.head.appendChild(s);
  });
}
function loadGoogleScripts() {
  if (!scriptsPromise) {
    scriptsPromise = Promise.all([
      loadScript('https://apis.google.com/js/api.js').then(() =>
        new Promise((r) => window.gapi.load('picker', r))),
      loadScript('https://accounts.google.com/gsi/client'),
    ]).catch((e) => { scriptsPromise = null; throw e; });
  }
  return scriptsPromise;
}

export default function GoogleDrivePickerButton({ cfg, onPicked, disabled }) {
  const { t } = useTranslation('editor');
  const [busy, setBusy] = useState(false);
  if (!cfg || !cfg.client_id || !cfg.api_key) return null;

  const openPicker = async () => {
    setBusy(true);
    try {
      await loadGoogleScripts();
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: cfg.client_id,
        scope: SCOPE,
        callback: (resp) => {
          if (!resp || !resp.access_token) { setBusy(false); return; }
          const picker = new window.google.picker.PickerBuilder()
            .addView(new window.google.picker.DocsView().setIncludeFolders(true))
            .setOAuthToken(resp.access_token)
            .setDeveloperKey(cfg.api_key)
            .setCallback((data) => {
              if (data.action === window.google.picker.Action.PICKED) {
                const link = pickedDocToLink((data.docs || [])[0]);
                if (link.url) onPicked(link);
              }
              if (data.action === window.google.picker.Action.PICKED
                || data.action === window.google.picker.Action.CANCEL) {
                setBusy(false);
              }
            })
            .build();
          picker.setVisible(true);
        },
        error_callback: () => setBusy(false),
      });
      tokenClient.requestAccessToken();
    } catch (err) {
      setBusy(false);
      throw err;
    }
  };

  return (
    <Button variant="outline" size="sm" className="gap-1.5" disabled={disabled || busy}
      data-testid="drive-picker" onClick={() => openPicker().catch(() => {})}>
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M7.71 3.5 1.15 15l3.43 5.99 6.58-11.49L7.71 3.5zm8.58 0h-6.86l6.57 11.5h6.85L16.29 3.5zM9.16 16.5 5.72 22.5h13.14l3.43-6H9.16z" />
        </svg>
      )}
      {t('nodeDialog.files.fromDrive')}
    </Button>
  );
}
