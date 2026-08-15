import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, Sparkles, Loader2, ChevronDown, Upload } from 'lucide-react';
import { useState } from 'react';
import ImportMapDialog from '@/components/shared/ImportMapDialog';

// Jediný zdroj pravdy pro akce v hlavičce (Nový projekt + AI založení mapy).
// Stejné popisky, ikony i responsivní chování na všech kartách (Projekty/Úkoly/Šablony).
// Openery a stav dodává hook useMapCreation; sem se předá už hotové.
// Obě AI cesty (Z cíle / Z textu) žijí jako záložky UVNITŘ sjednoceného
// AiCreateDialog — tady je jedno tlačítko „S pomocí AI" (a stejná položka
// v mobilní nabídce, protože samostatné tlačítko je pod md schované).
export default function NewMapActions({ onCreate, onAi, ai, creating }) {
  const { t } = useTranslation(['home', 'editor']);
  // import je vždy k dispozici (nezávisí na AI) — vlastní nabídka vedle „Nový projekt"
  const [importOpen, setImportOpen] = useState(false);
  const aiAvailable = ai.has('generate') || ai.has('from_text');
  return (
    <>
      {/* Dělené tlačítko (Richard 31. 7.: „tyhle 2 tlačítka bych sloučil"):
          hlavní plocha zakládá projekt na JEDEN klik (anti-bloat — nejčastější
          akce nesmí zdražet), šipka otevře nabídku s importem. Bonus: import
          je teď dostupný i na mobilu (dřív hidden md:inline-flex). */}
      <div className="inline-flex">
        <Button onClick={onCreate} disabled={creating} className="rounded-r-none">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          <span className="hidden sm:inline">{t('newMap.newProject')}</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              disabled={creating}
              className="rounded-l-none border-l border-primary-foreground/25 px-2"
              aria-label={t('newMap.moreOptions')}
            >
              <ChevronDown className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* AI i v této nabídce: na mobilu (<md) je samostatné AI tlačítko
                schované a tohle je jediná cesta k němu (Richardův nález 7. 8.) */}
            {aiAvailable && (
              <DropdownMenuItem onClick={() => onAi()}>
                <Sparkles className="w-4 h-4 mr-2" /> {t('newMap.withAi')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4 mr-2" /> {t('editor:importMap.button')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ImportMapDialog open={importOpen} onClose={() => setImportOpen(false)} />
      {/* AI je zapnutá, ale právě neodpovídá (u hostované verze běží u poskytovatele).
          Tlačítko schováme jako všude jinde, ale TADY ho uživatel hledá — proto
          místo tichého zmizení zůstane zašedlé s vysvětlením, ať nemá pocit,
          že se funkce ztratila. */}
      {ai.configured && !ai.healthy && (
        <Button variant="outline" disabled className="hidden md:inline-flex" title={t('newMap.aiUnavailableHint')}>
          <Sparkles className="w-4 h-4 opacity-60" />
          {t('newMap.aiUnavailable')}
        </Button>
      )}
      {aiAvailable && (
        <Button variant="outline" onClick={() => onAi()} disabled={creating} className="hidden md:inline-flex">
          <Sparkles className="w-4 h-4" />
          {t('newMap.withAi')}
        </Button>
      )}
    </>
  );
}
