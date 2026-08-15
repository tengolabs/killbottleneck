// Seznam práce v lite režimu — „Dnes" a „Zadal jsem" jsou tentýž seznam,
// jen jiné sekce ze serverového přehledu (pb_hooks/helpers.js:buildMyDay).
//
// Řádek umí právě to, co se dělá každý den: hotovo / odložit / připnout.
// Nic se tu nenastavuje a na detail se neproklikává — od toho je plná verze.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Calendar, CheckSquare, Target, Lightbulb, Send, TriangleAlert, Flame, CalendarClock, Clock, Pause, Inbox, Sunrise, CalendarCheck, CalendarDays, CheckCircle2, ChevronUp, ChevronDown } from 'lucide-react';
import TaskRowActions from '@/components/shared/TaskRowActions';
import { getDeadlineStatus, formatDeadline } from '@/lib/nodeMeta';
import { planState } from '@/lib/taskActions';
import { intlLocale } from '@/lib/locale';
import { focusStateOf, sortFocusFirst } from '@/lib/focus';
import { useAuth } from '@/lib/AuthContext';

const SECTIONS = {
  today: [
    { key: 'overdue', label: 'today.overdue', icon: Flame, cls: 'text-red-600 dark:text-red-400' },
    { key: 'today', label: 'today.dueToday', icon: CalendarClock, cls: 'text-amber-600 dark:text-amber-400' },
    // „Zítra" přibylo s plánováním — co si naplánuju na zítra, musím zítra vidět
    { key: 'tomorrow', label: 'today.tomorrow', icon: Sunrise, cls: 'text-sky-600 dark:text-sky-400' },
    { key: 'week', label: 'today.week', icon: Clock, cls: 'text-blue-600 dark:text-blue-400' },
    { key: 'blocking', label: 'today.blocking', icon: TriangleAlert, cls: 'text-orange-600 dark:text-orange-400' },
    // A4: nástroj sám přizná, kde neodpovídá realitě — až úplně dole, ať netlačí
    { key: 'stuck', label: 'today.stuck', icon: Pause, cls: 'text-muted-foreground' },
    // Dvě různé věci, proto dvě sekce (Richard 27. 7. 2026 — v jedné „Ostatní"
    // se při jedenácti položkách nedalo vyznat): co má termín dál než týden,
    // a co termín nemá vůbec. V plné verzi je obojí na stránce Úkoly; tady jiná
    // stránka NENÍ, takže bez nich by práce bez termínu prostě zmizela — a to je
    // ta ztráta důvěry, kvůli které lidi úkolníky přestanou aktualizovat.
    { key: 'later', label: 'today.later', icon: CalendarDays, cls: 'text-muted-foreground' },
    { key: 'noDate', label: 'today.noDate', icon: Inbox, cls: 'text-muted-foreground' },
  ],
  delegated: [
    { key: 'delegated', label: 'delegated.title', icon: Send, cls: 'text-violet-600 dark:text-violet-400' },
  ],
};

const ICON = { node: Target, idea: Lightbulb, delegated: Send };

// Na telefonu se celý e-mail nevejde a ořízne se doprostřed domény
// („jan.novak@example.c…"), takže z něj stejně nic nepoznáš. Část před zavináčem
// člověka identifikuje líp a je třikrát kratší; celý e-mail zůstává v title.
const shortEmail = (email) => String(email || '').split('@')[0] || email;

function Row({ item, onChanged, onFailed }) {
  const { t } = useTranslation('lite');
  const navigate = useNavigate();
  const { t: tc } = useTranslation('common');
  const { user } = useAuth();
  const focusState = focusStateOf(user, item);
  const Icon = ICON[item.kind] || CheckSquare;
  const st = getDeadlineStatus(item.deadline, item.status);
  const deadlineCls = st === 'overdue'
    ? 'text-red-600 dark:text-red-400'
    : st === 'upcoming' ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground';
  // Nejdůležitější úkol dne musí být na telefonu vidět NA PRVNÍ POHLED
  // (Richard 31. 7.: „v lite by to mohlo být vidět více") — celý řádek dostane
  // jantarový nádech + levý proužek, zítřek jemnější než dnešek.
  const focusCls = focusState === 'today'
    ? 'border-l-4 border-l-amber-500 bg-amber-500/10'
    : focusState === 'tomorrow' ? 'border-l-4 border-l-amber-400/60 bg-amber-500/5' : '';
  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-b last:border-b-0 ${focusCls}`}>
      <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-snug">{item.title}</p>
        {/* Řádek podrobností na TELEFONU. Ustupovat smí jen název projektu —
            všechno ostatní je krátké a nesmí se lámat (Richardovy snímky
            27. 7. 2026: datum se lámalo na „3." / „8." a dlouhý e-mail sežral
            celý řádek). Proto `min-w-0` jen u projektu a `shrink-0` u zbytku. */}
        <p className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
          {item.mapTitle && <span className="truncate min-w-0">{item.mapTitle}</span>}
          {item.deadline && (
            <span className={`inline-flex items-center gap-1 shrink-0 whitespace-nowrap ${deadlineCls}`}>
              <Calendar className="w-3 h-3" />{formatDeadline(item.deadline)}
            </span>
          )}
          {/* Plán jen IKONOU, bez textu: v sekci „Dnes" by „Naplánováno na dnes"
              opakovalo nadpis sekce a na mobilu zabralo dva řádky. Že je plán
              jinde než termín, je vidět z data vedle. */}
          {planState(item.planned) && (
            <CalendarCheck
              className="w-3 h-3 shrink-0 text-primary"
              aria-label={tc(`rowActions.planned.${planState(item.planned)}`)}
            />
          )}
          {item.assignee && (
            <span className="shrink-0 truncate max-w-[45%]" title={item.assignee_label || (item.external ? tc('nav:externalContacts.unknown') : item.assignee)}>
              {t('delegated.assignee', {
                // externí kontakt jménem (server posílá assignee_label), nikdy pseudo-e-mailem
                email: item.assignee_label || (item.external ? tc('nav:externalContacts.unknown') : shortEmail(item.assignee)),
              })}
            </span>
          )}
          {item.kind === 'idea' && <span className="shrink-0">{t('today.idea')}</span>}
        </p>
        {/* Fokus na VLASTNÍM třetím řádku — v meta řádku se tloukl s projektem
            a datem a hvězda byla dvakrát (Richardův screenshot 31. 7.). */}
        {focusState && (
          <p
            data-focus-badge={focusState}
            className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 mt-0.5"
          >
            ★ {t(`focusBadge.${focusState}`)}
          </p>
        )}
      </div>
      {/* na dotyku žádný hover — akce jsou vidět pořád, jinak pro mobil neexistují */}
      <TaskRowActions item={item} onDone={onChanged} onError={onFailed} />
    </div>
  );
}

export default function LiteList({ kind, day, failed, onReload, onChanged, onFailed }) {
  const { t, i18n } = useTranslation('lite');
  // Hotová práce se ze seznamu schovává schválně — ale úplně zmizet nesmí.
  // Richard 27. 7. 2026: „ať si v hlavě potvrdím, že to mám a někde to nevisí,
  // například důležitý úkol pro šéfa." Sbalené, ať to nezabírá místo.
  const [doneOpen, setDoneOpen] = useState(false);
  const { user: liteUser } = useAuth();
  const groups = (SECTIONS[kind] || [])
    // nejdůležitější úkol dne plave na začátek své sekce
    .map((s) => ({ ...s, items: sortFocusFirst(day?.sections?.[s.key] || [], liteUser) }))
    .filter((s) => s.items.length > 0);
  const empty = groups.length === 0;

  return (
    <div className="max-w-xl mx-auto">
      <header className="px-4 pt-5 pb-3">
        {/* Značka i v lite režimu — doteď tu nebyla vůbec (Richard 6. 8. 2026:
            „v lite není logo vůbec a to je taky škoda"). Světlá a tmavá verze,
            kolečko s hadem má natvrdo tmavé pozadí a ve světlém režimu by
            působilo jako flek. */}
        {/* Logo = zkratka domů i v lite (Richard 7. 8. 2026). Zůstává v lite
            režimu (na /lite = dnešní seznam), neopouští ho. */}
        <button
          type="button"
          onClick={() => navigate('/lite')}
          title={t('homeLink')}
          aria-label={t('homeLink')}
          className="flex items-center gap-2 mb-1.5 rounded-md outline-none hover:opacity-80 transition-opacity focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex items-center" aria-hidden="true">
            <img src="/znak-tmavy.webp" alt="" width="525" height="320"
                 className="hidden dark:block h-6 w-auto" />
            <img src="/znak-svetly.webp" alt="" width="493" height="320"
                 className="dark:hidden h-6 w-auto" />
          </span>
        </button>
        <h1 className="font-heading text-xl font-bold">{t(kind === 'today' ? 'today.title' : 'delegated.title')}</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          {new Date().toLocaleDateString(intlLocale(i18n.language), { weekday: 'long', day: 'numeric', month: 'long' })}
          {kind === 'today' && day?.counts ? ` · ${t('today.doneToday', { count: day.counts.done })}` : ''}
        </p>
      </header>

      {/* Tiché selhání by lhalo: prázdný seznam vypadá jako „nemám co dělat". */}
      {failed && (
        <div className="mx-4 mb-3 rounded-lg bg-destructive/10 text-destructive px-3 py-2 flex items-center gap-2 text-sm">
          <span className="flex-1">{t('loadFailed')}</span>
          <button onClick={onReload} className="font-medium underline">{t('retry')}</button>
        </div>
      )}

      {/* Zkrácený přehled se PŘIZNÁ. Neúplný seznam, který se tváří jako úplný,
          je horší než žádný — člověk se na něj spolehne. */}
      {day?.truncated && (
        <div className="mx-4 mb-3 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 px-3 py-2 text-sm">
          {t('truncated')}
        </div>
      )}

      {empty && !failed && day && (
        <div className="px-4 py-16 text-center">
          <p className="text-base">{t(kind === 'today' ? 'today.empty' : 'delegated.empty')}</p>
          <p className="text-sm text-muted-foreground mt-1">{t(kind === 'today' ? 'today.emptyHint' : 'delegated.emptyHint')}</p>
        </div>
      )}

      {kind === 'today' && (day?.sections?.doneToday || []).length > 0 && (
        <section className="mb-4">
          <button
            onClick={() => setDoneOpen((o) => !o)}
            className="w-full flex items-center gap-1.5 px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-green-600 dark:text-green-400"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {t('today.doneList')} ({day.sections.doneToday.length})
            {doneOpen ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
          </button>
          {doneOpen && (
            <div className="bg-card border-y">
              {day.sections.doneToday.map((item) => (
                <div key={`done-${item.kind}-${item.id}`} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-green-600 dark:text-green-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] leading-snug line-through opacity-70">{item.title}</p>
                    {item.mapTitle && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{item.mapTitle}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {groups.map((g) => (
        <section key={g.key} className="mb-4">
          <p className={`flex items-center gap-1.5 px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wide ${g.cls}`}>
            <g.icon className="w-3.5 h-3.5" /> {t(g.label)} ({g.items.length})
          </p>
          <div className="bg-card border-y">
            {g.items.map((item) => (
              <Row key={`${item.kind}-${item.id}`} item={item} onChanged={onChanged || onReload} onFailed={onFailed} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
