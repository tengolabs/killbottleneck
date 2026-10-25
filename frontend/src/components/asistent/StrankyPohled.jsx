import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, ChevronLeft, Circle, Code2, Copy, Download, ExternalLink, Globe, LayoutTemplate, Loader2, Plus, RefreshCw, Search, Sparkles, Trash2, Undo2, UserPlus, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { pb } from '@/api/pb';
import { base44 } from '@/api/base44Client';
import { getMembers } from '@/api/kb';
import { useAuth } from '@/lib/AuthContext';
import { copyToClipboard } from '@/lib/clipboard';
import { memberLabel } from '@/lib/memberLabel';
import { saveBlob, safeFilename } from '@/lib/saveFile';
import { serverOrigin } from '@/lib/serverUrl';
import { useLazyNs } from '@/i18n/lazyNs';
import { stranky as apiSeznam, stranka as apiStranka, strankaNapsat, strankaVratit, strankaSmazat, strankaSdilet, strankaTym, strankaLide } from '@/api/asistentApi';
import { useKbConfig } from '@/hooks/useKbConfig';

// Stránky asistenta (14. 10. 2026) — HTML artefakty (prezentace, přehledy, mini-appky), které napsal
// asistent (page writer) nebo připojený agent přes MCP. Záložka v panelu Dokumentů: seznam Moje | Sdílené se mnou,
// detail = náhled v SANDBOXOVANÉM iframu (srcdoc + sandbox BEZ allow-same-origin → stránka běží jako
// cizí původ a nedosáhne na přihlášení v localStorage ani na API instance), Otevřít v nové kartě přes
// /stranka/:id (ne blob URL — ta by dědila původ aplikace), Sdílet odkazem (/p/<token>), Lidé (jmenovitě
// vybraní členové + celý tým — „jako u sdílení mapy“, Richard 15. 10.), Stáhnout .html, Vrátit, Smazat.
// Psaní (15. 10. 2026): writer skládá stránku PO ČÁSTECH (osnova → kostra → části) a po každém kroku uloží
// rozpracované HTML + kroky do záznamu → panel je dostává realtime a ukazuje, co se právě děje: seznam
// kroků, rostoucí náhled a volitelně „živý kód“. Tokeny po jednom streamovat nejde (PocketBase volá model
// synchronně) — tohle je nejbližší poctivá náhrada. Šablony (NovaStranka): pevný první krok skládá
// aplikace — formulář složí zprávu asistentovi, aby funkce nebyla schovaná za přesnou formulací.

export const SANDBOX = 'allow-scripts allow-forms allow-popups allow-modals'; // NIKDY allow-same-origin
const SKUPINY = ['moje', 'tym'];
const CEKA_STARE_MS = 2 * 60 * 1000; // „ceka“ bez writeru déle než 2 min = nabídnout Zkusit znovu
export const NOVA = 'nova'; // dokId 'stranka:nova' nebo 'stranka:nova:<šablona>' = formulář nové stránky
export const SABLONY = ['vedeni', 'tym', 'zakaznik', 'osa', 'report', 'checklist', 'volne'];
const STYLY = ['svetly', 'tmavy', 'firemni'];

function datum(iso, lang) {
  if (!iso) return '';
  const d = new Date(String(iso).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(lang === 'en' ? 'en-GB' : 'cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const stari = (iso) => Date.now() - (Date.parse(String(iso || '').replace(' ', 'T')) || 0);
const sekundy = (ms) => `${Math.max(1, Math.round((ms || 0) / 1000))} s`;

// ⚠️ V sandboxovaném srcdoc rámci bere Chrome klik na odkaz „#sekce“ (navigace stránky) jako novou navigaci na
// about:blank#… → rámec zůstane prázdný (klik-test 25. 10. 2026). Blob URL to neřeší (klik neudělá nic, ověřeno),
// proto náhled do stránky před </body> vloží skript, který kliky na kotvy převede na posun v dokumentu.
// Veřejná /p/<token> i stažený soubor mají skutečnou adresu, tam kotvy fungují samy a skript se nevkládá.
const SKRIPT_KOTVY = `<script data-kb="nahled-kotvy">document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[href^="#"]'):null;if(!a)return;var id='';try{id=decodeURIComponent(a.getAttribute('href').slice(1))}catch(x){id=a.getAttribute('href').slice(1)}if(!id)return;var el=document.getElementById(id);if(!el)return;e.preventDefault();el.scrollIntoView({block:'start'});},true)</script>`;
// náhled chrání i ČLOVĚKA, ne jen aplikaci: stránka od agenta/injekce nesmí odeslat formulář ani fetch na cizí server
// (phishing uvnitř důvěryhodného UI) — totéž, co veřejná /p/ posílá hlavičkou (/checkup 25. 10. 2026)
const META_CSP = `<meta http-equiv="Content-Security-Policy" content="form-action 'none'; connect-src 'none'">`;
export function vlozKotvy(html) {
  let h = String(html || '');
  const hlava = h.search(/<head\b[^>]*>/i);
  if (hlava >= 0) { const k = h.indexOf('>', hlava) + 1; h = h.slice(0, k) + META_CSP + h.slice(k); }
  else { const html0 = h.search(/<html\b[^>]*>/i); const k = html0 >= 0 ? h.indexOf('>', html0) + 1 : 0; h = h.slice(0, k) + META_CSP + h.slice(k); }
  const i = h.toLowerCase().lastIndexOf('</body>');
  return i >= 0 ? h.slice(0, i) + SKRIPT_KOTVY + h.slice(i) : h + SKRIPT_KOTVY;
}
export function NahledStranky({ html, title, className, testid }) {
  const doc = useMemo(() => vlozKotvy(html), [html]);
  return (
    <iframe
      sandbox={SANDBOX}
      referrerPolicy="no-referrer"
      srcDoc={doc}
      title={title || 'page'}
      className={className || 'w-full h-full bg-white'}
      data-testid={testid || 'chat-str-iframe'}
    />
  );
}

// „Živý kód“: HTML roste po částech; nově příchozí kus se odkrývá postupně (psací stroj), ať je vidět pohyb
export function ZivyKod({ text, bezi }) {
  const [ukazano, setUkazano] = useState(0);
  const ref = useRef(null);
  const delka = (text || '').length;
  useEffect(() => {
    if (ukazano >= delka) { if (ukazano > delka) setUkazano(delka); return undefined; }
    const h = setInterval(() => setUkazano((u) => Math.min(delka, u + Math.max(60, Math.ceil((delka - u) / 25)))), 40);
    return () => clearInterval(h);
  }, [delka, ukazano]);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [ukazano]);
  return (
    <pre ref={ref} className="h-full overflow-auto bg-zinc-950 text-zinc-100 text-[11px] leading-snug p-2 font-mono whitespace-pre-wrap break-all" data-testid="chat-str-kod" data-delka={ukazano}>
      {(text || '').slice(0, ukazano)}{bezi || ukazano < delka ? <span className="inline-block w-1.5 h-3 bg-emerald-400 align-middle animate-pulse ml-0.5" /> : null}
    </pre>
  );
}

// kroky writeru (z pole prubeh záznamu): osnova → kostra → části (nebo „celá stránka“)
export function KrokyPsani({ prubeh, t }) {
  const kroky = (prubeh && prubeh.kroky) || [];
  if (!kroky.length) return null;
  return (
    <ol className="space-y-0.5" data-testid="chat-str-kroky">
      {kroky.map((k, i) => {
        const nazev = k.k === 'sekce' ? k.t : k.k === 'osnova' && !k.info ? t('krok.osnovaBezi') : t(`krok.${k.k}`, { count: k.info || 0 });
        return (
          <li key={i} className={`flex items-center gap-1.5 text-xs ${k.s === 'ceka' ? 'text-muted-foreground' : k.s === 'chyba' ? 'text-destructive' : ''}`} data-testid="chat-str-krok" data-stav={k.s}>
            {k.s === 'hotovo' ? <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> : k.s === 'bezi' ? <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" /> : k.s === 'chyba' ? <X className="w-3.5 h-3.5 shrink-0" /> : <Circle className="w-3 h-3 shrink-0 opacity-50" />}
            <span className="truncate flex-1">{nazev}</span>
            {k.s === 'hotovo' && k.ms ? <span className="text-[10px] text-muted-foreground shrink-0">{sekundy(k.ms)}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function SeznamStranek({ verze, onOtevri, onNova, skupina, setSkupina, q, setQ }) {
  const nsReady = useLazyNs('stranky');
  const { t, i18n } = useTranslation('stranky');
  const [hledat, setHledat] = useState('');
  const [rows, setRows] = useState(null);
  const [chyba, setChyba] = useState('');
  useEffect(() => { const h = setTimeout(() => setHledat(q.trim()), 250); return () => clearTimeout(h); }, [q]);
  useEffect(() => {
    let zivy = true;
    apiSeznam({ skupina, q: hledat })
      .then((r) => { if (zivy) { setRows(r.stranky || []); setChyba(''); } })
      .catch((e) => { if (zivy) { setRows((p) => p || []); setChyba(e.message || t('errorLoad')); } });
    return () => { zivy = false; };
  }, [skupina, hledat, verze, t]);
  if (!nsReady) return <Loader2 className="w-4 h-4 animate-spin m-3" />;
  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="chat-str-seznam-pohled">
      <div className="px-3 pt-3 pb-2 space-y-2 border-b shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="flex flex-wrap gap-1.5 flex-1" role="tablist">
            {SKUPINY.map((s) => (
              <button key={s} type="button" role="tab" aria-selected={skupina === s} onClick={() => setSkupina(s)}
                className={`text-xs rounded-full border px-2.5 py-1 transition-colors ${skupina === s ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-secondary'}`}
                data-testid="chat-str-filtr" data-skupina={s}>
                {t(`skupina.${s}`)}
              </button>
            ))}
          </div>
          <Button size="sm" className="h-7 text-xs shrink-0" onClick={() => onNova()} data-testid="chat-str-nova"><Plus className="w-3.5 h-3.5 mr-1" />{t('nova.button')}</Button>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} className="h-8 pl-8 text-sm" data-testid="chat-str-hledat" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1" data-testid="chat-str-seznam">
        {rows === null && <Loader2 className="w-4 h-4 animate-spin m-3" />}
        {chyba && <p className="text-xs text-destructive px-2">{chyba}</p>}
        {rows && rows.length === 0 && !chyba && (
          <div className="px-3 py-4 text-sm text-muted-foreground" data-testid="chat-str-prazdno">
            <LayoutTemplate className="w-6 h-6 mx-auto mb-2 opacity-60" />
            <p className="text-center">{hledat ? t('emptyFiltered') : skupina === 'tym' ? t('emptyTeam') : t('empty')}</p>
            {!hledat && skupina === 'moje' && (
              <div className="mt-3 flex flex-wrap justify-center gap-1.5" data-testid="chat-str-prazdno-sablony">
                {SABLONY.filter((s) => s !== 'volne').map((s) => (
                  <button key={s} type="button" onClick={() => onNova(s)} className="text-xs rounded-full border border-primary/50 px-2.5 py-1 hover:bg-secondary text-foreground" data-testid="chat-str-sablona-cip" data-sablona={s}>
                    {t(`sablony.${s}.nazev`)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {(rows || []).map((s) => (
          <button key={s.id} type="button" onClick={() => onOtevri(s.id)}
            className="w-full text-left rounded-lg border border-transparent px-2.5 py-2 hover:bg-secondary hover:border-border transition-colors"
            data-testid="chat-str-polozka" data-id={s.id} data-stav={s.stav}>
            <div className="flex items-center gap-2 min-w-0">
              {s.stav === 'pise' || s.stav === 'ceka' ? <Loader2 className="w-4 h-4 text-primary shrink-0 animate-spin" /> : s.stav === 'chyba' ? <AlertTriangle className="w-4 h-4 text-destructive shrink-0" /> : s.shared ? <Globe className="w-4 h-4 text-primary shrink-0" /> : <LayoutTemplate className="w-4 h-4 text-primary shrink-0" />}
              <span className="text-sm font-medium truncate flex-1">{s.title || t('page')}</span>
              {(s.team_visible || s.lide > 0) && <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground shrink-0" title={s.team_visible ? t('teamHint') : t('lide.count', { count: s.lide })}><Users className="w-3.5 h-3.5" />{s.team_visible ? '' : s.lide}</span>}
              <span className="text-[11px] text-muted-foreground shrink-0">{datum(s.updated, i18n.language)}</span>
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5 pl-6">
              {s.mine ? t(`state.${s.stav}`) : t('by', { name: s.owner_name || '—' })}{s.stav === 'hotovo' && s.size_kb ? ` · ${t('size', { kb: s.size_kb })}` : ''}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

// Lidé: jmenovitě vybraní členové organizace (výběr ze seznamu jako v dialogu sdílení mapy) + celý tým
function LideStranky({ str, uklada, akce, t }) {
  const { user } = useAuth();
  const [members, setMembers] = useState(null);
  const [vybrany, setVybrany] = useState('');
  useEffect(() => {
    let zivy = true;
    getMembers().then((r) => { if (zivy) setMembers(r.members || []); }).catch(() => { if (zivy) setMembers([]); });
    return () => { zivy = false; };
  }, []);
  const lide = str.shared_with || [];
  const kandidati = useMemo(() => {
    const uz = new Set(lide.map((u) => u.id));
    return (members || []).filter((m) => m.id !== user?.id && !uz.has(m.id))
      .sort((a, b) => (memberLabel(a) || '').localeCompare(memberLabel(b) || '', undefined, { sensitivity: 'base' }));
  }, [members, lide, user?.id]);
  const pridat = () => { if (!vybrany) return; akce(() => strankaLide({ id: str.id, akce: 'pridat', user: vybrany })); setVybrany(''); };
  return (
    <div className="rounded-md bg-secondary/60 px-2.5 py-2 space-y-2" data-testid="chat-str-lide">
      <p className="text-[11px] text-muted-foreground">{t('lide.hint')}</p>
      <div className="flex items-center gap-1.5">
        <select value={vybrany} onChange={(e) => setVybrany(e.target.value)} disabled={uklada || members === null} aria-label={t('lide.pick')}
          className="h-8 flex-1 min-w-0 rounded-md border border-input bg-background px-2 text-xs" data-testid="chat-str-lide-vyber">
          <option value="">{members === null ? '…' : kandidati.length ? t('lide.pick') : t('lide.nobody')}</option>
          {kandidati.map((m) => <option key={m.id} value={m.id}>{memberLabel(m) !== m.email ? `${memberLabel(m)} (${m.email})` : m.email}</option>)}
        </select>
        <Button size="sm" variant="outline" className="h-8" disabled={uklada || !vybrany} onClick={pridat} data-testid="chat-str-lide-pridat"><UserPlus className="w-3.5 h-3.5 mr-1" />{t('lide.add')}</Button>
      </div>
      {lide.length > 0 && (
        <ul className="space-y-0.5" data-testid="chat-str-lide-seznam">
          {lide.map((u) => (
            <li key={u.id} className="flex items-center gap-1.5 text-xs" data-testid="chat-str-clovek" data-id={u.id}>
              <span className="truncate flex-1">{u.name ? `${u.name} (${u.email})` : u.email}</span>
              <button type="button" className="text-muted-foreground hover:text-destructive" title={t('lide.remove')} aria-label={t('lide.remove')} disabled={uklada} onClick={() => akce(() => strankaLide({ id: str.id, akce: 'odebrat', user: u.id }))} data-testid="chat-str-clovek-odebrat"><X className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      <label className="flex items-center gap-2 text-xs cursor-pointer" title={t('teamHint')}>
        <input type="checkbox" checked={!!str.team_visible} disabled={uklada} onChange={() => akce(() => strankaTym({ id: str.id, team_visible: !str.team_visible }))} data-testid="chat-str-tym" />
        <Users className="w-3.5 h-3.5 text-muted-foreground" />{t('team')}
      </label>
    </div>
  );
}

export function DetailStranky({ id, verze, zmenene, onZpet, onSmazano }) {
  const { config: kbConfig } = useKbConfig(); // pages.timeout pro zaseklé „pise“
  const nsReady = useLazyNs('stranky');
  const { t, i18n } = useTranslation('stranky');
  const [str, setStr] = useState(null);
  const [chyba, setChyba] = useState('');
  const [hlaska, setHlaska] = useState('');
  const [uklada, setUklada] = useState(false);
  const [zkopirovano, setZkopirovano] = useState(false);
  const [potvrdSmazat, setPotvrdSmazat] = useState(false);
  const [lideOtevreno, setLideOtevreno] = useState(false);
  const [kod, setKod] = useState(false);
  const nacti = useCallback(async () => {
    try { const r = await apiStranka(id); setStr(r.stranka); setChyba(''); }
    catch (e) { setChyba(e.status === 404 ? t('notFound') : (e.message || t('errorLoad'))); }
  }, [id, t]);
  useEffect(() => { setStr(null); setHlaska(''); setPotvrdSmazat(false); setLideOtevreno(false); setKod(false); nacti(); }, [id, nacti]);
  const prvni = useRef(true);
  useEffect(() => {
    if (prvni.current) { prvni.current = false; return; }
    if (zmenene && zmenene.length && !zmenene.includes(`stranka:${id}`)) return;
    nacti();
  }, [verze, zmenene, id, nacti]);
  // psaní sleduje realtime (vlastník má listRule; writer ukládá po každém kroku) + pojistka dotazem každých 6 s
  const rozpracovana = !!str && str.mine && str.stav !== 'hotovo' && str.stav !== 'chyba';
  useEffect(() => {
    if (!rozpracovana) return undefined;
    let zivy = true; let unsub = null;
    pb.collection('ai_pages').subscribe(id, (e) => { if (zivy && e && e.record) nacti(); }).then((u) => { if (zivy) unsub = u; else u(); }).catch(() => {});
    const h = setInterval(() => { if (zivy) nacti(); }, 6000);
    return () => { zivy = false; clearInterval(h); if (unsub) unsub(); };
  }, [rozpracovana, id, nacti]);

  const akce = async (fn, ok) => {
    setUklada(true); setHlaska('');
    try { const r = await fn(); if (r && r.stranka) setStr((p) => ({ ...(p || {}), ...r.stranka, html: r.stranka.html !== undefined ? r.stranka.html : (p || {}).html })); if (ok) setHlaska(ok); }
    catch (e) { setHlaska(e.message || t('errorSave')); }
    setUklada(false);
  };
  const znovu = async () => {
    setHlaska(t('retrying'));
    setStr((p) => (p ? { ...p, stav: 'pise', chyba: '', prubeh: null, rozepsano: '' } : p));
    // odpověď se nečeká (minuty, Cloudflare ji může utnout) — stav přijde realtime / dotazem
    strankaNapsat(id).then(() => nacti()).catch((e) => { setHlaska(e.status === 409 ? '' : (e.message || t('failed'))); nacti(); });
  };
  const adresa = str && str.share_token ? (str.share_url || `${serverOrigin()}/p/${str.share_token}`) : '';
  const kopiruj = async () => {
    if (!(await copyToClipboard(adresa))) { setHlaska(t('copyFailed')); return; }
    setZkopirovano(true); setTimeout(() => setZkopirovano(false), 1500);
  };
  const stahni = () => saveBlob(new Blob([str.html || ''], { type: 'text/html;charset=utf-8' }), `${safeFilename(str.title || '', 'stranka')}.html`);

  if (!nsReady) return <Loader2 className="w-4 h-4 animate-spin m-4" />;
  if (chyba) return (
    <div className="p-4 text-sm space-y-3">
      <p className="text-destructive" data-testid="chat-str-chyba">{chyba}</p>
      <Button size="sm" variant="outline" onClick={onZpet}>{t('back')}</Button>
    </div>
  );
  if (!str) return <Loader2 className="w-4 h-4 animate-spin m-4" />;
  // zaseklé „pise“ (zámek writeru vypršel bez výsledku) = po KB_PAGE_TIMEOUT + 30 s nabídnout Zkusit znovu (/checkup 25. 10. 2026)
  const piseStare = str.stav === 'pise' && stari(str.updated) > (((kbConfig && kbConfig.pages && kbConfig.pages.timeout) || 280) + 30) * 1000;
  const stare = (str.stav === 'ceka' && stari(str.updated) > CEKA_STARE_MS) || piseStare;
  const pise = (str.stav === 'pise' || str.stav === 'ceka') && !stare;
  // během psaní (a po chybě) náhled z rozpracovaného HTML; hotová stránka z html
  const nahled = str.stav === 'hotovo' ? str.html : (str.rozepsano || str.html);
  const lideN = (str.shared_with || []).length;
  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="chat-str-detail" data-id={str.id} data-stav={str.stav}>
      <div className="px-3 pt-2 pb-1.5 space-y-1 shrink-0">
        <h2 className="text-sm font-semibold break-words leading-tight" data-testid="chat-str-titulek">{str.title}</h2>
        <p className="text-[11px] text-muted-foreground">
          {str.mine ? t(`state.${str.stav}`) : t('by', { name: str.owner_name || '—' })} · {datum(str.updated, i18n.language)}{str.stav === 'hotovo' && str.size_kb ? ` · ${t('size', { kb: str.size_kb })}` : ''}
        </p>
        {pise && (
          <div className="rounded-md border border-primary/50 bg-primary/5 px-2.5 py-1.5 text-xs space-y-1.5" data-testid="chat-str-pise">
            <div className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /><span className="flex-1">{str.prubeh ? t('writingSteps') : t('writing')}</span>
              <button type="button" onClick={() => setKod((k) => !k)} aria-pressed={kod} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] border ${kod ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-secondary'}`} title={t('codeHint')} data-testid="chat-str-kod-prepinac"><Code2 className="w-3 h-3" />{t('code')}</button>
            </div>
            <KrokyPsani prubeh={str.prubeh} t={t} />
          </div>
        )}
        {(str.stav === 'chyba' || stare) && str.mine && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 px-2.5 py-1.5 text-xs space-y-1" data-testid="chat-str-selhani">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0">{str.stav === 'chyba' ? `${t('failed')}${str.chyba ? ` ${str.chyba}` : ''}` : t('queued')}</span>
              <Button size="sm" variant="outline" className="h-7 shrink-0" disabled={uklada} onClick={znovu} data-testid="chat-str-znovu"><RefreshCw className="w-3.5 h-3.5 mr-1" />{t('retry')}</Button>
            </div>
            {str.stav === 'chyba' && <KrokyPsani prubeh={str.prubeh} t={t} />}
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 border-y bg-white">
        {kod && pise
          ? <ZivyKod text={nahled || ''} bezi />
          : nahled ? <NahledStranky html={nahled} title={str.title} /> : <div className="h-full flex items-center justify-center text-xs text-muted-foreground"><LayoutTemplate className="w-6 h-6 opacity-40" /></div>}
      </div>
      <div className="px-3 py-2 space-y-1.5 shrink-0">
        {hlaska && <p className="text-xs text-muted-foreground" data-testid="chat-str-hlaska">{hlaska}</p>}
        {str.mine && str.share_token && (
          <div className="rounded-md bg-secondary/60 px-2.5 py-1.5 space-y-1" data-testid="chat-str-sdileni">
            <p className="text-[11px] text-muted-foreground">{t('shareOn')}</p>
            <div className="flex items-center gap-1.5">
              <Input readOnly value={adresa} className="h-7 text-xs flex-1 min-w-0" onFocus={(e) => e.target.select()} data-testid="chat-str-odkaz" />
              <Button size="sm" variant="outline" className="h-7" onClick={kopiruj} data-testid="chat-str-kopirovat">{zkopirovano ? <Check className="w-3.5 h-3.5 mr-1 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 mr-1" />}{zkopirovano ? t('copied') : t('copy')}</Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="ghost" className="h-7 text-xs" title={t('shareNewHint')} disabled={uklada} onClick={() => akce(() => strankaSdilet({ id, akce: 'obnovit' }))} data-testid="chat-str-novy-odkaz"><RefreshCw className="w-3.5 h-3.5 mr-1" />{t('shareNew')}</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-destructive" disabled={uklada} onClick={() => akce(() => strankaSdilet({ id, akce: 'vypnout' }))} data-testid="chat-str-zrusit-odkaz">{t('shareOff')}</Button>
            </div>
          </div>
        )}
        {str.mine && lideOtevreno && str.stav === 'hotovo' && <LideStranky str={str} uklada={uklada} akce={akce} t={t} />}
        {potvrdSmazat ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="chat-str-smazat-potvrzeni">
            <span className="text-xs">{t('deleteConfirm')}</span>
            <Button size="sm" variant="destructive" disabled={uklada} onClick={() => akce(async () => { await strankaSmazat(id); onSmazano(); })} data-testid="chat-str-smazat-ano">{t('deleteYes')}</Button>
            <Button size="sm" variant="outline" disabled={uklada} onClick={() => setPotvrdSmazat(false)}>{t('cancel')}</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {str.html && (
              <Button size="sm" variant="outline" className="h-8" asChild>
                <a href={`/stranka/${encodeURIComponent(id)}`} target="_blank" rel="noopener noreferrer" title={t('openHint')} data-testid="chat-str-otevrit"><ExternalLink className="w-3.5 h-3.5 mr-1" />{t('open')}</a>
              </Button>
            )}
            {str.mine && str.stav === 'hotovo' && !str.share_token && (
              <Button size="sm" variant="outline" className="h-8" disabled={uklada} onClick={() => akce(() => strankaSdilet({ id, akce: 'zapnout' }))} data-testid="chat-str-sdilet"><Globe className="w-3.5 h-3.5 mr-1" />{t('share')}</Button>
            )}
            {str.mine && str.stav === 'hotovo' && (
              <Button size="sm" variant={lideOtevreno ? 'default' : (str.team_visible || lideN ? 'secondary' : 'outline')} className="h-8" aria-pressed={lideOtevreno} title={t('lide.hint')} onClick={() => setLideOtevreno((v) => !v)} data-testid="chat-str-lide-prepinac"><Users className="w-3.5 h-3.5 mr-1" />{str.team_visible ? t('lide.team') : lideN ? t('lide.count', { count: lideN }) : t('lide.button')}</Button>
            )}
            {str.html && <Button size="icon" variant="ghost" className="h-8 w-8" title={t('download')} aria-label={t('download')} onClick={stahni} data-testid="chat-str-stahnout"><Download className="w-4 h-4" /></Button>}
            {str.mine && str.ma_predchozi && str.stav !== 'pise' && str.stav !== 'ceka' && (
              <Button size="icon" variant="ghost" className="h-8 w-8" title={t('restore')} aria-label={t('restore')} disabled={uklada} onClick={() => akce(() => strankaVratit(id), t('restored'))} data-testid="chat-str-vratit"><Undo2 className="w-4 h-4" /></Button>
            )}
            {str.mine && (
              <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" title={t('delete')} aria-label={t('delete')} onClick={() => setPotvrdSmazat(true)} data-testid="chat-str-smazat"><Trash2 className="w-4 h-4" /></Button>
            )}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">{t('sandboxNote')}</p>
      </div>
    </div>
  );
}

// Nová stránka ze šablony: formulář složí zprávu asistentovi (aplikace skládá první krok, ne model).
// sablona = předvolba z čipu; mapId = projekt z adresy (editor mapy), jinak první v seznamu.
export function NovaStranka({ sablona, mapId, onOdeslat, onZpet }) {
  const nsReady = useLazyNs('stranky');
  const { t } = useTranslation('stranky');
  const [vybrana, setVybrana] = useState(SABLONY.includes(sablona) ? sablona : 'vedeni');
  const [styl, setStyl] = useState('svetly');
  const [mapy, setMapy] = useState(null);
  const [mapa, setMapa] = useState(mapId || '');
  const [doplneni, setDoplneni] = useState('');
  useEffect(() => {
    let zivy = true;
    base44.entities.GoalMap.list('-updated_date', 50)
      .then((rows) => { if (!zivy) return; const m = (rows || []).filter((x) => !x.archived && x.kind !== 'org'); setMapy(m); setMapa((p) => p || (m[0] && m[0].id) || ''); })
      .catch(() => { if (zivy) setMapy([]); });
    return () => { zivy = false; };
  }, []);
  if (!nsReady) return <Loader2 className="w-4 h-4 animate-spin m-3" />;
  const volne = vybrana === 'volne';
  const projekt = (mapy || []).find((m) => m.id === mapa);
  const muzeOdeslat = volne ? doplneni.trim().length > 0 : true;
  const odeslat = () => {
    if (!muzeOdeslat) return;
    const casti = [t(`sablony.${vybrana}.zprava`, { projekt: projekt ? projekt.title : '' })];
    if (!volne) casti.push(projekt ? t('nova.projektVeta', { projekt: projekt.title }) : t('nova.bezProjektu'));
    casti.push(t(`nova.stylVeta.${styl}`));
    if (doplneni.trim()) casti.push((volne ? '' : t('nova.doplneniVeta')) + doplneni.trim());
    onOdeslat(casti.filter(Boolean).join(' '));
  };
  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="chat-str-nova-form">
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">{t('nova.intro')}</p>
        <div className="space-y-1.5" role="radiogroup" aria-label={t('nova.sablona')}>
          {SABLONY.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={vybrana === s} onClick={() => setVybrana(s)}
              className={`w-full text-left rounded-md border px-2.5 py-1.5 transition-colors ${vybrana === s ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary'}`}
              data-testid="chat-str-sablona" data-sablona={s}>
              <span className="block text-xs font-medium">{t(`sablony.${s}.nazev`)}</span>
              <span className="block text-[11px] text-muted-foreground leading-snug">{t(`sablony.${s}.popis`)}</span>
            </button>
          ))}
        </div>
        {!volne && (
          <label className="block space-y-1">
            <span className="text-xs font-medium">{t('nova.projekt')}</span>
            <select value={mapa} onChange={(e) => setMapa(e.target.value)} className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs" data-testid="chat-str-nova-projekt">
              <option value="">{mapy === null ? '…' : t('nova.bezProjektuVolba')}</option>
              {(mapy || []).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
          </label>
        )}
        <div className="space-y-1">
          <span className="text-xs font-medium">{t('nova.styl')}</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('nova.styl')}>
            {STYLY.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={styl === s} onClick={() => setStyl(s)}
                className={`text-xs rounded-full border px-2.5 py-1 ${styl === s ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-secondary'}`} data-testid="chat-str-styl" data-styl={s}>
                {t(`nova.styly.${s}`)}
              </button>
            ))}
          </div>
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-medium">{volne ? t('nova.zadani') : t('nova.doplneni')}</span>
          <Textarea value={doplneni} onChange={(e) => setDoplneni(e.target.value)} rows={3} placeholder={volne ? t('nova.zadaniPlaceholder') : t('nova.doplneniPlaceholder')} className="text-sm" data-testid="chat-str-nova-text" />
        </label>
      </div>
      <div className="px-3 py-2 border-t flex items-center gap-2 shrink-0">
        <Button size="sm" variant="ghost" className="h-8" onClick={onZpet} data-testid="chat-str-nova-zpet"><ChevronLeft className="w-4 h-4 mr-0.5" />{t('back')}</Button>
        <Button size="sm" className="h-8 flex-1" disabled={!muzeOdeslat} onClick={odeslat} data-testid="chat-str-nova-odeslat"><Sparkles className="w-3.5 h-3.5 mr-1" />{t('nova.submit')}</Button>
      </div>
    </div>
  );
}
