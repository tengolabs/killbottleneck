import { useTranslation } from 'react-i18next';
import { Target } from 'lucide-react';
import { projectIcon, projectName, apexTitle } from '@/lib/projectColors';
import { fmtDateShort } from '@/lib/locale';

// Jedna karta projektu na titulní straně.
//
// ⚠️ ROZVRŽENÍ MÁ PRAVIDLO (Richard 27. 7. 2026): nahoře jen to, co INFORMUJE,
// dole jen to, co NĚCO DĚLÁ. Dřív stály vedle sebe štítky „sdíleno / veřejné"
// a tlačítka „sdílet / archivovat / smazat" — člověk pak míří na jedno
// a trefí druhé.
//
// Destruktivní akce (koš) je navíc odsazená úplně doprava, co nejdál od té
// nejčastější (Dashboard vlevo). Richard: „v jiné aplikaci se mi pořád stává,
// že kliknu na koš, když chci něco jiného."
export default function MapCard({ map, icon: Icon, iconWrapClass = 'bg-primary/10', iconClass = 'text-primary', badges, meta, onClick, actions }) {
  const { t } = useTranslation('home');
  const color = map.color || '';
  const emoji = projectIcon(map);
  const nazev = projectName(map) || t('misc.untitled');
  // Hlavní cíl (text vrcholového uzlu) pod názvem projektu — Richard 18. 8. 2026:
  // „uživatelé by chtěli vidět pod názvem projektu název hlavního uzlu."
  // Když se shoduje s názvem projektu (typicky projekt ze šablony), řádek se
  // NEUKAZUJE — dvakrát totéž pod sebou je šum, ne informace.
  const hlavniCil = apexTitle(map);
  const stejne = hlavniCil.toLocaleLowerCase() === nazev.toLocaleLowerCase();
  return (
    <div
      onClick={onClick}
      style={color ? { borderLeftColor: color, borderLeftWidth: 4 } : undefined}
      className="group relative cursor-pointer rounded-xl border bg-card p-5 hover:shadow-lg hover:border-primary/30 transition-all"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${iconWrapClass}`}
          style={color ? { backgroundColor: `${color}22` } : undefined}
        >
          {emoji
            ? <span className="text-xl leading-none">{emoji}</span>
            : <Icon className={`w-5 h-5 ${iconClass}`} style={color ? { color } : undefined} />}
        </div>
        {/* jen informace: kolik mám otevřené práce, komu je projekt vidět */}
        {badges}
      </div>
      <h3 className="font-heading font-semibold text-base mb-1 line-clamp-1">
        {nazev}
      </h3>
      {hlavniCil && !stejne && (
        /* `line-clamp` patří až na vnitřní <span> — na <p> ho přebije `flex`
           (Tailwind emituje display AŽ ZA lineClamp), takže by byl mrtvý. */
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground mb-1.5" title={hlavniCil}>
          <Target className="w-3.5 h-3.5 shrink-0 mt-px opacity-70" aria-hidden="true" />
          <span className="line-clamp-2">{hlavniCil}</span>
        </p>
      )}
      <p className="text-xs text-muted-foreground">{meta}</p>
      {map.updated_date && (
        <p className="text-xs text-muted-foreground/70 mt-2">
          {t('mapCard.edited', { date: fmtDateShort(map.updated_date) })}
        </p>
      )}
      {/* Akce jsou vidět VŽDY, ne až na najetí myší (Richard 27. 7. 2026).
          Na tabletu a telefonu hover neexistuje, takže by se k nim člověk
          nedostal vůbec — a i na počítači nemá jak tušit, že tam jsou.
          Schovaná akce = akce, která pro půlku uživatelů neexistuje. */}
      {actions && (
        <div className="mt-3 pt-3 border-t flex items-center gap-1">
          {actions}
        </div>
      )}
    </div>
  );
}
