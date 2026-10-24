import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronLeft, Download, Loader2, Receipt, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { faktury as apiFaktury, faktura as apiFaktura, fakturaZaplaceno } from '@/api/asistentApi';

// Faktury v panelu Dokumentů (9. 10. 2026): seznam vystavených faktur (vlastní; správce všechny) a detail
// jedné — položky, součty, odběratel, platba, Stáhnout PDF (prohlížeč, lib/faktura líně), přepínač Zaplaceno.
// BEZ editace: faktura je neměnná, oprava = nová faktura. Aplikace není zákonný archiv dokladů — říká to i panel.
// dokId v kontextu = „faktura:<id>“ (DokumentyPanel podle předpony kreslí tenhle pohled místo dokumentu).

export const FAKTURA_PREFIX = 'faktura:';

function castka(n, mena, lang) {
  try { return new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'cs-CZ', { style: 'currency', currency: mena || 'CZK', minimumFractionDigits: 2 }).format(Number(n || 0)); }
  catch { return `${Number(n || 0).toFixed(2)} ${mena || 'CZK'}`; }
}
function datum(ymd, lang) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(ymd || '');
  return lang === 'en' ? `${m[3]}/${m[2]}/${m[1]}` : `${Number(m[3])}. ${Number(m[2])}. ${m[1]}`;
}

export function FakturySeznam({ verze, onOtevri }) {
  const { t, i18n } = useTranslation('asistent');
  const [rows, setRows] = useState(null);
  const [chyba, setChyba] = useState('');
  const [jenNezaplacene, setJenNezaplacene] = useState(false);
  useEffect(() => {
    let zivy = true;
    apiFaktury({ unpaid: jenNezaplacene })
      .then((r) => { if (zivy) { setRows(r.faktury || []); setChyba(''); } })
      .catch((e) => { if (zivy) { setRows((p) => p || []); setChyba(e.message || t('faktura.errorLoad')); } });
    return () => { zivy = false; };
  }, [verze, jenNezaplacene, t]);
  // filtr po měsících vystavení (účetnictví — Richard 24. 10. 2026); ZIP i součty jdou jen z vyfiltrovaných
  const [mesic, setMesic] = useState(''); // '' = všechny, jinak YYYY-MM
  const mesice = Array.from(new Set((rows || []).map((f) => String(f.issued || '').slice(0, 7)).filter(Boolean))).sort().reverse();
  const nazevMesice = (m) => { try { return new Intl.DateTimeFormat(i18n.language === 'en' ? 'en' : 'cs', { month: 'long', year: 'numeric' }).format(new Date(`${m}-01T12:00:00`)); } catch { return m; } };
  useEffect(() => { if (mesic && rows && !mesice.includes(mesic)) setMesic(''); }, [mesic, mesice, rows]); // po „jen nezaplacené“ může měsíc zmizet
  const videt = (rows || []).filter((f) => !mesic || String(f.issued || '').startsWith(mesic));
  const nezaplaceno = videt.filter((f) => !f.paid_on).reduce((s, f) => s + Number(f.total || 0), 0);
  // zobrazené faktury jako PDF v jednom ZIPu (lib/faktura/zip líně — pdf-lib + fflate mimo hlavní balík)
  const [zip, setZip] = useState(null); // null | { hotovo, celkem } | 'chyba'
  const stahniVse = async () => {
    if (!videt.length || (zip && zip !== 'chyba')) return;
    setZip({ hotovo: 0, celkem: videt.length });
    try { const { stahniFakturyZip } = await import('@/lib/faktura/zip'); await stahniFakturyZip(videt, { lang: i18n.language === 'en' ? 'en' : 'cs', nazev: mesic ? `faktury-${mesic}` : '', onProgress: (h, c) => setZip({ hotovo: h, celkem: c }) }); setZip(null); }
    catch (e) { setZip('chyba'); setChyba(t('faktura.error', { detail: (e && (e.message || e.status)) || '?' })); }
  };
  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-1" data-testid="chat-faktury-seznam">
      {rows && rows.length > 0 && (
        <div className="px-1 pb-1">
          <select value={mesic} onChange={(e) => setMesic(e.target.value)} className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs" aria-label={t('faktura.month')} data-testid="chat-faktury-mesic">
            <option value="">{t('faktura.monthAll')}</option>
            {mesice.map((m) => <option key={m} value={m}>{nazevMesice(m)}</option>)}
          </select>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-1 pb-1 text-[11px] text-muted-foreground">
        <span>{rows ? t('faktura.listTotal', { count: videt.length, unpaid: castka(nezaplaceno, 'CZK', i18n.language) }) : ''}</span>
        <span className="inline-flex items-center gap-2">
          {videt.length > 0 && (
            <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-60" onClick={stahniVse} disabled={!!zip && zip !== 'chyba'} data-testid="chat-faktury-zip">
              {zip && zip !== 'chyba' ? <><Loader2 className="w-3 h-3 animate-spin" />{t('faktura.zipping', { done: zip.hotovo, total: zip.celkem })}</> : <><Download className="w-3 h-3" />{t('faktura.downloadAll')}</>}
            </button>
          )}
          <button type="button" className="text-primary hover:underline" onClick={() => setJenNezaplacene((v) => !v)} data-testid="chat-faktury-filtr">{jenNezaplacene ? t('faktura.filterAll') : t('faktura.filterUnpaid')}</button>
        </span>
      </div>
      {rows === null && <Loader2 className="w-4 h-4 animate-spin m-3" />}
      {chyba && <p className="text-xs text-destructive px-2">{chyba}</p>}
      {rows && rows.length === 0 && !chyba && (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground" data-testid="chat-faktury-prazdno">
          <Receipt className="w-6 h-6 mx-auto mb-2 opacity-60" />
          <p>{t('faktura.empty')}</p>
        </div>
      )}
      {videt.map((f) => (
        <button key={f.id} type="button" onClick={() => onOtevri(FAKTURA_PREFIX + f.id)} className="w-full text-left rounded-lg border border-transparent px-2.5 py-2 hover:bg-secondary hover:border-border transition-colors" data-testid="chat-faktura-polozka" data-id={f.id} data-cislo={f.cislo} data-zaplaceno={f.paid_on ? '1' : '0'}>
          <div className="flex items-center gap-2 min-w-0">
            <Receipt className={`w-4 h-4 shrink-0 ${f.paid_on ? 'text-emerald-600' : 'text-primary'}`} />
            <span className="text-sm font-medium truncate flex-1">{f.cislo} · {f.customer_name}</span>
            <span className="text-sm shrink-0">{castka(f.total, f.currency, i18n.language)}</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 pl-6">{f.paid_on ? t('faktura.paid', { date: datum(f.paid_on, i18n.language) }) : `${t('faktura.unpaid')} · ${t('faktura.due', { date: datum(f.due, i18n.language) })}`}</p>
        </button>
      ))}
    </div>
  );
}

export function FakturaDetail({ id, onZpet }) {
  const { t, i18n } = useTranslation('asistent');
  const [f, setF] = useState(null);
  const [chyba, setChyba] = useState('');
  const [bezi, setBezi] = useState(false);
  const [hlaska, setHlaska] = useState('');
  const lang = i18n.language === 'en' ? 'en' : 'cs';
  useEffect(() => {
    let zivy = true;
    setF(null); setChyba(''); setHlaska('');
    apiFaktura(id).then((r) => { if (zivy) setF(r.faktura); }).catch((e) => { if (zivy) setChyba(e.status === 404 ? t('faktura.notFound') : (e.message || t('faktura.errorLoad'))); });
    return () => { zivy = false; };
  }, [id, t]);
  const stahni = async () => {
    setBezi(true); setHlaska('');
    try { const { stahniFakturu } = await import('@/lib/faktura/stahni'); await stahniFakturu(id, { lang, dto: f }); }
    catch (e) { setHlaska(t('faktura.error', { detail: (e && (e.message || e.status)) || '?' })); }
    finally { setBezi(false); }
  };
  const prepni = async () => {
    setBezi(true); setHlaska('');
    try { const r = await fakturaZaplaceno(id, !f.paid_on); setF(r.faktura); }
    catch (e) { setHlaska(e.message || t('faktura.errorSave')); }
    finally { setBezi(false); }
  };
  if (chyba) return (
    <div className="p-4 text-sm space-y-3">
      <p className="text-destructive">{chyba}</p>
      <Button size="sm" variant="outline" onClick={onZpet}><ChevronLeft className="w-4 h-4 mr-1" />{t('dok.back')}</Button>
    </div>
  );
  if (!f) return <Loader2 className="w-4 h-4 animate-spin m-4" />;
  const s = f.supplier || {}; const c = f.customer || {};
  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="chat-faktura-detail" data-id={f.id} data-cislo={f.cislo}>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
        <div>
          <h2 className="text-base font-semibold inline-flex items-center gap-1.5" data-testid="chat-faktura-titulek"><Receipt className="w-4 h-4 text-primary" />{t('faktura.card', { cislo: f.cislo })}</h2>
          <p className="text-xs text-muted-foreground">{t('faktura.issued', { date: datum(f.issued, lang) })} · {t('faktura.due', { date: datum(f.due, lang) })}</p>
          <p className={`text-xs font-medium ${f.paid_on ? 'text-emerald-600' : 'text-amber-600'}`} data-testid="chat-faktura-stav">{f.paid_on ? t('faktura.paid', { date: datum(f.paid_on, lang) }) : t('faktura.unpaid')}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div><p className="text-muted-foreground font-semibold uppercase text-[10px]">{t('faktura.supplier')}</p><p className="font-medium">{s.name}</p><p className="whitespace-pre-line">{s.address}</p>{s.ico && <p>IČO {s.ico}</p>}{s.dic && <p>DIČ {s.dic}</p>}</div>
          <div><p className="text-muted-foreground font-semibold uppercase text-[10px]">{t('faktura.customer')}</p><p className="font-medium" data-testid="chat-faktura-odberatel">{c.name}</p><p className="whitespace-pre-line">{c.address}</p>{c.ico && <p>IČO {c.ico}</p>}{c.dic && <p>DIČ {c.dic}</p>}</div>
        </div>
        <div>
          <p className="text-muted-foreground font-semibold uppercase text-[10px]">{t('faktura.items')}</p>
          <table className="w-full text-xs mt-1" data-testid="chat-faktura-polozky">
            <tbody>
              {(f.items || []).map((it, i) => (
                <tr key={i} className="border-b border-border/60">
                  <td className="py-1 pr-2 break-words">{it.description}</td>
                  <td className="py-1 pr-2 text-right whitespace-nowrap text-muted-foreground">{it.quantity}{it.unit ? ` ${it.unit}` : ''} × {castka(it.unit_price, f.currency, lang)}</td>
                  <td className="py-1 text-right whitespace-nowrap">{castka(it.total != null ? it.total : it.quantity * it.unit_price, f.currency, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-xs space-y-0.5">
            {f.vat_payer ? (
              <>
                <p className="flex justify-between"><span className="text-muted-foreground">{t('faktura.net')}</span><span>{castka(f.subtotal, f.currency, lang)}</span></p>
                <p className="flex justify-between"><span className="text-muted-foreground">{t('faktura.vat', { rate: f.vat_rate })}</span><span>{castka(f.vat, f.currency, lang)}</span></p>
              </>
            ) : <p className="text-muted-foreground">{t('faktura.nonVat')}</p>}
            <p className="flex justify-between font-semibold text-sm"><span>{t('faktura.total')}</span><span data-testid="chat-faktura-celkem">{castka(f.total, f.currency, lang)}</span></p>
          </div>
        </div>
        {f.note && <div><p className="text-muted-foreground font-semibold uppercase text-[10px]">{t('faktura.note')}</p><p className="text-xs whitespace-pre-line">{f.note}</p></div>}
        <div className="rounded-md bg-secondary/60 px-2.5 py-1.5 text-xs">
          {s.iban || s.bank_account ? (
            <>
              {s.bank_account && <p>{t('faktura.account')}: <span className="font-medium">{s.bank_account}</span></p>}
              {s.iban && <p>IBAN: {s.iban}</p>}
              <p>{t('faktura.vs')}: <span className="font-medium">{f.vs}</span></p>
              {f.spayd && <p className="text-muted-foreground">{t('faktura.qr')} — {t('faktura.qrHint')}</p>}
            </>
          ) : <p className="text-muted-foreground">{t('faktura.noAccount')}</p>}
        </div>
        <p className="text-[11px] text-muted-foreground" data-testid="chat-faktura-archiv">{t('faktura.archiveHint')}</p>
      </div>
      <div className="border-t px-3 py-2 space-y-1.5 shrink-0">
        {hlaska && <p className="text-xs text-destructive" data-testid="chat-faktura-hlaska">{hlaska}</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" className="h-8" disabled={bezi} onClick={stahni} data-testid="chat-faktura-stahnout">{bezi ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Download className="w-3.5 h-3.5 mr-1" />}{t('faktura.download')}</Button>
          <Button size="sm" variant="outline" className="h-8" disabled={bezi} onClick={prepni} data-testid="chat-faktura-zaplaceno">{f.paid_on ? <Undo2 className="w-3.5 h-3.5 mr-1" /> : <Check className="w-3.5 h-3.5 mr-1" />}{f.paid_on ? t('faktura.markUnpaid') : t('faktura.markPaid')}</Button>
        </div>
      </div>
    </div>
  );
}
