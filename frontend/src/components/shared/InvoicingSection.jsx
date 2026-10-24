import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Receipt, Loader2, Check, ChevronDown, ChevronRight, PanelLeftOpen } from 'lucide-react';
import { useLazyNs } from '@/i18n/lazyNs';
import { invoicingProfile, invoicingProfileUloz, invoicingProfileMe, invoicingProfileMeUloz } from '@/api/asistentApi';

// Údaje DODAVATELE na faktury, které asistent vystavuje klientům (9. 10. 2026). Dva režimy (24. 10. 2026):
//  • rezim="org" (výchozí): SPOLEČNÉ údaje organizace, jen správce, Správa organizace; GET/POST /invoicing-profile
//  • rezim="me": VLASTNÍ údaje přihlášeného (Můj účet, kdokoli) — mají přednost před společnými a dávají mu vlastní
//    číselnou řadu; GET/POST /invoicing-profile/me, { smazat: true } = zpět na společné.
// Whitelist + validace ve faktury.js — tatáž, kterou používá asistent. NEPLÉST s BillingSection
// (= fakturační údaje odběratele killBottlenecku, jen hostované instance). Tahle sekce je i na self-hostu.
// `vychoziOtevreno`: sekci rovnou rozbalit a nascrollovat (odkaz z karty asistenta „Otevřít údaje dodavatele“)
// `onOtevritFaktury`: proklik „Vystavené faktury v Dokumentech“ (Můj účet i Správa organizace — Richard 24. 10. 2026)
export default function InvoicingSection({ rezim = 'org', vychoziOtevreno = false, onOtevritFaktury = null }) {
  const nsReady = useLazyNs('billing');
  const { t } = useTranslation('billing');
  const { user } = useAuth();
  const me = rezim === 'me';
  const PRAZDNY = { name: '', address: '', ico: '', dic: '', vat_payer: false, vat_rate: 21, bank_account: '', iban: '', email: '', prefix: '', due_days: 14 };
  const [form, setForm] = useState(PRAZDNY);
  const [stav, setStav] = useState({ complete: false, missing: [] });
  const [vlastni, setVlastni] = useState(false); // režim me: má uživatel vlastní profil?
  const [spolecny, setSpolecny] = useState({ complete: false, name: '' }); // režim me: stav společného
  const [open, setOpen] = useState(!!vychoziOtevreno);
  const [loading, setLoading] = useState(true);
  const ref = useRef(null);
  useEffect(() => { if (vychoziOtevreno) { setOpen(true); setTimeout(() => ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50); } }, [vychoziOtevreno]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // účet zadaný jako IBAN server ukládá do `iban` a `bank_account` nechá prázdný — formulář musí do pole účtu dát IBAN,
  // jinak by další uložení (třeba jen e-mailu) poslalo prázdný účet a server IBAN smazal (/checkup 24. 10. 2026)
  const sForm = (profil) => { const p = { ...PRAZDNY, ...(profil || {}) }; if (!p.bank_account && p.iban) p.bank_account = p.iban; return p; };
  const prevezmi = (r) => {
    if (me) {
      setVlastni(r.active === 'vlastni');
      setSpolecny(r.shared || { complete: false, name: '' });
      const d = r.own || { profil: {}, complete: false, missing: [] };
      setForm(sForm(d.profil));
      setStav({ complete: !!d.complete, missing: d.missing || [] });
    } else {
      setForm((f) => ({ ...f, ...sForm(r.profil) }));
      setStav({ complete: !!r.complete, missing: r.missing || [] });
    }
  };
  useEffect(() => {
    if (!me && user?.role !== 'admin') return;
    (me ? invoicingProfileMe() : invoicingProfile())
      .then(prevezmi)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.role, me]);

  if ((!me && user?.role !== 'admin') || !nsReady) return null;

  const set = (k) => (e) => { const v = e && e.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e; setForm((f) => ({ ...f, [k]: v })); setSaved(false); };
  const save = async () => {
    setSaving(true); setError('');
    try {
      const telo = { ...form };
      delete telo.iban; // IBAN dopočítá server z účtu (nebo přijme IBAN v poli účtu)
      prevezmi(await (me ? invoicingProfileMeUloz(telo) : invoicingProfileUloz(telo)));
      setSaved(true);
    } catch (err) {
      setError(err?.response?.error || err?.message || '');
    } finally { setSaving(false); }
  };
  const smazVlastni = async () => {
    setSaving(true); setError('');
    try { prevezmi(await invoicingProfileMeUloz({ smazat: true })); setSaved(false); }
    catch (err) { setError(err?.response?.error || err?.message || ''); }
    finally { setSaving(false); }
  };
  const stitek = me
    ? (vlastni ? `${t('invoicing.me.own')} · ${form.name}` : (spolecny.complete ? t('invoicing.me.usingShared', { name: spolecny.name }) : t('invoicing.me.none')))
    : (stav.complete ? `${t('invoicing.complete')} · ${form.name}` : t('invoicing.incomplete'));
  const zeleny = me ? (vlastni ? stav.complete : spolecny.complete) : stav.complete;
  const T = me ? 'invoicing-me' : 'invoicing';

  return (
    <div ref={ref} className={me ? 'border-t pt-3' : 'rounded-xl border border-border bg-card p-5 mt-6'} data-testid={`${T}-section`}>
      <button type="button" className="w-full flex items-center gap-2 text-left" onClick={() => setOpen((v) => !v)} data-testid={`${T}-toggle`} aria-expanded={open}>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <Receipt className="h-4 w-4 text-primary" />
        <h2 className={me ? 'text-sm font-medium flex-1 min-w-0' : 'font-semibold flex-1 min-w-0'}>{me ? t('invoicing.me.heading') : t('invoicing.heading')}</h2>
        {!loading && <span className={`text-xs rounded-full px-2 py-0.5 shrink-0 max-w-[55%] truncate ${zeleny ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'}`} data-testid={`${T}-stav`} data-complete={stav.complete ? '1' : '0'} data-vlastni={vlastni ? '1' : '0'}>{stitek}</span>}
      </button>
      {open && (
        <div className="mt-3">
          <p className="text-sm text-muted-foreground mb-4">{me ? t('invoicing.me.hint') : t('invoicing.hint')}</p>
          {onOtevritFaktury && (
            <button type="button" onClick={onOtevritFaktury} className="inline-flex items-center gap-1 text-sm text-primary hover:underline mb-4" data-testid={`${T}-faktury`}>
              <PanelLeftOpen className="h-4 w-4" />{t('invoicing.me.openInvoices')}
            </button>
          )}
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2"><Label htmlFor="inv-name">{t('invoicing.name')}</Label><Input id="inv-name" value={form.name || ''} onChange={set('name')} autoComplete="off" className="mt-1" maxLength={200} data-testid="invoicing-name" /></div>
                <div className="sm:col-span-2"><Label htmlFor="inv-address">{t('invoicing.address')}</Label><Textarea id="inv-address" rows={2} value={form.address || ''} onChange={set('address')} className="mt-1" maxLength={300} data-testid="invoicing-address" /></div>
                <div><Label htmlFor="inv-ico">{t('invoicing.ico')}</Label><Input id="inv-ico" value={form.ico || ''} onChange={set('ico')} className="mt-1" maxLength={20} data-testid="invoicing-ico" /></div>
                <div><Label htmlFor="inv-dic">{t('invoicing.dic')}</Label><Input id="inv-dic" value={form.dic || ''} onChange={set('dic')} className="mt-1" maxLength={20} data-testid="invoicing-dic" /></div>
                <div className="flex items-center gap-2 pt-5"><input id="inv-vat" type="checkbox" checked={!!form.vat_payer} onChange={set('vat_payer')} data-testid="invoicing-vat-payer" /><Label htmlFor="inv-vat">{t('invoicing.vatPayer')}</Label></div>
                <div><Label htmlFor="inv-vat-rate">{t('invoicing.vatRate')}</Label><Input id="inv-vat-rate" type="number" min={0} max={100} value={form.vat_rate ?? 21} onChange={set('vat_rate')} disabled={!form.vat_payer} className="mt-1" data-testid="invoicing-vat-rate" /></div>
                <div className="sm:col-span-2">
                  <Label htmlFor="inv-account">{t('invoicing.bankAccount')}</Label>
                  <Input id="inv-account" value={form.bank_account || form.iban || ''} onChange={set('bank_account')} autoComplete="off" className="mt-1" maxLength={40} data-testid="invoicing-account" />
                  <p className="text-xs text-muted-foreground mt-1">{t('invoicing.bankAccountHint')}{form.iban ? ` ${t('invoicing.iban', { iban: form.iban })}` : ''}</p>
                </div>
                <div className="sm:col-span-2"><Label htmlFor="inv-email">{t('invoicing.email')}</Label><Input id="inv-email" type="email" value={form.email || ''} onChange={set('email')} className="mt-1" maxLength={120} data-testid="invoicing-email" /></div>
                <div><Label htmlFor="inv-prefix">{t('invoicing.prefix')}</Label><Input id="inv-prefix" value={form.prefix || ''} onChange={set('prefix')} className="mt-1" maxLength={6} data-testid="invoicing-prefix" /><p className="text-xs text-muted-foreground mt-1">{t('invoicing.prefixHint')}</p></div>
                <div><Label htmlFor="inv-due">{t('invoicing.dueDays')}</Label><Input id="inv-due" type="number" min={0} max={365} value={form.due_days ?? 14} onChange={set('due_days')} className="mt-1" data-testid="invoicing-due" /></div>
              </div>
              {error && <p className="text-sm text-destructive mt-2" data-testid={`${T}-error`}>{error}</p>}
              <div className="flex flex-wrap gap-2 mt-4">
                <Button onClick={save} disabled={saving} data-testid={`${T}-save`}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : saved ? <Check className="h-4 w-4 mr-2" /> : null}
                  {saved ? t('invoicing.savedButton') : (me ? t('invoicing.me.saveButton') : t('invoicing.saveButton'))}
                </Button>
                {me && vlastni && (
                  <Button variant="outline" onClick={smazVlastni} disabled={saving} data-testid="invoicing-me-smazat">{t('invoicing.me.removeButton')}</Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-3">{me ? t('invoicing.me.archive') : t('invoicing.archive')}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
