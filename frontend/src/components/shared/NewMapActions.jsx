import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, ChevronDown, Upload } from 'lucide-react';
import { useState } from 'react';
import ImportMapDialog from '@/components/shared/ImportMapDialog';

// Jediný zdroj pravdy pro akce v hlavičce (Nový projekt + import).
// Stejné popisky, ikony i responsivní chování na všech kartách (Projekty/Úkoly/Šablony).
// Openery a stav dodává hook useMapCreation; sem se předá už hotové.
// Do 28. 9. 2026 tu bylo i tlačítko „S pomocí AI" (Poradce) — Richard: Poradce se už nezobrazuje,
// projekt s AI zakládá asistent v panelu (od 1. 10. 2026 i z odkazu v dialogu Nový projekt).
export default function NewMapActions({ onCreate }) {
  const { t } = useTranslation(['home', 'editor']);
  // import je vždy k dispozici (nezávisí na AI) — vlastní nabídka vedle „Nový projekt"
  const [importOpen, setImportOpen] = useState(false);
  return (
    <>
      {/* Dělené tlačítko (Richard 31. 7.: „tyhle 2 tlačítka bych sloučil"):
          hlavní plocha zakládá projekt na JEDEN klik (anti-bloat — nejčastější
          akce nesmí zdražet), šipka otevře nabídku s importem. Bonus: import
          je teď dostupný i na mobilu (dřív hidden md:inline-flex). */}
      <div className="inline-flex">
        <Button onClick={onCreate} className="rounded-r-none">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">{t('newMap.newProject')}</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="rounded-l-none border-l border-primary-foreground/25 px-2"
              aria-label={t('newMap.moreOptions')}
            >
              <ChevronDown className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* „S pomocí AI“ tu bylo do 28. 9. 2026 — Richard: Poradce se už nezobrazuje,
                projekt s AI zakládá asistent v panelu. */}
            <DropdownMenuItem onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4 mr-2" /> {t('editor:importMap.button')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ImportMapDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}
