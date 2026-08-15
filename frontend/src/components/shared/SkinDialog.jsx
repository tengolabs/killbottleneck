import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { BUILTIN_SKINS, DEFAULT_SKIN_ID, getBuiltinSkin } from '@/lib/skins';
import { effectiveTheme, setTheme } from '@/lib/theme';
import { validateSkin, fontStack } from '@/lib/skinValidator';
import { setSkin } from '@/lib/theme';
import { Check, Download, Upload, ExternalLink, Palette, Sun as SunIcon, Moon as MoonIcon } from 'lucide-react';

// PŘED VYDÁNÍM (RENAME CHECKLIST): přepnout na veřejné repo pod org killbottleneck.
// Do té doby privátní vývojové repo na osobním účtu (rozhodnutí 30. 7. 2026).
const GALLERY_URL = 'https://github.com/tengolabs/killbottleneck-skins';

// Náhledová karta = mini-swatch vykreslený inline z hodnot skinu (žádné
// screenshoty): pozadí, karta s borderem, tečky primary/accent, „Aa" v písmu
// nadpisů. Vědomě ze sekce light — karta má vypadat stejně v obou režimech.
function SkinCard({ skin, active, label, title, onClick }) {
  const l = skin.light || {};
  const c = (k, fb) => `hsl(${l[k] || fb})`;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title || skin.description}
      data-skin-card={skin.id || 'custom'}
      className={`relative flex flex-col h-24 text-left rounded-lg border-2 overflow-hidden transition-shadow hover:shadow-md ${
        active ? 'border-primary ring-2 ring-primary/30' : 'border-border'
      }`}
    >
      <div className="flex-1 min-h-0 p-2" style={{ background: c('background', '210 40% 98%') }}>
        <div
          className="h-full rounded px-2 flex items-center justify-between"
          style={{
            background: c('card', '0 0% 100%'),
            border: `1px solid hsl(${l.border || '214 32% 91%'})`,
            borderRadius: l.radius || '0.5rem',
          }}
        >
          <span
            className="text-lg font-bold"
            style={{
              color: c('foreground', '222 47% 11%'),
              fontFamily: Array.isArray(l['font-heading']) ? fontStack(l['font-heading']) : undefined,
            }}
          >
            Aa
          </span>
          <span className="flex gap-1">
            <span className="w-4 h-4 rounded-full" style={{ background: c('primary', '239 84% 67%') }} />
            <span className="w-4 h-4 rounded-full" style={{ background: c('accent', '239 84% 95%') }} />
          </span>
        </div>
      </div>
      <div className="shrink-0 px-2 py-1.5 bg-card flex items-center justify-between gap-1">
        <span className="text-xs font-medium truncate">{label || skin.name}</span>
        {active && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
      </div>
    </button>
  );
}

// Výběr skinu + import/export (formát kb-skin v1, viz lib/skinValidator.js).
// Volba se ukládá k účtu (vzor jazyka — LanguageToggle); localStorage cache
// v theme.js drží vzhled i offline a před přihlášením.
export default function SkinDialog({ open, onClose }) {
  // režim se přepíná rovnou v dialogu, ať je vidět, jak skin vypadá v obou
  const [tema, setTema] = useState(effectiveTheme());
  const { t } = useTranslation('nav');
  const { t: tCommon } = useTranslation('common');
  const { toast } = useToast();
  const { user, patchUser } = useAuth();
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const fileRef = useRef(null);

  const activeId = user?.skin_id || DEFAULT_SKIN_ID;
  const customSkin = (() => {
    const r = validateSkin(user?.skin_custom);
    return r.ok ? r.clean : null;
  })();

  const persist = (fields) => {
    if (!user?.id) return;
    base44.entities.User.update(user.id, fields).catch(() => {});
    patchUser(fields);
  };

  const chooseBuiltin = (skin) => {
    setSkin(skin);
    persist({ skin_id: skin.id });
  };

  const chooseCustom = () => {
    if (!customSkin) return;
    setSkin(customSkin);
    persist({ skin_id: 'custom' });
  };

  const applyImport = (text) => {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      toast({ title: t('skins.importInvalid'), description: t('skins.importNotJson'), variant: 'destructive' });
      return;
    }
    const r = validateSkin(obj);
    if (!r.ok) {
      toast({ title: t('skins.importInvalid'), description: r.errors.join(', '), variant: 'destructive' });
      return;
    }
    if (r.warnings.length) {
      // neznámé tokeny (skin z novější verze formátu) se přeskočí, zbytek platí
      toast({ title: t('skins.importWarnings'), description: r.warnings.join(', ') });
    }
    setSkin(r.clean);
    persist({ skin_id: 'custom', skin_custom: r.clean });
    setImportOpen(false);
    setImportText('');
  };

  const onFile = (ev) => {
    const f = ev.target.files?.[0];
    ev.target.value = '';
    if (!f) return;
    f.text().then(applyImport).catch(() => {
      toast({ title: t('skins.importInvalid'), variant: 'destructive' });
    });
  };

  // Export aktuálního skinu — u vestavěného jeho definici („vzít a upravit"),
  // interní `id` ven nejde (v galerii by kolidovalo). Metadata se doplňují až
  // TADY — v datech skinů nejsou, ať zbytečně neleží v lite bundlu.
  const exportSkin = () => {
    const current = (activeId === 'custom' ? customSkin : getBuiltinSkin(activeId))
      || getBuiltinSkin(DEFAULT_SKIN_ID);
    const { id, ...bare } = current;
    const data = id
      ? { ...bare, author: 'killBottleneck', license: 'CC0-1.0', description: tCommon(`skinDesc.${id}`) }
      : bare;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (data.name || 'skin').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.kb-skin.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="w-5 h-5" /> {t('skins.title')}
          </DialogTitle>
          <DialogDescription>{t('skins.description')}</DialogDescription>
        </DialogHeader>

        {/* Přepínač světlý/tmavý přímo tady (Richard 12. 8. 2026: „když
            přepínám skiny, bylo by super měnit i tmavý a světlý — nemusím
            lézt do mapy a vidím, jak se mění pozadí"). Skin platí pro oba
            režimy, takže se vybírá dvojice skin × režim; bez přepínače šla
            vidět jen půlka výsledku. */}
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
          <span className="text-sm text-muted-foreground">{t('skins.previewMode')}</span>
          <div className="flex gap-1">
            {[['light', SunIcon], ['dark', MoonIcon]].map(([rezim, Ikona]) => (
              <Button
                key={rezim}
                type="button"
                variant={tema === rezim ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setTheme(rezim); setTema(rezim); }}
                aria-pressed={tema === rezim}
                data-theme-pick={rezim}
              >
                <Ikona className="w-4 h-4 mr-1" />
                {t(rezim === 'dark' ? 'skins.modeDark' : 'skins.modeLight')}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 max-h-[55vh] overflow-y-auto pr-1">
          {BUILTIN_SKINS.map((skin) => (
            <SkinCard
              key={skin.id}
              skin={skin}
              label={tCommon(`skins.${skin.id}`)}
              title={tCommon(`skinDesc.${skin.id}`)}
              active={activeId === skin.id}
              onClick={() => chooseBuiltin(skin)}
            />
          ))}
          {customSkin && (
            <SkinCard
              skin={customSkin}
              label={`${t('skins.custom')} — ${customSkin.name}`}
              active={activeId === 'custom'}
              onClick={chooseCustom}
            />
          )}
        </div>

        {importOpen && (
          <div className="space-y-2">
            <Textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={t('skins.importPlaceholder')}
              rows={5}
              className="font-mono text-xs"
              data-skin-import
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => applyImport(importText)} disabled={!importText.trim()} data-skin-import-apply>
                {t('skins.importApply')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setImportOpen(false); setImportText(''); }}>
                {t('skins.importCancel')}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
          <Button variant="outline" size="sm" onClick={() => (importOpen ? fileRef.current?.click() : setImportOpen(true))}>
            <Upload className="w-4 h-4 mr-1.5" /> {importOpen ? t('skins.importFile') : t('skins.importBtn')}
          </Button>
          <Button variant="outline" size="sm" onClick={exportSkin}>
            <Download className="w-4 h-4 mr-1.5" /> {t('skins.exportBtn')}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={GALLERY_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-1.5" /> {t('skins.gallery')}
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
