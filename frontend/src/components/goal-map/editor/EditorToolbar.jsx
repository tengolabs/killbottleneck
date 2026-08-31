import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Plus, Loader2, Check, Download, Sparkles, Share2, Eye, Users, Undo2, MessageSquare, StickyNote, AlignCenter, CheckSquare, MoreVertical, LayoutGrid, Archive, ArchiveRestore, FileJson, StretchHorizontal, Shrink, Maximize, ALargeSmall, Type, Heading, Zap, Columns3 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import OrgLogo from '@/components/shared/OrgLogo';
import UserMenu from '@/components/shared/UserMenu';
import NotificationBell from '@/components/shared/NotificationBell';
import PersonalTabs from './PersonalTabs';

// ikonky orientace mapy: obdélník na výšku / na šířku
const IconPortrait = (props) => (
  <svg width="14" height="16" viewBox="0 0 14 16" fill="none" {...props}>
    <rect x="2.75" y="1.75" width="8.5" height="12.5" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);
const IconLandscape = (props) => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none" {...props}>
    <rect x="1.75" y="2.75" width="12.5" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

// Tři styly Zarovnat (cyklus jedním tlačítkem): klasika (do šířky) → kompakt
// (střídavá 2 patra) → sevřít (patra + těsnější sloty a kroky — karty blíž
// k sobě, mapa se vejde na stránku). Tři patra NEpomáhala: tidy tree je pakuje
// stejně široko jako dvě (změřeno layout-parity), úspora přišla až z rozestupů.
// ALIGN_STYLES/ALIGN_OPTS žijí v lib/alignStyles.js — sdílí je i zakládání
// nové mapy (templateConvert), aby nevznikala mapa v jiném stylu, než jaký
// nabízí tlačítko
// ikony stylů na tlačítku Zarovnat (vzhled tlačítka = indikátor, žádné toasty)
const ALIGN_ICONS = { classic: StretchHorizontal, compact: Shrink, bands: LayoutGrid };
// ikony stupňů na tlačítku Čitelnost — stejná logika jako u Zarovnat:
// tlačítko ukazuje stupeň, který PRÁVĚ platí, stisk přepne na další.
const CITELNOST_ICONS = { normal: ALargeSmall, large: Type, titleOnly: Heading };

// Horní lišta editoru: široká varianta (≥1850 px) i ⋮ menu pro užší displeje.
// Obě varianty jsou tu vedle sebe 1:1 tak, jak byly v GoalMapEditor (F1-07);
// sjednocení do jednoho seznamu akcí je samostatný nález F1-10.
// Čistě prezentační — vstupy jdou v pojmenovaných balících:
//   nav     … navigace + organizace (logo)
//   layout  … směr, zarovnání, čitelnost, kanban
//   access  … kdo je uživatel a co smí (canEdit, canShare, …)
//   state   … stav mapy pro lištu (ukládání, počty, otevřený chat, …)
//   actions … handlery tlačítek
export default function EditorToolbar({ nav, layout, access, state, actions }) {
  const { t } = useTranslation('editor');
  const { navigate, org } = nav;
  const {
    direction, setDirMode, recenterMap, kanbanAktivni, kanbanNsReady,
    alignStyle, alignLock, handleAlign, alignPressStart, alignPressEnd,
    citelnost, handleCitelnost,
  } = layout;
  const {
    user, canEdit, canShare, canWork, isPublicView, isDraft, isTemplatePreview,
    isMapOwner, personalMap, archived, activeMapId, ai,
  } = access;
  const {
    saveStatus, sharedCount, mapTaskCount, mapRules, chatOpen, exporting,
    visibleNodes, canUndo, personalView,
  } = state;
  const {
    setShareOpen, handleUndo, setRulesDefaults, setRulesOpen, setAdvisorOpen,
    setChatOpen, handleAddNote, setPersonalView, handleExport, handleExportJson,
    setSaveTplOpen, handleToggleArchive, handleAddGoal,
  } = actions;
  return (
      <header className="min-h-14 sm:h-14 border-b bg-card flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-2 gap-y-1.5 px-3 sm:px-4 py-1.5 sm:py-0 z-10 shrink-0">
        <div className="flex items-center gap-2 min-w-0 w-auto sm:flex-1">
          {/* Značka patří úplně doleva, před šipku zpět (Richard 6. 8.).
              U názvu projektu být nesmí — dvě loga vedle sebe by si konkurovala,
              proto tady stojí BUĎ logo firmy, NEBO naše, nikdy obojí.
              18. 8. 2026: přednost dostalo logo organizace (stejně jako
              v hlavičce plné verze) — kdo si ho nahraje, čeká ho všude.
              Na mobilu jen kolečko s hadem, jinak by v úzké liště nezbylo
              místo na název. */}
          {/* Logo = zkratka na úvod (klik odkudkoli vede na Home, Richard 7. 8. 2026).
              Obrázky zůstávají dekorativní, přístupnost nese button. */}
          <button
            type="button"
            onClick={() => navigate('/')}
            title={t('toolbar.homeLink')}
            aria-label={t('toolbar.homeLink')}
            className="flex items-center shrink-0 rounded-md outline-none hover:opacity-80 transition-opacity focus-visible:ring-2 focus-visible:ring-ring"
          >
            <OrgLogo org={org} compact />
          </button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              // zpět tam, odkud uživatel přišel (např. tabulka úkolů); bez historie na titulku
              if (window.history.state && window.history.state.idx > 0) navigate(-1);
              else navigate('/');
            }}
            className="shrink-0 h-11 w-11 sm:h-9 sm:w-9" // mobil: 44px dotyková plocha (u horní hrany se 36px špatně trefuje)
            title={t('toolbar.back')}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          {/* Název projektu se 18. 8. 2026 přestěhoval z lišty POD ni (Richard:
              „název mapy je málo viditelný a když je dlouhý, schová se").
              V liště se tísnil mezi ikonami a přebytek ořízl doprostřed slova. */}
        </div>
        <div className="flex items-center gap-1.5 sm:gap-3 w-full sm:w-auto justify-between sm:justify-end shrink-0">
          {/* Vyhledávání a filtr Moje úkoly se přestěhovaly do LEVÉ lišty pod
              zásobník a časovač (Richard 11. 8.: „vyhledávání dej ikonku pod
              zásobník a časovač… moje úkoly taky, je to jen filtr") — horní
              liště se ulevilo. */}
          {/* Rozložení mapy: na výšku (svisle) / na šířku (vodorovně) / auto dle displeje */}
          <div className="flex items-center rounded-md border border-input overflow-hidden shrink-0 divide-x divide-input" role="group" aria-label={t('toolbar.directionGroup')}>
            {/* Ikonka = orientace DISPLEJE: na výšku (portrét) → strom se větví do šířky
                (doprava); na šířku (landscape) → strom dolů. Předvybere se dle displeje;
                klik i vycentruje. (Auto tlačítko zbytečné — default je stejně dle zařízení.) */}
            {[
              ['horizontal', t('toolbar.directionPortrait'), <IconPortrait key="p" className="w-4 h-[18px]" />],
              ['vertical', t('toolbar.directionLandscape'), <IconLandscape key="l" className="w-[18px] h-4" />],
            ].map(([v, label, ic]) => (
              <button
                key={v}
                type="button"
                data-dir={v}
                onClick={() => { if (v === direction) recenterMap(); setDirMode(v); }}
                title={v === direction ? t('toolbar.directionCenter', { label }) : label}
                aria-pressed={direction === v}
                className={`h-9 min-w-[48px] px-3 flex items-center justify-center gap-1 text-xs font-medium transition-colors ${
                  direction === v ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground active:bg-muted'
                }`}
              >
                {ic}
                <span className="hidden md:inline">{label}</span>
              </button>
            ))}
          </div>
          {(canEdit || personalMap) && (() => {
            if (kanbanAktivni && kanbanNsReady) {
              return (
                <Button variant="outline" size="sm" className="hidden min-[1850px]:inline-flex opacity-80" disabled
                  title={t('rules:rules.toolbarKanbanTitle')} data-testid="toolbar-kanban-mode">
                  <Columns3 className="w-4 h-4" />
                  <span className="hidden sm:inline">{t('rules:rules.toolbarKanban')}</span>
                </Button>
              );
            }
            const AlignIcon = ALIGN_ICONS[alignStyle] || AlignCenter;
            return (
              <Button
                variant={alignLock ? 'default' : 'outline'}
                size="sm"
                className={`hidden min-[1850px]:inline-flex${alignLock ? ' ring-2 ring-primary/40 shadow-inner' : ''}`}
                onClick={handleAlign}
                onPointerDown={alignPressStart}
                onPointerUp={alignPressEnd}
                onPointerLeave={alignPressEnd}
                onPointerCancel={alignPressEnd}
                onContextMenu={(e) => e.preventDefault()}
                title={alignLock ? t('toolbar.alignLockedTitle', { styl: t(`toolbar.alignShort_${alignLock}`) }) : t('toolbar.alignTitle')}
                data-align-lock={alignLock || 'off'}
              >
                {/* Ikona zůstává VŽDY ikonou stylu — Richard 12. 8.: „ať je
                    ikonka pořád stejná, jen při zamčení změní barvu nebo je
                    jakoby zmáčknutá". Zámek jako vlastní ikona bral informaci
                    o tom, KTERÝ styl je zamčený. */}
                <AlignIcon className="w-4 h-4" />
                <span className="hidden sm:inline">{alignStyle ? `${t('toolbar.align')} · ${t(`toolbar.alignShort_${alignStyle}`)}` : t('toolbar.align')}</span>
              </Button>
            );
          })()}
          {/* Čitelnost je ZÁMĚRNĚ mimo `canEdit` — na rozdíl od Zarovnat nesahá
              na mapu, jen na sazbu písma. Kdo mapu jen prohlíží (veřejná,
              sdílená jen ke čtení), musí si ji taky umět zvětšit. */}
          {(() => {
            const CitIcon = CITELNOST_ICONS[citelnost] || ALargeSmall;
            return (
              <Button
                variant="outline"
                size="sm"
                data-citelnost={citelnost}
                className="hidden min-[1850px]:inline-flex"
                onClick={handleCitelnost}
                title={t('toolbar.readabilityTitle')}
              >
                <CitIcon className="w-4 h-4" /> <span className="hidden sm:inline">{`${t('toolbar.readability')} · ${t(`toolbar.readabilityShort_${citelnost}`)}`}</span>
              </Button>
            );
          })()}
          {/* kostička (fit) i na velké liště — hned vedle Zarovnat */}
          <Button variant="outline" size="sm" className="hidden min-[1850px]:inline-flex px-2" onClick={recenterMap} title={t('toolbar.fitViewTitle')}>
            <Maximize className="w-4 h-4" />
          </Button>
          {/* Dashboard se přestěhoval do levé lišty pod filtr Moje úkoly
              (Richard 11. 8.: „tlačítko dashboard doleva a dolů pod filtr") */}
          {user && activeMapId && !isPublicView && (
            <Button
              variant="outline"
              size="sm"
              className="hidden min-[1850px]:inline-flex"
              onClick={() => navigate(`/tasks?map=${activeMapId}`)}
              title={t('toolbar.tasksTitle')}
            >
              <CheckSquare className="w-4 h-4" />
              <span className="hidden sm:inline">{t('toolbar.tasks')}{mapTaskCount > 0 ? ` (${mapTaskCount})` : ''}</span>
            </Button>
          )}
          {saveStatus === 'saving' && (
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" /> {t('saveState.saving')}
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-green-600">
              <Check className="w-3 h-3" /> {t('saveState.saved')}
            </span>
          )}
          {sharedCount > 0 && (
            <button
              onClick={() => canShare && setShareOpen(true)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-secondary hover:bg-accent transition-colors"
              title={t('share.sharedWith', { count: sharedCount })}
            >
              <Users className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">{sharedCount}</span>
            </button>
          )}
          {!canEdit && (
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground px-2 py-1 rounded-md bg-secondary">
              <Eye className="w-3.5 h-3.5" /> {canWork ? t('share.workBadge') : t('share.readOnly')}
            </span>
          )}
          {canEdit && (
            <Button variant="outline" size="sm" className="hidden min-[1850px]:inline-flex" onClick={handleUndo} disabled={!canUndo} title={t('toolbar.undoTitle')}>
              <Undo2 className="w-4 h-4" /> {t('toolbar.undoShort')}
            </Button>
          )}
          {canShare && user && !isDraft && !isTemplatePreview && (
            <Button variant="outline" size="sm" className="hidden min-[1850px]:inline-flex" onClick={() => setShareOpen(true)}>
              <Share2 className="w-4 h-4" /> {t('toolbar.share')}
            </Button>
          )}
          {/* Automatizační pravidla mapy — jen editor; pod 1850 px žije v ⋮ menu
              (lišta je plná a její finální podoba je otevřené rozhodnutí) */}
          {canEdit && user && activeMapId && !isPublicView && !isTemplatePreview && (
            <Button variant="outline" size="sm" className="hidden min-[1850px]:inline-flex" onClick={() => { setRulesDefaults({}); setRulesOpen(true); }} data-testid="toolbar-rules">
              <Zap className="w-4 h-4" /> {t('toolbar.rules')}{mapRules.length > 0 ? ` (${mapRules.length})` : ''}
            </Button>
          )}
          {canEdit && ai.has('generate') && user && (
            <Button variant="outline" size="sm" className="hidden min-[1850px]:inline-flex" onClick={() => setAdvisorOpen(true)}>
              <Sparkles className="w-4 h-4" /> {t('toolbar.suggestAi')}
            </Button>
          )}
          {canEdit && ai.has('chat') && user && (
            <Button
              variant={chatOpen ? 'default' : 'outline'}
              size="sm"
              className="hidden min-[1850px]:inline-flex"
              onClick={() => setChatOpen((v) => !v)}
              title={t('toolbar.aiChat')}
            >
              <MessageSquare className="w-4 h-4" /> {t('toolbar.aiChat')}
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" size="sm" className="hidden min-[1850px]:inline-flex" onClick={handleAddNote} title={t('toolbar.addNoteTitle')}>
              <StickyNote className="w-4 h-4" /> {t('toolbar.note')}
            </Button>
          )}
          {/* Zarovnat i na malých obrazovkách (Richard 11. 8.: „na mobilu chci
              nahoře tlačítko zarovnat… blíže k přepínání zobrazení") — ikonové,
              ikona = aktuální styl; „+" je naopak vpravo u zvonečku.
              Velká lišta (≥1850) má plné tlačítko s názvem stylu. */}
          {(canEdit || personalMap) && (() => {
            if (kanbanAktivni && kanbanNsReady) {
              return (
                <Button variant="outline" size="icon" className="min-[1850px]:hidden h-9 w-9 shrink-0 opacity-80" disabled
                  title={t('rules:rules.toolbarKanbanTitle')} data-testid="toolbar-kanban-mode-narrow">
                  <Columns3 className="w-4 h-4" />
                </Button>
              );
            }
            const AlignIcon = ALIGN_ICONS[alignStyle] || AlignCenter;
            return (
              <Button
                variant={alignLock ? 'default' : 'outline'}
                size="icon"
                className={`min-[1850px]:hidden h-9 w-9 shrink-0${alignLock ? ' ring-2 ring-primary/40 shadow-inner' : ''}`}
                onClick={handleAlign}
                onPointerDown={alignPressStart}
                onPointerUp={alignPressEnd}
                onPointerLeave={alignPressEnd}
                onPointerCancel={alignPressEnd}
                onContextMenu={(e) => e.preventDefault()}
                title={alignLock ? t('toolbar.alignLockedTitle', { styl: t(`toolbar.alignShort_${alignLock}`) }) : t('toolbar.alignTitle')}
                data-align-lock={alignLock || 'off'}
              >
                {/* i na úzké liště zůstává ikona stylu, zámek dělá jen vzhled */}
                <AlignIcon className="w-4 h-4" />
              </Button>
            );
          })()}
          {/* Čitelnost — právě na mobilu je nejpotřebnější, proto v liště
              vždycky (a i v mapě jen ke čtení, viz velká lišta výš) */}
          {(() => {
            const CitIcon = CITELNOST_ICONS[citelnost] || ALargeSmall;
            return (
              <Button variant="outline" size="icon" data-citelnost={citelnost} className="min-[1850px]:hidden h-9 w-9 shrink-0" onClick={handleCitelnost} title={t('toolbar.readabilityTitle')}>
                <CitIcon className="w-4 h-4" />
              </Button>
            );
          })()}
          {/* „kostička" = oddálit na celou mapu (Richard 11. 8.) — táž akce jako
              fit ve spodních ovládacích prvcích plátna, jen po ruce v liště;
              mr-auto uzavírá levou skupinu [směr | zarovnat | čitelnost | kostička] */}
          <Button variant="outline" size="icon" className="min-[1850px]:hidden h-9 w-9 shrink-0 mr-auto" onClick={recenterMap} title={t('toolbar.fitViewTitle')}>
            <Maximize className="w-4 h-4" />
          </Button>
          <PersonalTabs personalMap={personalMap} personalView={personalView} setPersonalView={setPersonalView} navigate={navigate} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="hidden min-[1850px]:inline-flex" disabled={exporting || visibleNodes.length === 0}>
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {t('toolbar.export')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport('png')}>
                <Download className="w-4 h-4" /> {t('toolbar.exportPng')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('pdf')}>
                <Download className="w-4 h-4" /> {t('toolbar.exportPdf')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportJson(true)}>
                <FileJson className="w-4 h-4" /> {t('toolbar.exportJson')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportJson(false)}>
                <FileJson className="w-4 h-4" /> {t('toolbar.exportJsonNoPeople')}
              </DropdownMenuItem>
              {user && !isPublicView && !isTemplatePreview && !personalMap && (
                <DropdownMenuItem onClick={() => setSaveTplOpen(true)}>
                  <LayoutGrid className="w-4 h-4" /> {t('toolbar.saveAsTemplate')}
                </DropdownMenuItem>
              )}
              {user && activeMapId && !isPublicView && isMapOwner && (
                <DropdownMenuItem onClick={handleToggleArchive}>
                  {archived
                    ? <><ArchiveRestore className="w-4 h-4" /> {t('toolbar.restoreFromArchive')}</>
                    : <><Archive className="w-4 h-4" /> {t('toolbar.archiveProject')}</>}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {canEdit && (
            <Button onClick={handleAddGoal} size="sm">
              <Plus className="w-4 h-4" /> <span className="hidden sm:inline">{t('toolbar.addGoal')}</span>
            </Button>
          )}
          <NotificationBell />
          {/* Panáček jako všude jinde v aplikaci (reklamace z bety 12. 8. 2026):
              mapa byla jediné místo bez hlavičky, takže tu nabídka pod jménem
              chyběla a návod „vpravo nahoře najdete Vzhled" v mapě neplatil.
              ⋮ vedle zůstává na MAPOVÉ akce (export, archivace, šablona). */}
          {user && !isPublicView && <UserMenu />}
          {/* mobil: sekundární akce v jednom ⋮ menu (desktop je má rozbalené) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="min-[1850px]:hidden h-8 w-8" title={t('toolbar.moreActions')}>
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* Dashboard má vlastní ikonu v levé liště — v ⋮ menu by byl dvakrát */}
              {user && activeMapId && !isPublicView && (
                <DropdownMenuItem onClick={() => navigate(`/tasks?map=${activeMapId}`)}>
                  <CheckSquare className="w-4 h-4" /> {t('toolbar.tasks')}{mapTaskCount > 0 ? ` (${mapTaskCount})` : ''}
                </DropdownMenuItem>
              )}
              {canEdit && (
                <DropdownMenuItem disabled={!canUndo} onClick={handleUndo}>
                  <Undo2 className="w-4 h-4" /> {t('toolbar.undoTitle')}
                </DropdownMenuItem>
              )}
              {/* Zarovnat má vlastní ikonu v liště na všech velikostech — v ⋮ menu by bylo dvakrát */}
              {canShare && user && !isDraft && !isTemplatePreview && (
                <DropdownMenuItem onClick={() => setShareOpen(true)}>
                  <Share2 className="w-4 h-4" /> {t('toolbar.share')}
                </DropdownMenuItem>
              )}
              {canEdit && user && activeMapId && !isPublicView && !isTemplatePreview && (
                <DropdownMenuItem onClick={() => { setRulesDefaults({}); setRulesOpen(true); }}>
                  <Zap className="w-4 h-4" /> {t('toolbar.rules')}{mapRules.length > 0 ? ` (${mapRules.length})` : ''}
                </DropdownMenuItem>
              )}
              {canEdit && ai.has('generate') && user && (
                <DropdownMenuItem onClick={() => setAdvisorOpen(true)}>
                  <Sparkles className="w-4 h-4" /> {t('toolbar.suggestAi')}
                </DropdownMenuItem>
              )}
              {canEdit && ai.has('chat') && user && (
                <DropdownMenuItem onClick={() => setChatOpen((v) => !v)}>
                  <MessageSquare className="w-4 h-4" /> {t('toolbar.aiChat')}
                </DropdownMenuItem>
              )}
              {canEdit && (
                <DropdownMenuItem onClick={handleAddNote}>
                  <StickyNote className="w-4 h-4" /> {t('toolbar.note')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem disabled={exporting || visibleNodes.length === 0} onClick={() => handleExport('png')}>
                <Download className="w-4 h-4" /> {t('toolbar.exportPngShort')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={exporting || visibleNodes.length === 0} onClick={() => handleExport('pdf')}>
                <Download className="w-4 h-4" /> {t('toolbar.exportPdfShort')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={exporting} onClick={() => handleExportJson(true)}>
                <FileJson className="w-4 h-4" /> {t('toolbar.exportJsonShort')}
              </DropdownMenuItem>
              {user && !isPublicView && !isTemplatePreview && !personalMap && (
                <DropdownMenuItem onClick={() => setSaveTplOpen(true)}>
                  <LayoutGrid className="w-4 h-4" /> {t('toolbar.saveAsTemplate')}
                </DropdownMenuItem>
              )}
              {user && activeMapId && !isPublicView && isMapOwner && (
                <DropdownMenuItem onClick={handleToggleArchive}>
                  {archived
                    ? <><ArchiveRestore className="w-4 h-4" /> {t('toolbar.restoreFromArchive')}</>
                    : <><Archive className="w-4 h-4" /> {t('toolbar.archiveProject')}</>}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
  );
}
