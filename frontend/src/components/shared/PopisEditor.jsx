import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLazyNs } from '@/i18n/lazyNs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Bold, Italic, Strikethrough, Heading1, Heading2, List, ListOrdered, Link2, Eye, Pencil, Paperclip } from 'lucide-react';
import { vlozZnacku, vlozOdkaz, pokracujSeznam } from '@/lib/popisFormat';
import FormatovanyPopis from './FormatovanyPopis';
import { linkKind } from '@/components/node-dialog/linkKind';

// Popis s formátováním — lišta nad obyčejnou textareou, žádný contentEditable.
//
// Uživatelé chtěli popis využívat na dokumentaci procesů (Richard 18. 8. 2026),
// k čemuž holé pole nestačilo. Text se ukládá se ZNAČKAMI (viz lib/popisFormat.js),
// takže datový model zůstává beze změny a starší popisy platí dál.
//
// Proč ne WYSIWYG: contentEditable by znamenal vlastní správu kurzoru, vkládání
// z Wordu a rozsypané HTML v datech. Lišta nad textareou dělá totéž, co lidé
// znají z GitHubu, a přepínač náhledu ukáže výsledek.
//
// Tlačítko odkazu nabízí PŘÍLOHY UZLU: v mapě se pak zobrazí „evidence“ místo
// stránky dlouhé adresy z Google Sheets. Přílohy jsou už načtené v dialogu,
// nic se kvůli tomu nedotahuje.

export default function PopisEditor({
  value,
  onChange,
  id = 'description',
  rows = 6,
  placeholder,
  prilohy = [],
}) {
  const { t } = useTranslation('popis');
  const nsReady = useLazyNs('popis');
  // Popis se většinou ČTE, editace je vědomý krok — Richard 18. 8. 2026:
  // „ať je defaultně na pozici náhled a když budu chtít, tak dám editovat."
  // Zamčený stav navíc chrání dlouhý popis před nechtěným přepsáním.
  // Prázdné pole se zamykat nemá: nebylo by co číst a psaní by stálo klik navíc.
  const [nahled, setNahled] = useState(() => !!value);
  const zamknutoUrceno = useRef(!!value);
  const [odkazOpen, setOdkazOpen] = useState(false);
  const [adresa, setAdresa] = useState('');
  const [popisek, setPopisek] = useState('');
  const ref = useRef(null);
  const dotknutoRef = useRef(false);   // klikl už člověk do pole? (viz pridejOdkaz)
  const pisuSam = useRef(false);       // změnu vyvolal uživatel, ne načtení dat

  // Text se do dialogu načte až po prvním vykreslení, takže výchozí zámek
  // nejde určit jen z první hodnoty — dorovná se, jakmile popis dorazí.
  //
  // ⚠️⚠️ ROZLIŠIT „PŘIŠLO ZE SERVERU" OD „ČLOVĚK PÍŠE". Dokud se tu koukalo
  // jen na to, jestli je `value` neprázdné, zamkl PRVNÍ NAPSANÝ ZNAK pole —
  // textarea se odmountovala a zbytek psaní padal do prázdna. Tichá ztráta
  // dat: uživatel píše větu a v poli zůstane jedno písmeno. Nález kontrolního
  // panelu 19. 8. 2026, způsobeno opravou „výchozí stav zamčeno" z téhož dne.
  useEffect(() => {
    if (zamknutoUrceno.current) return;
    if (pisuSam.current) { zamknutoUrceno.current = true; return; }   // psaní zámek NEspouští
    if (value) { zamknutoUrceno.current = true; setNahled(true); }
  }, [value]);

  const text = value || '';

  // Po vložení značky je potřeba vrátit kurzor tam, kam patří — jinak skočí
  // na konec a psaní ve větším popisu je k nepoužití.
  const uplatni = ({ text: novy, od, konec }) => {
    pisuSam.current = true;
    onChange(novy);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(od, konec);
    });
  };

  const znacka = (druh) => {
    const el = ref.current;
    const od = el ? el.selectionStart : text.length;
    const do_ = el ? el.selectionEnd : text.length;
    uplatni(vlozZnacku(text, od, do_, druh));
  };

  const pridejOdkaz = (url, jmeno) => {
    const el = ref.current;
    // Kdo do pole ještě neklikl, má kurzor na nule — odkaz by skočil PŘED
    // celý dosavadní text (Richard 18. 8. 2026). Bez dotyku pole se přidává
    // na konec, což je to, co člověk čeká.
    const doteklSe = el && (el.selectionStart > 0 || el.selectionEnd > 0 || dotknutoRef.current);
    const od = doteklSe ? el.selectionStart : text.length;
    const do_ = doteklSe ? el.selectionEnd : text.length;
    uplatni(vlozOdkaz(text, od, do_, url, jmeno));
    setOdkazOpen(false);
    setAdresa('');
    setPopisek('');
  };

  const klavesa = (e) => {
    // Enter uvnitř seznamu pokračuje seznamem a čísluje dál; na prázdné
    // položce seznam ukončí. Bez toho se muselo tlačítko mačkat na každém
    // řádku znovu a všechny položky zůstaly „1." (Richard 18. 8. 2026).
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const el = ref.current;
      if (el && el.selectionStart === el.selectionEnd) {
        const dalsi = pokracujSeznam(text, el.selectionStart);
        if (dalsi) { e.preventDefault(); uplatni(dalsi); return; }
      }
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); znacka('tucne'); }
    if (k === 'i') { e.preventDefault(); znacka('kurziva'); }
  };

  const odkazovePrilohy = prilohy.filter((f) => f.url);

  // dokud nejsou texty lišty v paměti, ukáže se samotné pole (pár kB, jeden frame).
  // Lišta s klíči místo popisků by vypadala jako vada.
  if (!nsReady) {
    return (
      <Textarea
        ref={ref}
        id={id}
        value={text}
        onChange={(e) => { pisuSam.current = true; onChange(e.target.value); }}
        placeholder={placeholder}
        rows={rows}
      />
    );
  }

  const Tlacitko = ({ ikona: Ikona, druh, popis }) => (
    <button
      type="button"
      onClick={() => znacka(druh)}
      title={popis}
      className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
    >
      <Ikona className="w-3.5 h-3.5" />
    </button>
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-0.5 flex-wrap border rounded-md px-1 py-0.5 bg-muted/30">
        {/* v zamčeném stavu by tlačítka jen svítila a nic nedělala */}
        {!nahled && <>
        <Tlacitko ikona={Bold} druh="tucne" popis={`${t('popis.tucne')} (Ctrl+B)`} />
        <Tlacitko ikona={Italic} druh="kurziva" popis={`${t('popis.kurziva')} (Ctrl+I)`} />
        <Tlacitko ikona={Strikethrough} druh="skrtnute" popis={t('popis.skrtnute')} />
        <span className="w-px h-4 bg-border mx-0.5" />
        <Tlacitko ikona={Heading1} druh="nadpis1" popis={t('popis.nadpis1')} />
        <Tlacitko ikona={Heading2} druh="nadpis2" popis={t('popis.nadpis2')} />
        <span className="w-px h-4 bg-border mx-0.5" />
        <Tlacitko ikona={List} druh="odrazka" popis={t('popis.odrazka')} />
        <Tlacitko ikona={ListOrdered} druh="cislovana" popis={t('popis.cislovana')} />
        <span className="w-px h-4 bg-border mx-0.5" />

        {/* odkaz — nahoře přílohy uzlu, dole vlastní adresa */}
        <Popover open={odkazOpen} onOpenChange={setOdkazOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              title={t('popis.odkaz')}
              data-popis-odkaz
              className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <Link2 className="w-3.5 h-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-2 space-y-2">
            {odkazovePrilohy.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] font-medium text-muted-foreground">{t('popis.zPriloh')}</p>
                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {odkazovePrilohy.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => pridejOdkaz(f.url, f.name || '')}
                      className="w-full flex items-center gap-1.5 text-left text-xs px-1.5 py-1 rounded hover:bg-secondary"
                      title={f.url}
                    >
                      <Paperclip className="w-3 h-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate">{f.name || f.url}</span>
                      {linkKind(f.url) && (
                        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{linkKind(f.url)}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium text-muted-foreground">{t('popis.vlastniOdkaz')}</p>
              <Input
                value={adresa}
                onChange={(e) => setAdresa(e.target.value)}
                placeholder="https://"
                className="h-8 text-sm"
                data-popis-odkaz-url
              />
              <Input
                value={popisek}
                onChange={(e) => setPopisek(e.target.value)}
                placeholder={t('popis.popisekPlaceholder')}
                className="h-8 text-sm"
                data-popis-odkaz-popisek
                onKeyDown={(e) => { if (e.key === 'Enter' && adresa.trim()) { e.preventDefault(); pridejOdkaz(adresa.trim(), popisek.trim()); } }}
              />
              <button
                type="button"
                disabled={!adresa.trim()}
                onClick={() => pridejOdkaz(adresa.trim(), popisek.trim())}
                className="w-full text-xs px-2 py-1.5 rounded-md border hover:bg-secondary disabled:opacity-40"
              >
                {t('popis.vlozit')}
              </button>
            </div>
          </PopoverContent>
        </Popover>

        </>}
        {/* Dvojice, ne přepínač: jedno tlačítko ukazovalo, co se STANE po kliknutí
            („Náhled" při psaní), a člověk to četl jako „jsem v náhledu" —
            Richard 18. 8. 2026: „tam je náhled a psát, to mě zmátlo." Teď je
            vidět, kde právě je: aktivní půlka je zvýrazněná. */}
        {(text || nahled) && (
          <div className="ml-auto inline-flex items-center rounded-md border bg-background p-0.5" role="group">
            <button
              type="button"
              onClick={() => setNahled(false)}
              aria-pressed={!nahled}
              data-popis-psat
              className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition-colors ${
                !nahled ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Pencil className="w-3 h-3" />
              {t('popis.psat')}
            </button>
            <button
              type="button"
              onClick={() => setNahled(true)}
              aria-pressed={nahled}
              data-popis-nahled
              className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition-colors ${
                nahled ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Eye className="w-3 h-3" />
              {t('popis.nahled')}
            </button>
          </div>
        )}
      </div>

      {nahled ? (
        <div
          data-popis-nahled-obsah
          className="min-h-[6rem] rounded-md border bg-background px-3 py-2 text-sm"
        >
          <FormatovanyPopis text={text} />
        </div>
      ) : (
        <Textarea
          ref={ref}
          id={id}
          value={text}
          onChange={(e) => { pisuSam.current = true; onChange(e.target.value); }}
          onKeyDown={klavesa}
          onSelect={() => { dotknutoRef.current = true; }}
          placeholder={placeholder}
          rows={rows}
        />
      )}
    </div>
  );
}
