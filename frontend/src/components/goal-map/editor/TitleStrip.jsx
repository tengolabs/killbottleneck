import { useTranslation } from 'react-i18next';

// Pruh s názvem projektu nad levou lištou ikon (text; klikem přejmenování).
// Čistě prezentační: JSX přesunuto 1:1 z GoalMapEditor (F1-07).
export default function TitleStrip({ dashboardOpen, railLeft, nazevEditace, canEdit, title, setTitle, setNazevEditace }) {
  const { t } = useTranslation('editor');
  return (
    <>
        {/* NÁZEV PROJEKTU — volný pruh nad levou lištou ikon (ta začíná na top-16).
            Vlastní řádek unese i dlouhý název, na který se v liště nedostávalo.
            Odsazení zleva kopíruje lištu ikon, ať název neschová vysunutý
            zásobník ani časovač. Nad dashboardem ne — ten si název píše sám. */}
        {!dashboardOpen && (
          <div
            style={{ left: railLeft + 8 }}
            className="absolute top-2 z-30 max-w-[min(80vw,60rem)]"
          >
            {/* ⚠️ V KLIDU JE TO TEXT, NE POLE. Široké průhledné `input` přes plátno
                vypadalo stejně, ale polykalo myš: v pruhu 960 × 38 px nešlo chytit
                uzel ani táhnout plátnem, a nic to neprozrazovalo (nález panelu
                /checkup 18. 8. 2026, změřeno — tažení nepohnulo plátnem vůbec).
                Tlačítko se smrskne na šířku textu, takže mrtvá zóna je přesně
                velikost názvu — a tam klik stejně patří, otevírá přejmenování. */}
            {nazevEditace && canEdit ? (
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => setNazevEditace(false)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
                aria-label={t('toolbar.titlePlaceholder')}
                placeholder={t('toolbar.titlePlaceholder')}
                className="w-[min(80vw,60rem)] max-w-full bg-card rounded-lg px-2 py-1 outline-none
                  font-heading text-lg sm:text-xl font-bold tracking-tight border border-input"
              />
            ) : (
              <button
                type="button"
                onClick={() => canEdit && setNazevEditace(true)}
                title={title}
                className={`block max-w-full truncate rounded-lg px-2 py-1 text-left
                  font-heading text-lg sm:text-xl font-bold tracking-tight
                  border border-transparent transition-colors
                  ${canEdit ? 'hover:bg-card/80 hover:border-border' : 'cursor-default'}`}
              >
                {title || t('toolbar.titlePlaceholder')}
              </button>
            )}
          </div>
        )}
    </>
  );
}
