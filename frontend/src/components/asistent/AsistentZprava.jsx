import { Fragment, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Check, CheckCheck, ClipboardList, Copy, Download, ExternalLink, FileText, Loader2, Mail, Mic, NotebookPen, PanelLeftOpen, Pencil, Phone, ScrollText, Undo2, Upload, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saveBlob, safeFilename } from '@/lib/saveFile';
import { copyToClipboard } from '@/lib/clipboard';
import { PAMET } from '@/lib/AsistentContext';
import { ZNACKA_PREPISU, ZNACKA_PDF, ZNACKA_HLASU } from '@/lib/prepisZpravy';

// Jedna zpráva chatu + její karty (otázky s volbami, akce k potvrzení, skin,
// paměť, nápad, „nahlédl do"). Zprávy nástrojů (role tool) se nekreslí —
// jsou pro model; uživatel vidí místo nich kartu „nahlédl do".

// Otázky s předpřipravenými odpověďmi (nástroj ask_user): čipy + vlastní text,
// odešle se jedna zpráva „1) … 2) …" — server ji modelu podá jako výsledek
// nástroje. Aktivní jen u POSLEDNÍ zprávy (starší už odpovězené jsou jen text).
function KartaOtazky({ karta, aktivni, onSend, loading }) {
  const { t } = useTranslation('asistent');
  const [odpovedi, setOdpovedi] = useState(() => karta.questions.map(() => ''));
  const nastav = (i, v) => setOdpovedi((o) => o.map((x, j) => (j === i ? v : x)));
  const hotovo = odpovedi.some((o) => o.trim());
  const odeslat = () => {
    const radky = karta.questions.map((q, i) => `${i + 1}) ${odpovedi[i].trim() || '—'}`);
    onSend(radky.join('\n'));
  };
  // Enter v poli vlastní odpovědi = odeslat (Richard 1. 10. 2026). U víc otázek nejdřív skočí na další
  // nezodpovězenou — nedopsaný formulář neodejde omylem; tlačítkem jde odeslat kdykoli.
  const pole = useRef([]);
  const enter = (i) => {
    if (loading) return;
    const dalsi = karta.questions.findIndex((q, j) => j !== i && !odpovedi[j].trim());
    if (odpovedi[i].trim() && dalsi >= 0) { if (pole.current[dalsi]) pole.current[dalsi].focus(); return; }
    if (hotovo) odeslat();
  };
  return (
    // výrazně oddělený blok (Richard 13. 9.: „oblast otázek by mohla být oddělená ještě víc")
    // číslované mini-sekce s vlastním rámečkem: nezvyklý uživatel má poznat, že
    // ho AI o něco žádá a kde jedna otázka končí (Richard 13. 9., z telefonu)
    <div className="mt-3 space-y-2 rounded-lg border border-primary/40 border-l-4 border-l-primary bg-primary/5 p-2.5 shadow-sm" data-testid="chat-otazky">
      <p className="text-xs font-semibold text-primary">{t('questionsIntro', { count: karta.questions.length })}</p>
      {karta.questions.map((q, i) => (
        <div key={i} className="space-y-1.5 rounded-md border border-border bg-card/70 p-2" data-testid="chat-otazka">
          <p className="text-sm font-medium leading-snug flex gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[11px] font-bold inline-flex items-center justify-center">{i + 1}</span>
            <span>{q.text}</span>
          </p>
          {aktivni && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    data-testid="chat-otazka-volba"
                    onClick={() => nastav(i, o)}
                    className={`text-xs rounded-full border px-2.5 py-1 text-left transition-colors ${odpovedi[i] === o ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary hover:bg-accent border-border'}`}
                  >
                    {o}
                  </button>
                ))}
              </div>
              <Input
                value={q.options.includes(odpovedi[i]) ? '' : odpovedi[i]}
                onChange={(e) => nastav(i, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enter(i); } }}
                ref={(el) => { pole.current[i] = el; }}
                placeholder={t('questionsAnswer')}
                className="h-8 text-xs"
                data-testid="chat-otazka-text"
              />
            </>
          )}
        </div>
      ))}
      {aktivni && (
        <Button size="sm" className="w-full" disabled={!hotovo || loading} onClick={odeslat} data-testid="chat-otazky-odeslat">
          {t('questionsSend')}
        </Button>
      )}
    </div>
  );
}

// Pozadí karty drží tokeny skinu (bg-background), stav nese jen barva hrany —
// pevné světlé barvy (emerald-50) na tmavém skinu Půlnoc vybledly text
// (snímek Richarda 13. 9. 2026).
const STAV_STYL = {
  ceka: 'border-amber-500 bg-background/70',
  hotovo: 'border-emerald-500 bg-background/70',
  zamitnuto: 'border-border bg-background/40 opacity-80',
  chyba: 'border-destructive bg-background/70',
};

// Akce čekající na potvrzení (zapisovací nástroj). Ano → server ji vykoná
// vlastním v1 API; Ne → model dostane „zamítnuto" a hledá jinou cestu.
// Celý strom nových uzlů na kartě (fáze C, 1. 10. 2026): prvních 12 řádků, zbytek po rozbalení — náhled
// před založením, jaký měl starý Poradce. Řádek = odsazení podle úrovně, řešitel, termín, plán.
function KartaStrom({ strom }) {
  const { t } = useTranslation('asistent');
  const [vse, setVse] = useState(false);
  const radky = vse ? strom : strom.slice(0, 12);
  return (
    <div className="mt-1.5 rounded-md border bg-background/60 px-2 py-1.5 text-xs" data-testid="chat-akce-strom">
      {radky.map((r, i) => (
        <div key={i} className="flex items-baseline gap-1.5 py-0.5" style={{ paddingLeft: `${Math.min(r.u, 6) * 14}px` }} data-testid="chat-akce-strom-uzel" data-uroven={r.u}>
          <span className="text-muted-foreground">{r.u === 0 ? '•' : '–'}</span>
          <span className="flex-1 min-w-0 break-words">{r.t}{r.z ? <span className="text-muted-foreground"> · {t('treeFromBuffer')}</span> : null}
            {/* popis kroku (třeba měřitelný cíl od AI) musí být vidět PŘED potvrzením — klik-test 1. 10. 2026 */}
            {r.k ? <span className="block text-muted-foreground" data-testid="chat-akce-strom-popis">{r.k}</span> : null}
          </span>
          {r.o && <span className="shrink-0 text-muted-foreground truncate max-w-[9rem]" title={r.o}>{r.o}</span>}
          {r.d && <span className="shrink-0 rounded bg-destructive/10 px-1 text-destructive">{r.d.slice(8, 10)}. {Number(r.d.slice(5, 7))}.</span>}
          {r.p && !r.d && <span className="shrink-0 rounded bg-primary/10 px-1 text-primary">{t('treePlan')} {r.p.slice(8, 10)}. {Number(r.p.slice(5, 7))}.</span>}
        </div>
      ))}
      {strom.length > 12 && (
        <button type="button" className="mt-1 text-primary hover:underline" onClick={() => setVse((v) => !v)} data-testid="chat-akce-strom-vse">
          {vse ? t('treeLess') : t('treeAll', { count: strom.length })}
        </button>
      )}
    </div>
  );
}

function KartaAkce({ karta, onPotvrd, onKlientSkin, loading, onOdkaz, najdiPdf, ulozPdf, drivejsiOpravy, onOtevriDokument }) {
  const { t } = useTranslation('asistent');
  const stav = karta.stav || 'ceka';
  // výchozí skin instance vykoná prohlížeč (má JSON vestavěných skinů) — Ano jde přes panel, ne rovnou na server
  const ano = () => (karta.klient === 'instance_skin' && onKlientSkin ? onKlientSkin(karta) : onPotvrd(karta.id, true));
  if (karta.klient === 'pdf_nahrada') return <KartaPdfOprava karta={karta} onPotvrd={onPotvrd} loading={loading} najdiPdf={najdiPdf} ulozPdf={ulozPdf} drivejsiOpravy={drivejsiOpravy} />;
  const popisek = { ceka: t('actionWaiting'), hotovo: t('actionDone'), zamitnuto: t('actionDeclined'), chyba: t('actionError') }[stav];
  return (
    <div className={`mt-2 rounded-lg border p-2.5 text-sm ${STAV_STYL[stav] || STAV_STYL.ceka}`} data-testid="chat-akce" data-stav={stav}>
      <p className="font-medium leading-snug">{karta.popis}</p>
      {karta.detail && <p className="text-xs text-muted-foreground mt-0.5" data-testid="chat-akce-detail">{karta.detail}</p>}
      {Array.isArray(karta.strom) && karta.strom.length > 0 && <KartaStrom strom={karta.strom} />}
      {karta.jednorazove && karta.jednorazove.temp_password && <DocasneHeslo udaj={karta.jednorazove} />}
      {stav === 'ceka' ? (
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={loading} onClick={ano} data-testid="chat-akce-ano">
            <Check className="w-3.5 h-3.5 mr-1" />{t('actionYes')}
          </Button>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => onPotvrd(karta.id, false)} data-testid="chat-akce-ne">
            <X className="w-3.5 h-3.5 mr-1" />{t('actionNo')}
          </Button>
        </div>
      ) : (
        <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{popisek}{stav === 'chyba' && karta.vysledek ? ` — ${karta.vysledek}` : ''}</span>
          {stav === 'hotovo' && karta.odkaz && karta.odkaz.udalost_id && (
            <Link to={`/tasks?view=calendar&udalost=${encodeURIComponent(karta.odkaz.udalost_id)}`} onClick={onOdkaz} className="inline-flex items-center gap-1 text-primary hover:underline" data-testid="chat-akce-odkaz">
              {t('actionOpenEvent')} <ExternalLink className="w-3 h-3" />
            </Link>
          )}
          {stav === 'hotovo' && karta.odkaz && karta.odkaz.type === 'dokument' && karta.odkaz.doc_id && onOtevriDokument && (
            <button type="button" onClick={() => onOtevriDokument(karta.odkaz.doc_id)} className="inline-flex items-center gap-1 text-primary hover:underline" data-testid="chat-akce-dokument">
              {t('dok.open')} <PanelLeftOpen className="w-3 h-3" />
            </button>
          )}
          {stav === 'hotovo' && karta.odkaz && karta.odkaz.map_id && (
            <Link to={`/map/${karta.odkaz.map_id}${karta.odkaz.node_id ? `?node=${encodeURIComponent(karta.odkaz.node_id)}` : ''}`} onClick={onOdkaz} className="inline-flex items-center gap-1 text-primary hover:underline" data-testid="chat-akce-odkaz">
              {karta.odkaz.node_id ? t('actionOpenNode') : t('actionOpen')} <ExternalLink className="w-3 h-3" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// Dočasné heslo pozvánky bez SMTP: přijde JEN v odpovědi na potvrzení (server ho do rozhovoru neukládá) —
// po obnovení stránky už není; uživatel ho zkopíruje a předá osobně (vzor InviteDialog)
function DocasneHeslo({ udaj }) {
  const { t } = useTranslation('asistent');
  const [ok, setOk] = useState(false);
  const kopiruj = async () => { try { await copyToClipboard(`${udaj.email}\n${udaj.temp_password}`); setOk(true); } catch { setOk(false); } };
  return (
    <div className="mt-2 rounded-md border border-amber-500/60 bg-amber-50/70 dark:bg-amber-950/30 p-2 text-xs" data-testid="chat-akce-heslo">
      <p className="text-muted-foreground">{t('nastaveni.tempPassword', { email: udaj.email })}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <code className="font-mono text-sm select-all" data-testid="chat-akce-heslo-text">{udaj.temp_password}</code>
        <button type="button" onClick={kopiruj} className="inline-flex items-center gap-1 text-primary hover:underline" data-testid="chat-akce-heslo-kopirovat">
          <Copy className="w-3 h-3" />{ok ? t('nastaveni.copied') : t('nastaveni.copy')}
        </button>
      </div>
      <p className="mt-1 text-muted-foreground">{t('nastaveni.tempPasswordHint')}</p>
    </div>
  );
}

// Nastavení provedené hned (jazyk, motiv, zjednodušené zobrazení, čitelnost, zámek, jméno, upozornění) s Vrátit —
// vzor KartaSkin. Vrátit = tatáž cesta s předchozí hodnotou (panel.vratNastaveni).
function KartaNastaveni({ karta, onRevert }) {
  const { t } = useTranslation('asistent');
  const { t: tn } = useTranslation('notify');
  let text;
  if (karta.co === 'notify') {
    const typ = karta.typ === 'all' ? t('nastaveni.allTypes') : tn(`type.${karta.typ}`, { defaultValue: karta.typ });
    const kanaly = [];
    if (karta.in_app !== undefined && karta.in_app !== null) kanaly.push(`${t('nastaveni.inApp')} ${karta.in_app ? t('nastaveni.on') : t('nastaveni.off')}`);
    if (karta.email !== undefined && karta.email !== null) kanaly.push(`${t('nastaveni.email')} ${karta.email ? t('nastaveni.on') : t('nastaveni.off')}`);
    text = t('nastaveni.notify', { type: typ, channels: kanaly.join(', ') });
  } else {
    const nazev = t(`nastaveni.pole.${karta.co}`, { defaultValue: karta.co });
    const hodnota = ['full_name', 'display_name'].includes(karta.co) ? (karta.hodnota || '—') : t(`nastaveni.hodnoty.${karta.co}.${karta.hodnota}`, { defaultValue: karta.hodnota });
    text = t('nastaveni.changed', { name: nazev, value: hodnota });
  }
  return (
    <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-xs" data-testid="chat-nastaveni" data-co={karta.co}>
      <span>{text}</span>
      {onRevert && (
        <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => onRevert(karta)} data-testid="chat-nastaveni-vratit">
          <Undo2 className="w-3 h-3" />{t('nastaveni.revert')}
        </button>
      )}
    </div>
  );
}

// Oprava PDF (nástroj pdf_replace_text, kind client): server soubor nemá — po potvrzení
// ho opraví PROHLÍŽEČ (lib/pdf.nahradText, přelepka), ukáže náhled dotčené strany a
// nabídne stažení; výsledek (co se povedlo / nenašlo) pošle serveru v /chat/potvrdit,
// aby model dopověděl pravdu. Po reloadu bajty PDF nejsou → karta si soubor vyžádá znovu.
function KartaPdfOprava({ karta, onPotvrd, loading, najdiPdf, ulozPdf, drivejsiOpravy }) {
  const { t } = useTranslation('asistent');
  const stav = karta.stav || 'ceka';
  const nahrady = (karta.args && karta.args.replacements) || [];
  const jmeno = (karta.pdf && karta.pdf.name) || (karta.args && karta.args.file) || '';
  const stran = (karta.pdf && karta.pdf.pages) || 0;
  const [vybrane, setVybrane] = useState(() => nahrady.map(() => true));
  const [bezi, setBezi] = useState(false);
  const [vysledek, setVysledek] = useState(null);   // { blob, provedeno, nenalezeno, nahled, page }
  const [chyba, setChyba] = useState('');
  const [maSoubor, setMaSoubor] = useState(() => !!(najdiPdf && najdiPdf(jmeno, stran)));
  const inputRef = useRef(null);
  const zivy = useRef(true);
  useEffect(() => () => { zivy.current = false; }, []);
  const vk = karta.vysledek_klienta;
  const nahraj = async (f) => {
    if (!f) return;
    try {
      const P = await import('@/lib/pdf');
      const b = await P.bajty(f);
      // po reloadu: musí to být TEN soubor (stejný počet stran), jinak by náhrady sedly jinam
      if (stran && await P.pocetStran(b) !== stran) { setChyba('jinySoubor'); return; }
      if (ulozPdf) ulozPdf(jmeno, stran, b);
      setMaSoubor(true); setChyba('');
    } catch (e) { setChyba(e && e.kod ? e.kod : 'poskozeno'); }
  };
  const proved = async () => {
    const rec = najdiPdf ? najdiPdf(jmeno, stran) : null;
    if (!rec) { setMaSoubor(false); return; }
    setBezi(true); setChyba('');
    // výsledek jde serveru VŽDY (i když se karta mezitím odmontovala — jinak by čekala navěky)
    let hlaseni = null;
    try {
      const P = await import('@/lib/pdf');
      const vyber = nahrady.filter((_, i) => vybrane[i]);
      const preskoceno = nahrady.filter((_, i) => !vybrane[i]);
      // na originál se aplikují i opravy z dřívějších karet (z rozhovoru na serveru) → druhá
      // oprava neztratí první, a to i po obnovení stránky
      const drive = (drivejsiOpravy ? drivejsiOpravy(karta.id, jmeno, stran) : []).map((x) => ({ ...x, klic: 'drive' }));
      const v = await P.nahradText(rec.bytes, drive.concat(vyber));
      const provedeno = v.provedeno.filter((x) => x.klic !== 'drive').map(({ klic: _k, ...x }) => x);
      const nenalezeno = v.nenalezeno.filter((x) => x.klic !== 'drive').map(({ klic: _k, ...x }) => x);
      const page = (v.strany.length ? provedeno[0] && provedeno[0].page : 0) || v.strany[0] || (vyber[0] && vyber[0].page) || 1;
      let nahled = '';
      try { nahled = await P.nahledStrany(v.bytes, page); } catch { /* náhled je bonus */ }
      hlaseni = { provedeno, nenalezeno, preskoceno: preskoceno.length };
      if (zivy.current) setVysledek({ blob: v.blob, provedeno, nenalezeno, nahled, page, celkem: drive.length });
    } catch (e) {
      const kod = e && e.kod ? e.kod : 'poskozeno';
      if (zivy.current) setChyba(kod);
      hlaseni = { provedeno: [], nenalezeno: [], chyba: kod };
    } finally {
      if (zivy.current) setBezi(false);
    }
    // model dostane pravdu: co se povedlo, co ne a co uživatel odškrtl
    onPotvrd(karta.id, true, hlaseni);
  };
  const stahni = () => { if (vysledek) saveBlob(vysledek.blob, safeFilename(jmeno.replace(/\.pdf$/i, ''), 'dokument') + '-opraveno.pdf'); };
  const popisek = { ceka: t('actionWaiting'), hotovo: t('pdf.cardDone'), zamitnuto: t('actionDeclined'), chyba: t('actionError') }[stav];
  return (
    <div className={`mt-2 rounded-lg border p-2.5 text-sm ${STAV_STYL[stav] || STAV_STYL.ceka}`} data-testid="chat-akce" data-stav={stav} data-klient="pdf_nahrada">
      <p className="font-medium leading-snug inline-flex items-center gap-1.5"><FileText className="w-4 h-4 text-primary shrink-0" />{karta.popis}</p>
      <ul className="mt-1.5 space-y-1 text-xs" data-testid="chat-pdf-nahrady">
        {nahrady.map((n, i) => (
          <li key={i} className="flex items-start gap-1.5">
            {stav === 'ceka' && <input type="checkbox" className="mt-0.5" checked={!!vybrane[i]} onChange={(e) => setVybrane((v) => v.map((x, j) => (j === i ? e.target.checked : x)))} data-testid="chat-pdf-nahrada-vyber" />}
            <span className="min-w-0"><span className="text-muted-foreground">{t('pdf.page', { n: n.page })}</span> {t('pdf.quoted', { v: n.find })} → <span className="font-medium">{t('pdf.quoted', { v: n.replace })}</span></span>
          </li>
        ))}
      </ul>
      {stav === 'ceka' && (
        <div className="mt-2 space-y-1.5">
          {!maSoubor && (
            <div className="rounded-md border border-dashed border-border p-2 text-xs" data-testid="chat-pdf-znovu">
              <p className="text-muted-foreground">{t('pdf.needFile', { name: jmeno })}</p>
              <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { nahraj(e.target.files?.[0]); e.target.value = ''; }} data-testid="chat-pdf-znovu-input" />
              <Button size="sm" variant="outline" className="h-7 text-xs mt-1" onClick={() => inputRef.current?.click()}><Upload className="w-3.5 h-3.5 mr-1" />{t('pdf.chooseFile')}</Button>
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={loading || bezi || !maSoubor || !vybrane.some(Boolean)} onClick={proved} data-testid="chat-akce-ano">
              {bezi ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}{t('pdf.apply')}
            </Button>
            <Button size="sm" variant="outline" disabled={loading || bezi} onClick={() => onPotvrd(karta.id, false)} data-testid="chat-akce-ne">
              <X className="w-3.5 h-3.5 mr-1" />{t('actionNo')}
            </Button>
          </div>
        </div>
      )}
      {chyba && <p className="mt-1.5 text-xs text-destructive" data-testid="chat-pdf-karta-chyba">{t(`pdf.chyba.${chyba}`, { defaultValue: t('pdf.chyba.poskozeno') })}</p>}
      {stav !== 'ceka' && (
        <div className="mt-1.5 text-xs text-muted-foreground" data-testid="chat-pdf-vysledek">
          <span>{popisek}</span>
          {vk && (vk.provedeno || []).length > 0 && <span> — {t('pdf.replaced', { done: vk.provedeno.length, total: (vk.provedeno || []).length + (vk.nenalezeno || []).length })}</span>}
          {vk && (vk.nenalezeno || []).length > 0 && (
            <ul className="mt-1 list-disc pl-4" data-testid="chat-pdf-nenalezeno">
              {vk.nenalezeno.map((n, i) => <li key={i}>{t('pdf.page', { n: n.page })} {t('pdf.quoted', { v: n.find })} — {t(`pdf.chyba.${n.kod || 'nenalezeno'}`, { defaultValue: t('pdf.chyba.nenalezeno') })}</li>)}
            </ul>
          )}
        </div>
      )}
      {vysledek && (
        <div className="mt-2 space-y-1.5" data-testid="chat-pdf-hotovo">
          {vysledek.nahled && <div className="max-h-[26rem] overflow-y-auto rounded border bg-white"><img src={vysledek.nahled} alt="" className="w-full" data-testid="chat-pdf-nahled-strany" /></div>}
          {vysledek.provedeno.length > 0 && (
            <>
              <Button size="sm" className="w-full" onClick={stahni} data-testid="chat-pdf-stahnout"><Download className="w-3.5 h-3.5 mr-1" />{t('pdf.download')}</Button>
              {vysledek.celkem > 0 && <p className="text-[11px] text-muted-foreground" data-testid="chat-pdf-vcetne-drivejsich">{t('pdf.includesEarlier', { count: vysledek.celkem })}</p>}
              <p className="text-[11px] text-muted-foreground">{t('pdf.overlayNote')}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function KartaSkin({ karta, onRevert }) {
  const { t } = useTranslation('asistent');
  const { t: tc } = useTranslation('common');
  return (
    <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-xs" data-testid="chat-skin">
      <span>{t('skinChanged', { name: tc(`skins.${karta.skin_id}`, { defaultValue: karta.skin_id }) })}</span>
      <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => onRevert(karta.predchozi)} data-testid="chat-skin-vratit">
        <Undo2 className="w-3 h-3" />{t('skinRevert')}
      </button>
    </div>
  );
}

// Nabídka „co dál" (nástroj suggest_next): čipy, klik pošle text jako zprávu.
// Aktivní jen u poslední zprávy — starší nabídky zůstávají jako muted text.
function KartaNavrhy({ karta, aktivni, onSend, loading }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" data-testid="chat-navrhy">
      {karta.items.map((n) => (
        aktivni
          ? <button key={n} type="button" disabled={loading} onClick={() => onSend(n)} className="text-xs rounded-full border border-primary/50 bg-background/70 px-2.5 py-1 hover:bg-primary hover:text-primary-foreground transition-colors" data-testid="chat-navrh">{n}</button>
          : <span key={n} className="text-xs rounded-full border border-border px-2.5 py-1 text-muted-foreground">{n}</span>
      ))}
    </div>
  );
}

// Koncept k použití (nástroj draft_text): e-mail / body k poradě / k telefonátu
// v poli s ikonou kopírování — jako blok kódu (Richard 13. 9. 2026).
// Od 30. 9. 2026 se koncept sám ukládá do Dokumentů (doc_id) → „Otevřít vedle“ ho ukáže v panelu vlevo od chatu.
// „Uložit do projektu“ (připsání do poznámek projektu) zrušeno 1. 10. 2026 (Richard): dokument si projekt
// pamatuje sám a odkazuje na mapu; celé texty v poznámkách projektu vytlačovaly poznatky o projektu.
const KONCEPT_IKONA = { email: Mail, meeting: Users, call: Phone, note: NotebookPen, summary: ClipboardList, other: ScrollText };
function KartaKoncept({ karta, onOtevriDokument }) {
  const { t } = useTranslation('asistent');
  const [zkopirovano, setZkopirovano] = useState(false);
  const Ikona = KONCEPT_IKONA[karta.kind] || ScrollText;
  const kopiruj = async () => {
    if (!(await copyToClipboard(karta.text))) return; // „Zkopírováno“ jen když se to opravdu povedlo
    setZkopirovano(true);
    setTimeout(() => setZkopirovano(false), 1500);
  };
  return (
    <div className="mt-2 rounded-lg border border-border bg-background/80 text-xs" data-testid="chat-koncept" data-kind={karta.kind}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
        <span className="inline-flex items-center gap-1.5 font-medium"><Ikona className="w-3.5 h-3.5 text-primary" />{karta.title || t(`draft.${karta.kind}`)}</span>
        <button type="button" onClick={kopiruj} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 hover:bg-secondary" title={t('draft.copy')} data-testid="chat-koncept-kopirovat">
          {zkopirovano ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}{zkopirovano ? t('draft.copied') : t('draft.copy')}
        </button>
      </div>
      {/* adresát i předmět vidět už na kartě — e-mail z tahu s cizím PDF nesmí nést skrytého adresáta (checkup 1. 10.) */}
      {karta.to && <p className="px-2.5 pt-2 text-muted-foreground break-all" data-testid="chat-koncept-komu">{t('dok.to')}: <span className="text-foreground">{karta.to}</span></p>}
      {karta.subject && <p className={`px-2.5 ${karta.to ? 'pt-0.5' : 'pt-2'} text-muted-foreground`} data-testid="chat-koncept-predmet">{t('dok.subject')}: <span className="text-foreground">{karta.subject}</span></p>}
      <pre className="whitespace-pre-wrap break-words font-sans px-2.5 py-2 max-h-72 overflow-y-auto select-text" data-testid="chat-koncept-text">{karta.text}</pre>
      {karta.doc_id && onOtevriDokument && (
        <div className="border-t border-border px-2.5 py-1.5 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => onOtevriDokument(karta.doc_id)} className="inline-flex items-center gap-1 font-medium text-primary hover:underline" data-testid="chat-koncept-otevrit">
            <PanelLeftOpen className="w-3.5 h-3.5" />{t('dok.openBeside')}
          </button>
        </div>
      )}
    </div>
  );
}

// Prostý text s lehkým členěním: řádek zakončený dvojtečkou (do 60 znaků) je
// název sekce → polotučně. Žádný markdown, model ho nemá psát.
function Text({ text }) {
  const radky = String(text).split('\n');
  return (
    <p className="whitespace-pre-wrap break-words">
      {radky.map((r, i) => {
        const sekce = /^[^-•\s].{0,58}:$/.test(r.trim());
        return <span key={i}>{sekce ? <span className="font-semibold">{r}</span> : r}{i < radky.length - 1 ? '\n' : ''}</span>;
      })}
    </p>
  );
}

// Zpráva uživatele s obrázkem: server do ní složí doprovodný text a pod značkou přepis.
// Značku (je pro model) uživateli neukazujeme — přepis dostane vlastní podložený blok.
// PDF: pod značkou je text stran — uživateli jen štítek přílohy a text sbalený (je dlouhý; on svůj soubor zná).
// Hlasovka (1. 10. 2026): pod značkou je přepis — uživatel vidí „🎤 Hlasovka 0:42“ a co z nahrávky vyšlo.
// Značky jsou v lib/prepisZpravy.js (sdílí je oprava přepisu).
const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;

// Oprava přepisu (tužka v bublině, Richard 1. 10. 2026): jen u POSLEDNÍ hlasovky / fotky a jen dokud z jejího tahu nic
// nevzniklo (rozhoduje server: chat.lze_opravit). Odeslání zahodí nepotvrzené návrhy a asistent odpoví znovu.
function TuzkaPrepisu({ onClick }) {
  const { t } = useTranslation('asistent');
  return (
    <button type="button" onClick={onClick} title={t('transcriptEdit')} aria-label={t('transcriptEdit')} className="ml-auto -my-1 -mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md opacity-80 hover:opacity-100 hover:bg-primary-foreground/15" data-testid="chat-prepis-upravit">
      <Pencil className="w-3.5 h-3.5" />
    </button>
  );
}
function OpravaPrepisu({ text, onOdeslat, onZrusit, zaneprazdnen }) {
  const { t } = useTranslation('asistent');
  const [hodnota, setHodnota] = useState(text);
  const pole = useRef(null);
  useEffect(() => { if (pole.current) { pole.current.focus(); pole.current.setSelectionRange(pole.current.value.length, pole.current.value.length); } }, []);
  const zmena = hodnota.trim() && hodnota.trim() !== String(text).trim();
  return (
    <div data-testid="chat-prepis-oprava">
      <textarea ref={pole} value={hodnota} onChange={(e) => setHodnota(e.target.value)} rows={Math.min(10, Math.max(3, Math.ceil(hodnota.length / 42)))} maxLength={8000}
        className="w-full rounded-md border border-border bg-background p-1.5 text-base leading-snug text-foreground sm:text-sm" data-testid="chat-prepis-pole" />
      <p className="mt-0.5 opacity-75">{t('transcriptEditHint')}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button type="button" disabled={!zmena || zaneprazdnen} onClick={() => onOdeslat(hodnota.trim())} className="rounded-md border border-border bg-background px-2 py-1 font-medium text-foreground disabled:opacity-50" data-testid="chat-prepis-odeslat">{t('transcriptEditSend')}</button>
        <button type="button" onClick={onZrusit} className="px-1 py-1 underline opacity-80 hover:opacity-100" data-testid="chat-prepis-zrusit">{t('transcriptEditCancel')}</button>
      </div>
    </div>
  );
}
function ZpravaUzivatele({ zprava, lzeOpravit, onOprav, loading }) {
  const { t } = useTranslation('asistent');
  const [editStav, setEdit] = useState(false);
  const edit = editStav && !!lzeOpravit; // úprava jen tam, kde ji server dovolí (ne po přepnutí rozhovoru, ne po další zprávě)
  const odesliOpravu = (txt) => { setEdit(false); if (onOprav) onOprav(txt); };
  const obr = zprava.obrazek || {};
  const pdf = zprava.pdf || null;
  const zdroj = String(zprava.content || '');
  const mp = pdf ? zdroj.split(ZNACKA_PDF) : [zdroj];
  const textPdf = mp.length > 1 ? mp.slice(1).join('\n') : '';
  const mh = (mp.length > 1 ? mp[0] : zdroj).split(ZNACKA_HLASU);
  const prepisHlasu = mh.length > 1 ? mh.slice(1).join('\n') : '';
  const m = mh[0].split(ZNACKA_PREPISU);
  const doprovod = m.length > 1 ? m[0] : (mp.length > 1 || mh.length > 1 ? mh[0] : zprava.content);
  const prepis = m.length > 1 ? m.slice(1).join('\n') : '';
  const hlas = zprava.hlas || (prepisHlasu ? {} : null);
  return (
    <>
      {obr.nahled && <img src={`data:${obr.mime || 'image/webp'};base64,${obr.nahled}`} alt="" className="mb-1.5 max-h-40 rounded-md" data-testid="chat-zprava-obrazek" />}
      {obr.orez && <p className="text-[11px] opacity-75 mb-1" data-testid="chat-zprava-obrazek-orez">{t('imageDropped')}</p>}
      {pdf && (
        <span className="mb-1.5 inline-flex items-center gap-1.5 rounded-md bg-primary-foreground/15 px-2 py-1 text-xs max-w-full" data-testid="chat-zprava-pdf">
          <FileText className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{pdf.name}</span>{pdf.pages ? <span className="opacity-75 shrink-0">· {t('pdf.pages', { count: pdf.pages })}</span> : null}
        </span>
      )}
      {doprovod && <p className="whitespace-pre-wrap break-words">{doprovod}</p>}
      {hlas && (
        <div className={`${doprovod ? 'mt-1.5 ' : ''}rounded-lg bg-primary-foreground/10 px-2 py-1.5 text-xs`} data-testid="chat-zprava-hlas">
          <p className="flex items-center gap-1 opacity-90 font-medium mb-0.5"><Mic className="w-3.5 h-3.5 shrink-0" />{hlas.s ? t('voiceNote', { cas: mmss(hlas.s) }) : t('voiceNoteNoTime')}{zprava.docasna ? <span className="opacity-75 font-normal"> · {t('voiceReading')}</span> : null}{zprava.opraveno ? <span className="opacity-75 font-normal" data-testid="chat-prepis-upraveno"> · {t('transcriptEdited')}</span> : null}
            {lzeOpravit && !loading && prepisHlasu && !edit && <TuzkaPrepisu onClick={() => setEdit(true)} />}
          </p>
          {edit && prepisHlasu ? <OpravaPrepisu text={prepisHlasu} onOdeslat={odesliOpravu} onZrusit={() => setEdit(false)} zaneprazdnen={loading} /> : prepisHlasu && (prepisHlasu.length > 600 ? (
            <details data-testid="chat-zprava-hlas-dlouhy"><summary className="cursor-pointer opacity-75">{prepisHlasu.slice(0, 160)}… {t('voiceShowAll')}</summary><p className="whitespace-pre-wrap break-words mt-1 max-h-60 overflow-y-auto">{prepisHlasu}</p></details>
          ) : <p className="whitespace-pre-wrap break-words" data-testid="chat-zprava-hlas-prepis">{prepisHlasu}</p>)}
        </div>
      )}
      {textPdf && (
        <details className={`${doprovod ? 'mt-1.5 ' : ''}rounded-lg bg-primary-foreground/10 px-2 py-1.5 text-xs`} data-testid="chat-zprava-pdf-text">
          <summary className="cursor-pointer opacity-75">{pdf && pdf.orez ? t('pdf.textDropped') : t('pdf.textShow')}</summary>
          <p className="whitespace-pre-wrap break-words mt-1 max-h-60 overflow-y-auto">{textPdf}</p>
        </details>
      )}
      {prepis && (
        <div className={`${doprovod ? 'mt-1.5 ' : ''}rounded-lg bg-primary-foreground/10 px-2 py-1.5 text-xs`} data-testid="chat-zprava-prepis">
          <p className="flex items-center gap-1 mb-0.5"><span className="opacity-75">{t('imageTranscript')}{zprava.opraveno ? <span data-testid="chat-prepis-upraveno"> · {t('transcriptEdited')}</span> : null}</span>
            {lzeOpravit && !loading && !edit && <TuzkaPrepisu onClick={() => setEdit(true)} />}
          </p>
          {edit ? <OpravaPrepisu text={prepis} onOdeslat={odesliOpravu} onZrusit={() => setEdit(false)} zaneprazdnen={loading} /> : <p className="whitespace-pre-wrap break-words">{prepis}</p>}
        </div>
      )}
    </>
  );
}

export default function AsistentZprava({ zprava, posledni, loading, onSend, onPotvrd, onRevertSkin, onRevertNastaveni, onKlientSkin, onOdkaz, najdiPdf, ulozPdf, drivejsiOpravy, onOtevriDokument, lzeOpravit, onOprav }) {
  const { t } = useTranslation('asistent');
  if (zprava.role === 'tool') return null;
  const jaUzivatel = zprava.role === 'user';
  const karty = zprava.karty || [];
  const nahlednuto = karty.filter((k) => k.type === 'nastroje').flatMap((k) => k.jmena || []);
  // „Provést vše": když čeká víc akcí naráz (termín + řešitel na pěti uzlech), jednotlivé
  // potvrzení zůstává, ale navrch je jedno tlačítko pro všechny (Richard 29. 9. 2026).
  // Karty vykonávané prohlížečem (oprava PDF) mají vlastní výběr — do dávky nejdou.
  const cekajici = karty.filter((k) => k.type === 'akce' && k.stav === 'ceka' && !k.klient);
  const prvniCekajici = karty.indexOf(cekajici[0]);
  return (
    <div className={`flex ${jaUzivatel ? 'justify-end' : 'justify-start'}`} data-testid="chat-msg" data-role={zprava.role}>
      <div className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${jaUzivatel ? 'bg-primary text-primary-foreground rounded-br-md' : 'bg-secondary text-foreground rounded-bl-md'}`}>
        {nahlednuto.length > 0 && (
          <p className="text-[11px] text-muted-foreground mb-1" data-testid="chat-nahlednuto">
            {t('toolsLooked', { names: [...new Set(nahlednuto)].map((n) => t(`toolNames.${n}`, { defaultValue: n })).join(', ') })}
          </p>
        )}
        {jaUzivatel ? <ZpravaUzivatele zprava={zprava} lzeOpravit={!!lzeOpravit && !zprava.docasna} onOprav={onOprav} loading={loading} /> : (zprava.content && <Text text={zprava.content} />)}
        {zprava.docasna && loading && <Loader2 className="w-3 h-3 animate-spin inline-block ml-1 opacity-70" />}
        {karty.map((k, i) => {
          if (k.type === 'otazky') return <KartaOtazky key={i} karta={k} aktivni={posledni} onSend={onSend} loading={loading} />;
          if (k.type === 'akce') return (
            <Fragment key={i}>
              {i === prvniCekajici && cekajici.length > 1 && (
                <div className="mt-2 flex justify-end">
                  <Button size="sm" disabled={loading} onClick={() => onPotvrd(cekajici.map((c) => c.id), true)} data-testid="chat-akce-vse" data-pocet={cekajici.length}>
                    <CheckCheck className="w-3.5 h-3.5 mr-1" />{t('actionAll', { count: cekajici.length })}
                  </Button>
                </div>
              )}
              <KartaAkce karta={k} onPotvrd={onPotvrd} onKlientSkin={onKlientSkin} loading={loading} onOdkaz={onOdkaz} najdiPdf={najdiPdf} ulozPdf={ulozPdf} drivejsiOpravy={drivejsiOpravy} onOtevriDokument={onOtevriDokument} />
            </Fragment>
          );
          if (k.type === 'navrhy') return <KartaNavrhy key={i} karta={k} aktivni={posledni} onSend={onSend} loading={loading} />;
          if (k.type === 'koncept') return <KartaKoncept key={i} karta={k} onOtevriDokument={onOtevriDokument} />;
          if (k.type === 'dokument') return (
            <button key={i} type="button" onClick={() => onOtevriDokument && onOtevriDokument(k.doc_id)} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-primary/60 bg-background/60 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-secondary" data-testid="chat-dokument-karta">
              <PanelLeftOpen className="w-3.5 h-3.5" />{t('dok.updatedCard', { title: k.title })}
            </button>
          );
          if (k.type === 'skin') return <KartaSkin key={i} karta={k} onRevert={onRevertSkin} />;
          if (k.type === 'nastaveni') return <KartaNastaveni key={i} karta={k} onRevert={onRevertNastaveni} />;
          if (k.type === 'theme') return <p key={i} className="mt-1.5 text-xs text-muted-foreground">{t('themeChanged', { name: k.theme === 'dark' ? t('themeDark') : t('themeLight') })}</p>;
          if (k.type === 'pamet') return (
            <div key={i} className="mt-2 rounded-lg border border-border bg-background/60 p-2 text-xs" data-testid="chat-pamet-karta">
              <p className="text-muted-foreground mb-1">{t('memorySaved')}</p>
              <p className="whitespace-pre-wrap">{k.text}</p>
              {/* paměť bydlí od 1. 10. 2026 v Dokumentech (připnutá nahoře) */}
              {onOtevriDokument && (
                <button type="button" onClick={() => onOtevriDokument(PAMET)} className="mt-1.5 inline-flex items-center gap-1 font-medium text-primary hover:underline" data-testid="chat-pamet-otevrit">
                  <PanelLeftOpen className="w-3.5 h-3.5" />{t('dok.memoryOpen')}
                </button>
              )}
            </div>
          );
          if (k.type === 'otevrit') return (
            <Link key={i} to={`/map/${k.map_id}`} onClick={onOdkaz} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-primary/60 bg-background/60 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-secondary" data-testid="chat-otevrit-projekt">
              {k.map_title ? t('openProjectNamed', { title: k.map_title }) : t('actionOpen')} <ExternalLink className="w-3 h-3" />
            </Link>
          );
          if (k.type === 'napad') return <p key={i} className="mt-1.5 text-xs text-muted-foreground" data-testid="chat-napad-karta">{t('ideaSaved', { title: k.title })}</p>;
          return null;
        })}
      </div>
    </div>
  );
}
