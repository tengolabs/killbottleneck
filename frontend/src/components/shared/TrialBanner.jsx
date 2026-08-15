import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { pb } from '@/api/pb';
import { useAuth } from '@/lib/AuthContext';
import { Clock, Lock } from 'lucide-react';

// Pruh o zkušební době. Server ho ohlašuje v /api/kb/config (trial_until,
// trial_expired) od 6. 8. 2026 — bez tohohle pruhu by se zákazník o konci
// zkušebky dozvěděl až ve chvíli, kdy mu poprvé neprojde uložení. Tedy
// v nejhorší možný okamžik.
//
// Kdo co vidí (klik-test 7. 8. 2026 — Richard odpočet „nikde neviděl"):
//   · SPRÁVCE organizace: nenápadný odpočet dní po CELOU zkušebku,
//   · všichni: výrazný pruh posledních 7 dní (dřív by členy jen otravoval),
//   · všichni: po vypršení vždy — to už je vysvětlení, ne upomínka.
// Instance bez zkušebky (self-host, placené tarify) pruh nikdy neuvidí.
const CENIK = 'https://killbottleneck.cz/ceny';
const DNI_PRED = 7;

export default function TrialBanner() {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stav, setStav] = useState(null);

  // „Vybrat tarif": SPRÁVCE jde do košíku ve Správě organizace (Richard
  // 8. 8. 2026 — tarif se nově vybírá a platí PŘÍMO v aplikaci); člen na
  // Správu organizace nedosáhne, ten dál míří na veřejný ceník.
  const cta = user?.role === 'admin'
    ? {
      onClick: (e) => { e.preventDefault(); navigate('/admin/users'); },
      href: '/admin/users',
    }
    : { href: CENIK, target: '_blank', rel: 'noopener noreferrer' };

  useEffect(() => {
    let zivy = true;
    pb.send('/api/kb/config', { method: 'GET' })
      .then((cfg) => {
        if (!zivy || !cfg?.trial_until) return;
        const konec = new Date(cfg.trial_until + 'T23:59:59Z');
        const zbyva = Math.ceil((konec - Date.now()) / 86400000);
        setStav({ vyprselo: !!cfg.trial_expired, zbyva, konec: cfg.trial_until });
      })
      .catch(() => { /* config nejde načíst → pruh prostě není */ });
    return () => { zivy = false; };
  }, []);

  if (!stav) return null;
  if (!stav.vyprselo && stav.zbyva > DNI_PRED) {
    // mimo posledních 7 dní: členy neobtěžovat, správce ale musí mít přehled
    if (user?.role !== 'admin') return null;
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 px-4 py-1 text-xs border-b shrink-0 bg-muted/40 text-muted-foreground"
      >
        <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{t('trial.remaining', { count: stav.zbyva })}</span>
        <a {...cta} className="underline underline-offset-2 whitespace-nowrap">
          {t('trial.cta')}
        </a>
      </div>
    );
  }

  const vyprselo = stav.vyprselo;
  const Ikona = vyprselo ? Lock : Clock;
  return (
    <div
      role="status"
      className={`flex items-center justify-center gap-3 px-4 py-2 text-sm border-b shrink-0 ${
        vyprselo
          ? 'bg-red-50 border-red-200 text-red-900 dark:bg-red-950/40 dark:border-red-900 dark:text-red-200'
          : 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-200'
      }`}
    >
      <Ikona className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="font-medium">
        {vyprselo
          ? t('trial.expired')
          : t('trial.remaining', { count: Math.max(stav.zbyva, 0) })}
      </span>
      <a {...cta} className="underline underline-offset-2 font-semibold whitespace-nowrap">
        {t('trial.cta')}
      </a>
    </div>
  );
}
