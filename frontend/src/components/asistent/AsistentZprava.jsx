import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Check, Copy, ExternalLink, Loader2, Mail, Phone, ScrollText, Undo2, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
function KartaAkce({ karta, onPotvrd, loading, onOdkaz }) {
  const { t } = useTranslation('asistent');
  const stav = karta.stav || 'ceka';
  const popisek = { ceka: t('actionWaiting'), hotovo: t('actionDone'), zamitnuto: t('actionDeclined'), chyba: t('actionError') }[stav];
  return (
    <div className={`mt-2 rounded-lg border p-2.5 text-sm ${STAV_STYL[stav] || STAV_STYL.ceka}`} data-testid="chat-akce" data-stav={stav}>
      <p className="font-medium leading-snug">{karta.popis}</p>
      {karta.detail && <p className="text-xs text-muted-foreground mt-0.5" data-testid="chat-akce-detail">{karta.detail}</p>}
      {stav === 'ceka' ? (
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={loading} onClick={() => onPotvrd(karta.id, true)} data-testid="chat-akce-ano">
            <Check className="w-3.5 h-3.5 mr-1" />{t('actionYes')}
          </Button>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => onPotvrd(karta.id, false)} data-testid="chat-akce-ne">
            <X className="w-3.5 h-3.5 mr-1" />{t('actionNo')}
          </Button>
        </div>
      ) : (
        <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{popisek}{stav === 'chyba' && karta.vysledek ? ` — ${karta.vysledek}` : ''}</span>
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
const KONCEPT_IKONA = { email: Mail, meeting: Users, call: Phone, other: ScrollText };
function KartaKoncept({ karta, mapy, vychoziMapa, onUlozKoncept }) {
  const { t } = useTranslation('asistent');
  const [zkopirovano, setZkopirovano] = useState(false);
  // uložení do poznámek projektu: model ho udělal sám (map_id), nebo tlačítkem
  const [ulozeno, setUlozeno] = useState(karta.map_id || '');
  const [vyber, setVyber] = useState(false);
  const [mapa, setMapa] = useState(vychoziMapa || '');
  const [uklada, setUklada] = useState(false);
  const Ikona = KONCEPT_IKONA[karta.kind] || ScrollText;
  const nazevMapy = (id) => (mapy.find((m) => m.id === id) || {}).title || '';
  const uloz = async () => {
    const cil = mapa || vychoziMapa || (mapy[0] && mapy[0].id);
    if (!cil) return;
    setUklada(true);
    try { await onUlozKoncept({ text: karta.text, kind: karta.kind, title: karta.title, map_id: cil }); setUlozeno(cil); setVyber(false); } catch { /* chyba = zůstane tlačítko */ }
    setUklada(false);
  };
  const kopiruj = async () => {
    try { await navigator.clipboard.writeText(karta.text); } catch {
      try { const ta = document.createElement('textarea'); ta.value = karta.text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); } catch { /* bez schránky */ }
    }
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
      <pre className="whitespace-pre-wrap break-words font-sans px-2.5 py-2 max-h-72 overflow-y-auto select-text" data-testid="chat-koncept-text">{karta.text}</pre>
      <div className="border-t border-border px-2.5 py-1.5 flex flex-wrap items-center gap-2" data-testid="chat-koncept-ulozeni">
        {ulozeno ? (
          <span className="text-muted-foreground inline-flex items-center gap-1"><Check className="w-3.5 h-3.5 text-emerald-500" />{t('draft.saved', { title: nazevMapy(ulozeno) || '…' })}</span>
        ) : vyber ? (
          <>
            <select value={mapa || vychoziMapa || ''} onChange={(e) => setMapa(e.target.value)} className="h-7 rounded-md border border-input bg-background px-1.5 text-xs max-w-[220px]" data-testid="chat-koncept-mapa">
              {mapy.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
            <Button size="sm" className="h-7 text-xs" disabled={uklada || !mapy.length} onClick={uloz} data-testid="chat-koncept-ulozit">{t('draft.saveConfirm')}</Button>
          </>
        ) : (
          <button type="button" onClick={() => setVyber(true)} className="inline-flex items-center gap-1 text-primary hover:underline" data-testid="chat-koncept-do-projektu">{t('draft.save')}</button>
        )}
      </div>
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
const ZNACKA_PREPISU = /(?:^|\n\n)\[(?:Přepis obrázku|Image transcript)\]\n/;
function ZpravaUzivatele({ zprava }) {
  const { t } = useTranslation('asistent');
  const obr = zprava.obrazek || {};
  const m = String(zprava.content || '').split(ZNACKA_PREPISU);
  const doprovod = m.length > 1 ? m[0] : zprava.content;
  const prepis = m.length > 1 ? m.slice(1).join('\n') : '';
  return (
    <>
      {obr.nahled && <img src={`data:${obr.mime || 'image/webp'};base64,${obr.nahled}`} alt="" className="mb-1.5 max-h-40 rounded-md" data-testid="chat-zprava-obrazek" />}
      {obr.orez && <p className="text-[11px] opacity-75 mb-1" data-testid="chat-zprava-obrazek-orez">{t('imageDropped')}</p>}
      {doprovod && <p className="whitespace-pre-wrap break-words">{doprovod}</p>}
      {prepis && (
        <div className={`${doprovod ? 'mt-1.5 ' : ''}rounded-lg bg-primary-foreground/10 px-2 py-1.5 text-xs`} data-testid="chat-zprava-prepis">
          <p className="opacity-75 mb-0.5">{t('imageTranscript')}</p>
          <p className="whitespace-pre-wrap break-words">{prepis}</p>
        </div>
      )}
    </>
  );
}

export default function AsistentZprava({ zprava, posledni, loading, onSend, onPotvrd, onRevertSkin, mapy = [], vychoziMapa = '', onUlozKoncept, onOdkaz }) {
  const { t } = useTranslation('asistent');
  if (zprava.role === 'tool') return null;
  const jaUzivatel = zprava.role === 'user';
  const karty = zprava.karty || [];
  const nahlednuto = karty.filter((k) => k.type === 'nastroje').flatMap((k) => k.jmena || []);
  return (
    <div className={`flex ${jaUzivatel ? 'justify-end' : 'justify-start'}`} data-testid="chat-msg" data-role={zprava.role}>
      <div className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${jaUzivatel ? 'bg-primary text-primary-foreground rounded-br-md' : 'bg-secondary text-foreground rounded-bl-md'}`}>
        {nahlednuto.length > 0 && (
          <p className="text-[11px] text-muted-foreground mb-1" data-testid="chat-nahlednuto">
            {t('toolsLooked', { names: [...new Set(nahlednuto)].map((n) => t(`toolNames.${n}`, { defaultValue: n })).join(', ') })}
          </p>
        )}
        {jaUzivatel ? <ZpravaUzivatele zprava={zprava} /> : (zprava.content && <Text text={zprava.content} />)}
        {zprava.docasna && loading && <Loader2 className="w-3 h-3 animate-spin inline-block ml-1 opacity-70" />}
        {karty.map((k, i) => {
          if (k.type === 'otazky') return <KartaOtazky key={i} karta={k} aktivni={posledni} onSend={onSend} loading={loading} />;
          if (k.type === 'akce') return <KartaAkce key={i} karta={k} onPotvrd={onPotvrd} loading={loading} onOdkaz={onOdkaz} />;
          if (k.type === 'navrhy') return <KartaNavrhy key={i} karta={k} aktivni={posledni} onSend={onSend} loading={loading} />;
          if (k.type === 'koncept') return <KartaKoncept key={i} karta={k} mapy={mapy} vychoziMapa={vychoziMapa} onUlozKoncept={onUlozKoncept} />;
          if (k.type === 'skin') return <KartaSkin key={i} karta={k} onRevert={onRevertSkin} />;
          if (k.type === 'theme') return <p key={i} className="mt-1.5 text-xs text-muted-foreground">{t('themeChanged', { name: k.theme === 'dark' ? t('themeDark') : t('themeLight') })}</p>;
          if (k.type === 'pamet') return (
            <div key={i} className="mt-2 rounded-lg border border-border bg-background/60 p-2 text-xs" data-testid="chat-pamet-karta">
              <p className="text-muted-foreground mb-1">{t('memorySaved')}</p>
              <p className="whitespace-pre-wrap">{k.text}</p>
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
