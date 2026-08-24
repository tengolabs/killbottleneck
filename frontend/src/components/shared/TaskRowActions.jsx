// Řádková lišta akcí — hotovo a „kdy to chci řešit" přímo z řádku, bez dialogu.
//
// ⚠️ PLÁNOVÁNÍ NENÍ ZMĚNA TERMÍNU. Dřív tu byla dvě tlačítka: „odložit"
// (přepisovalo termín) a „připnout na dnešek". Richard to 27. 7. 2026 vyzkoušel
// naostro a měl pravdu, že je to špatně: „termín je termín a měl by se měnit
// vědomě dotykem na datum a kalendářem". Posun na zítra tichým kliknutím
// v seznamu přepisoval dohodu s někým jiným.
// Zůstala tedy JEDNA nabídka (dnes / zítra / příští týden / zrušit plán), která
// termínu nesahá. Termín se mění výhradně v detailu úkolu.
//
// Záměrně BEZ shadcn/Radix (žádný DropdownMenu): tuhle lištu používá i
// zjednodušený (lite) režim, který nesmí stáhnout Radix balíčky.
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CalendarClock, CalendarCheck, Star } from 'lucide-react';
import { availableActions, markDone, setStatus, plan, unplan, planState, toTarget } from '@/lib/taskActions';
import { focusStateOf, setFocus, clearFocusOf, restoreFocus } from '@/lib/focus';
import { useAuth } from '@/lib/AuthContext';

const BTN = 'inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground ' +
  'hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:pointer-events-none transition-colors';

const WHEN = ['today', 'tomorrow', 'nextWeek'];

// only: zúžení nabídky pro pohledy, kde už některou akci obsluhuje něco jiného
// (v tabulce úkolů cykluje stav klik na štítek stavu — druhé „hotovo" vedle něj
// by bylo zdvojení bez užitku, což zakazuje anti-bloat pravidlo).
export default function TaskRowActions({ item, onDone, onError, className = '', only = null }) {
  const { t } = useTranslation('common');
  const { user, patchUser } = useAuth();
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const wrapRef = useRef(null);

  // klik mimo / Esc zavře rozbalovátka (bez knihovny)
  useEffect(() => {
    if (!open && !focusOpen) return;
    const closeAll = () => { setOpen(false); setFocusOpen(false); };
    const close = (e) => { if (!wrapRef.current?.contains(e.target)) closeAll(); };
    const esc = (e) => { if (e.key === 'Escape') closeAll(); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open, focusOpen]);

  const actions = only ? availableActions(item).filter((a) => only.includes(a)) : availableActions(item);
  if (actions.length === 0) return null;

  const target = toTarget(item);
  // `planned` = datum plánu; volající ho bere z planned_on / node.data.plannedOn
  const state = planState(item.planned);

  // `undo` = jak akci vrátit. Předává se ven do hlášky, aby šlo omyl opravit
  // JEDNÍM klikem. Richard 27. 7. 2026: „klikl jsem omylem na hotovo a zmizel
  // mi úkol a nevím kam." Potvrzení předem by omylu předešlo taky, ale zdražilo
  // by KAŽDÉ odbavení — a ubírat kliknutí je celý smysl řádkových akcí.
  const run = async (key, fn, note, undo) => {
    if (busy) return;
    setBusy(key);
    try {
      const res = await fn();
      setOpen(false);
      onDone?.(res, note, undo);
    } catch (e) {
      onError?.(e);
    } finally {
      setBusy('');
    }
  };

  // stopPropagation: řádek pod lištou otevírá detail — akce ho otevřít nesmí
  const stop = (e) => { e.stopPropagation(); e.preventDefault(); };

  return (
    <span
      ref={wrapRef}
      onClick={stop}
      className={`relative inline-flex items-center gap-0.5 shrink-0 ${className}`}
    >
      {actions.includes('done') && (
        <button
          type="button"
          className={BTN}
          disabled={!!busy}
          title={t('rowActions.done')}
          aria-label={t('rowActions.done')}
          onClick={(e) => {
            stop(e);
            const back = item.status || 'todo'; // stav PŘED odbavením, ať se vrátí přesně
            run('done', () => markDone(target), t('rowActions.doneNote'), () => setStatus(target, back));
          }}
        >
          <Check className="w-4 h-4" />
        </button>
      )}

      {/* NEJDŮLEŽITĚJŠÍ úkol dne — jeden na dnes, jeden na zítra (Richard
          31. 7. 2026). Není to priorita (ta je zamítnutá) — je to denní volba,
          vyprší sama. Označení jiného řádku to předchozí tiše nahradí. */}
      {actions.includes('done') && user && (
        <>
          <button
            type="button"
            data-focus-btn
            className={`${BTN} ${focusStateOf(user, item) ? 'text-amber-500' : ''}`}
            disabled={!!busy}
            title={t('rowActions.focus')}
            aria-label={t('rowActions.focus')}
            aria-expanded={focusOpen}
            onClick={(e) => { stop(e); setFocusOpen((o) => !o); setOpen(false); }}
          >
            <Star className="w-4 h-4" fill={focusStateOf(user, item) ? 'currentColor' : 'none'} />
          </button>
          {focusOpen && (
            <span className="absolute right-0 top-8 z-30 flex flex-col min-w-[200px] rounded-lg border bg-popover shadow-md py-1">
              <span className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('rowActions.focusHeading')}
              </span>
              {['today', 'tomorrow'].map((w) => (
                <button
                  key={w}
                  type="button"
                  data-focus-when={w}
                  className={`px-3 py-1.5 text-left text-sm hover:bg-secondary ${focusStateOf(user, item) === w ? 'text-amber-600 font-medium' : ''}`}
                  onClick={(e) => {
                    stop(e);
                    setFocusOpen(false);
                    // prev PŘED akcí — vrácení jedním klikem obnoví celý stav fokusu
                    const prevFocus = user?.focus && typeof user.focus === 'object' ? { ...user.focus } : {};
                    run('focus', () => setFocus(user, patchUser, w, item),
                      t(`rowActions.focusNote.${w}`), () => restoreFocus(user, patchUser, prevFocus));
                  }}
                >
                  {t(`rowActions.when.${w}`)}
                </button>
              ))}
              {focusStateOf(user, item) && (
                <button
                  type="button"
                  data-focus-clear
                  className="px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-secondary border-t mt-1 pt-2"
                  onClick={(e) => {
                    stop(e);
                    setFocusOpen(false);
                    // i zrušení má vrácení jedním klikem — stejný vzor jako označení dne
                    const prevFocus = user?.focus && typeof user.focus === 'object' ? { ...user.focus } : {};
                    run('focus', () => clearFocusOf(user, patchUser, item),
                      t('rowActions.focusCleared'), () => restoreFocus(user, patchUser, prevFocus));
                  }}
                >
                  {t('rowActions.focusClear')}
                </button>
              )}
            </span>
          )}
        </>
      )}

      {actions.includes('plan') && (
        <>
          <button
            type="button"
            className={`${BTN} ${state ? 'text-primary' : ''}`}
            disabled={!!busy}
            title={state ? t(`rowActions.planned.${state}`) : t('rowActions.plan')}
            aria-label={state ? t(`rowActions.planned.${state}`) : t('rowActions.plan')}
            aria-expanded={open}
            onClick={(e) => { stop(e); setOpen((o) => !o); setFocusOpen(false); }}
          >
            {state ? <CalendarCheck className="w-4 h-4" /> : <CalendarClock className="w-4 h-4" />}
          </button>
          {open && (
            <span className="absolute right-0 top-8 z-30 flex flex-col min-w-[200px] rounded-lg border bg-popover shadow-md py-1">
              {/* Nadpis a patička jsou tu schválně: bez nich si člověk myslí,
                  že mění termín — přesně to nedorozumění tuhle změnu vyvolalo. */}
              <span className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('rowActions.planHeading')}
              </span>
              {WHEN.map((w) => (
                <button
                  key={w}
                  type="button"
                  className="px-3 py-1.5 text-left text-sm hover:bg-secondary"
                  onClick={(e) => { stop(e); run('plan', () => plan(target, w), t(`rowActions.plannedNote.${w}`)); }}
                >
                  {t(`rowActions.when.${w}`)}
                </button>
              ))}
              {state && (
                <button
                  type="button"
                  className="px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-secondary border-t mt-1 pt-2"
                  onClick={(e) => { stop(e); run('plan', () => unplan(target), t('rowActions.unplannedNote')); }}
                >
                  {t('rowActions.unplan')}
                </button>
              )}
              <span className="px-3 pt-1.5 pb-0.5 text-[11px] leading-snug text-muted-foreground border-t mt-1">
                {t('rowActions.planKeepsDeadline')}
              </span>
            </span>
          )}
        </>
      )}
    </span>
  );
}
