import { useState, useEffect } from 'react';
import TrialBanner from '@/components/shared/TrialBanner';
import UserMenu from '@/components/shared/UserMenu';
import { saveMode, MODE_LITE } from '@/lib/liteMode';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import OrgLogo from '@/components/shared/OrgLogo';
import { useAuth } from '@/lib/AuthContext';
import ThemeToggle from '@/components/ThemeToggle';
import NotificationBell from '@/components/shared/NotificationBell';
import TimerWidget from '@/components/shared/TimerWidget';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Smartphone } from 'lucide-react';

// Jednotná hlavička přihlášené aplikace (Home i Úkoly) — stejné logo, navigace
// a uživatelské menu všude, ať přepínání stránek nepůsobí jako „přeneslo mě to jinam".
// Editor mapy má vlastní specializovanou lištu, ten sem nepatří — sdílí ale
// nabídku pod panáčkem (components/shared/UserMenu.jsx), aby uživatel hledal
// účet, vzhled a jazyk všude na stejném místě (reklamace z bety 12. 8. 2026).
// NAV je uvnitř komponenty, aby se štítky vyhodnotily při každém renderu
// (jazyk se přepíná za běhu).

export default function AppHeader({ active, backTo, actions, org: orgProp, onInvited }) {
  const { t, i18n } = useTranslation('nav');
  const { t: tLite } = useTranslation('lite');
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const NAV = [
    { key: 'projects', label: t('nav.projects'), to: '/' },
    { key: 'tasks', label: t('nav.tasks'), to: '/tasks' },
    { key: 'mymap', label: t('nav.myMap'), to: '/my-map' },
    // „Organizace" — pohled shora, jen admin a manažer. Vědomé prolomení
    // anti-bloat pravidla „žádná nová trvalá položka v navigaci" rozhodnutím
    // majitele produktu (Richard 25. 8. 2026). Člen položku nevidí; v lite není.
    ...((user?.role === 'admin' || user?.role === 'manager')
      ? [{ key: 'organizace', label: t('nav.organizace'), to: '/organizace' }] : []),
    { key: 'templates', label: t('nav.templates'), to: '/?view=templates' },
  ];
  const [orgOwn, setOrgOwn] = useState(null);
  const org = orgProp !== undefined ? orgProp : orgOwn;

  useEffect(() => {
    if (orgProp === undefined) base44.org.get().then(setOrgOwn).catch(() => {});
  }, [orgProp]);

  return (
    <>
    {/* Pruh o zkušební době patří NAD hlavičku, ať ho vidí každá stránka
        s AppHeaderem — jinak by se musel opakovat na pěti místech. */}
    <TrialBanner />
    <header className="border-b bg-card">
      <div className="max-w-6xl mx-auto px-4 min-h-14 sm:h-14 flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-2 gap-y-1.5 py-1.5 sm:py-0">
        <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto">
          {backTo && (
            <Button variant="ghost" size="icon" onClick={() => navigate(backTo)} className="shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          )}
          {/* Logo je zkratka na úvod — klik odkudkoli (mapa, šablony, nastavení…)
              vede na Home (Richard 7. 8. 2026). Přístupné: button s aria-label,
              samotné obrázky zůstávají dekorativní. */}
          <button
            type="button"
            onClick={() => navigate('/')}
            title={t('header.homeLink')}
            aria-label={t('header.homeLink')}
            className="flex items-center shrink-0 rounded-md outline-none hover:opacity-80 transition-opacity focus-visible:ring-2 focus-visible:ring-ring"
          >
            <OrgLogo org={org} />
          </button>
          <h1 className="font-heading text-lg font-bold tracking-tight truncate hidden sm:block">
            {/* Dokud si organizace nenastaví vlastní název, stojí tu značka
                produktu — ne popis „Mapa cílů" (Richard 6. 8. 2026). */}
            {org?.name || t('header.defaultTitle')}
          </h1>
          {/* Na úzkém displeji se lišta POSOUVÁ UVNITŘ (swipe), nikdy neroztáhne
              stránku: pátá položka „Organizace" (admin/manažer) se na 390 px
              nevejde a bez toho měla celá aplikace vodorovný posun (nález
              panelu 25. 8. 2026). Posuvník je schovaný, položky se nezalamují. */}
          <nav className="flex items-center gap-1 ml-2 sm:ml-4 self-stretch min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {NAV.map((item) => (
              <button
                key={item.key}
                data-nav={item.key}
                onClick={() => navigate(item.to)}
                className={`px-2 sm:px-3 h-full text-sm font-medium whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                  active === item.key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
          {actions}
          <TimerWidget />
          <NotificationBell />
          <ThemeToggle />
          {/* CESTA ZPĚT DO LITE REŽIMU, vidět bez otevírání menu.
              Richard 27. 7. 2026: „přepnu se do plného režimu jedním klikem
              a pak se člověk ztratí ve velkém prostředí a nemá šanci zpět."
              Na úzkém displeji je to jediné rozumné místo — v menu pod avatarem
              se to na telefonu nedá najít. Na širokém displeji zůstává v menu,
              aby lišta nebobtnala (anti-bloat pravidlo). */}
          {user && (
            <Button
              variant="outline"
              size="icon"
              className="min-[1024px]:hidden"
              onClick={() => { saveMode(MODE_LITE); navigate('/lite'); }}
              title={tLite('switch.toLite')}
              aria-label={tLite('switch.toLite')}
            >
              <Smartphone className="w-4 h-4" />
            </Button>
          )}
          <UserMenu onInvited={onInvited} />
        </div>
      </div>
    </header>
    </>
  );
}
