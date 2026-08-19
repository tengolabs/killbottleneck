import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Smile, X, Search } from 'lucide-react';
import { PROJECT_EMOJIS } from '@/lib/projectColors';
import { useLazyNs } from '@/i18n/lazyNs';

// Výběr ikony (emoji) projektu i uzlu. value = aktuální emoji ('' = žádné).
//
// Katalog ~200 ikon v kategoriích s hledáním se načítá AŽ PŘI OTEVŘENÍ nabídky
// (dynamický import). Do hlavního balíku se tak nedostane a lite režim, který
// má do stropu 1 kB, o něm vůbec neví. Do doby, než se katalog dotáhne, se
// ukáže původní kurátorovaná sada PROJECT_EMOJIS — nabídka je tím použitelná
// okamžitě a nikdy prázdná.
//
// „Vlastní znak" je pole, do kterého člověk vloží libovolné emoji z klávesnice
// (Richard 18. 8. 2026). Záměrně se NEnahrávají obrázky: hostovaná verze cizí
// soubory neukládá a SVG bylo den předtím zakázáno kvůli skriptu uvnitř.
function Dlazdice({ e, vybrana, onVyber, onZapomen, popisOdebrat }) {
  return (
    <span className="relative inline-flex group">
      <button
        type="button"
        onClick={() => onVyber(e)}
        title={e}
        className={`w-7 h-7 rounded flex items-center justify-center text-lg leading-none hover:bg-secondary ${vybrana ? 'bg-primary/15 ring-1 ring-primary' : ''}`}
      >
        {e}
      </button>
      {onZapomen && (
        <button
          type="button"
          onClick={(ev) => { ev.stopPropagation(); onZapomen(e); }}
          title={popisOdebrat}
          className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center w-3.5 h-3.5 rounded-full bg-muted text-muted-foreground hover:bg-destructive hover:text-destructive-foreground text-[9px] leading-none border"
        >
          ×
        </button>
      )}
    </span>
  );
}

// Obsah nabídky bez Popoveru — aby šel použít i tam, kde už jeden Popover
// otevřený je (tabulka úkolů). Vnořovat Popover do Popoveru se nemá:
// rvaly by se o zámek klávesnice.
export function EmojiNabidka({ value, onChange, onHotovo }) {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith('en') ? 'en' : 'cs';
  const [katalog, setKatalog] = useState(null);
  const [dotaz, setDotaz] = useState('');
  const [oblibene, setOblibene] = useState([]);
  const [vlastni, setVlastni] = useState('');
  const [vlastniChyba, setVlastniChyba] = useState(false);

  // katalog i oblíbené až při prvním vykreslení nabídky
  useEffect(() => {
    if (katalog) return;
    let zruseno = false;
    import('@/lib/emojiKatalog').then((m) => {
      if (zruseno) return;
      setKatalog(m);
      setOblibene(m.nactiOblibene());
    });
    return () => { zruseno = true; };
  }, [katalog]);

  const t = katalog ? katalog.TEXTY[lang] : null;
  const nalezene = katalog && dotaz.trim() ? katalog.hledejIkony(dotaz) : null;

  const vyber = (e) => {
    onChange(e);
    if (katalog) setOblibene(katalog.zapamatujOblibenou(e));
    setDotaz('');
    setVlastni('');
    setVlastniChyba(false);
    onHotovo?.();
  };

  // „U+1F436" je pro člověka pořád ikona psa — přeložíme ji. Co ikona být
  // nemůže (běžný text), se neuloží a řekne se to nahlas.
  const pouzijVlastni = () => {
    const ikona = katalog ? katalog.naIkonu(vlastni) : '';
    if (!ikona) { setVlastniChyba(true); return; }
    vyber(ikona);
  };

  const zapomen = (e) => { if (katalog) setOblibene(katalog.zapomenOblibenou(e)); };

  return (
    <div>
        {/* hledání */}
        <div className="relative mb-2">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
          <Input
            value={dotaz}
            onChange={(ev) => setDotaz(ev.target.value)}
            placeholder={t ? t.hledat : ''}
            className="h-8 pl-7 text-sm"
            data-emoji-hledat
          />
        </div>

        {/* ⚠️ Kolečko myši tu musí scrollovat RUČNĚ. Nabídka se otevírá v portálu,
            tedy mimo DOM okna úpravy uzlu, a Radix Dialog zamyká scrollování všeho,
            co ke svému obsahu nepatří (react-remove-scroll) — kolečko se sem jinak
            vůbec nedostane a seznam vypadá zaseknutě. Nález Richarda 18. 8. 2026. */}
        <div
          className="max-h-64 overflow-y-auto pr-1"
          onWheel={(ev) => {
            const el = ev.currentTarget;
            const doleji = ev.deltaY > 0 && el.scrollTop + el.clientHeight < el.scrollHeight;
            const nahoru = ev.deltaY < 0 && el.scrollTop > 0;
            if (doleji || nahoru) { el.scrollTop += ev.deltaY; ev.stopPropagation(); }
          }}
          data-emoji-seznam
        >
          {/* výsledky hledání */}
          {nalezene !== null ? (
            nalezene.length ? (
              <div className="grid grid-cols-8 gap-0.5">
                {nalezene.map((e) => <Dlazdice key={e} e={e} vybrana={value === e} onVyber={vyber} />)}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground py-3 text-center">{t?.nenalezeno}</p>
            )
          ) : (
            <>
              {/* oblíbené = posledně použité */}
              {oblibene.length > 0 && (
                <div className="mb-2">
                  <p className="text-[11px] font-medium text-muted-foreground mb-1">{t?.oblibene}</p>
                  <div className="grid grid-cols-8 gap-0.5">
                    {oblibene.map((e) => (
                      <Dlazdice key={e} e={e} vybrana={value === e} onVyber={vyber}
                                onZapomen={zapomen} popisOdebrat={t?.odebrat} />
                    ))}
                  </div>
                </div>
              )}
              {katalog ? (
                katalog.KATEGORIE.map((kat) => (
                  <div key={kat.id} className="mb-2">
                    <p className="text-[11px] font-medium text-muted-foreground mb-1">{kat.nazev[lang]}</p>
                    <div className="grid grid-cols-8 gap-0.5">
                      {kat.ikony.map(([e]) => <Dlazdice key={e} e={e} vybrana={value === e} onVyber={vyber} />)}
                    </div>
                  </div>
                ))
              ) : (
                // než se katalog dotáhne — původní sada, ať nabídka není prázdná
                <div className="grid grid-cols-8 gap-0.5">
                  {PROJECT_EMOJIS.map((e) => <Dlazdice key={e} e={e} vybrana={value === e} onVyber={vyber} />)}
                </div>
              )}
            </>
          )}
        </div>

        {/* vlastní znak z klávesnice */}
        <div className="mt-2 pt-2 border-t">
          <p className="text-[11px] font-medium text-muted-foreground mb-1">{t?.vlastni}</p>
          <div className="flex items-center gap-1.5">
            <Input
              value={vlastni}
              onChange={(ev) => { setVlastni(ev.target.value.slice(0, 32)); setVlastniChyba(false); }}
              onKeyDown={(ev) => { if (ev.key === 'Enter' && vlastni.trim()) { ev.preventDefault(); pouzijVlastni(); } }}
              placeholder={t ? t.vlastniPopis : ''}
              className="h-8 text-sm"
              data-emoji-vlastni
            />
            <button
              type="button"
              disabled={!vlastni.trim()}
              onClick={pouzijVlastni}
              className="shrink-0 text-xs px-2 py-1.5 rounded-md border hover:bg-secondary disabled:opacity-40"
            >
              {t?.pouzit}
            </button>
          </div>
          {vlastniChyba && (
            <p className="mt-1 text-[11px] text-destructive" data-emoji-chyba>{t?.neniIkona}</p>
          )}
        </div>

        {value && (
          <button
            type="button"
            onClick={() => { onChange(''); onHotovo?.(); }}
            className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground inline-flex items-center justify-center gap-1 py-1"
          >
            <X className="w-3 h-3" /> {t?.bezIkony}
          </button>
        )}
    </div>
  );
}

// Tlačítko s aktuální ikonou, po kliknutí rozbalí nabídku.
export default function EmojiPicker({ value, onChange, className = '' }) {
  const [open, setOpen] = useState(false);
  // ⚠️ Popisek se bere z i18n, NE z katalogu. Dřív se kvůli téhle jediné větě
  // stahoval celý katalog (12 kB) při každém vykreslení pickeru — tedy i když
  // ho nikdo neotevřel, přesně proti tomu, co slibuje komentář nahoře.
  // (Nález panelu 19. 8. 2026.)
  const { t } = useTranslation('popis');
  const nsReady = useLazyNs('popis');
  const popisek = nsReady ? t('popis.vybratIkonu') : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={popisek || undefined}
          data-emoji-picker
          className={`w-10 h-10 shrink-0 rounded-md border flex items-center justify-center text-xl leading-none hover:bg-secondary transition-colors ${className}`}
        >
          {value || <Smile className="w-4 h-4 text-muted-foreground" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        {open && <EmojiNabidka value={value} onChange={onChange} onHotovo={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  );
}
