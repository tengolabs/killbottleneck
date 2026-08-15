import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pb } from '@/api/pb';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { ShoppingCart, Loader2, CreditCard, Landmark, Check } from 'lucide-react';
import { useLazyNs } from '@/i18n/lazyNs';

// Košík členství (jen admin, jen hostovaná instance). Ceny musí sedět 1:1 na
// veřejný ceník a PRICING ve stripe_setup.py — při změně cen se mění OBOJÍ.
// Platba kartou = Stripe payment link z /api/kb/config (payment_links, plní
// provozovatel přes KB_PAYMENT_LINKS; bez něj se karta nenabízí). Platba
// PŘEVODEM jen u ROČNÍHO členství (Richard 8. 8. 2026) a vyžaduje vyplněné
// fakturační údaje — objednávka letí přes AI bránu na provozovatele.
const PLANS = [
  { id: 'cloud-lite-year', tier: 'cloud-lite', period: 'year', priceCzk: 290, transfer: true },
  { id: 'cloud-lite-quarter', tier: 'cloud-lite', period: 'quarter', priceCzk: 99, transfer: false },
  { id: 'privat-standard-month', tier: 'privat-standard', period: 'month', priceCzk: 249, transfer: false },
  { id: 'privat-business-month', tier: 'privat-business', period: 'month', priceCzk: 490, transfer: false },
];

export default function MembershipSection({ billingComplete }) {
  const nsReady = useLazyNs('billing');
  const { t } = useTranslation('billing');
  const { user } = useAuth();
  const [config, setConfig] = useState(null);
  const [plan, setPlan] = useState('cloud-lite-year');
  const [ordering, setOrdering] = useState(false);
  const [orderDone, setOrderDone] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/kb/config').then((r) => (r.ok ? r.json() : null)).then(setConfig).catch(() => {});
  }, []);

  if (user?.role !== 'admin' || !config?.hosted || !nsReady) return null;

  const vybrany = PLANS.find((p) => p.id === plan);
  const links = config.payment_links || {};
  const cardLink = links[plan];
  // client_reference_id = slug instance (subdoména) — Stripe webhook podle něj
  // povýší TUHLE instanci místo zakládání nové. Platí pro hostované adresy
  // <slug>.killbottleneck.com; na vlastní doméně by slug nevyšel, ale košík
  // se ukazuje jen na hostovaných instancích (config.hosted), takže to sedí.
  const slug = window.location.hostname.split('.')[0];
  const cardUrl = cardLink ? `${cardLink}${cardLink.includes('?') ? '&' : '?'}client_reference_id=${encodeURIComponent(slug)}` : null;

  const objednatPrevodem = async () => {
    setOrdering(true);
    setError('');
    try {
      const res = await pb.send('/api/kb/order-transfer', {
        method: 'POST', body: { tier: vybrany.tier, period: 'year' },
      });
      setOrderDone(res.order || {});
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
        {config.trial_until
          ? t('membership.hintTrial', { date: config.trial_until })
          : t('membership.hint')}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4" role="radiogroup">
        {PLANS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={plan === p.id}
            onClick={() => { setPlan(p.id); setOrderDone(null); setError(''); }}
            className={`rounded-lg border p-3 text-left transition-colors ${
              plan === p.id ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/50'}`}
            data-testid={`plan-${p.id}`}>
            <div className="font-medium text-sm">{t(`membership.plan.${p.id}`)}</div>
            <div className="text-lg font-bold mt-1">
              {p.priceCzk} Kč
              <span className="text-xs font-normal text-muted-foreground"> / {t(`membership.period.${p.period}`)}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">{t(`membership.planHint.${p.id}`)}</div>
          </button>
        ))}
      </div>

      {orderDone ? (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 text-sm" data-testid="order-done">
          <p className="flex items-center gap-2 font-medium"><Check className="h-4 w-4" />
            {t('membership.orderReceived')}</p>
          <p className="text-muted-foreground mt-1">
            {t('membership.orderReceivedHint', { amount: orderDone.amount ?? vybrany.priceCzk })}
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {cardUrl ? (
            <Button asChild>
              <a href={cardUrl} target="_blank" rel="noopener noreferrer">
                <CreditCard className="h-4 w-4 mr-2" />{t('membership.payByCard')}
              </a>
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">{t('membership.cardUnavailable')}</span>
          )}
          {vybrany.transfer && (
            <Button variant="outline" onClick={objednatPrevodem}
              disabled={ordering || !billingComplete} data-testid="order-transfer">
              {ordering ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Landmark className="h-4 w-4 mr-2" />}
              {t('membership.orderByTransfer')}
            </Button>
          )}
          {vybrany.transfer && !billingComplete && (
            <span className="text-sm text-amber-600 dark:text-amber-400">{t('membership.billingFirst')}</span>
          )}
          {!vybrany.transfer && (
            <span className="text-sm text-muted-foreground">{t('membership.transferYearlyOnly')}</span>
          )}
        </div>
      )}
      {error && <p className="text-sm text-destructive mt-2">{error}</p>}
    </div>
  );
}
