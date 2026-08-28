// ZJEDNODUŠENÝ (light) REŽIM — „co mám dělat" a „co jsem zadal", nic víc.
//
// Není to responzivní varianta plné appky, je to JINÝ PRODUKT nad stejnými daty.
// Kdo práci řídí, vidí mapu; kdo ji vykonává, vidí seznam. Proto se lite režim
// od plného liší tím, co v něm CHYBÍ: žádný editor mapy, sdílení, nastavení AI,
// API klíče, registr agentů, správa uživatelů, šablony, klienti, měření času,
// archiv ani export. Nic z toho tu není nedodělek — je to záměr.
//
// ⚠️ TVRDÁ PODMÍNKA: tenhle strom NESMÍ importovat ReactFlow ani @radix-ui/*.
// Celý smysl lite režimu je malý balík pro telefon (změřeno: první načtení plné
// appky na 4G ze studené cache trvalo 11,5 s — viz product/tests/scale-limits.js).
// Hlídá to product/tests/lite-bundle.js; když sáhnete po hotové komponentě
// z components/ui/, ověřte si, co za sebou táhne.
import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Sun, Moon, Send, Bell, Plus, ExternalLink, Palette, ArrowDown, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { fetchMyDay } from '@/api/myDay';
import { saveMode, MODE_FULL } from '@/lib/liteMode';
import { base44 } from '@/api/base44Client';
import { BUILTIN_SKINS, DEFAULT_SKIN_ID, getBuiltinSkin } from '@/lib/skins';
import { validateSkin } from '@/lib/skinValidator';
import { setSkin, setTheme, effectiveTheme } from '@/lib/theme';
import LiteList from './LiteList';
import SkinPattern from '@/components/shared/SkinPattern';
import LiteNotifications from './LiteNotifications';
import LiteQuickAdd from './LiteQuickAdd';

const NAV = [
  { to: '/lite', end: true, key: 'today', icon: Sun },
  { to: '/lite/delegated', key: 'delegated', icon: Send },
  { to: '/lite/inbox', key: 'notifications', icon: Bell },
];

export default function LiteApp() {
  const [napovedaSkryta, setNapovedaSkryta] = useState(() => {
    try { return localStorage.getItem('kb-lite-skin-hint') === '1'; } catch (e) { return false; }
  });
  const { t } = useTranslation('lite');
  const { t: tCommon } = useTranslation('common');
  const { user, isLoadingAuth, patchUser } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [day, setDay] = useState(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(() => {
    if (!user?.email) return;
    fetchMyDay()
      .then((d) => { setDay(d); setFailed(false); })
      .catch(() => setFailed(true));
  }, [user]);
  useEffect(() => { reload(); }, [reload]);
  // nativní obal: po návratu z pozadí čerstvý „Můj den" (event z lib/nativeApp.js)
  useEffect(() => {
    window.addEventListener('kb-native-resume', reload);
    return () => window.removeEventListener('kb-native-resume', reload);
  }, [reload]);

  // Na dotyku se akce provede a řádek jen zmizí — bez potvrzení člověk neví,
  // CO se stalo (Richard 27. 7. 2026: „připnutí na mobilu nic nepíše").
  // use-toast importuje jen React, takže tím do light balíku Radix nepřiteče.
  const changed = useCallback((res, note, undo) => {
    if (note) {
      toast({
        title: note,
        // prostý <button>, ne ToastAction ze shadcn — ten by do lite balíku
        // přitáhl Radix, což hlídá product/tests/lite-bundle.js
        action: undo ? (
          <button
            type="button"
            onClick={async () => { try { await undo(); } finally { reload(); } }}
            className="shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-secondary"
          >
            {tCommon('rowActions.undo')}
          </button>
        ) : undefined,
      });
    }
    reload();
  }, [toast, reload, tCommon]);

  // Neúspěch se nesmí spolknout. Řádek by se po reloadu vrátil do původního
  // stavu a vypadalo by to, že akce prostě „nezabrala" — přesně ten tichý
  // neúspěch, kvůli kterému lidi nástroji přestanou věřit.
  const failedAction = useCallback((err) => {
    toast({ title: t('error.actionFailed'), description: err?.message, variant: 'destructive' });
    reload();
  }, [toast, reload, t]);

  const toFull = () => {
    saveMode(MODE_FULL); // volba se pamatuje — nikoho neuvěznit v ořezaném zobrazení
    navigate('/');
  };

  // Tmavý/světlý režim i v lite — na mobilu jinak nešel přepnout vůbec
  // (ThemeToggle je jen v hlavičce plné verze; Richardův nález 30. 7.).
  const [themeNow, setThemeNow] = useState(effectiveTheme());
  const toggleTheme = () => {
    const next = themeNow === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeNow(next);
  };

  // Skin: nativní <select>, NE shadcn Select — Radix by rozbil lite-bundle.js.
  // Import/export vlastního skinu je práce pro plnou verzi; tady se dá vybrat
  // vestavěný (a „Vlastní", pokud už ho účet má z plné verze).
  const hasCustomSkin = validateSkin(user?.skin_custom).ok;
  const changeSkin = (ev) => {
    const id = ev.target.value;
    const skin = id === 'custom' ? validateSkin(user?.skin_custom).clean : getBuiltinSkin(id);
    if (!skin) return;
    setSkin(skin);
    if (user?.id) {
      base44.entities.User.update(user.id, { skin_id: id }).catch(() => {});
      patchUser({ skin_id: id });
    }
  };

  if (!isLoadingAuth && !user) return <Navigate to="/login" replace />;

  return (
    // ⚠️ pb-32, ne pb-20. Spodní lišta je pevná a od 6. 8. 2026 pod ní přibyl
    // obsah (úvodní mapa prodloužila stránku, nápověda se šipkou k tomu),
    // takže se přepínač režimu a vzhledu dostal ZA okraj obrazovky — na
    // telefonu na něj v základní poloze nešlo kliknout. Naměřeno: tlačítko
    // y=840..868 při výšce okna 844. (Nález kontrolního panelu 6. 8. 2026.)
    <div className="min-h-screen bg-background text-foreground pb-32">
      <SkinPattern position="fixed inset-x-0 bottom-14" />
      <Routes>
        <Route index element={
          <LiteList kind="today" day={day} failed={failed} onReload={reload} onChanged={changed} onFailed={failedAction} />
        } />
        <Route path="delegated" element={
          <LiteList kind="delegated" day={day} failed={failed} onReload={reload} onChanged={changed} onFailed={failedAction} />
        } />
        <Route path="inbox" element={<LiteNotifications />} />
        <Route path="*" element={<Navigate to="/lite" replace />} />
      </Routes>

      <div className="max-w-xl mx-auto px-4">
        {/* Přepnutí do plné verze musí být VIDĚT jako tlačítko, ne šedý text —
            pro spoustu lidí je tohle první obrazovka a mysleli by si, že
            zjednodušený seznam je celá aplikace (Richard 6. 8. 2026 večer). */}
        <button
          onClick={toFull}
          className="w-full mt-6 inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground shadow-sm hover:bg-secondary"
        >
          <ExternalLink className="w-4 h-4" /> {t('switch.toFull')}
        </button>
        <p className="text-center text-xs text-muted-foreground pt-2 pb-4">{t('switch.hint')}</p>
        {/* Ukazatel na přepínač vzhledu. Po prvním přihlášení je obrazovka
            prázdná a není čím začít — Richard 6. 8. 2026: „bylo by fajn dát
            šipku, která jde zavřít: zde si změníš svůj vzhled… tím by se mělo
            začít." Zavření si pamatujeme, podruhé už neotravuje. */}
        {!napovedaSkryta && (
          <div className="flex items-start justify-center gap-2 text-xs text-muted-foreground pb-1">
            <span className="text-center">{t('skins.hint')}</span>
            <button
              type="button"
              onClick={() => { try { localStorage.setItem('kb-lite-skin-hint', '1'); } catch (e) { /* soukromý režim */ } setNapovedaSkryta(true); }}
              title={t('skins.hintClose')}
              aria-label={t('skins.hintClose')}
              className="shrink-0 -mt-0.5 p-1 rounded hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {!napovedaSkryta && (
          <div className="flex justify-center text-muted-foreground pb-0.5" aria-hidden="true">
            <ArrowDown className="w-4 h-4 animate-bounce" />
          </div>
        )}
        {/* Přepínač režimu VLEVO vedle palety — vpravo je plovoucí „+" a hrozil
            klik omylem (Richard 30. 7.). */}
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pb-6">
          <button
            type="button"
            data-theme-toggle-lite
            onClick={toggleTheme}
            title={themeNow === 'dark' ? t('skins.toLight') : t('skins.toDark')}
            aria-label={themeNow === 'dark' ? t('skins.toLight') : t('skins.toDark')}
            className="border rounded-md bg-card text-foreground px-2 py-1.5"
          >
            {themeNow === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
          <label className="flex items-center gap-2">
            <Palette className="w-3.5 h-3.5" /> {t('skins.label')}
            <select
              data-skin-select
              value={user?.skin_id || DEFAULT_SKIN_ID}
              onChange={changeSkin}
              className="border rounded-md bg-card text-foreground text-xs px-2 py-1.5"
            >
              {BUILTIN_SKINS.map((s) => (
                <option key={s.id} value={s.id}>{tCommon(`skins.${s.id}`)}</option>
              ))}
              {hasCustomSkin && <option value="custom">{t('skins.custom')}</option>}
            </select>
          </label>
        </div>
      </div>

      <button
        onClick={() => setAdding(true)}
        aria-label={t('add.button')}
        className="fixed right-4 bottom-20 z-30 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center active:scale-95 transition-transform"
      >
        <Plus className="w-6 h-6" />
      </button>
      {adding && <LiteQuickAdd onClose={() => setAdding(false)} onAdded={() => { setAdding(false); reload(); }} />}

      <nav className="fixed bottom-0 inset-x-0 z-20 border-t bg-card">
        <div className="max-w-xl mx-auto grid grid-cols-3">
          {NAV.map((n) => (
            <NavLink
              key={n.key}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
            >
              <n.icon className="w-5 h-5" />
              {t(`nav.${n.key}`)}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
