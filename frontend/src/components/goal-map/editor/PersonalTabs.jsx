import { useTranslation } from 'react-i18next';
import { ulozKlic } from '@/lib/storageKeys';

// „Moje mapa": přepínač Moje / Zadal jsem v liště a pruh seskupení pod ní.
// Čistě prezentační: JSX přesunuto 1:1 z GoalMapEditor (F1-07).
export default function PersonalTabs({ personalMap, personalView, setPersonalView, navigate }) {
  const { t } = useTranslation('editor');
  return (
    <>
          {/* „Moje mapa": přepínač pohledu patří do lišty (na místo „+", které tu
              read-only mapa nemá) — plátno zůstává celé mapě */}
          {personalMap && (
            <div className="flex rounded-lg border overflow-hidden shrink-0">
              {[['mine', t('myday:myMap.tabMine')], ['delegated', t('myday:myMap.tabDelegated')]].map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    if (personalView === v) return;
                    setPersonalView(v);
                    navigate(v === 'delegated' ? '/my-map?view=delegated' : '/my-map', { replace: true });
                    // dofit dělá efekt přestavby (recenter tady by fitnul starý obsah)
                  }}
                  aria-pressed={personalView === v}
                  className={`h-9 px-3 text-xs sm:text-sm font-medium transition-colors ${
                    personalView === v ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
    </>
  );
}

export function DelegatedGroupingBar({ personalMap, personalView, delegatedGrouping, setDelegatedGrouping }) {
  const { t } = useTranslation('editor');
  return (
    <>
      {/* „Zadal jsem": pruh seskupení V TOKU stránky (ne plovoucí přes plátno) —
          fitView o překryvu nevěděl a strom se schovával pod panel */}
      {personalMap && personalView === 'delegated' && (
        <div className="flex justify-center border-b bg-card py-1.5 shrink-0">
          <div className="flex rounded-lg border overflow-hidden">
            {[['flat', t('myday:myMap.groupFlat')], ['people', t('myday:myMap.groupPeople')], ['projects', t('myday:myMap.groupProjects')]].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setDelegatedGrouping(key);
                  ulozKlic('kb-delegated-grouping', key);
                  // dofit dělá efekt přestavby (recenter tady by fitnul starý obsah)
                }}
                className={`px-3 py-1 text-xs font-medium transition-colors ${delegatedGrouping === key ? 'bg-secondary text-foreground' : 'bg-background hover:bg-secondary/60 text-muted-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
