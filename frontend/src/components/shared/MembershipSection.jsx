import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pb } from '@/api/pb';
import { loadKbConfig, invalidateKbConfig } from '@/hooks/useKbConfig';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { ShoppingCart, Loader2, CreditCard, Landmark, Check, ExternalLink, Mail } from 'lucide-react';
import { useLazyNs } from '@/i18n/lazyNs';
import { TARIFY } from '@/lib/kosikTarify';

// Košík členství (jen admin, jen hostovaná instance). Tarify a ceny viz
// lib/kosikTarify.js.
// SAMOOBSLUHA jen pro ZKUŠEBKU a jen na Cloud Lite (rozhodnutí Richarda 14. 10.
// 2026): tahle cesta je jediná, kterou provozovatel po zaplacení povýší bez
// člověka (instanci se jen zruší konec zkušebky). Přechod na vlastní server
// (Pro / AI Agent = stěhování dat) a změna tarifu u instance, která už platí
// (změna předplatného místo druhého nákupu), se zatím domlouvají e-mailem —
// tlačítko „Napsat nám". Až bude postavený upgrade v administraci, karta se
// rozšíří.
// Platba kartou = Stripe payment link z /api/kb/config (payment_links, klíč
// `<tarif>-<období>`, plní provozovatel; bez něj se karta nenabízí). Platba
// PŘEVODEM jen u ročního Lite (Richard 8. 8. 2026; server jiný tarif odmítne)
// a vyžaduje vyplněné fakturační údaje.
const SUPPORT = 'support@killbottleneck.com';
const OBDOBI = ['month', 'quarter', 'year'];

export default function MembershipSection({ billingComplete }) {
  const nsReady = useLazyNs('billing');
  const { t } = useTranslation('billing');
  const { user } = useAuth();
  const [config, setConfig] = useState(null);
  const [tier, setTier] = useState('cloud-lite');
  const [period, setPeriod] = useState('year');
  const [ordering, setOrdering] = useState(false);
  const [orderDone, setOrderDone] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadKbConfig().then(setConfig).catch(() => {});
  }, []);

  if (user?.role !== 'admin' || !config?.hosted || !nsReady) return null;

  const vybrany = TARIFY.find((x) => x.tier === tier);
  // zkušebka = instance s koncem zkušební doby (i prošlé); bez něj už platí
  const zkusebka = !!config.trial_until;
  const samoobsluha = zkusebka && tier === 'cloud-lite';
  const cena = vybrany.prices[period];
  const prevodem = samoobsluha && vybrany.transferYear && period === 'year';
  const links = config.payment_links || {};
  const cardLink = links[`${tier}-${period}`];
  // client_reference_id = slug instance (subdoména) — Stripe webhook podle něj
  // povýší TUHLE instanci místo zakládání nové. Platí pro hostované adresy
  // <slug>.killbottleneck.com; na vlastní doméně by slug nevyšel, ale košík
  // se ukazuje jen na hostovaných instancích (config.hosted), takže to sedí.
  const slug = window.location.hostname.split('.')[0];
  // prefilled_email: webhook povýší instanci jen při shodě e-mailu plátce s e-mailem,
  // kterým byla založená — jinak by platba založila NOVOU instanci. Správce zkušebky
  // je skoro vždy ten, kdo ji zakládal, tak mu ho rovnou předvyplníme.
  const cardUrl = samoobsluha && cardLink
    ? `${cardLink}${cardLink.includes('?') ? '&' : '?'}client_reference_id=${encodeURIComponent(slug)}`
      + (user?.email ? `&prefilled_email=${encodeURIComponent(user.email)}` : '')
    : null;
  const mailto = `mailto:${SUPPORT}?subject=${encodeURIComponent(t('membership.mailSubject', {
    plan: t(`membership.plan.${tier}`), period: t(`membership.periodPick.${period}`), slug,
  }))}`;
  const funkce = (x) => {
    const f = t(`membership.features.${x}`, { returnObjects: true });
    return Array.isArray(f) ? f : []; // chybějící klíč vrací řetězec — nespadnout s celou stránkou
  };

  const objednatPrevodem = async () => {
    setOrdering(true);
    setError('');
    try {
      const res = await pb.send('/api/kb/order-transfer', {
        method: 'POST', body: { tier, period: 'year' },
      });
      setOrderDone(res.order || {});
      invalidateKbConfig(); // objednávka mění trial_* v configu (TrialBanner)
    } catch (err) {
      setError(err?.response?.error || err.message);
    } finally {
      setOrdering(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 mt-6" data-testid="membership-section">
      <div className="flex items-center gap-2 mb-1">
        <ShoppingCart className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">{t('membership.heading')}</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        {zkusebka
          ? t('membership.hintTrial', { date: config.trial_until })
          : t('membership.hintActive')}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3" role="radiogroup" aria-label={t('membership.planLabel')}>
        {TARIFY.map((x) => (
          <button key={x.tier} type="button" role="radio" aria-checked={tier === x.tier}
            onClick={() => {
              setTier(x.tier);
              if (!x.prices[period]) setPeriod('year'); // čtvrtletí má jen Lite
              setOrderDone(null); setError('');
            }}
            className={`rounded-lg border p-3 text-left transition-colors ${
              tier === x.tier ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/50'}`}
            data-testid={`plan-${x.tier}`}>
            <div className="font-medium text-sm">{t(`membership.plan.${x.tier}`)}</div>
            <div className="text-lg font-bold mt-1">
              {x.prices[period] ?? x.prices.year} Kč
              <span className="text-xs font-normal text-muted-foreground"> / {t(`membership.period.${x.prices[period] ? period : 'year'}`)}</span>
            </div>
            <ul className="mt-2 space-y-1">
              {funkce(x.tier).map((f) => (
                <li key={f} className="flex gap-1.5 text-xs text-muted-foreground">
                  <Check className="h-3.5 w-3.5 mt-px shrink-0 text-primary" />{f}
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>

      <a href={t('membership.pricingUrl')} target="_blank" rel="noopener noreferrer" data-testid="compare-plans"
        className="inline-flex items-center gap-1 text-sm text-primary hover:underline mb-3">
        {t('membership.compareLink')}<ExternalLink className="h-3.5 w-3.5" />
      </a>

      <div className="flex flex-wrap items-center gap-2 mb-4" role="radiogroup" aria-label={t('membership.periodLabel')}>
        {OBDOBI.filter((o) => vybrany.prices[o]).map((o) => (
          <button key={o} type="button" role="radio" aria-checked={period === o}
            onClick={() => { setPeriod(o); setOrderDone(null); setError(''); }}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              period === o ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'}`}
            data-testid={`period-${o}`}>
            {t(`membership.periodPick.${o}`)}
          </button>
        ))}
        {period === 'year' && (
          <span className="text-xs text-muted-foreground">{t('membership.yearFree')}</span>
        )}
      </div>

      {orderDone ? (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 text-sm" data-testid="order-done">
          <p className="flex items-center gap-2 font-medium"><Check className="h-4 w-4" />
            {t('membership.orderReceived')}</p>
          <p className="text-muted-foreground mt-1">
            {t('membership.orderReceivedHint', { amount: orderDone.amount ?? cena })}
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {cardUrl && (
            <Button asChild>
              <a href={cardUrl} target="_blank" rel="noopener noreferrer" data-testid="pay-card">
                <CreditCard className="h-4 w-4 mr-2" />{t('membership.payByCard')}
              </a>
            </Button>
          )}
          {prevodem && (
            <Button variant="outline" onClick={objednatPrevodem}
              disabled={ordering || !billingComplete} data-testid="order-transfer">
              {ordering ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Landmark className="h-4 w-4 mr-2" />}
              {t('membership.orderByTransfer')}
            </Button>
          )}
          {!samoobsluha && (
            <Button asChild variant={zkusebka ? 'default' : 'outline'}>
              <a href={mailto} data-testid="write-us"><Mail className="h-4 w-4 mr-2" />{t('membership.writeUs')}</a>
            </Button>
          )}
          {prevodem && !billingComplete && (
            <span className="text-sm text-amber-600 dark:text-amber-400">{t('membership.billingFirst')}</span>
          )}
          <span className="text-sm text-muted-foreground basis-full" data-testid="membership-note">
            {!samoobsluha
              ? t(zkusebka ? 'membership.ownServerByMail' : 'membership.changeByMail')
              : !cardLink
                ? t(prevodem ? 'membership.cardUnavailable' : 'membership.cardUnavailableNoTransfer')
                : [t('membership.payerEmail'), !prevodem && t('membership.transferYearlyOnly')].filter(Boolean).join(' ')}
          </span>
        </div>
      )}
      {error && <p className="text-sm text-destructive mt-2">{error}</p>}
    </div>
  );
}
