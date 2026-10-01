// AI blok pod Nočním plánováním (1. 10. 2026, fáze C plánu AI funkcí): balíčky asistenta, které si
// uživatel spustí sám — Roztřídit poznámky, Nový projekt s AI (převedený Poradce). Další porady
// (Po schůzce, Týdenní revize, Příprava na schůzku, Týmová porada) přibudou do seznamu POMOCNICI.
// Počítač: mřížka 2 sloupce. Telefon: sbalený řádek „AI pomocníci (N)“, rozbalení si pamatuje účet.
// Fáze D (1. 10. 2026): + Po schůzce, Týdenní revize. Fáze E: + Příprava na schůzku, Týmová porada (vedoucí).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, ChevronDown, ChevronUp, ClipboardList, ListTree, NotebookPen, Sparkles, Users } from 'lucide-react';
import { nactiKlic, ulozKlic, KEY_AI_BLOK } from '@/lib/storageKeys';

const POMOCNICI = [
  { id: 'trideni', mode: 'trideni', Ikona: ListTree, testid: 'chat-blok-trideni' },
  { id: 'novyProjekt', mode: 'novy_projekt', Ikona: Sparkles, testid: 'chat-blok-novy-projekt' },
  { id: 'poSchuzce', mode: 'po_schuzce', Ikona: NotebookPen, testid: 'chat-blok-po-schuzce' },
  { id: 'revize', mode: 'revize', Ikona: CalendarCheck, testid: 'chat-blok-revize' },
  { id: 'priprava', mode: 'priprava', Ikona: ClipboardList, testid: 'chat-blok-priprava' },
  // jen správce a vedoucí (server roli hlídá sám — tlačítko je jen nabídka)
  { id: 'tym', mode: 'tymova_porada', Ikona: Users, testid: 'chat-blok-tym', vedouci: true },
];

export default function AiBlok({ mobil, userId, vedouci, disabled, onSpust }) {
  const { t } = useTranslation('asistent');
  const klic = `${KEY_AI_BLOK}:${userId || ''}`;
  const [rozbaleno, setRozbaleno] = useState(() => nactiKlic(klic) === '1');
  const prepni = () => setRozbaleno((r) => { ulozKlic(klic, r ? '0' : '1'); return !r; });
  const ukazat = !mobil || rozbaleno;
  const polozky = POMOCNICI.filter((p) => !p.vedouci || vedouci);
  return (
    <div className="rounded-lg border bg-background/70 p-3 text-sm" data-testid="chat-ai-blok">
      {mobil ? (
        <button type="button" onClick={prepni} aria-expanded={rozbaleno} className="w-full inline-flex items-center gap-1.5 font-medium text-left" data-testid="chat-ai-blok-rozbalit">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="flex-1">{t('aiBlok.title')} ({polozky.length})</span>
          {rozbaleno ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
      ) : (
        <p className="inline-flex items-center gap-1.5 font-medium"><Sparkles className="w-4 h-4 text-primary" />{t('aiBlok.title')}</p>
      )}
      {ukazat && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {polozky.map(({ id, mode, Ikona, testid }) => (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => onSpust(mode)}
              className="min-w-0 text-left rounded-md border bg-card p-2 hover:bg-secondary disabled:opacity-50 flex items-start gap-2"
              data-testid={testid}
            >
              <Ikona className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span className="min-w-0">
                <span className="block text-xs font-medium leading-snug">{t(`aiBlok.${id}`)}</span>
                <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">{t(`aiBlok.${id}Hint`)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
