import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Tlačítko horní lišty s rozbalovací nabídkou — Zarovnat, Uspořádat i Čitelnost
// (Richard 1. 10. 2026: „mění pořád velikost a když klikám na stejné místo,
// pohnou se mi tlačítka… předělal bych vše jako uspořádat"). Popisek je PEVNÝ
// („Zarovnat ▾"), aktuální hodnotu ukazuje jen ikona, zaškrtnutá položka
// a tooltip — šířka tlačítka se volbou nikdy nemění, lišta neposkakuje.
// Kreslí se dvakrát jako ostatní stavová tlačítka: `siroka` = lišta ≥1850 px
// s popiskem, jinak ikonové h-9 w-9.
//
// polozky: [{ value, label, hint, Icon, data }] — `data` jsou data-* atributy
// položky (selektory testů). Výběr volá onVyber(value) i pro hodnotu, která
// už platí (Radix onSelect, ne onValueChange) — styl „do šířky" vybraný
// znovu tak mapu znovu srovná.
//
// Klik MIMO otevřenou nabídku ji má jen zavřít. Uzly React Flow mají
// `pointer-events: all`, takže zámek kliků od Radixu na ně neplatí a klik na
// „Přidat podcíl" nabídku zavřel A ZÁROVEŇ založil cíl (/checkup 2. 10. 2026).
// Otevřená nabídka si proto pod sebe dává průhlednou clonu přes celé okno.
export default function NabidkaListy({
  siroka, Ikona, popisek, title, nadpis, hodnota, polozky, onVyber,
  doplnek, variant = 'outline', tridy = '', triggerProps = {},
}) {
  const [otevreno, setOtevreno] = useState(false);
  return (
    <DropdownMenu open={otevreno} onOpenChange={setOtevreno}>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={siroka ? 'sm' : 'icon'}
          className={(siroka ? 'hidden min-[1850px]:inline-flex gap-1.5' : 'min-[1850px]:hidden h-9 w-9 shrink-0') + (tridy ? ` ${tridy}` : '')}
          title={title}
          aria-label={siroka ? undefined : popisek}
          {...triggerProps}
        >
          <Ikona className="w-4 h-4" />
          {siroka && (
            <>
              <span>{popisek}</span>
              <ChevronDown className="w-3.5 h-3.5 opacity-60" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      {otevreno && createPortal(<div className="fixed inset-0 z-40 pointer-events-auto" data-testid="nabidka-clona" aria-hidden="true" />, document.body)}
      {/* výška podle místa pod tlačítkem — na telefonu naležato by položka zámku
          skončila pod okrajem okna bez možnosti rolovat */}
      <DropdownMenuContent align="end" className="w-64 max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto">
        {nadpis && <DropdownMenuLabel>{nadpis}</DropdownMenuLabel>}
        <DropdownMenuRadioGroup value={hodnota}>
          {polozky.map(({ value, label, hint, Icon, data = {} }) => (
            <DropdownMenuRadioItem key={value} value={value} onSelect={() => onVyber(value)} className="items-start" {...data}>
              <Icon className="w-4 h-4 mr-2 mt-0.5 shrink-0 text-muted-foreground" />
              <span className="flex flex-col">
                <span>{label}</span>
                {hint && <span className="text-[11px] leading-tight text-muted-foreground">{hint}</span>}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {doplnek && (
          <>
            <DropdownMenuSeparator />
            {doplnek}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
