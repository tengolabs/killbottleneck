import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pb } from '@/api/pb';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FileText, Loader2, Check } from 'lucide-react';
import { useLazyNs } from '@/i18n/lazyNs';

// Fakturační údaje organizace (jen admin). Při registraci zkušebky se
// NEVYŽADUJÍ — povinné jsou až při objednávce členství (MembershipSection
// bez nich objednávku nepustí). Server: GET/POST /api/kb/billing (whitelist).
//
// ⚠️ JEN NA HOSTOVANÉ INSTANCI (`config.hosted`), stejně jako MembershipSection.
// Self-host si u nás nic neobjednává, takže IČO a DIČ tam nemají co pohledávat.
// Do 8. 8. 2026 to bylo napsané jen v komentáři v UserAdmin.jsx a v kódu chybělo,
// takže self-hoster fakturační formulář VIDĚL.
export default function BillingSection({ onChange }) {
  const nsReady = useLazyNs('billing');
  const { t } = useTranslation('billing');
  const { user } = useAuth();
  const [form, setForm] = useState({ company: '', ico: '', dic: '', street: '', city: '', zip: '', email: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [hosted, setHosted] = useState(null);

  useEffect(() => {
    pb.send('/api/kb/config', { method: 'GET' })
      .then((cfg) => setHosted(!!(cfg && cfg.hosted)))
      .catch(() => setHosted(false));
  }, []);

  useEffect(() => {
    if (!hosted) return;
    pb.send('/api/kb/billing', { method: 'GET' })
      .then((res) => {
        setForm((f) => ({ ...f, ...(res.billing || {}) }));
        onChange?.(!!res.complete);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [hosted]);

  if (user?.role !== 'admin' || !hosted || !nsReady) return null;

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setSaved(false); };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await pb.send('/api/kb/billing', { method: 'POST', body: form });
      setSaved(true);
      onChange?.(!!res.complete);
    } catch (err) {
      setError(err?.response?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const pole = [
    ['company', 'billingCompany', 'sm:col-span-2'],
    ['ico', 'billingIco', ''],
    ['dic', 'billingDic', ''],
    ['street', 'billingStreet', 'sm:col-span-2'],
    ['city', 'billingCity', ''],
    ['zip', 'billingZip', ''],
    ['email', 'billingEmail', 'sm:col-span-2'],
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-5 mt-6" data-testid="billing-section">
      <div className="flex items-center gap-2 mb-1">
        <FileText className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">{t('billing.heading')}</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{t('billing.hint')}</p>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {pole.map(([k, label, cls]) => (
              <div key={k} className={cls}>
                <Label htmlFor={`billing-${k}`}>{t(`billing.${label}`)}</Label>
                <Input id={`billing-${k}`} value={form[k] || ''} onChange={set(k)}
                  autoComplete="off" className="mt-1" />
              </div>
            ))}
          </div>
          {error && <p className="text-sm text-destructive mt-2">{error}</p>}
          <Button onClick={save} disabled={saving} className="mt-4">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
              : saved ? <Check className="h-4 w-4 mr-2" /> : null}
            {saved ? t('billing.savedButton') : t('billing.saveButton')}
          </Button>
        </>
      )}
    </div>
  );
}
