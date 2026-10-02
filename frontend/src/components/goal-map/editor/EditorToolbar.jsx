import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Plus, Loader2, Check, Download, Share2, Eye, Users, Undo2, AlignCenter, CheckSquare, MoreVertical, LayoutGrid, Archive, ArchiveRestore, FileJson, StretchHorizontal, Shrink, Maximize, ALargeSmall, Type, Heading, Columns3, Flame, ArrowDownWideNarrow, CalendarClock, CalendarCheck, UserRound, CircleDot, Bot } from 'lucide-react';
import { useAsistent } from '@/lib/AsistentContext';
import { useMedia } from '@/lib/useMedia';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLazyNs } from '@/i18n/lazyNs';
import { KRITERIA } from '@/lib/nodeOrder';
import { ALIGN_STYLES } from '@/lib/alignStyles';
import { CITELNOST_STUPNE } from '@/lib/citelnost';
import NabidkaListy from './NabidkaListy';
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

// Tři styly Zarovnat (nabídka, viz nabidkaZarovnat): klasika (do šířky) → kompakt
// (střídavá 2 patra) → sevřít (patra + těsnější sloty a kroky — karty blíž
// k sobě, mapa se vejde na stránku). Tři patra NEpomáhala: tidy tree je pakuje
// stejně široko jako dvě (změřeno layout-parity), úspora přišla až z rozestupů.
// ALIGN_STYLES/ALIGN_OPTS žijí v lib/alignStyles.js — sdílí je i zakládání
// nové mapy (templateConvert), aby nevznikala mapa v jiném stylu, než jaký
// nabízí tlačítko
// ikony stylů na tlačítku Zarovnat (vzhled tlačítka = indikátor, žádné toasty)
const ALIGN_ICONS = { classic: StretchHorizontal, compact: Shrink, bands: LayoutGrid };
// ikony stupňů na tlačítku Čitelnost — stejná logika jako u Zarovnat:
// tlačítko ukazuje stupeň, který PRÁVĚ platí, výběr je v nabídce.
const CITELNOST_ICONS = { normal: ALargeSmall, large: Type, titleOnly: Heading };
// ikony kritérií nabídky „Uspořádat podle…" — na tlačítku je ikona ZVOLENÉHO
// kritéria (stejný idiom jako Zarovnat a Čitelnost: tlačítko = indikátor)
const USPORADAT_ICONS = { deadline: CalendarClock, plannedOn: CalendarCheck, owner: UserRound, status: CircleDot };
// krátké názvy stylů/stupňů jsou malými (tooltip „… (do šířky)", toasty);
// jako položka nabídky stojí samy, tak s velkým písmenem
const velke = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// Tlačítko, které se přepíná mezi `outline` a plným `default` (Asistent, Úzká
// hrdla, zamčené Zarovnat), musí být v obou stavech stejně široké: outline má
// 1px rámeček, plné žádný → o 2 px užší a celá lišta o ty 2 px uskočila.
const RAMECEK_PLNEHO = 'border border-transparent';

// Horní lišta editoru: široká varianta (≥1850 px) i ⋮ menu pro užší displeje.
// Akce, které nesou OBĚ varianty, žijí v jednom seznamu `akce` (F1-10) a obě
// větve se z něj jen mapují — podmínky viditelnosti a handlery tak existují
// jednou. Historické rozdíly mezi větvemi (jiné texty, disabled jen v menu)
// jsou v seznamu vyznačené poli popisekListy/popisekMenu/disabledMenu/jen —
// vědomě zachované 1:1, nerozhodnuté. („JSON bez jmen" jen v liště padlo
// rozhodnutím vlastníka 1. 9. 2026 — položka je i v ⋮ menu.)
// Čistě prezentační — vstupy jdou v pojmenovaných balících:
//   nav     … navigace + organizace (logo)
//   layout  … směr, zarovnání, čitelnost, kanban
//   access  … kdo je uživatel a co smí (canEdit, canShare, …)
//   state   … stav mapy pro lištu (ukládání, počty, otevřený chat, …)
//   actions … handlery tlačítek
export default function EditorToolbar({ nav, layout, access, state, actions }) {
  const { t } = useTranslation('editor');
  const asistent = useAsistent();
  const sirokaLista = useMedia('(min-width: 1850px)');
  const { navigate, org } = nav;
  const {
    direction, setDirMode, recenterMap, kanbanAktivni, kanbanNsReady,
    alignStyle, alignLock, handleAlign, handleAlignLock, handleSrovnatVse,
    citelnost, handleCitelnost, usporadani, handleUsporadat,
  } = layout;
  const {
    user, canEdit, canShare, canWork, isPublicView, isDraft, isTemplatePreview,
    isMapOwner, personalMap, archived, activeMapId, ai, mapKind,
  } = access;
  const {
    saveStatus, sharedCount, mapTaskCount, exporting,
    visibleNodes, canUndo, personalView, showBottlenecks, bottleneckAnalysis,
  } = state;
  const {
    setShareOpen, handleUndo,
    setPersonalView, handleExport, handleExportJson,
    setSaveTplOpen, handleToggleArchive, handleAddGoal, setShowBottlenecks,
  } = actions;

  // „Uspořádat podle…" (Richard 5. 9. 2026): rozbalovací nabídka VEDLE Zarovnat
  // — termín / plán / řešitel / stav; klik na položku mapu rovnou přerovná
  // (zápis + Zpět, viz useMapLayout.handleUsporadat). Je stavová (radio +
  // vlastní trigger), takže do seznamu `akce` nepatří — kreslí se dvakrát
  // stejně jako Zarovnat: široká lišta s textem, úzká jen ikona; do ⋮ menu ne.
  // Nezobrazuje se: v Mojí mapě (má vlastní pruh seskupení a řadí se sama dle
  // termínu), bez práva editace, ve veřejném náhledu a v kanbanu (rozložení
  // tam drží pravidla posunu — indikátor Kanban už za Zarovnat stojí).
  // Texty žijí v LAZY namespace `usporadat` (lite dieta); než se donačte,
  // tlačítko se nekreslí (bliknutí klíčů je horší než frame čekání).
  const usporadatNsReady = useLazyNs('usporadat');
  const zobrazUsporadat = canEdit && !personalMap && !isPublicView && usporadatNsReady && !(kanbanAktivni && kanbanNsReady);
  const nabidkaUsporadat = (siroka) => {
    if (!zobrazUsporadat) return null;
    return (
      <NabidkaListy
        siroka={siroka}
        Ikona={USPORADAT_ICONS[usporadani] || ArrowDownWideNarrow}
        popisek={t('usporadat:label')}
        title={usporadani ? `${t('usporadat:title')} (${t(`usporadat:${usporadani}`)})` : t('usporadat:title')}
        nadpis={t('usporadat:podle')}
        hodnota={usporadani}
        polozky={KRITERIA.map((k) => ({
          value: k, label: t(`usporadat:${k}`), hint: t(`usporadat:${k}Hint`),
          Icon: USPORADAT_ICONS[k], data: { 'data-kriterium': k },
        }))}
        onVyber={handleUsporadat}
        triggerProps={{
          'data-testid': siroka ? 'toolbar-usporadat' : 'toolbar-usporadat-narrow',
          'data-usporadani': usporadani || 'none',
        }}
      />
    );
  };

  // Zarovnat (jen s právem editace nebo v Mojí mapě) — nabídka tří stylů,
  // výběr mapu hned přerovná; zámek stylu je zaškrtávací položka pod nimi.
  // Zamčené tlačítko je plné s prstencem (Richard 12. 8.: „ikonka pořád stejná,
  // jen při zamčení změní barvu nebo je jakoby zmáčknutá").
  // V kanbanu stojí na jeho místě neaktivní indikátor Kanban.
  const nabidkaZarovnat = (siroka) => {
    if (!(canEdit || personalMap)) return null;
    if (kanbanAktivni && kanbanNsReady) {
      return (
        <Button variant="outline" size={siroka ? 'sm' : 'icon'} disabled
          className={siroka ? 'hidden min-[1850px]:inline-flex opacity-80' : 'min-[1850px]:hidden h-9 w-9 shrink-0 opacity-80'}
          title={t('rules:rules.toolbarKanbanTitle')} data-testid={siroka ? 'toolbar-kanban-mode' : 'toolbar-kanban-mode-narrow'}>
          <Columns3 className="w-4 h-4" />
          {siroka && <span className="hidden sm:inline">{t('rules:rules.toolbarKanban')}</span>}
        </Button>
      );
    }
    return (
      <NabidkaListy
        siroka={siroka}
        Ikona={ALIGN_ICONS[alignStyle] || AlignCenter}
        popisek={t('toolbar.align')}
        title={alignLock
          ? t('toolbar.alignLockedTitle', { styl: t(`toolbar.alignShort_${alignLock}`) })
          : (alignStyle ? `${t('toolbar.alignTitle')} (${t(`toolbar.alignShort_${alignStyle}`)})` : t('toolbar.alignTitle'))}
        nadpis={t('toolbar.alignNadpis')}
        hodnota={alignStyle}
        polozky={ALIGN_STYLES.map((s) => ({
          value: s, label: velke(t(`toolbar.alignShort_${s}`)), hint: t(`toolbar.alignHint_${s}`),
          Icon: ALIGN_ICONS[s], data: { 'data-styl': s },
        }))}
        onVyber={handleAlign}
        variant={alignLock ? 'default' : 'outline'}
        tridy={alignLock ? `${RAMECEK_PLNEHO} ring-2 ring-primary/40 shadow-inner` : ''}
        doplnek={(
          <DropdownMenuCheckboxItem checked={!!alignLock} onCheckedChange={handleAlignLock} data-align-lock-item="">
            <span className="flex flex-col">
              <span>{t('toolbar.alignLockItem')}</span>
              <span className="text-[11px] leading-tight text-muted-foreground">{t('toolbar.alignLockHint')}</span>
            </span>
          </DropdownMenuCheckboxItem>
        )}
        triggerProps={{
          'data-testid': siroka ? 'toolbar-zarovnat' : 'toolbar-zarovnat-narrow',
          'data-align-lock': alignLock || 'off',
          'data-align-style': alignStyle || 'none',
        }}
      />
    );
  };

  // Čitelnost je ZÁMĚRNĚ mimo `canEdit` — na rozdíl od Zarovnat nesahá na mapu,
  // jen na sazbu písma. Kdo mapu jen prohlíží (veřejná, sdílená jen ke čtení),
  // musí si ji taky umět zvětšit; na mobilu je nejpotřebnější.
  const nabidkaCitelnost = (siroka) => (
    <NabidkaListy
      siroka={siroka}
      Ikona={CITELNOST_ICONS[citelnost] || ALargeSmall}
      popisek={t('toolbar.readability')}
      title={`${t('toolbar.readabilityTitle')} (${t(`toolbar.readabilityShort_${citelnost}`)})`}
      nadpis={t('toolbar.readabilityNadpis')}
      hodnota={citelnost}
      polozky={CITELNOST_STUPNE.map((s) => ({
        value: s, label: velke(t(`toolbar.readabilityShort_${s}`)), hint: t(`toolbar.readabilityHint_${s}`),
        Icon: CITELNOST_ICONS[s], data: { 'data-stupen': s },
      }))}
      onVyber={handleCitelnost}
      triggerProps={{
        'data-testid': siroka ? 'toolbar-citelnost' : 'toolbar-citelnost-narrow',
        'data-citelnost': citelnost,
      }}
    />
  );

  // „Kostička" (Richard 11. 8.: oddálit na celou mapu; 1. 10. 2026: „by mohlo
  // zároveň zarovnat dle všech nastavení"). Kdo smí Zarovnat, tomu mapu srovná
  // podle stylu + Uspořádat a oddálí (useMapLayout.handleSrovnatVse); bez práva
  // editace a v kanbanu jen oddálí. Čisté oddálení je i dole v ovládání plátna.
  // (podle `kanbanAktivni` samotného — `kanbanNsReady` je jen donačtení textů
  // indikátoru a kostička by do té doby desku přerovnala; /checkup 2. 10.)
  const srovnaVse = (canEdit || personalMap) && !isPublicView && !kanbanAktivni;
  const kosticka = (siroka) => (
    <Button
      variant="outline"
      size={siroka ? 'sm' : 'icon'}
      className={siroka ? 'hidden min-[1850px]:inline-flex px-2' : 'min-[1850px]:hidden h-9 w-9 shrink-0 mr-auto'}
      onClick={srovnaVse ? handleSrovnatVse : recenterMap}
      title={srovnaVse ? t('toolbar.fitAlignTitle') : t('toolbar.fitViewTitle')}
      aria-label={srovnaVse ? t('toolbar.fitAlignTitle') : t('toolbar.fitViewTitle')}
      data-testid={siroka ? 'toolbar-fit' : 'toolbar-fit-narrow'}
      data-srovna={srovnaVse ? 'ano' : 'ne'}
    >
      <Maximize className="w-4 h-4" />
    </Button>
  );

  // Jediný zdroj pravdy pro akce kreslené dvakrát: širokou lištou (≥1850 px)
  // a ⋮ menu pro užší displeje (F1-10). Pořadí seznamu = pořadí v ⋮ menu;
  // v liště určuje místo `sekceListy` ('akce1' před stavem ukládání, 'akce2'
  // za odznaky, 'export' uvnitř nabídky Export).
  // Rozdíly větví (dřívější rozejití, zachováno 1:1 — NEROZHODNUTO):
  //   popisekListy/popisekMenu … Zpět a exporty mají v liště jiné texty než v menu
  //   disabledMenu … exporty zamyká v liště celé tlačítko Export (trigger),
  //                  v ⋮ menu má disabled každá položka zvlášť
  //   jen: 'lista' … akce se kreslí jen v liště, v ⋮ menu chybí (dnes nevyužité)
  //   titulekListy/testIdListy/varianta/popisekVeSpanu … title, data-testid,
  //                  zvýraznění otevřeného AI chatu a responzivní <span> nese jen lišta
  const akce = [
    {
      // Dashboard má vlastní ikonu v levé liště — tady jsou jen Úkoly
      klic: 'ukoly',
      sekceListy: 'akce1',
      viditelna: user && activeMapId && !isPublicView,
      Ikona: CheckSquare,
      popisek: `${t('toolbar.tasks')}${mapTaskCount > 0 ? ` (${mapTaskCount})` : ''}`,
      titulekListy: t('toolbar.tasksTitle'),
      popisekVeSpanu: true, // lišta: text v <span class="hidden sm:inline">
      onClick: () => navigate(`/tasks?map=${activeMapId}`),
    },
    {
      klic: 'zpet',
      sekceListy: 'akce2',
      viditelna: canEdit,
      Ikona: Undo2,
      popisekListy: t('toolbar.undoShort'),
      popisekMenu: t('toolbar.undoTitle'),
      titulekListy: t('toolbar.undoTitle'),
      disabled: !canUndo,
      onClick: handleUndo,
    },
    {
      // Zarovnat má vlastní ikonu v liště na všech velikostech — v ⋮ menu by bylo dvakrát
      klic: 'sdilet',
      sekceListy: 'akce2',
      viditelna: canShare && user && !isDraft && !isTemplatePreview,
      Ikona: Share2,
      popisek: t('toolbar.share'),
      onClick: () => setShareOpen(true),
    },
    {
      // AI chat na boku (asistent přes všechny stránky) — panel žije v App.jsx.
      // 15. 9. 2026 (Richard): z lišty pryč „Navrhnout s AI“, starý „AI chat“ nad
      // mapou i „Poznámka“ — lišta byla tak plná, že vytlačila logo vlevo.
      klic: 'asistent',
      sekceListy: 'akce2',
      viditelna: ai.has('chat_panel') && user,
      Ikona: Bot,
      popisek: t('toolbar.asistent'),
      titulekListy: t('toolbar.asistent'),
      testIdListy: 'toolbar-asistent',
      varianta: asistent.open ? 'default' : 'outline',
      onClick: () => asistent.setOpen((v) => !v),
    },
    {
      klic: 'exportPng',
      sekceListy: 'export',
      viditelna: true,
      Ikona: Download,
      popisekListy: t('toolbar.exportPng'),
      popisekMenu: t('toolbar.exportPngShort'),
      disabledMenu: exporting || visibleNodes.length === 0,
      onClick: () => handleExport('png'),
    },
    {
      klic: 'exportPdf',
      sekceListy: 'export',
      viditelna: true,
      Ikona: Download,
      popisekListy: t('toolbar.exportPdf'),
      popisekMenu: t('toolbar.exportPdfShort'),
      disabledMenu: exporting || visibleNodes.length === 0,
      onClick: () => handleExport('pdf'),
    },
    {
      klic: 'exportJson',
      sekceListy: 'export',
      viditelna: true,
      Ikona: FileJson,
      popisekListy: t('toolbar.exportJson'),
      popisekMenu: t('toolbar.exportJsonShort'),
      disabledMenu: exporting,
      onClick: () => handleExportJson(true),
    },
    {
      // rozhodnutí vlastníka 1. 9. 2026: i v ⋮ menu (dřív `jen: 'lista'`)
      klic: 'exportJsonBezJmen',
      sekceListy: 'export',
      viditelna: true,
      Ikona: FileJson,
      popisekListy: t('toolbar.exportJsonNoPeople'),
      popisekMenu: t('toolbar.exportJsonNoPeopleShort'),
      disabledMenu: exporting,
      onClick: () => handleExportJson(false),
    },
    {
      klic: 'sablona',
      sekceListy: 'export',
      viditelna: user && !isPublicView && !isTemplatePreview && !personalMap,
      Ikona: LayoutGrid,
      popisek: t('toolbar.saveAsTemplate'),
      onClick: () => setSaveTplOpen(true),
    },
    {
      klic: 'archiv',
      sekceListy: 'export',
      viditelna: user && activeMapId && !isPublicView && isMapOwner,
      Ikona: archived ? ArchiveRestore : Archive,
      popisek: archived ? t('toolbar.restoreFromArchive') : t('toolbar.archiveProject'),
      onClick: handleToggleArchive,
    },
  ];
  // jedna akce → tlačítko široké lišty (≥1850 px)
  const tlacitkoListy = (a) => (
    <Button
      key={a.klic}
      variant={a.varianta || 'outline'}
      size="sm"
      className={`hidden min-[1850px]:inline-flex${a.varianta === 'default' ? ` ${RAMECEK_PLNEHO}` : ''}`}
      onClick={a.onClick}
      disabled={a.disabled}
      title={a.titulekListy}
      data-testid={a.testIdListy}
    >
      <a.Ikona className="w-4 h-4" />
      {a.popisekVeSpanu
        ? <span className="hidden sm:inline">{a.popisekListy ?? a.popisek}</span>
        : ` ${a.popisekListy ?? a.popisek}`}
    </Button>
  );
  // jedna akce → položka rozbalovací nabídky: ⋮ menu (s disabled a kratšími
  // texty), nebo nabídky Export v liště (bez disabled — zamyká celý trigger)
  const polozkaMenu = (a, vListe) => (
    <DropdownMenuItem
      key={a.klic}
      disabled={vListe ? undefined : (a.disabledMenu ?? a.disabled)}
      onClick={a.onClick}
    >
      <a.Ikona className="w-4 h-4" /> {vListe ? (a.popisekListy ?? a.popisek) : (a.popisekMenu ?? a.popisek)}
    </DropdownMenuItem>
  );
  const akceListy = (sekce) => akce.filter((a) => a.sekceListy === sekce && a.viditelna).map(tlacitkoListy);

  // data-app-header: pod spodní hranu lišty se staví panely „fixed“ (Dokumenty asistenta, 30. 9. 2026)
  // `sticky top-0`: obě řady lišty drží nahoře, i kdyby se stránka přece jen
  // dala posunout (pojistka k `h-dvh` v GoalMapEditor — Richard 1. 10. 2026)
  // Otevřený panel asistenta lištu NEPOSOUVÁ, leží PŘES ni (Richard 2. 10. 2026:
  // „když otevřu asistenta, posune se vše a přijdu o tlačítko zpět… asistent
  // neposouvá lištu, ale je přes ní"). Obsah stránky odsouvá AsistentHost
  // (App.jsx, paddingRight = šířka panelu) — lišta si ten odsun záporným okrajem
  // vezme zpět, takže zůstává přes celé okno a její pravý konec schová panel
  // (z-40 nad z-10). Mapa pod lištou se dál zúží, ať je vedle panelu celá vidět.
  // JEN u široké textové lišty (≥1850 px) — tam se vedle panelu nevešla a logo
  // se šipkou Zpět zmizely. Ikonová lišta (<1850) se vedle panelu vejde celá;
  // překrytí by jí naopak schovalo „+", zvonek a ⋮ menu (v něm Zpět a Sdílet).
  const odsunPanelu = sirokaLista && user && asistent.dostupny && asistent.open ? asistent.width : 0;
  // Stav ukládání v ikonové liště (640–1849 px): jen ikona, absolutně vlevo od
  // přepínače směru — nezabírá místo, takže se při uložení nic nepohne (dřív
  // text uprostřed řady odsouval přepínač směru o ~65 px). Text zůstává pro
  // čtečky (a pro sady, které na „Ukládání" čekají). Na telefonu se neukazuje.
  const stavUkladaniIkona = !sirokaLista && (saveStatus === 'saving' || saveStatus === 'saved') ? (
    <span
      className={`hidden sm:flex absolute right-full top-1/2 -translate-y-1/2 mr-1.5 items-center ${saveStatus === 'saving' ? 'text-muted-foreground' : 'text-green-600'}`}
      title={saveStatus === 'saving' ? t('saveState.saving') : t('saveState.saved')}
      data-testid="save-status"
      data-stav={saveStatus}
    >
      {saveStatus === 'saving' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
      <span className="sr-only">{saveStatus === 'saving' ? t('saveState.saving') : t('saveState.saved')}</span>
    </span>
  ) : null;
  return (
      <header data-app-header style={odsunPanelu ? { marginRight: -odsunPanelu } : undefined} className="transition-[margin] sticky top-0 min-h-14 sm:h-14 border-b bg-card flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-2 gap-y-1.5 px-3 sm:px-4 py-1.5 sm:py-0 z-10 shrink-0">
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
        {/* Telefon (Richard 29. 9. 2026, „horní lišta plná" → „přes tři řádky" → „pořád divné"):
            dvě PLNÉ řady. Nahoře logo + šipka zpět vlevo a napravo akce (+, hrdla, zvonek,
            panáček, ⋮); dole zleva nástroje mapy (směr, zarovnat, čitelnost, kostička).
            Technika: tahle skupina je na telefonu `contents` (její děti jsou přímo v hlavičce,
            která zalamuje) a dvě vnitřní obálky — nástroje `basis-full order-last`, akce
            `ml-auto` — jsou na počítači `sm:contents`, takže DOM i vzhled ≥640 px zůstávají 1:1.
            Dřív (shrink-0 + w-full bez zalomení) řada jedenácti tlačítek přetekla přes okraj
            a rolovala do strany celou stránku i s mapou. */}
        <div className="contents sm:flex sm:items-center sm:gap-3 sm:w-auto sm:justify-end sm:shrink-0">
          <div className="flex items-center gap-1.5 basis-full order-last sm:contents" data-testid="toolbar-nastroje">
          {/* Vyhledávání a filtr Moje úkoly se přestěhovaly do LEVÉ lišty pod
              zásobník a časovač (Richard 11. 8.: „vyhledávání dej ikonku pod
              zásobník a časovač… moje úkoly taky, je to jen filtr") — horní
              liště se ulevilo. */}
          {/* Rozložení mapy: na výšku (svisle) / na šířku (vodorovně) / auto dle displeje */}
          <div className="relative flex shrink-0">
          {stavUkladaniIkona}
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
          </div>
          {/* široká lišta: pevné „Zarovnat ▾ / Uspořádat ▾ / Čitelnost ▾" + kostička */}
          {nabidkaZarovnat(true)}
          {nabidkaUsporadat(true)}
          {nabidkaCitelnost(true)}
          {kosticka(true)}
          {/* Dashboard se přestěhoval do levé lišty pod filtr Moje úkoly
              (Richard 11. 8.: „tlačítko dashboard doleva a dolů pod filtr") */}
          {akceListy('akce1')}
          {/* Stav ukládání NESMÍ hýbat lištou. Lišta je zarovnaná doprava, takže
              objevení „Ukládání… / Uloženo" po každém uložení odsunulo všechna
              tlačítka vlevo od něj o ~77 px — klik na totéž místo pak trefil jiné
              tlačítko (Richard 1. 10. 2026; kontrola „lišta neposkakuje"
              v ui-usporadani). Široká lišta (≥1850 px) mu proto drží pevné místo
              v řadě; ikonová lišta na ně nemá šířku (vedle panelu asistenta se
              nevešla), takže tam je jen ikona MIMO tok vlevo od přepínače směru
              — viz stavUkladaniIkona. */}
          {sirokaLista && (
            <span className="flex w-24 shrink-0 items-center gap-1.5 text-xs whitespace-nowrap" data-testid="save-status" data-stav={saveStatus || 'idle'}>
              {saveStatus === 'saving' && (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" /> {t('saveState.saving')}
                </span>
              )}
              {saveStatus === 'saved' && (
                <span className="flex items-center gap-1.5 text-green-600">
                  <Check className="w-3 h-3" /> {t('saveState.saved')}
                </span>
              )}
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
          {akceListy('akce2')}
          {/* Zarovnat / Uspořádat / Čitelnost i na malých obrazovkách (Richard 11. 8.:
              „na mobilu chci nahoře tlačítko zarovnat… blíže k přepínání zobrazení") —
              ikonové, ikona = aktuální volba, klik otevře nabídku; „+" je vpravo
              u zvonečku. Kostička s mr-auto uzavírá levou skupinu
              [směr | zarovnat | uspořádat | čitelnost | kostička]. */}
          {nabidkaZarovnat(false)}
          {nabidkaUsporadat(false)}
          {nabidkaCitelnost(false)}
          {kosticka(false)}
          </div>
          <div className="flex items-center gap-1.5 ml-auto sm:contents" data-testid="toolbar-akce">
          <PersonalTabs personalMap={personalMap} personalView={personalView} setPersonalView={setPersonalView} navigate={navigate} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="hidden min-[1850px]:inline-flex" disabled={exporting || visibleNodes.length === 0}>
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {t('toolbar.export')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {akce.filter((a) => a.sekceListy === 'export' && a.viditelna).map((a) => polozkaMenu(a, true))}
            </DropdownMenuContent>
          </DropdownMenu>
          {canEdit && (
            <Button onClick={handleAddGoal} size="sm">
              <Plus className="w-4 h-4" /> <span className="hidden sm:inline">{t('toolbar.addGoal')}</span>
            </Button>
          )}
          {/* Úzká hrdla: přepínač zvýraznění. Viditelný vždy (i pod 1850 px) —
              počítadlo je alarm, nesmí se schovat do ⋮. Počítadlo = jen REÁLNÁ
              hrdla. Stavy tlačítka: zapnuto = plné (default, jako jiné aktivní
              přepínače); vypnuto s hrdly = výstražný obrys; jinak obyčejný
              obrys. (Odrazový koncept měl podsvícení obráceně — po načtení
              vypadal přepínač zapnutě, nález revize 1. 9. 2026.) */}
          {user && !isPublicView && mapKind !== 'org' && (
            <Button
              variant={showBottlenecks ? 'default' : 'outline'}
              size="sm"
              className={`h-9 gap-1.5 text-xs font-semibold ${showBottlenecks ? `${RAMECEK_PLNEHO} ` : ''}${
                bottleneckAnalysis.totalBottlenecks > 0 && !showBottlenecks
                  ? 'border-rose-400/60 text-rose-600 dark:border-rose-800 dark:text-rose-400'
                  : ''
              }`}
              onClick={() => setShowBottlenecks((prev) => !prev)}
              title={t('toolbar.bottlenecksTitle')}
              data-testid="toolbar-bottlenecks"
              data-zapnuto={showBottlenecks ? '1' : '0'}
            >
              <Flame className={`w-4 h-4 ${!showBottlenecks && bottleneckAnalysis.totalBottlenecks > 0 ? 'text-amber-400 fill-amber-400' : ''}`} />
              <span className="hidden sm:inline">{t('toolbar.bottlenecks')}</span>
              {bottleneckAnalysis.totalBottlenecks > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold" data-pocet="realna">
                  {bottleneckAnalysis.totalBottlenecks}
                </span>
              )}
              {/* Po zapnutí se na plátně rozsvítí i POTENCIÁLNÍ (oranžová) hrdla —
                  tlačítko ale jen změnilo barvu a kolik jich je, se muselo počítat
                  na plátně (Richard 6. 9. 2026: „dal bych tam taky počet").
                  Oranžové počítadlo se ukazuje JEN se zapnutým přepínačem, stejně
                  jako oranžové uzly; vypnuté tlačítko dál hlásí jen reálná. */}
              {/* Místo pro oranžové počítadlo se drží I VYPNUTÉ (neviditelné):
                  jinak tlačítko po zapnutí narostlo o ~24 px a protože je lišta
                  zarovnaná doprava, uskočilo všechno vlevo od něj (/checkup
                  2. 10. 2026, stejná vada jako měnící se popisky Zarovnat). */}
              {bottleneckAnalysis.potentialCount > 0 && (
                <span className={`inline-flex items-center gap-1.5${showBottlenecks ? '' : ' invisible'}`} aria-hidden={showBottlenecks ? undefined : 'true'}>
                  {/* „1 + 3": plus mezi počítadly (Richard 6. 9. 2026) — dvě
                      barevné bublinky vedle sebe se četly jako jedno číslo */}
                  {bottleneckAnalysis.totalBottlenecks > 0 && <span className="text-[10px] font-bold opacity-80" aria-hidden="true">+</span>}
                  <span className="px-1.5 py-0.5 rounded-full bg-amber-400 text-amber-950 text-[10px] font-bold" {...(showBottlenecks ? { 'data-pocet': 'potencialni' } : {})}>
                    {bottleneckAnalysis.potentialCount}
                  </span>
                </span>
              )}
            </Button>
          )}
          {/* Telefon: Asistent i v horní řadě (Richard 29. 9. 2026: „proč na mobilu není nahoře
              taky tlačítko AI asistent?") — jako na titulce; do 1850 px je jinak jen v ⋮ menu
              a na počítači ho zastupuje ouško na pravém okraji, na telefonu lišta dole. */}
          {user && ai.has('chat_panel') && (
            <Button variant="default" size="icon" className="sm:hidden h-9 w-9 shrink-0" onClick={() => asistent.setOpen((v) => !v)} title={t('toolbar.asistent')} aria-label={t('toolbar.asistent')} data-testid="toolbar-asistent-mobil">
              <Bot className="w-4 h-4" />
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
              {/* Dashboard má vlastní ikonu v levé liště a Zarovnat v liště na
                  všech velikostech — v ⋮ menu by byly dvakrát, proto tu nejsou */}
              {akce.filter((a) => a.viditelna && a.jen !== 'lista').map((a) => polozkaMenu(a, false))}
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </div>
      </header>
  );
}
