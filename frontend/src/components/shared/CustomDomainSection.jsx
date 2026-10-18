import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pb } from '@/api/pb';
import { useKbConfig } from '@/hooks/useKbConfig';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Globe, Loader2, Check, Copy, AlertTriangle, X } from 'lucide-react';
import { useLazyNs } from '@/i18n/lazyNs';

// Vlastní doména (jen správce, jen vlastní server KB Cloud Pro / AI Agent — tam, kde
// provisioning připravil cíl CNAME, config.custom_domain_enabled). Jako u Base44:
// zadáš doménu → zkopíruješ dva DNS záznamy → „Zkontrolovat". Když DNS sedí, žádost
// odejde provozovateli a server se přepne sám (pár minut: certifikát, adresa instance).
// Instance nic nepřepíná sama — jen ukazuje záznamy a stav (vlastniDomena.js).
const AKTIVNI_STAVY = ['queued', 'working'];

export default function CustomDomainSection() {
  const nsReady = useLazyNs('admin');
  const { t } = useTranslation('admin');
  const { user } = useAuth();
  const { config } = useKbConfig(!!user);
  const [stav, setStav] = useState(null);
  const [vstup, setVstup] = useState('');
  const [navrh, setNavrh] = useState(null);   // {domain, apex, records} před odesláním
  const [checks, setChecks] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [zkopirovano, setZkopirovano] = useState('');

  const povoleno = user?.role === 'admin' && !!config?.custom_domain_enabled;

  const nacti = useCallback(async () => {
    try {
      setStav(await pb.send('/api/kb/custom-domain', { method: 'GET' }));
    } catch (err) {
      setError(chyba(err));
    }
  }, []);

  useEffect(() => { if (povoleno) nacti(); }, [povoleno, nacti]);

  // během přepínání se stav obnovuje sám (centrála běží každou minutu)
  const zadost = stav?.request;
  const probiha = !!zadost && AKTIVNI_STAVY.includes(zadost.status);
  useEffect(() => {
    if (!probiha) return undefined;
    const id = setInterval(nacti, 15000);
    return () => clearInterval(id);
  }, [probiha, nacti]);

  if (!povoleno || !nsReady || !stav?.available) return null;

  function chyba(err) {
    const kod = err?.response?.error_code || err?.data?.error_code;
    return kod ? t(`customDomain.err.${kod}`, { defaultValue: t('customDomain.err.generic') }) : (err?.message || t('customDomain.err.generic'));
  }

  const pripravit = async () => {
    setBusy(true); setError(''); setChecks(null);
    try {
      setNavrh(await pb.send('/api/kb/custom-domain/records', { method: 'POST', body: { domain: vstup } }));
    } catch (err) { setError(chyba(err)); } finally { setBusy(false); }
  };

  const zkontrolovat = async (domena) => {
    setBusy(true); setError('');
    try {
      const r = await pb.send('/api/kb/custom-domain/check', { method: 'POST', body: { domain: domena } });
      setChecks(r.checks || null);
      if (r.requested) { setNavrh(null); await nacti(); }
    } catch (err) { setError(chyba(err)); } finally { setBusy(false); }
  };

  const odpojit = async () => {
    setBusy(true); setError('');
    try {
      await pb.send('/api/kb/custom-domain/remove', { method: 'POST', body: {} });
      setNavrh(null); setChecks(null); await nacti();
    } catch (err) { setError(chyba(err)); } finally { setBusy(false); }
  };

  const kopiruj = (text) => {
    try { navigator.clipboard.writeText(text); setZkopirovano(text); setTimeout(() => setZkopirovano(''), 1500); } catch { /* bez schránky jen ručně */ }
  };

  // co ukázat: rozpracovaný návrh > rozpracovaná/selhaná žádost > aktivní doména
  const domena = navrh?.domain || stav.domain || '';
  const zaznamy = navrh?.records || stav.records || [];
  const apex = navrh ? navrh.apex : stav.apex;
  const aktivni = stav.active;
  const ukazZaznamy = !!domena && (navrh || (zadost && zadost.status !== 'removed' && !(zadost.status === 'active' && aktivni === domena)));

  return (
    <div className="rounded-xl border border-border bg-card p-5 mt-6" data-testid="custom-domain-section">
      <div className="flex items-center gap-2 mb-1">
        <Globe className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">{t('customDomain.heading')}</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        {t('customDomain.hint', { slug: stav.slug_domain })}
      </p>

      {aktivni && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm mb-4 flex flex-wrap items-center gap-3" data-testid="custom-domain-active">
          <Check className="h-4 w-4" />
          <span>{t('customDomain.active', { domain: aktivni })}</span>
          <Button variant="outline" size="sm" onClick={odpojit} disabled={busy || probiha} data-testid="custom-domain-remove">
            <X className="h-3.5 w-3.5 mr-1" />{t('customDomain.remove')}
          </Button>
        </div>
      )}

      {probiha && (
        <div className="rounded-lg border border-border p-3 text-sm mb-4 flex items-center gap-2" data-testid="custom-domain-progress">
          <Loader2 className="h-4 w-4 animate-spin" />
          {zadost.action === 'remove'
            ? t('customDomain.removing')
            : t('customDomain.switching', { domain: zadost.domain })}
        </div>
      )}

      {zadost?.status === 'failed' && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm mb-4 flex items-start gap-2" data-testid="custom-domain-failed">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{t('customDomain.failed', { domain: zadost.domain, reason: zadost.error || '—' })}</span>
        </div>
      )}

      {!probiha && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Input value={vstup} onChange={(e) => setVstup(e.target.value)} placeholder="ukoly.firma.cz"
            className="max-w-xs" autoComplete="off" spellCheck={false} data-testid="custom-domain-input"
            onKeyDown={(e) => { if (e.key === 'Enter' && vstup.trim()) pripravit(); }} />
          <Button variant="outline" onClick={pripravit} disabled={busy || !vstup.trim()} data-testid="custom-domain-prepare">
            {aktivni ? t('customDomain.change') : t('customDomain.prepare')}
          </Button>
        </div>
      )}

      {ukazZaznamy && (
        <div className="mb-4" data-testid="custom-domain-records">
          <p className="text-sm mb-2">{t('customDomain.recordsIntro', { domain: domena })}</p>
          <div className="overflow-x-auto">
            <table className="text-sm w-full border-collapse">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-4 font-normal">{t('customDomain.col.name')}</th>
                  <th className="py-1 pr-4 font-normal">{t('customDomain.col.type')}</th>
                  <th className="py-1 pr-4 font-normal">{t('customDomain.col.value')}</th>
                  <th className="py-1 font-normal">{t('customDomain.col.state')}</th>
                </tr>
              </thead>
              <tbody>
                {zaznamy.map((z) => {
                  const c = (checks || []).find((x) => x.name === z.name);
                  return (
                    <tr key={z.name} className="border-t border-border">
                      <td className="py-1.5 pr-4 font-mono break-all">{z.name}</td>
                      <td className="py-1.5 pr-4 font-mono">{z.type}</td>
                      <td className="py-1.5 pr-4 font-mono break-all">
                        {z.value}
                        <button type="button" className="ml-2 inline-flex text-muted-foreground hover:text-foreground align-middle"
                          onClick={() => kopiruj(z.value)} aria-label={t('customDomain.copy')}>
                          {zkopirovano === z.value ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                      <td className="py-1.5" data-testid={`custom-domain-check-${z.name}`}>
                        {!c ? '—' : c.ok
                          ? <span className="text-green-700 dark:text-green-400">{t('customDomain.ok')}</span>
                          : <span className="text-destructive">{t(`customDomain.check.${c.error}`, { found: (c.found || []).join(', ') || '—' })}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="text-xs text-muted-foreground mt-2 space-y-1 list-disc pl-4">
            <li>{t('customDomain.tipCloudflare')}</li>
            {apex && <li className="text-amber-600 dark:text-amber-400">{t('customDomain.tipApex')}</li>}
            <li>{t('customDomain.tipWait')}</li>
            <li>{t('customDomain.tipLogin')}</li>
          </ul>
          {!probiha && (
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <Button onClick={() => zkontrolovat(domena)} disabled={busy} data-testid="custom-domain-check">
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {t('customDomain.check.button')}
              </Button>
            </div>
          )}
        </div>
      )}

      {!stav.gateway_ok && <p className="text-xs text-muted-foreground">{t('customDomain.gatewayDown')}</p>}
      {error && <p className="text-sm text-destructive mt-2">{error}</p>}
    </div>
  );
}
