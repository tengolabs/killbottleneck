import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pb } from '@/api/pb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fmtDate, intlLocale } from '@/lib/locale';
import { Coins, Loader2, Check } from 'lucide-react';

// AI kredity organizace (Správa organizace, jen admin; Richard 14. 9. 2026):
// spotřeba chatu asistenta v kreditech tento týden — celek, skupiny správci ×
// ostatní s kvótou, po lidech, předchozí týdny — a nastavení týdenní kvóty
// + podílu správců. Server: GET /api/kb/ai-kredity, POST /api/kb/ai-kredity/nastaveni
// (kredity.js). Texty v líném balíku `admin` (mimo lite rozpočet).
const fmtN = (x, d = 2) => Number(x || 0).toLocaleString(intlLocale(), { maximumFractionDigits: d });

// `celkem` = kvóta organizace: skupina s podílem 0 % má kvota 0 a server ji BLOKUJE — nesmí
// vypadat jako „bez stropu“ (checkup 15. 9. 2026)
function Skupina({ t, nazev, s, celkem, testid }) {
  const maStrop = celkem > 0;
  const podil = !maStrop ? 0 : s.kvota > 0 ? Math.min(100, Math.round((s.kredity / s.kvota) * 100)) : 100;
  const barva = podil >= 100 ? 'bg-destructive' : podil >= 80 ? 'bg-amber-500' : 'bg-primary';
  return (
    <div className="rounded-lg border bg-background p-3" data-testid={testid}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{nazev} <span className="text-xs text-muted-foreground font-normal">({t('groupPeople', { n: s.lidi })})</span></span>
        <span className="text-xs text-muted-foreground" data-testid={`${testid}-n`}>{maStrop ? t('used', { pouzito: fmtN(s.kredity), kvota: fmtN(s.kvota) }) : t('usedNoLimit', { pouzito: fmtN(s.kredity) })}</span>
      </div>
      {maStrop && (
        <div className="h-2 rounded-full bg-secondary mt-2 overflow-hidden"><div className={`h-full ${barva}`} style={{ width: `${podil}%` }} /></div>
      )}
    </div>
  );
}

export default function AiKredityKarta() {
  const { t } = useTranslation('admin', { keyPrefix: 'aiKredity' });
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [kvota, setKvota] = useState('');
  const [podil, setPodil] = useState('30');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const savedTimer = useRef(null);

  useEffect(() => {
    let zivy = true;
    pb.send('/api/kb/ai-kredity', { method: 'GET' })
      .then((d) => {
        if (!zivy) return;
        setData(d); setFailed(false);
        setKvota(String(d.vlastni || 0));   // vlastní hodnota správce (0 = bez vlastního stropu), ne efektivní kvóta
        setPodil(String(d.podil_admin));
      })
      .catch(() => { if (zivy) setFailed(true); });
    return () => { zivy = false; clearTimeout(savedTimer.current); };
  }, []);

  const uloz = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      const d = await pb.send('/api/kb/ai-kredity/nastaveni', { method: 'POST', body: { kvota_tyden: Number(kvota), podil_admin: Number(podil) } });
      setData(d); setSaved(true);
      clearTimeout(savedTimer.current); savedTimer.current = setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e?.response?.error || e?.message || 'error');
    } finally { setSaving(false); }
  };

  // efektivní kvóta = vlastní hodnota omezená stropem provozovatele (env); bez obojího = bez stropu
  const strop = Number(data?.strop_env) || 0;
  const kvVlastni = Number(kvota) || 0, pd = Math.min(100, Math.max(0, Number(podil) || 0));
  const kv = strop > 0 ? (kvVlastni > 0 ? Math.min(kvVlastni, strop) : strop) : kvVlastni;
  const roleText = (r) => (r === 'admin' ? t('roleAdmin') : r === 'manager' ? t('roleManager') : t('roleUser'));

  return (
    <div className="rounded-xl border bg-card p-4 mb-6" data-testid="ai-kredity">
      <h2 className="font-heading text-sm font-semibold flex items-center gap-2 mb-1">
        <Coins className="w-4 h-4 text-primary" /> {t('heading')}
      </h2>
      <p className="text-xs text-muted-foreground mb-3">{t('description', { kc: fmtN(data?.kredit_kc ?? 0.08, 2) })}</p>

      {failed && <p className="text-sm text-destructive" data-testid="ai-kredity-chyba">{t('loadError')}</p>}
      {!data && !failed && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}

      {data && (
        <>
          <div className="text-xs text-muted-foreground mb-2">{t('thisWeek', { od: fmtDate(data.tyden_od) })}</div>
          <div className="grid grid-cols-3 gap-2 mb-3" data-testid="ai-kredity-celkem">
            <div className="rounded-lg border bg-background p-2.5 flex flex-col"><span className="text-3xl font-heading font-bold leading-tight" data-testid="ai-kredity-celkem-n">{fmtN(data.celkem.kredity)}</span><span className="text-xs text-muted-foreground">{t('credits')}</span></div>
            <div className="rounded-lg border bg-background p-2.5 flex flex-col"><span className="text-3xl font-heading font-bold leading-tight">{fmtN(data.celkem.n, 0)}</span><span className="text-xs text-muted-foreground">{t('chats')}</span></div>
            <div className="rounded-lg border bg-background p-2.5 flex flex-col"><span className="text-3xl font-heading font-bold leading-tight">{fmtN(data.celkem.tokens_in + data.celkem.tokens_out, 0)}</span><span className="text-xs text-muted-foreground">{t('tokens')}</span></div>
          </div>
          <div className="grid sm:grid-cols-2 gap-2 mb-4">
            <Skupina t={t} nazev={t('groupAdmin')} s={data.admin} celkem={data.kvota} testid="ai-kredity-admin" />
            <Skupina t={t} nazev={t('groupOthers')} s={data.ostatni} celkem={data.kvota} testid="ai-kredity-ostatni" />
          </div>

          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm" data-testid="ai-kredity-lide">
              <thead><tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-1.5 pr-2 font-medium">{t('person')}</th><th className="py-1.5 pr-2 font-medium">{t('role')}</th>
                <th className="py-1.5 pr-2 font-medium text-right">{t('credits')}</th><th className="py-1.5 pr-2 font-medium text-right">{t('chats')}</th>
                <th className="py-1.5 pr-2 font-medium text-right">{t('tokens')}</th><th className="py-1.5 font-medium">{t('lastUse')}</th>
              </tr></thead>
              <tbody className="divide-y">
                {data.lide.map((u) => (
                  <tr key={u.id} data-testid="ai-kredity-clovek" data-email={u.email}>
                    <td className="py-1.5 pr-2"><span className="font-medium">{u.name || u.email}</span>{u.name && <span className="block text-xs text-muted-foreground">{u.email}</span>}</td>
                    <td className="py-1.5 pr-2 text-xs text-muted-foreground">{roleText(u.role)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums" data-testid="ai-kredity-clovek-kredity">{fmtN(u.kredity)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmtN(u.n, 0)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmtN(u.tokens_in + u.tokens_out, 0)}</td>
                    <td className="py-1.5 text-xs text-muted-foreground">{u.posledni ? fmtDate(u.posledni) : t('never')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.tydny && data.tydny.length > 1 && (
            <div className="mb-4">
              <div className="text-xs font-medium mb-1">{t('history')}</div>
              <ul className="text-xs text-muted-foreground space-y-0.5" data-testid="ai-kredity-tydny">
                {data.tydny.slice(1).map((w) => (
                  <li key={w.od} className="flex justify-between gap-2"><span>{t('week', { od: fmtDate(w.od) })}</span><span className="tabular-nums">{fmtN(w.kredity)} {t('credits')} · {fmtN(w.n, 0)} {t('chats')}</span></li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-lg border bg-background p-3">
            <div className="text-sm font-medium mb-0.5">{t('settingsHeading')}</div>
            <p className="text-xs text-muted-foreground mb-2">{t('settingsHint')}</p>
            {strop > 0 && <p className="text-xs text-amber-700 dark:text-amber-300 mb-2" data-testid="ai-kredity-env">{t('envNotice', { kvota: fmtN(strop, 0) })}</p>}
            <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <div><Label htmlFor="ai-kvota" className="text-xs">{t('quota')}</Label><Input id="ai-kvota" type="number" min="0" max="1000000" step="1" value={kvota} onChange={(e) => setKvota(e.target.value)} className="h-9" data-testid="ai-kredity-kvota" /></div>
              <div><Label htmlFor="ai-podil" className="text-xs">{t('adminShare')}</Label><Input id="ai-podil" type="number" min="0" max="100" step="1" value={podil} onChange={(e) => setPodil(e.target.value)} className="h-9" data-testid="ai-kredity-podil" /></div>
              <Button onClick={uloz} disabled={saving} className="h-9" data-testid="ai-kredity-ulozit">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
                {saved ? t('saved') : t('save')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5" data-testid="ai-kredity-rozdeleni">
              {kv > 0 ? t('split', { admin: fmtN(kv * pd / 100), ostatni: fmtN(kv - kv * pd / 100) }) : t('noLimit')}
            </p>
            {error && <p className="text-xs text-destructive mt-1" data-testid="ai-kredity-chyba-ulozeni">{error}</p>}
          </div>
        </>
      )}
    </div>
  );
}
