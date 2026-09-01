import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  ControlButton,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  SelectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Plus, Loader2, Target, Trash2, Lock, Unlock, Sun, Moon, ChevronDown, Map as MapIcon, Palette, SlidersHorizontal } from 'lucide-react';
import GoalNode from '@/components/goal-map/GoalNode';
import { MembersContext } from '@/lib/memberLabel';
import { useMembersWithContacts } from '@/lib/externalContacts';
import SkinPattern from '@/components/shared/SkinPattern';
import ApexGoalNode from '@/components/goal-map/ApexGoalNode';
import StickyNoteNode from '@/components/goal-map/StickyNoteNode';
import PersonalRootNode from '@/components/goal-map/PersonalRootNode';
import DeletableEdge from '@/components/goal-map/DeletableEdge';
import { useBufferNodes } from '@/components/goal-map/BufferPanel';
import ProgressDashboard from '@/components/goal-map/ProgressDashboard';
import { shareMap, getPublicMap, nodeStatus } from '@/api/kb';
import { layoutTree, findFreeChildSpot } from '@/lib/treeLayout';
import { isApexNode as isApexNodeShared } from '@/lib/mapNodes';
import { spojeniPovoleno, poskozeneHrany } from '@/lib/mapStructure';
import { cleanMapData as cleanMap } from '@/lib/cleanMap';
import GoalMapContext from '@/components/goal-map/GoalMapContext';
import { useToast } from '@/components/ui/use-toast';
import i18next from 'i18next';
import { ensureNs } from '@/i18n/lazyNs';
import { ToastAction } from '@/components/ui/toast';
import { useAiModes } from '@/hooks/useAiEnabled';
import { effectiveTheme, setTheme } from '@/lib/theme';
import { statusConfig, cycleStatus } from '@/lib/statusMeta';
import { getDeadlineStatus } from '@/lib/nodeMeta';
import BulkEditDialog from '@/components/goal-map/BulkEditDialog';
import { templateToMap, templateForLang } from '@/lib/templateConvert';
import { ALIGN_OPTS, stylNoveMapy } from '@/lib/alignStyles';
import { createRulesFromTemplate, ownersFromNodes, createProjectRecord } from '@/lib/createProject';
import { computeWaitingSet } from '@/lib/waitStatus';
import { nactiKlic, ulozKlic } from '@/lib/storageKeys';
import { useSidePanels } from '@/hooks/useSidePanels';
import { useMapCounts } from '@/hooks/useMapCounts';
import { useMapHistory } from '@/hooks/useMapHistory';
import { useMapExport } from '@/hooks/useMapExport';
import { useMapRules } from '@/hooks/useMapRules';
import { useAiActions } from '@/hooks/useAiActions';
import { useMapLayoutRefs } from '@/hooks/useMapLayoutRefs';
import { useMapLayout } from '@/hooks/useMapLayout';
import { useBufferInsert } from '@/hooks/useBufferInsert';
import { usePersonalMapView } from '@/hooks/usePersonalMapView';
import { useMapAutosave } from '@/hooks/useMapAutosave';
import { buildChildrenMap, descendantCounts, hiddenByCollapse, computeProgressMap } from '@/lib/mapProgress';
import { jeZadavatelNeboVlastnik, mojePracovniUzlyZ } from '@/lib/nodePermissions';
// prezentační sekce JSX editoru (F1-07) — jen renderují, stav zůstává tady
import ConflictBanners from '@/components/goal-map/editor/ConflictBanners';
import EditorToolbar from '@/components/goal-map/editor/EditorToolbar';
import { DelegatedGroupingBar } from '@/components/goal-map/editor/PersonalTabs';
import TitleStrip from '@/components/goal-map/editor/TitleStrip';
import LeftRail from '@/components/goal-map/editor/LeftRail';
import EditorDialogs from '@/components/goal-map/editor/EditorDialogs';

const nodeTypes = { goalNode: GoalNode, apexNode: ApexGoalNode, note: StickyNoteNode, personalRoot: PersonalRootNode };
const edgeTypes = { deletable: DeletableEdge };

const defaultEdgeOptions = {
  type: 'deletable',
  animated: true,
  style: { stroke: 'hsl(var(--canvas-edge))', strokeWidth: 2 },
};

function EditorContent({ mapId, personalMap = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { user, patchUser } = useAuth();
  const { t } = useTranslation('editor');
  const [title, setTitle] = useState('');
  const [color, setColor] = useState('');
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  // motiv (světlý/tmavý) — přesunut z lišty dolů k ovládání mapy
  const [theme, setThemeState] = useState(effectiveTheme);
  const toggleTheme = () => { const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next); setThemeState(next); };
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editNodeId, setEditNodeId] = useState(null);
  // minimapa jde schovat — překrývá malůvku skinu a na malých mapách zavazí
  const [miniMapOpen, setMiniMapOpen] = useState(() => nactiKlic('kb-minimap-open') !== '0');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [skinOpen, setSkinOpen] = useState(false);   // dialog Vzhled i z editoru
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const [nazevEditace, setNazevEditace] = useState(false);
  const ai = useAiModes();
  const [shareOpen, setShareOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false); // lupa v levé liště
  const [rfInstance, setRfInstance] = useState(null);
  const [canEdit, setCanEdit] = useState(true);
  // Sdílení spravuje vlastník + JMENOVANÝ spolusprávce (shared_with_edit), NE
  // plošný team_access=edit (Richard 20. 8. 2026). Zrcadlo je tu jen UI
  // nápověda — autorizaci drží server (map_shares v routě /share).
  const [canShare, setCanShare] = useState(false);
  const [sharedCount, setSharedCount] = useState(0);
  const [isPublicView, setIsPublicView] = useState(false);  // veřejně sdílená mapa ≠ demo
  // Logo organizace i v liště mapy (Richard 18. 8. 2026: „v organizaci DUVE jsem
  // změnil logo, ale v mapě se nezměnilo"). Vlastní logo má přednost, značka
  // killBottlenecku zůstává instancím, které si žádné nenahrály.
  //
  // ⚠️ JEN PŘIHLÁŠENÉMU ČLENOVI. Dřív tu stálo, že „na veřejné mapě vrátí
  // org.get() prázdno" — NENÍ TO PRAVDA: `org_settings` má listRule "" (vědomě,
  // od 15. 7. 2026: jedna firma = jedna instance), takže je čte i nepřihlášený
  // a /map/:id není za ProtectedRoute. Anonymní návštěvník sdílené mapy by tedy
  // viděl logo zákazníka — a veřejná mapa je jediná akviziční plocha produktu.
  // Stejné pravidlo drží i DocumentTitle. (Nález panelu /checkup 18. 8. 2026.)
  const [org, setOrg] = useState(null);
  useEffect(() => {
    if (!user || isPublicView) { setOrg(null); return; }
    base44.org.get().then(setOrg).catch(() => {});
  }, [user, isPublicView]);
  const [activeMapId, setActiveMapId] = useState(null);
  const [isTemplatePreview, setIsTemplatePreview] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  const [ownerEmails, setOwnerEmails] = useState([]);
  // Deep-link /map/:id?view=dashboard — druhá cesta k dashboardu z dlaždice
  // projektu na titulce („šéf se ptá, v jaké fázi to je" → jeden klik).
  // Tlačítko v liště je pod 1850 px schované v ⋮ menu, takže tohle není zdvojení,
  // ale jediná rychlá cesta na běžném notebooku.
  const [dashboardOpen, setDashboardOpen] = useState(
    () => new URLSearchParams(location.search).get('view') === 'dashboard');
  // odznaky uzlů (komentáře, přílohy, úkoly, běžící agenti) — hooks/useMapCounts.js (F1-07)
  const {
    commentCounts, fileCounts, taskStats, mapTasks, mapTaskCount, setTaskStatsVersion, runningAgentNodes,
  } = useMapCounts({ activeMapId, isPublicView, user, editNodeId });
  const [taskNodeId, setTaskNodeId] = useState(null);
  // členové + externí kontakty v jednom (kontakty s external:true); reloadMembers
  // po změně adresáře kontaktů (onContactsChanged z OwnerSelect)
  const [members, reloadMembers] = useMembersWithContacts(user);
  const [mapShare, setMapShare] = useState(null); // {ownerEmail, sharedWith, teamAccess}
  const [mapKind, setMapKind] = useState(''); // '' běžná | 'org' organizační struktura
  const [archived, setArchived] = useState(false);
  const [isMapOwner, setIsMapOwner] = useState(false);
  // spolupracovník (work): mapa read-only, ale smí cyklovat stav SVÝCH uzlů routou /node-status
  const [canWork, setCanWork] = useState(false);
  const archiveOfferShown = useRef(false); // auto-nabídka archivace max 1× za otevření mapy
  const highlightDone = useRef(false);

  const skipNextSave = useRef(true);
  // „latest ref" aktuálních uzlů/hran: callbacky s dlouhým životem (letící
  // autosave) potřebují vidět SOUČASNÝ stav, ne uzávěr z doby naplánování
  const nodesNow = useRef([]);
  const edgesNow = useRef([]);
  const mapRulesNow = useRef([]);
  // Rozložení mapy — raná část (směr, zámek posunu, refy směru/pozic, závora
  // deep-linku, centerOnNode, cleanMapData) — hooks/useMapLayoutRefs.js (F1-07).
  // Refy čtou už loadPersonalMap, load mapy a autosave níž, proto vzniká tady.
  const {
    setDirMode, direction, narrow, updateNodeInternals, locked, setLocked, recenterMap, citelnostRef,
    directionRef, appliedDirRef, canonicalPosRef, alignMapKeyRef, pendingDeepLink, centerOnNode, cleanMapData,
  } = useMapLayoutRefs({ nodes, rfInstance, nodesNow, edgesNow, location });
  const templateSeriesRef = useRef(null); // id číslované šablony z náhledu (state maže replaceState)
  // VZOROVÁ (needitovaná) podoba šablony — projekt vzniká z ní, ne z rozklikaného náhledu
  const sablonaCistaRef = useRef(null);
  const templateSeedsRef = useRef(null); // {idMap, rules} z náhledu šablony — pravidla se založí až s mapou
  // Zpět + Vrátit AI změny — hooks/useMapHistory.js (F1-07)
  const {
    canUndo, pushHistory, handleUndo, aiSnapshotRef, canUndoAi, setCanUndoAi, handleUndoAi,
  } = useMapHistory({ nodesNow, edgesNow, setNodes, setEdges, toast, t });
  const buffer = useBufferNodes(user);
  const { bufferOpen, timeLogOpen, toggleBuffer, toggleTimeLog } = useSidePanels();

  // Posun levé lišty ikon i proužku s názvem, když je vysunutý zásobník (288 px)
  // nebo časovač (320 px). Oba naráz otevřené BÝT NEMOHOU — přepínače se navzájem
  // zavírají (toggleBuffer/toggleTimeLog výš) a i úvodní stav z prohlížeče dává
  // přednost zásobníku, takže se šířky nikdy nesčítají. Dřív ten výraz stál
  // v souboru třikrát a rozejít se mohl kdykoliv.
  const railLeft = bufferOpen ? 288 : timeLogOpen ? 320 : 0;

  // Mapy poškozené DŘÍV, než začala platit kontrola spojení (lib/mapStructure.js).
  // Server je schválně dál ukládá — jinak by se z nich uživatel nedostal ven a
  // shodil by mu i posun uzlu. Nabídneme mu tedy cestu ven: odpojíme hrany navíc
  // (uzly zůstanou) a jde to vzít Zpět. NIC neděláme potichu.
  const [poskozenaMapa, setPoskozenaMapa] = useState(null);
  const opravitStrom = useCallback(() => {
    const vadne = poskozenaMapa?.edgeIds || [];
    if (!vadne.length) return;
    pushHistory();
    setEdges((prev) => prev.filter((e) => vadne.indexOf(e.id) === -1));
    setPoskozenaMapa(null);
  }, [poskozenaMapa, pushHistory, setEdges]);

  useEffect(() => {
    if (!poskozenaMapa) return;
    toast({
      title: t('node.mapBroken'),
      description: t('node.mapBrokenHint', { count: poskozenaMapa.edgeIds.length }),
      duration: 30000,
      // data-repair-map kvůli e2e: ToastAction je v tomhle repu <div>, ne <button>,
      // takže hledání „podle tlačítka s textem" ho nenajde
      action: (
        <ToastAction data-repair-map="" altText={t('node.repairAction')} onClick={opravitStrom}>
          {t('node.repairAction')}
        </ToastAction>
      ),
    });
    // opravitStrom schválně mimo deps — jinak by se hláška vyrobila znovu při
    // každé změně mapy a přebila by všechno ostatní
     
  }, [poskozenaMapa]);

  const editNodeRaw = editNodeId ? nodes.find((n) => n.id === editNodeId) : null;
  // Dialog VRCHOLU ukazuje barvu PROJEKTU (vrchol JE projekt) — i když byla
  // nastavená paletou v tabulce úkolů a data.color vrcholu je prázdné.
  // Uložení jde zpátky přes handleSaveNode, který ji do projektu propíše.
  const editNode = editNodeRaw && editNodeRaw.type === 'apexNode' && !editNodeRaw.data?.color && color
    ? { ...editNodeRaw, data: { ...editNodeRaw.data, color } }
    : editNodeRaw;
  // zodpovědné osoby: sdílení mapy + všichni členové týmu (BEZ externích kontaktů —
  // jejich pseudo-e-maily do našeptávačů sdílení/e-mailů nepatří)
  const ownerOptions = useMemo(
    () => [...new Set([...ownerEmails, ...members.filter((m) => !m.external).map((m) => m.email)])].sort(),
    [ownerEmails, members]
  );
  // rozpracovaná/demo mapa nemá záznam — přístup má jen autor
  const effectiveMapAccess = mapShare || { ownerEmail: user?.email || '', sharedWith: [], teamAccess: '' };

  // přisdílení mapy při výběru zodpovědné osoby bez přístupu (smí jen vlastník)
  const handleShareAdd = useCallback(async (email) => {
    if (!activeMapId) {
      toast({ title: t('toasts.mapNotSaved'), description: t('toasts.mapNotSavedDesc'), variant: 'destructive' });
      return false;
    }
    try {
      // quiet: přisdílení je součást ZADÁNÍ PRÁCE — adresát dostane souhrnnou
      // notifikaci o přidělené práci, druhá o sdílení by byla duplikát
      const res = await shareMap({ action: 'share', mapId: activeMapId, email, permission: 'work', quiet: true });
      if (res?.error) {
        toast({ title: t('tasks:tasksPage.shareFailed'), description: res.error, variant: 'destructive' });
        return false;
      }
      // sdílení bumplo `updated` mapy → posunout základ, jinak následné uložení
      // uzlu (owner+termín) spadne na 409 a přisdílená osoba/termín se ztratí
      if (res?.updated) baseUpdated.current = res.updated;
      // povýšení (už nasdílený čtenář) NEPŘIDÁVÁ řádek — jen mu zvedne úroveň;
      // bez téhle větve se člověk v seznamu i v počtu objevil dvakrát
      setMapShare((s) => ({
        ...s,
        sharedWith: (s?.sharedWith || []).includes(email) ? s.sharedWith : [...(s?.sharedWith || []), email],
        sharedWithWork: (s?.sharedWithWork || []).includes(email) ? s.sharedWithWork : [...(s?.sharedWithWork || []), email],
      }));
      if (!res?.upgraded) setSharedCount((c) => c + 1);
      toast({ title: t('tasks:tasksPage.mapShared'), description: t('tasks:tasksPage.mapSharedDesc', { email }) });
      return true;
    } catch (e) {
      const msg = e.response?.error || t('tasks:tasksPage.shareOwnerOnly');
      toast({ title: t('tasks:tasksPage.shareFailed'), description: msg, variant: 'destructive' });
      return false;
    }
  }, [activeMapId, toast]);
  const isDraft = mapId === 'new' && !activeMapId;
  // Build children map from edges
  const childrenMap = useMemo(() => buildChildrenMap(edges), [edges]);

  // Compute visible nodes/edges based on collapsed state
  const { visibleNodes, visibleEdges, hiddenCounts } = useMemo(() => {
    const hidden = hiddenByCollapse(nodes, childrenMap);
    const counts = descendantCounts(nodes, childrenMap);

    const vNodes = nodes
      .filter((n) => !hidden.has(n.id))
      // deletable:false na vrcholu — xyflow pak z Delete/Backspace vynechá uzel
      // I JEHO HRANY (samotný filtr remove změn hrany neochránil: deleteElements
      // je posílá zvlášť a děti by tiše osiřely — nález checkupu 2. 8.)
      .map((n) => ({ ...n, zIndex: n.type === 'note' ? 0 : (n.zIndex ?? 10), ...(isApexNodeShared(n) ? { deletable: false } : {}) }));
    const visibleIds = new Set(vNodes.map((n) => n.id));
    // Stav hrany se ODVOZUJE za běhu z CÍLOVÉHO uzlu — hrana vede *do* něj a nic
    // jiného o ní nevypovídá. Ukládat se nesmí: cleanMap zapisuje u hrany jen
    // id/source/target, takže uložený stav by se rozešel s realitou hned, jak
    // někdo přepne stav uzlu jinde (mobil, pravidlo, API).
    const dataById = {};
    for (const n of vNodes) dataById[n.id] = n.data || {};
    const vEdges = edges
      .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
      .map((e) => {
        const d = dataById[e.target] || {};
        // getDeadlineStatus vrací u hotového vždy 'normal', takže přednost
        // „zelená před červenou" vyjde bez dalšího větvení
        const stav = d.status === 'done'
          ? 'done'
          : (getDeadlineStatus(d.deadline, d.status) === 'overdue' ? 'late' : 'normal');
        const barva = stav === 'done' ? 'var(--canvas-edge-done)'
          : stav === 'late' ? 'var(--canvas-edge-late)'
          : 'var(--canvas-edge)';
        return {
          ...e,
          // hotové se přestane hýbat (práce doběhla), propadlé zrychlí (index.css)
          animated: stav !== 'done',
          className: stav === 'late' ? 'kb-hrana-late' : undefined,
          // ⚠️ xyflow slučuje s defaultEdgeOptions MĚLCE — vlastní style nahradí
          // celý výchozí objekt, takže strokeWidth tu musí být taky
          style: { stroke: `hsl(${barva})`, strokeWidth: 2 },
          domAttributes: { 'data-stav-hrany': stav },
        };
      });

    return { visibleNodes: vNodes, visibleEdges: vEdges, hiddenCounts: counts };
  }, [nodes, edges, childrenMap]);

  // „Moje mapa": záložka, seskupení, cíle uzlů a (pře)načtení agregace —
  // hooks/usePersonalMapView.js (F1-07). Volá se tady, protože loadPersonalMap
  // čte load-efekt níž; efekty přenačtení zůstávají pod ním (pořadí spouštění).
  const {
    personalView, setPersonalView, delegatedGrouping, setDelegatedGrouping, loadPersonalMap, onNodeClick,
  } = usePersonalMapView({
    personalMap, user, t, members, setNodes, setEdges, skipNextSave, location, navigate,
    directionRef, canonicalPosRef, appliedDirRef, citelnostRef,
  });

  // Load map
  useEffect(() => {
    // ⚠️ Úklid stavu PŘEDCHOZÍ mapy. Route `/map/:id` nemá `key`, takže přechod
    // z náhledu šablony (nebo z veřejné mapy) na skutečnou mapu komponentu
    // NEPŘEMOUNTUJE — příznaky by přežily. A `isTemplatePreview`/`isPublicView`
    // vypínají autosave, takže by se nad reálnou mapou tiše ztrácely úpravy.
    // Příznaky si zapíná až ta větev, které patří.
    setIsTemplatePreview(false);
    setIsPublicView(false);
    sablonaCistaRef.current = null;
    templateSeedsRef.current = null;
    templateSeriesRef.current = null;
    (async () => {
      // „Moje mapa" — read-only agregace mých uzlů napříč projekty (žádné ukládání)
      if (personalMap) {
        setCanEdit(false);
        setCanShare(false);
        skipNextSave.current = true;
        setTitle(t('myday:myMap.title'));
        await loadPersonalMap();
        setLoading(false);
        return;
      }

      // Bez mapId není co ukazovat. Do 6. 8. 2026 tu byl sandbox „demo režim"
      // s ukázkovou mapou; demo bylo ZRUŠENO (Richard: „demo zruš") — zájemce
      // jde rovnou do registrace, kde dostane vlastní instanci a vlastní data.
      if (!mapId) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      // New map — draft mode, or template preview
      if (mapId === 'new') {
        setCanEdit(true);
        setCanShare(true);
        skipNextSave.current = true;

        // Template preview — load template structure without saving
        if (location.state?.template) {
          const tpl = location.state.template;
          setIsTemplatePreview(true);
          setTitle(tpl.title || t('defaults.newMapTitle'));
          // číslovaná série: zapamatovat PŘED replaceState (ten location.state maže)
          templateSeriesRef.current = tpl.number_format && tpl.id ? tpl.id : null;
          window.history.replaceState({}, document.title);

          // konverze sjednocena v lib/templateConvert (vč. procesních metadat)
          const { nodes: tplNodes, edges: tplEdges, idMap: tplIdMap } = templateToMap(tpl, { startDate: new Date() });
          // vestavěná pravidla šablony se založí až při skutečném uložení
          // mapy — název pravidla dle jazyka UI (task_seeds zrušeny 17. 8.)
          const tplRules = templateForLang(tpl).rules;
          templateSeedsRef.current =
            (Array.isArray(tplRules) && tplRules.length > 0)
              ? { idMap: tplIdMap, rules: tplRules }
              : null;
          // ⚠️ ČISTÁ podoba šablony se odkládá stranou. Náhled je DEMO, ve kterém
          // se dá klidně klikat (Richard 17. 8.: „funguje to jako takové demo,
          // kde nejde nic pokazit a nic se neuloží") — a „Použít šablonu" proto
          // zakládá projekt VŽDY z téhle vzorové podoby, ne z toho, co si v
          // náhledu kdo rozklikal. Bez toho se stalo tohle: uživatel si v
          // náhledu přepnul kartu na Hotovo, aby vyzkoušel kanban, a projekt pak
          // vznikl s kartou, která se narodila hotová — pravidla ještě
          // neexistovala, takže ji nikdy nic neposunulo.
          // structuredClone = pojistka: bez ní by odložená šablona sdílela objekty
          // s plátnem a jediná in-place mutace uzlu v editoru by „čistou" podobu
          // tiše ušpinila. Dnes editor nemutuje, ale nic to nehlídá.
          sablonaCistaRef.current = structuredClone({ nodes: tplNodes, edges: tplEdges, title: tpl.title || '' });
          setNodes(tplNodes);
          setEdges(tplEdges);
          // Mapa vzniká ve stylu podle zámku (jinak kompaktně) — ať to ví
          // i tlačítko. Bez toho měla čerstvá mapa prázdný popisek, první
          // stisk ji „přepnul" do stylu, ve kterém už byla, a vypadalo to,
          // že tlačítko nefunguje (Richard 12. 8.: „2× zmáčknu, než se to
          // změní"). Klíč se přenese na id mapy, jakmile ji uloží autosave.
          setAlignStyle(stylNoveMapy());
        } else {
          setTitle('');
          setNodes([]);
          setEdges([]);
        }
        setLoading(false);
        return;
      }

      try {
        if (user) {
          // Authenticated — load via SDK
          const result = await base44.entities.GoalMap.filter({ id: mapId });
          if (result && result.length > 0) {
            const m = result[0];
            const isOwner = m.created_by_id === user?.id;
            const namedEdit = (m.shared_with_edit || []).includes(user?.email);
            const hasEdit = namedEdit || m.team_access === 'edit';
            setCanEdit(isOwner || hasEdit);
            setCanShare(isOwner || namedEdit);
            setCanWork(!isOwner && !hasEdit && (m.shared_with_work || []).includes(user?.email));
            setIsMapOwner(isOwner);
            setArchived(!!m.archived);
            setMapKind(m.kind || '');
            archiveOfferShown.current = false;
            setActiveMapId(mapId);
            // B3 výchozí verze + základna merge. Otisk stavu v databázi se bere
            // hned po načtení — bez něj by prázdné uložení proklouzlo aspoň
            // jednou (hned při prvním přepnutí čitelnosti).
            zapamatujServer(m);
            setSharedCount(((m.shared_with || []).concat(m.shared_with_edit || [])).filter((v, i, a) => a.indexOf(v) === i).length);
            setOwnerEmails([user?.email, ...(m.shared_with_edit || [])].filter((v, i, a) => v && a.indexOf(v) === i));
            setMapShare({ ownerEmail: m.created_by, sharedWith: m.shared_with || [], teamAccess: m.team_access || '', sharedWithWork: m.shared_with_work || [], sharedWithEdit: m.shared_with_edit || [] });
            skipNextSave.current = true;
            setTitle(m.title || '');
            setColor(m.color || '');
            setNodes((m.nodes || []).map((n) => ({
              ...n,
              type: n.type === 'note' ? 'note' : (isApexNodeShared(n) ? 'apexNode' : 'goalNode'),
              data: { ...n.data, collapsed: n.data?.collapsed || false },
            })));
            setEdges((m.edges || []).map((e) => ({ ...e, type: 'deletable' })));
            const vada = poskozeneHrany(m.nodes || [], m.edges || []);
            setPoskozenaMapa(vada.edgeIds.length ? vada : null);
          } else {
            setNotFound(true);
          }
        } else {
          // Unauthenticated — load public map via backend function (editable but not saved)
          const result = await getPublicMap({ mapId });
          const map = result?.map;
          if (map) {
            setCanEdit(true);
            setCanShare(false);
            // Veřejně sdílená mapa NENÍ demo — nápis „Demo režim" u cizí mapy
            // mate (Richardův nález 6. 8.). Chování zůstává stejné (nic se
            // neukládá), mění se jen to, co se návštěvníkovi říká.
            setIsPublicView(true);
            skipNextSave.current = true;
            setTitle(map.title || '');
            setColor(map.color || '');
            // sdílení se z veřejného DTO záměrně NEPOSÍLÁ (osobní údaje)
            setOwnerEmails([user?.email].filter(Boolean));
            setNodes((map.nodes || []).map((n) => ({
              ...n,
              type: n.type === 'note' ? 'note' : (isApexNodeShared(n) ? 'apexNode' : 'goalNode'),
              data: { ...n.data, collapsed: n.data?.collapsed || false },
            })));
            setEdges((map.edges || []).map((e) => ({ ...e, type: 'deletable' })));
            const vadaVer = poskozeneHrany(map.nodes || [], map.edges || []);
            setPoskozenaMapa(vadaVer.edgeIds.length ? vadaVer : null);
          } else {
            setNotFound(true);
          }
        }
      } catch (e) {
        console.error(e);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
    // loadPersonalMap záměrně mimo deps — jinak by změna identity user/t
    // reloadla i BĚŽNOU mapu a zahodila rozpracované změny; „Moje mapa" má
    // na přepnutí záložky/seskupení vlastní efekt níže

    // Odchod z mapy (šipka Zpět, logo, i JINÁ mapa odkazem uvnitř editoru —
    // route /map/:id nemá key, komponenta se nepřemontuje) dřív než za 1,2 s po
    // úpravě: cleanup autosave efektu jen zrušil časovač a úprava se tiše
    // ztratila (nález F1-04). Tady se rozpracované uložení pošle hned, ještě
    // s uzávěrem a uzly STARÉ mapy (cleanup běží před načtením nové; panel 27. 8.).
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const fn = pendingSave.current;
      pendingSave.current = null;
      // `true` = flush: když PATCH právě letí, odesli NESMÍ jen přeplánovat
      // saveTimer (cleanup autosave efektu ho při unmountu vždy smaže a úprava
      // by se tiše ztratila) — počká na letící zápis a pošle stav hned
      // (kontrolní panel 31. 8. 2026; detaily v hooks/useMapAutosave.js).
      if (fn) fn(true);
    };
  }, [mapId, personalMap]);

  // „Moje mapa": přepnutí záložky (Mám udělat/Zadal jsem) nebo seskupení.
  // Dofit až PO dokončení přestavby — load je async; dřívější recenter v onClick
  // napasoval STARÝ obsah a nové uzly (hlavně 1–2) končily maličké mimo výřez.
  useEffect(() => {
    if (!personalMap || loading) return;
    loadPersonalMap().then(() => {
      setTimeout(() => { try { rfInstance?.fitView({ padding: 0.2, maxZoom: 1, duration: 300 }); } catch { /* ignore */ } }, 80);
    });
     
  }, [personalView, delegatedGrouping]);

  // „Moje mapa": adresář (členové + externí kontakty) dobíhá async — první
  // sestavení mohlo proběhnout s members=[] a jména externích ve skupinách
  // „podle lidí" jsou ZAPEČENÁ do dat uzlů (zůstala by „Externí kontakt").
  // Po dojetí/změně adresáře proto přestavět. (Nález kontrolního panelu 11. 8.)
  useEffect(() => {
    if (!personalMap || loading || !members.length) return;
    loadPersonalMap();
     
  }, [members]);

  // „Moje mapa": při změně zásobníku (nápad→volný úkol) přenačíst, ať se úkol
  // objeví bez ruční aktualizace mapy
  useEffect(() => {
    if (!personalMap || loading) return;
    loadPersonalMap();
     
  }, [buffer.items]);

  // Jen na stránce editoru vypnout zoom prohlížeče, ať dvouprstové gesto patří plátnu
  // mapy (React Flow pinch). Mimo editor (Home/Úkoly/dialogy) zůstává zoom stránky funkční.
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return undefined;
    const prev = meta.getAttribute('content');
    meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
    return () => { meta.setAttribute('content', prev || 'width=device-width, initial-scale=1.0'); };
  }, []);

  // Deep-link /map/:id?node=<id> — najet na uzel a zvýraznit ho (výběr = ring)
  useEffect(() => {
    if (highlightDone.current || loading || !rfInstance) return;
    const highlightId = new URLSearchParams(location.search).get('node');
    if (!highlightId) return;
    const node = nodes.find((n) => n.id === highlightId);
    if (!node) {
      // uzel v mapě není (smazaný / špatné id) — závoru zvednout, ať se aspoň
      // ukáže celá mapa místo zamrzlého výřezu
      if (nodes.length > 0) { highlightDone.current = true; pendingDeepLink.current = false; }
      return;
    }
    highlightDone.current = true;
    // vycentrovat cíl a nechat vidět SOUSEDY (ne maximální přiblížení na jeden uzel)
    centerOnNode(highlightId);
    // závoru držet, dokud animace nedoběhne (delay 60 + duration 500)
    setTimeout(() => { pendingDeepLink.current = false; }, 800);
    skipNextSave.current = true;
    setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === highlightId })));
  }, [loading, rfInstance, nodes, location.search, setNodes, narrow, centerOnNode]);

  // Ukládání mapy (konflikt/pruh cizí změny, základna merge + zapamatujServer,
  // saveStatus, debounced autosave vč. návrhu, nasadNaPlatno, tiché slití,
  // Ponechat moje změny, hlídač na pozadí) — hooks/useMapAutosave.js (F1-07).
  // Volá se TADY, na místě původního efektu autosave: deep-link nad tím,
  // efekt směru (useMapLayout) pod tím — pořadí efektů beze změny. Load-efekt
  // výš volá zapamatujServer a v cleanupu čte saveTimer/pendingSave (flush
  // při odchodu) — obojí hook vrací.
  const {
    conflict, remoteChanged, saveStatus, baseUpdated, zapamatujServer, zrcadliStavDoZakladny,
    saveTimer, pendingSave, nasadNaPlatno, handleKeepMine,
  } = useMapAutosave({
    mapId, activeMapId, setActiveMapId, isDraft, canEdit, isPublicView, isTemplatePreview,
    nodes, edges, title, color, setNodes, setEdges, setTitle, setColor,
    nodesNow, edgesNow, mapRulesNow, skipNextSave, cleanMapData, toast, t,
  });

  // Rozložení mapy (efekt směru, layoutAllForView, Zarovnat + zámek stylu,
  // Čitelnost) — hooks/useMapLayout.js (F1-07). Volá se TADY, na místě
  // původního efektu směru: hlídač na pozadí nad tím zůstává první, nabídka
  // archivace pod tím; vstupy už všechny existují a layoutAllForView musí
  // vzniknout dřív, než ho převezme useAiActions.
  const {
    layoutAllForView, alignStyle, setAlignStyle, alignStyleRef, alignLock,
    alignPressStart, alignPressEnd, handleAlign, citelnost, handleCitelnost,
  } = useMapLayout({
    nodes, edges, setNodes, loading, personalMap, activeMapId, isPublicView, canEdit, isMapOwner,
    user, patchUser, toast, t, pushHistory, rfInstance, skipNextSave,
    direction, updateNodeInternals, recenterMap, directionRef, appliedDirRef, canonicalPosRef,
    alignMapKeyRef, citelnostRef, pendingDeepLink,
  });

  const handleSaveTemplate = useCallback(async () => {
    if (!user) {
      // nepřihlášený návštěvník v náhledu šablony → k uložení je potřeba účet
      navigate('/register');
      return;
    }
    setSavingTemplate(true);
    try {
      // Projekt vzniká z VZOROVÉ šablony, ne z rozklikaného náhledu (viz komentář
      // u načtení náhledu). Kdo si v demu něco naklikal, o to přijde — záměr.
      const vzor = sablonaCistaRef.current;
      const { cleanNodes, cleanEdges } = vzor
        ? cleanMap(vzor.nodes, vzor.edges)
        : cleanMapData();
      // NÁZEV je výjimka: přejmenování z náhledu si uživatel ponechá (Richard
      // 17. 8.: „všiml jsem si, že když nechám název šablony, měl jsem 2 stejné
      // se stejným názvem, to je docela na nic"). Obsah čistý, jméno vlastní.
      const nazev = title.trim() || (vzor ? vzor.title : '').trim() || t('defaults.newMapTitle');
      // Přiřazení lidé se projektu nasdílí stejně jako u cesty „Nový projekt →
      // Ze šablony" (Richard 17. 8.: cesty sjednotit) — server pak rozešle
      // notifikace node_assigned. Vlastníci se berou z ČISTÉ šablony, ne
      // z plátna: co si kdo naklikal v náhledu, se nepřenáší ani tady.
      const newMap = await createProjectRecord({
        title: nazev,
        nodes: cleanNodes,
        edges: cleanEdges,
        owners: ownersFromNodes(cleanNodes), // řešitel ze šablony = spolupracovník (Richard 7. 8. 2026; nález S5-03)
        series: templateSeriesRef.current || '',
      });
      setIsTemplatePreview(false);
      setActiveMapId(newMap.id);
      setIsMapOwner(true);
      setCanShare(true);
      // ⚠️ Plátno přepnout na vzorovou podobu. Bez toho by na obrazovce zůstaly
      // rozklikané změny z náhledu a nejbližší autosave by je poslal do právě
      // založeného projektu — tedy přesně to, čemu se tahle změna vyhýbá.
      // SLÉVAT, ne vyměnit vše — velkoplošná výměna objektů bere uzlům measured
      // a plátno umí přestat kreslit hrany (viz komentář u nasadNaPlatno).
      if (vzor) {
        let vzorNodes = vzor.nodes;
        // Na úzkém displeji je plátno překlopené doprava, ale efekt směru se po
        // výměně obsahu znovu nespustí (deps [direction, loading]) — vzor nese
        // kanonické SVISLÉ pozice, takže si je sem překlopíme sami.
        // POCTIVĚ: měřeno na 700 px se rozhození projektu NEPODAŘILO vyvolat ani
        // na obrazu PŘED opravou (náhled i projekt vyšly stejně) — tohle je tedy
        // pojistka konzistence s appliedDirRef, ne oprava pozorované vady.
        if (directionRef.current === 'horizontal') {
          canonicalPosRef.current = new Map(vzorNodes.filter((n) => n.type !== 'note').map((n) => [n.id, { ...n.position }]));
          const hpos = layoutTree(vzorNodes, vzor.edges, 'horizontal', ALIGN_OPTS[alignStyleRef.current] || {});
          vzorNodes = vzorNodes.map((n) => (hpos[n.id] ? { ...n, position: hpos[n.id] } : n));
        }
        nasadNaPlatno(vzorNodes, vzor.edges);   // název zůstává uživatelův
      }
      sablonaCistaRef.current = null;
      // u číslované série server přepsal název a záznam je novější — srovnat,
      // jinak by první autosave poslal starý title (a starou verzi → 409)
      skipNextSave.current = true;
      setTitle(newMap.title || '');
      // Barva zvolená v náhledu se do projektu nesmí propašovat: create() ji
      // neposílá, ale stav `color` by ji poslal prvním autosavem — a hláška
      // přitom slibuje, že se z náhledu nepřenáší nic než název.
      setColor('');
      zapamatujServer(newMap);
      templateSeriesRef.current = null;
      // pravidla ze šablony — až teď, když mapa existuje; ref se nuluje
      // PŘED zakládáním (ochrana proti dvojímu založení)
      let pravidlaChybi = 0;
      if (templateSeedsRef.current) {
        const { idMap, rules } = templateSeedsRef.current;
        templateSeedsRef.current = null;
        try {
          const { zalozeno, celkem } = await createRulesFromTemplate(rules, idMap, newMap.id);
          pravidlaChybi = celkem - zalozeno;
        } catch (e2) {
          console.error('pravidla ze šablony', e2);
          pravidlaChybi = rules.length;
        }
      }
      window.history.replaceState(null, '', `/map/${newMap.id}`);
      // Přiznat, že se rozklikaný náhled nepřenáší — jinak by to bylo tiché
      // zahození lidské práce, i když jen z dema.
      // A hlavně: projekt bez pravidel = mrtvý kanban. Mlčet o tom nejde,
      // i když samotné založení projektu proběhlo.
      if (pravidlaChybi > 0) {
        // Text žije v líném ns `rules` (mimo jazykový balík) — lite má rozpočet
        // 490 kB a je PŘESNĚ na prahu; texty pravidel do něj nepatří.
        // ⚠️ Překládat přes i18next.t, NE přes `t` z useTranslation('editor'):
        // to je navázané na svoje ns a na dodatečně přidaný balík nedosáhne —
        // v toastu se pak ukáže holý klíč (naměřeno, ne odhad).
        await ensureNs('rules');
        toast({ title: t('toasts.mapSaved'), description: i18next.t('rules:rules.templateRulesFailed', { count: pravidlaChybi }) });
      } else {
        toast({ title: t('toasts.mapSaved'), description: t(vzor ? 'toasts.mapFromTemplateDesc' : 'toasts.mapSavedDesc') });
      }
    } catch (e) {
      console.error(e);
      toast({ title: t('toasts.error'), description: t('toasts.saveMapFailed'), variant: 'destructive' });
    } finally {
      setSavingTemplate(false);
    }
  }, [nodes, edges, title, toast, user, navigate, nasadNaPlatno]);

  // Archivace (jen vlastník; server hlídá totéž). Update jde přes stejný
  // konfliktní mechanismus jako autosave (base_updated → 409).
  const handleToggleArchive = useCallback(async () => {
    if (!activeMapId) return;
    try {
      const updated = await base44.entities.GoalMap.update(activeMapId, {
        archived: !archived,
        base_updated: baseUpdated.current,
      });
      baseUpdated.current = updated.updated_date;
      setArchived(!!updated.archived);
      toast(updated.archived
        ? { title: t('toasts.archived'), description: t('toasts.archivedDesc') }
        : { title: t('toasts.unarchived') });
    } catch (e) {
      toast({ title: t('toasts.changeFailed'), description: e?.message, variant: 'destructive' });
    }
  }, [activeMapId, archived, toast]);

  // Vše hotovo → jednorázová nabídka archivace (jen vlastník, poznámky se nepočítají)
  useEffect(() => {
    if (!isMapOwner || !activeMapId || archived || isPublicView || isTemplatePreview) return;
    if (archiveOfferShown.current) return;
    const goals = nodes.filter((n) => n.type !== 'note');
    if (goals.length === 0 || !goals.every((n) => n.data?.status === 'done')) return;
    archiveOfferShown.current = true;
    toast({
      title: t('toasts.allDone'),
      description: t('toasts.allDoneDesc'),
      action: <ToastAction altText={t('toasts.archiveAction')} onClick={handleToggleArchive}>{t('toasts.archiveAction')}</ToastAction>,
    });
  }, [nodes, isMapOwner, activeMapId, archived, isPublicView, isTemplatePreview, toast, handleToggleArchive]);

  // Hlavní uzel NEJDE smazat (Richard 2. 8.): přejmenovat ano, pryč jen s celou
  // mapou. Vrchol JE projekt — mapa bez něj je nesmysl (a MCP/API ho taky odmítá).
  const isApexNode = useCallback(
    (nodeId) => isApexNodeShared(nodes.find((x) => x.id === nodeId)),
    [nodes]
  );
  const apexDeleteRefused = useCallback(() => {
    toast({ title: t('node.apexNoDelete'), description: t('node.apexNoDeleteHint') });
  }, [toast, t]);

  // Uzel se zadaným úkolem (termínem) odstraní jen zadavatel (assignedBy,
  // u starších uzlů fallback vlastník mapy) nebo vlastník — „smazat cizí
  // zadání = odstranit důkaz" (Richard 7. 8.). Server to vynucuje na PATCH;
  // tady jen nenecháme uživatele doklikat do chyby.
  const canRemoveNodeShared = useCallback(
    (n) => jeZadavatelNeboVlastnik(n, { isMapOwner, ownerEmail: effectiveMapAccess.ownerEmail, userEmail: user?.email }),
    [isMapOwner, effectiveMapAccess.ownerEmail, user?.email]
  );
  const assignedDeleteRefused = useCallback((n) => {
    const assigner = n?.data?.assignedBy || effectiveMapAccess.ownerEmail || '';
    toast({ title: t('node.assignedNoDelete'), description: t('node.assignedNoDeleteHint', { email: assigner }) });
  }, [toast, t, effectiveMapAccess.ownerEmail]);

  const handleNodesChange = useCallback(
    (changes) => {
      let filtered = !canEdit ? changes.filter((c) => c.type !== 'remove') : changes;
      // klávesa Delete/Backspace nad vybraným vrcholem — odfiltrovat a říct proč
      const apexRemoves = filtered.filter((c) => c.type === 'remove' && isApexNode(c.id));
      if (apexRemoves.length) {
        filtered = filtered.filter((c) => !(c.type === 'remove' && isApexNode(c.id)));
        apexDeleteRefused();
      }
      // uzel s cizím zadaným úkolem — stejná mechanika jako u vrcholu
      const lockedRemove = filtered.find((c) => c.type === 'remove' && !canRemoveNodeShared(nodes.find((x) => x.id === c.id)));
      if (lockedRemove) {
        assignedDeleteRefused(nodes.find((x) => x.id === lockedRemove.id));
        filtered = filtered.filter((c) => !(c.type === 'remove' && !canRemoveNodeShared(nodes.find((x) => x.id === c.id))));
      }
      onNodesChange(filtered);
    },
    [canEdit, onNodesChange, isApexNode, apexDeleteRefused, nodes, canRemoveNodeShared, assignedDeleteRefused]
  );

  // Vrchol má deletable:false, takže ho xyflow (VČETNĚ jeho hran) z mazání
  // vynechá už při výpočtu — sem se dostane až očištěný výběr. Tady jen
  // vysvětlíme uživateli, proč se po Delete nad vrcholem „nic nestalo".
  const handleBeforeDelete = useCallback(
    ({ nodes: delNodes, edges: delEdges }) => {
      if (nodes.some((n) => n.selected && isApexNodeShared(n))) apexDeleteRefused();
      return delNodes.length > 0 || delEdges.length > 0;
    },
    [nodes, apexDeleteRefused]
  );

  const handleEdgesChange = useCallback(
    (changes) => {
      if (!canEdit) {
        onEdgesChange(changes.filter((c) => c.type !== 'remove'));
      } else {
        onEdgesChange(changes);
      }
    },
    [canEdit, onEdgesChange]
  );

  // MAPA JE STROM (lib/mapStructure.js). Spojení, které by udělalo kruh nebo
  // uzlu druhého rodiče, nesmí vzniknout — rozvržení je algoritmus pro strom a
  // na takové mapě se zacyklí (prohlížeč zatuhne na 100 % procesoru).
  // `isValidConnection` čáru rovnou obarví jako neplatnou, důvod si odložíme a
  // v `onConnectEnd` ho člověku VYSVĚTLÍME — tiché odmítnutí vypadá jako vada.
  const odmitnutoRef = useRef(null);
  const isValidConnection = useCallback(
    (spojeni) => {
      const duvod = spojeniPovoleno(edges, spojeni);
      odmitnutoRef.current = duvod;
      return !duvod;
    },
    [edges]
  );

  const onConnectStart = useCallback(() => { odmitnutoRef.current = null; }, []);

  const onConnectEnd = useCallback(() => {
    const duvod = odmitnutoRef.current;
    odmitnutoRef.current = null;
    if (!duvod) return;
    const klic = duvod === 'multiParent' ? 'connectMultiParent' : (duvod === 'cycle' ? 'connectCycle' : 'connectSelf');
    toast({ title: t(`node.${klic}`), description: t(`node.${klic}Hint`) });
  }, [toast, t]);

  const onConnect = useCallback(
    (params) => {
      // druhá závora: isValidConnection drží myš, tohle drží i klikací spojení
      if (spojeniPovoleno(edges, params)) return;
      pushHistory(); // naklikaná hrana musí jít vzít Zpět (dřív nešla)
      setEdges((eds) => addEdge(params, eds));
    },
    [edges, setEdges, pushHistory]
  );

  const handleAddGoal = useCallback(() => {
    const newId = `node-${Date.now()}`;
    pushHistory(); // přidání musí jít Vrátit zpět (stejně jako v handleAddChild)
    let position = { x: 250, y: 150 };
    if (rfInstance) {
      const center = rfInstance.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      position = { x: center.x - 110, y: center.y - 60 };
    }
    setNodes((prev) => [
      ...prev,
      {
        id: newId,
        type: 'goalNode',
        position,
        data: { title: '', status: 'todo', description: '', color: '', nodeType: 'normal', goalType: '', apexText: '' },
      },
    ]);
    setEditNodeId(newId);
  }, [rfInstance, setNodes, setEditNodeId, pushHistory]);

  const handleAddNote = useCallback(() => {
    const newId = `note-${Date.now()}`;
    let position = { x: 100, y: 100 };
    if (rfInstance) {
      const center = rfInstance.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      position = { x: center.x - 110, y: center.y - 90 };
    }
    setNodes((prev) => [
      ...prev,
      {
        id: newId,
        type: 'note',
        position,
        width: 220,
        height: 180,
        zIndex: 0,
        data: { text: '', color: '#fef9c3', width: 220, height: 180 },
      },
    ]);
  }, [rfInstance, setNodes]);

  const handleUpdateNote = useCallback(
    (nodeId, patch) => {
      setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)));
    },
    [setNodes]
  );

  const handleAddChild = useCallback(
    (parentId) => {
      const newId = `node-${Date.now()}`;
      const edgeId = `edge-${Date.now()}`;
      pushHistory(); // přidání musí jít Vrátit zpět (mazání to umělo, tohle ne)
      // volné místo přes sdílenou funkci — pevný offset od rodiče pokládal
      // nový uzel PŘES existující sourozence/potomky (Richardova reprodukce
      // na šabloně Budování startupu). Hne se JEN nový uzel, nic se nepřerovnává.
      const position = findFreeChildSpot(nodes, edges, parentId, directionRef.current);
      setNodes((prev) => {
        const parent = prev.find((n) => n.id === parentId);
        return [
          // nový uzel je vybraný (ring) — ostatní odznačit, ať je jasné, KTERÝ přibyl
          ...prev.map((n) => (n.selected ? { ...n, selected: false } : n)),
          {
            id: newId,
            type: 'goalNode',
            position,
            selected: true,
            data: {
              // org struktura: nový uzel je POZICE, ne podcíl (nález Richardova klik-testu)
              title: mapKind === 'org' ? t('editor:node.orgNewPosition') : t('tasks:tasksPage.newSubgoal'),
              status: 'todo', description: '', color: parent?.data?.color || '',
              ...(mapKind === 'org' ? { positionKind: 'position' } : {}),
            },
          },
        ];
      });
      setEdges((prev) => [...prev, { id: edgeId, source: parentId, target: newId, type: 'deletable' }]);
      // najet na nový uzel — když volné místo padne mimo výřez, uživatel by ho
      // jinak vůbec neviděl (stejná mechanika jako deep-link ?node=)
      centerOnNode(newId, { pos: position, delay: 120 });
    },
    [nodes, edges, setNodes, setEdges, pushHistory, centerOnNode, mapKind]
  );

  const handleDeleteNode = useCallback(
    (nodeId) => {
      if (isApexNode(nodeId)) { apexDeleteRefused(); return; } // vrchol jen s celou mapou
      const n = nodes.find((x) => x.id === nodeId);
      if (!canRemoveNodeShared(n)) { assignedDeleteRefused(n); return; } // cizí zadaný úkol
      pushHistory();
      setNodes((prev) => prev.filter((x) => x.id !== nodeId));
      setEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId));
    },
    [setNodes, setEdges, pushHistory, isApexNode, apexDeleteRefused, nodes, canRemoveNodeShared, assignedDeleteRefused]
  );

  const handleDeleteEdge = useCallback(
    (edgeId) => {
      pushHistory();
      setEdges((prev) => prev.filter((e) => e.id !== edgeId));
    },
    [setEdges, pushHistory]
  );

  // Zásobník: dostupnost, vložení nápadu (tlačítko/drag&drop) a odložení uzlu —
  // hooks/useBufferInsert.js (F1-07). Volá se až tady: čte pushHistory,
  // handleDeleteNode a canRemoveNodeShared; `buffer` (useBufferNodes) vzniká
  // výš, protože jeho items čte efekt „Mojí mapy".
  const {
    bufferEnabled, insertBufferItem, handleBufferDragOver, handleBufferDrop, handleStashNode,
  } = useBufferInsert({
    user, isPublicView, isTemplatePreview, nodes, edges, setNodes, setEdges, direction, rfInstance,
    pushHistory, buffer, canRemoveNodeShared, assignedDeleteRefused, handleDeleteNode, setEditNodeId, toast, t,
  });

  // Odpojení uzlu od rodiče (ikonka na uzlu) — smaže příchozí hrany
  const handleDetachNode = useCallback(
    (nodeId) => {
      pushHistory();
      setEdges((prev) => prev.filter((e) => e.target !== nodeId));
    },
    [setEdges, pushHistory]
  );

  const handleToggleCollapse = useCallback(
    (nodeId) => {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, collapsed: !n.data.collapsed } }
            : n
        )
      );
    },
    [setNodes]
  );

  // blokované „čekající" uzly (waitForChildren + nehotový podstrom)
  const waitingSet = useMemo(() => computeWaitingSet(nodes, edges), [nodes, edges]);
  // Uzly, kde mám SVOU práci: jsem garant uzlu, nebo na něm mám úkol jako
  // řešitel. Stejný předpis jako serverová kontrola v /node-status — podle něj
  // dostane ČTENÁŘ mapy tlačítka u svého kroku (a jen u něj).
  const mojePracovniUzly = useMemo(() => mojePracovniUzlyZ(nodes, mapTasks, user?.email), [nodes, mapTasks, user]);
  // Čtenář (ani vlastník, ani editor, ani spolupracovník), který v mapě přesto
  // nějakou práci má. Veřejný náhled a demo šablony se sem nepočítají — tam se
  // nic neukládá a uživatel nemusí být ani přihlášený.
  // ⚠️ A NIKDY „Moje mapa": ta je dopočítaný POHLED přes všechny projekty, ne
  // uložená mapa (`canEdit` je tam false, uzly nesou složené id `mapa::uzel`
  // a `activeMapId` k nim nepatří). Bez téhle podmínky dostal uživatel tlačítka
  // na svých kartách a klik skončil na 404 „mapa nebyla nalezena" — změřeno
  // 20. 8. 2026 na 11 z 19 karet. Skok do zdrojového projektu (onNodeClick)
  // navíc přebíjel štítek stavu, takže se ztratila i jediná funkční akce.
  const ctenarSPraci = !!user && !!activeMapId && !personalMap && !isPublicView
    && !canEdit && !canWork && mojePracovniUzly.size > 0;
  // automatizační pravidla mapy (dialog, načtení, blesk/opakování, kanban) — hooks/useMapRules.js (F1-07)
  const {
    rulesOpen, setRulesOpen, rulesDefaults, setRulesDefaults, mapRules, setMapRules,
    ruleNodes, recurrenceNodes, kanbanAktivni, kanbanNsReady, openRulesFromNode, handleEnableWaiting,
  } = useMapRules({ activeMapId, canEdit, isPublicView, setNodes, mapRulesNow });

  // spolupracovník: stav vlastního uzlu přes cílenou routu (RLS mu PATCH mapy nedá)
  const handleCycleStatusWork = useCallback(
    async (nodeId) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const current = node.data?.status || 'todo';
      if (current === 'todo' && waitingSet.has(nodeId)) {
        if (!window.confirm(t('tasks:tasksPage.confirmStartWaiting'))) return;
      }
      const next = cycleStatus(current);
      try {
        const res = await nodeStatus(activeMapId, nodeId, next);
        setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status: next } } : n)));
        zrcadliStavDoZakladny(nodeId, next);
        if (res?.updated) baseUpdated.current = res.updated;
      } catch (err) {
        // kdo smí co, rozhoduje server (garant NEBO řešitel úkolu na uzlu) —
        // lokální predikát řešitelskou větev neznal a lhal by
        if (err?.status === 403) {
          toast({ title: t('node.workOwnOnly'), description: t('node.workOwnOnlyHint'), variant: 'destructive' });
        } else {
          toast({ title: t('common:misc.statusChangeFailed'), description: err?.message, variant: 'destructive' });
        }
      }
    },
    [nodes, activeMapId, waitingSet, toast, t, setNodes]
  );

  const handleCycleStatus = useCallback(
    (nodeId) => {
      const node = nodes.find((n) => n.id === nodeId);
      const current = node?.data?.status || 'todo';
      if (current === 'todo' && waitingSet.has(nodeId)) {
        if (!window.confirm(t('tasks:tasksPage.confirmStartWaiting'))) return;
      }
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== nodeId) return n;
          return { ...n, data: { ...n.data, status: cycleStatus(n.data?.status || 'todo') } };
        })
      );
    },
    [setNodes, nodes, waitingSet]
  );

  const progressMap = useMemo(() => computeProgressMap(nodes, childrenMap), [nodes, childrenMap]);

  const handleSaveNode = useCallback(
    (nodeId, newData, nodeType) => {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId ? { ...n, type: nodeType || n.type, data: { ...n.data, ...newData } } : n
        )
      );
      // Vrchol JE projekt: barva nastavená v dialogu hlavního uzlu je barva
      // PROJEKTU — táž, kterou nastavuje paleta u řádku mapy v tabulce úkolů
      // (rámeček mapy, prstenec vrcholu, nadpis). Dřív skončila jen v
      // data.color vrcholu a nikam viditelně nevedla (Richard 6. 8. 2026 večer).
      const uzel = nodes.find((n) => n.id === nodeId);
      if (uzel?.type === 'apexNode' && newData.color !== undefined) {
        setColor(newData.color || '');
      }
      setEditNodeId(null);
    },
    [setNodes, nodes]
  );

  // AI: Poradce, chat s AI, rozpad/přepis uzlu — hooks/useAiActions.js (F1-07).
  // Volá se až tady (ne u ostatních useState nahoře): layoutAllForView a
  // centerOnNode vznikají výš v tomhle pořadí, žádný podmíněný return nad tím
  // není a výstupy (expandingNodeId, advisorOpen, chatOpen, handlery) čte
  // teprve contextValue a JSX pod ním.
  const {
    advisorOpen, setAdvisorOpen, chatOpen, setChatOpen, expandingNodeId,
    handleAcceptAdvisor, handleExpandNode, handleApplyOperations,
  } = useAiActions({
    nodes, edges, setNodes, setEdges, pushHistory, aiSnapshotRef, setCanUndoAi,
    layoutAllForView, centerOnNode, directionRef, canonicalPosRef, toast, t,
  });

  const handleDeleteSelected = useCallback(() => {
    // vrchol se z hromadného mazání vyjme — smazat ho jde jen s celou mapou;
    // výběr se čte ze stavu PŘED updaterem, ať toast a pushHistory neběží
    // uvnitř render fáze a prázdný výběr nezanechá prázdný krok v undo
    const apexSelected = nodes.some((n) => n.selected && isApexNodeShared(n));
    const selectedIds = new Set(nodes.filter((n) => n.selected && !isApexNodeShared(n)).map((n) => n.id));
    if (apexSelected) apexDeleteRefused();
    if (selectedIds.size === 0) return;
    pushHistory();
    setEdges((eds) => eds.filter((e) => !selectedIds.has(e.source) && !selectedIds.has(e.target)));
    setNodes((prev) => prev.filter((n) => !selectedIds.has(n.id)));
  }, [nodes, setNodes, setEdges, pushHistory, apexDeleteRefused]);

  const selectedNodeCount = nodes.filter((n) => n.selected).length;

  // Hromadná úprava označených cílů. Stejný merge do `data` jako handleSaveNode,
  // jen přes celý výběr — mapa je jeden JSON blob, takže autosave pošle JEDEN
  // PATCH a žádný dávkový endpoint není potřeba.
  //
  // ⚠️ Termín se u cizího zadání PŘESKAKUJE. Server (deadlineChangeDenied)
  // odmítne CELÝ PATCH mapy kvůli jedinému uzlu, na který uživatel nemá právo —
  // uživateli by se autosave tiše zasekl a nevěděl by proč. Předfiltr je tady,
  // ne v dialogu, a počet přeskočených se hlásí nahlas.
  const smiMenitTermin = useCallback(
    (n) => jeZadavatelNeboVlastnik(n, { isMapOwner, ownerEmail: effectiveMapAccess.ownerEmail, userEmail: user?.email }),
    [isMapOwner, effectiveMapAccess.ownerEmail, user?.email]
  );
  // Poznámky (lístky) NEJSOU cíle: server u nich cizí pole při normalizaci zahodí,
  // ale barvu si drží pod vlastním klíčem — hromadné přebarvení by jim ji tiše
  // sebralo (StickyNoteNode hledá hodnotu ve svém výčtu a jinak spadne na výchozí).
  // Vrchol se vylučuje taky: ten se hromadně needituje ani nemaže.
  const jeUpravitelny = (n) => n.selected && !isApexNodeShared(n) && n.type !== 'note';
  const selectedEditable = nodes.filter(jeUpravitelny);
  const selectedDeadlineOk = selectedEditable.filter(smiMenitTermin).length;

  const handleBulkApply = useCallback((zmeny) => {
    const cile = nodes.filter(jeUpravitelny);
    if (cile.length === 0) return;
    const meniTermin = Object.prototype.hasOwnProperty.call(zmeny, 'deadline');
    // „Termín je termín" (rozhodnutí 27. 7. 2026) — hromadná změna termínu se
    // potvrzuje, u ostatních polí stačí Zpět
    if (meniTermin && !window.confirm(i18next.t('hromadne:hromadne.potvrdit', { count: cile.length }))) return;

    const ids = new Set(cile.map((n) => n.id));
    let zmeneno = 0;
    let preskoceno = 0;
    const dalsi = nodes.map((n) => {
      if (!ids.has(n.id)) return n;
      const patch = { ...zmeny };
      if (meniTermin && !smiMenitTermin(n)) { delete patch.deadline; preskoceno += 1; }
      // beze změny → uzel nechat NETKNUTÝ, ať autosave ani záznamník nedostanou
      // práci zadarmo (a undo krok nevznikne z ničeho)
      const jineHodnoty = Object.keys(patch).some((k) => (n.data?.[k] || '') !== (patch[k] || ''));
      if (!jineHodnoty) return n;
      zmeneno += 1;
      return { ...n, data: { ...n.data, ...patch } };
    });

    if (zmeneno === 0) {
      // rozlišit „hodnoty už tam byly" od „nesměl jsem na to sáhnout" — druhé
      // je odmítnutí a tvářit se u něj, že se nic nezměnilo, je zavádějící
      toast(preskoceno > 0
        ? { title: i18next.t('hromadne:hromadne.terminCizi', { pocet: preskoceno, celkem: cile.length }) }
        : { title: i18next.t('hromadne:hromadne.nicSeNezmenilo') });
      setBulkOpen(false);
      return;
    }
    pushHistory();
    setNodes(dalsi);
    setBulkOpen(false);
    toast({
      title: i18next.t('hromadne:hromadne.hotovo', { count: zmeneno }),
      description: preskoceno > 0
        ? i18next.t('hromadne:hromadne.terminCizi', { pocet: preskoceno, celkem: cile.length })
        : i18next.t('hromadne:hromadne.hotovoZpet'),
    });
  }, [nodes, setNodes, pushHistory, toast, smiMenitTermin]);

  // Export obrázek/PDF/JSON — hooks/useMapExport.js (F1-07). Volá se až tady
  // (ne u ostatních useState nahoře): visibleNodes a cleanMapData vznikají
  // až pod nimi a `exporting` čte jen JSX, takže pořadí hodnot nic nemění.
  const { exporting, handleExport, handleExportJson } = useMapExport({
    visibleNodes, title, cleanMapData, activeMapId, user, t, toast,
  });

  const contextValue = useMemo(
    () => ({
      onAddChild: canEdit ? handleAddChild : undefined,
      // spolupracovník (work) uzel od 14. 8. 2026 OTEVÍRÁ taky — dostane
      // zjednodušené okno (variant="work" níže); cyklování stavu klikem na
      // odznak zůstává beze změny (anti-bloat: žádný klik navíc).
      // Od 20. 8. 2026 totéž ČTENÁŘ, ale JEN na uzlech se svou prací
      // (statusCycleNodeIds níže) — kdo dostal úkol, musí ho umět odškrtnout.
      onEditNode: canEdit || canWork || ctenarSPraci ? setEditNodeId : undefined,
      onDeleteNode: canEdit ? handleDeleteNode : undefined,
      onDeleteEdge: canEdit ? handleDeleteEdge : undefined,
      onExpandNode: canEdit && ai.has('expand') && user ? handleExpandNode : undefined,
      onToggleCollapse: handleToggleCollapse,
      onCycleStatus: canEdit ? handleCycleStatus : (canWork || ctenarSPraci ? handleCycleStatusWork : undefined),
      // null = bez omezení (vlastník, editor, spolupracovník). Množina = ČTENÁŘ:
      // štítek stavu i tužka jen tam, kde má svou práci. Kdo smí doopravdy,
      // rozhoduje server (/node-status) — tohle je jen to, co má smysl nabídnout.
      statusCycleNodeIds: canEdit || canWork ? null : mojePracovniUzly,
      onUpdateNote: canEdit ? handleUpdateNote : undefined,
      getProgress: (nodeId) => progressMap[nodeId] || 0,
      childCount: (nodeId) => hiddenCounts[nodeId] || 0,
      collapsed: (nodeId) => nodes.find((n) => n.id === nodeId)?.data?.collapsed || false,
      expandingNodeId,
      searchQuery,
      readOnly: !canEdit,
      myTasksOnly,
      currentUserEmail: user?.email,
      commentCounts,
      fileCounts,
      onStashNode: bufferEnabled && canEdit ? handleStashNode : undefined,
      onDetachNode: canEdit ? handleDetachNode : undefined,
      hasParent: (nodeId) => edges.some((e) => e.target === nodeId),
      taskStats,
      waitingSet,
      runningAgentNodes,
      ruleNodes,
      recurrenceNodes,
      onShowNodeTasks: user && activeMapId && !isPublicView ? setTaskNodeId : undefined,
      activeMapId, // pro hodinky na uzlu (start měření s map_id)
      direction, // směr stromu → konektory uzlů nahoře/dole vs vlevo/vpravo
      compactNode: personalMap, // „Moje mapa": název 1 řádek + bez progress baru → jednotná výška
      citelnost, // stupeň velikosti písma v uzlu (tlačítko Čitelnost)
      orgMap: mapKind === 'org', // organizační struktura: uzel = pozice/funkce (jiná karta)
    }),
    [handleAddChild, handleDeleteNode, handleDeleteEdge, handleExpandNode, handleToggleCollapse, handleCycleStatus, handleCycleStatusWork, canWork, ctenarSPraci, mojePracovniUzly, progressMap, hiddenCounts, nodes, edges, searchQuery, canEdit, expandingNodeId, myTasksOnly, user, commentCounts, fileCounts, handleUpdateNote, bufferEnabled, handleStashNode, handleDetachNode, taskStats, activeMapId, isPublicView, ai, waitingSet, runningAgentNodes, ruleNodes, recurrenceNodes, direction, personalMap, citelnost, mapKind]
  );

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">{t('notFound.message')}</p>
        <Button onClick={() => navigate('/')}>
          <ArrowLeft className="w-4 h-4" /> {t('notFound.backToOverview')}
        </Button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <ConflictBanners
        conflict={conflict}
        exporting={exporting}
        handleExportJson={handleExportJson}
        saveStatus={saveStatus}
        handleKeepMine={handleKeepMine}
        isPublicView={isPublicView}
        navigate={navigate}
        archived={archived}
        isMapOwner={isMapOwner}
        handleToggleArchive={handleToggleArchive}
        isTemplatePreview={isTemplatePreview}
        savingTemplate={savingTemplate}
        handleSaveTemplate={handleSaveTemplate}
        remoteChanged={remoteChanged}
      />
      <EditorToolbar
        nav={{ navigate, org }}
        layout={{
          direction, setDirMode, recenterMap, kanbanAktivni, kanbanNsReady,
          alignStyle, alignLock, handleAlign, alignPressStart, alignPressEnd,
          citelnost, handleCitelnost,
        }}
        access={{
          user, canEdit, canShare, canWork, isPublicView, isDraft, isTemplatePreview,
          isMapOwner, personalMap, archived, activeMapId, ai,
        }}
        state={{
          saveStatus, sharedCount, mapTaskCount, mapRules, chatOpen, exporting,
          visibleNodes, canUndo, personalView,
        }}
        actions={{
          setShareOpen, handleUndo, setRulesDefaults, setRulesOpen, setAdvisorOpen,
          setChatOpen, handleAddNote, setPersonalView, handleExport, handleExportJson,
          setSaveTplOpen, handleToggleArchive, handleAddGoal,
        }}
      />
      <DelegatedGroupingBar personalMap={personalMap} personalView={personalView} delegatedGrouping={delegatedGrouping} setDelegatedGrouping={setDelegatedGrouping} />
      <div
        className="flex-1 relative bg-background"
        style={color ? { borderWidth: 3, borderStyle: 'solid', borderColor: color } : undefined}
        onDragOver={bufferEnabled && canEdit ? handleBufferDragOver : undefined}
        onDrop={bufferEnabled && canEdit ? handleBufferDrop : undefined}
      >
        {/* malůvka POD plátnem — ReactFlow je proto průhledný (bg drží tenhle
            wrapper); export mapy fotí jen .react-flow, malůvku nezachytí.
            Odsazení zprava = ať ji nezakrývá minimapa (Richardův screenshot 31. 7.) */}
        {!exporting && (
          <SkinPattern
            position={`absolute inset-x-0 bottom-0 ${miniMapOpen && !narrow && !personalMap ? 'pr-56' : ''}`}
          />
        )}
        <TitleStrip
          dashboardOpen={dashboardOpen}
          railLeft={railLeft}
          nazevEditace={nazevEditace}
          canEdit={canEdit}
          title={title}
          setTitle={setTitle}
          setNazevEditace={setNazevEditace}
        />
        {dashboardOpen ? (
          <ProgressDashboard nodes={nodes} edges={edges} mapTitle={title} mapId={personalMap ? '' : (activeMapId || '')} />
        ) : (
        <GoalMapContext.Provider value={contextValue}>
        {/* adresář členů pro uzly: iniciály a bublina garanta ze ZOBRAZOVANÉHO
            jména místo e-mailu (Richard 8. 8. 2026) */}
        <MembersContext.Provider value={members}>
          <ReactFlow
            nodes={visibleNodes}
            edges={visibleEdges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onBeforeDelete={handleBeforeDelete}
            onConnect={canEdit ? onConnect : undefined}
            isValidConnection={isValidConnection}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onNodeClick={onNodeClick}
            onInit={(inst) => {
              setRfInstance(inst);
              // Dofit po inicializaci plátna: mobilní auto-překlopení směru běží
              // PŘED initem (rfInstance je v tu chvíli null a jeho fitView se
              // neprovede) — bez tohoto dofitu zůstane výřez na svislých pozicích
              setTimeout(() => {
                try { if (!pendingDeepLink.current) inst.fitView({ padding: 0.2 }); } catch { /* ignore */ }
              }, 120);
            }}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            edgesFocusable
            nodesDraggable={canEdit && !locked && direction === 'vertical'}
            nodesConnectable={canEdit && !locked && direction === 'vertical'}
            elementsSelectable={canEdit}
            selectionOnDrag
            selectionActivationKeyCode="Shift"
            panOnDrag
            selectionMode={SelectionMode.Partial}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            minZoom={0.2}
            deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : []}
            className="bg-transparent"
          >
            {!exporting && <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="hsl(var(--canvas-dots))" />}
            {/* na mobilu vyzdvihnout ovládání (+/−/fit) nad systémovou lištu, ať jde zmáčknout */}
            {!exporting && (
              <Controls
                showInteractive={false}
                style={{ marginLeft: bufferEnabled && bufferOpen ? 296 : 0, bottom: narrow ? 88 : undefined }}
              >
                {canEdit && (
                  <ControlButton
                    onClick={() => setLocked((v) => !v)}
                    title={locked ? t('controls.lockLockedTitle') : t('controls.lockUnlockedTitle')}
                    data-locked={locked ? '1' : '0'}
                    style={locked ? { background: '#ef4444', color: '#fff' } : undefined}
                  >
                    {locked ? <Lock size={14} /> : <Unlock size={14} />}
                  </ControlButton>
                )}
                <ControlButton
                  onClick={toggleTheme}
                  title={theme === 'dark' ? t('controls.themeToLight') : t('controls.themeToDark')}
                  data-theme-toggle="1"
                >
                  {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                </ControlButton>
                {/* skin jde měnit i z mapy — dialog Vzhled byl jen v hlavičce
                    titulky a z editoru se k němu nešlo dostat (Richard 31. 7.) */}
                <ControlButton
                  onClick={() => setSkinOpen(true)}
                  title={t('controls.skinTitle')}
                  data-skin-controls="1"
                >
                  <Palette size={14} />
                </ControlButton>
              </Controls>
            )}
            {/* Osobní mapa („Moje mapa" / „Zadal jsem") je SEZNAM, ne mapa
                k procházení — minimapa tam nic nepřidá a naopak překrývá
                poslední kartu (klik-test 27. 7. 2026: při 7 kartách byla
                poslední schovaná za ní). */}
            {!exporting && !narrow && !personalMap && miniMapOpen && (
              <MiniMap
                nodeColor={(node) => statusConfig[node.data?.status]?.color || 'hsl(var(--canvas-node))'}
                className="!bg-card !border"
                /* o 30 % menší než výchozí 200×150 (Richard 18. 8.) — na plátně
                   zabírala víc místa, než kolik reálně pomůže */
                style={{ width: 140, height: 105 }}
                pannable
                zoomable
              />
            )}
            {/* Minimalizace minimapy (Richard 31. 7.: překrývá malůvku skinu
                a na menších mapách jen zavazí). Tlačítko sedí v jejím rohu. */}
            {!exporting && !narrow && !personalMap && (
              <button
                type="button"
                data-minimap-toggle
                onClick={() => {
                  setMiniMapOpen((v) => { ulozKlic('kb-minimap-open', v ? '0' : '1'); return !v; });
                }}
                title={miniMapOpen ? t('controls.minimapHide') : t('controls.minimapShow')}
                aria-label={miniMapOpen ? t('controls.minimapHide') : t('controls.minimapShow')}
                className="absolute bottom-2 right-2 z-10 w-7 h-7 rounded-md border bg-card text-muted-foreground hover:text-foreground flex items-center justify-center shadow-sm"
              >
                {miniMapOpen ? <ChevronDown className="w-4 h-4" /> : <MapIcon className="w-4 h-4" />}
              </button>
            )}
          </ReactFlow>
          {canEdit && selectedNodeCount > 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2 rounded-xl border bg-card shadow-lg">
              <span className="text-sm font-medium text-muted-foreground">
                {t('selection.selected', { count: selectedNodeCount })}
              </span>
              {/* Když ve výběru není žádný SKUTEČNÝ cíl (jen vrchol nebo poznámky),
                  tlačítko se nenabízí — jinak se otevře „Upravit 0 cílů" a klik
                  na Použít mlčky neudělá nic. */}
              {selectedEditable.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkOpen(true)}
                data-bulk-open
              >
                <SlidersHorizontal className="w-4 h-4" />
                {t('selection.editSelection')}
              </Button>
              )}
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteSelected}
              >
                <Trash2 className="w-4 h-4" />
                {t('selection.deleteSelection')}
              </Button>
            </div>
          )}
          {canEdit && bulkOpen && (
            <BulkEditDialog
              open={bulkOpen}
              onOpenChange={setBulkOpen}
              pocet={selectedEditable.length}
              pocetSmiTermin={selectedDeadlineOk}
              mapAccess={effectiveMapAccess}
              members={members}
              onShareAdd={handleShareAdd}
              onContactsChanged={reloadMembers}
              onApply={handleBulkApply}
            />
          )}
        </MembersContext.Provider>
        </GoalMapContext.Provider>
        )}
        <LeftRail
          bufferEnabled={bufferEnabled}
          dashboardOpen={dashboardOpen}
          buffer={buffer}
          canEdit={canEdit}
          insertBufferItem={insertBufferItem}
          bufferOpen={bufferOpen}
          toggleBuffer={toggleBuffer}
          timeLogOpen={timeLogOpen}
          user={user}
          isPublicView={isPublicView}
          activeMapId={activeMapId}
          mapId={mapId}
          nodes={nodes}
          toggleTimeLog={toggleTimeLog}
          railLeft={railLeft}
          searchOpen={searchOpen}
          setSearchOpen={setSearchOpen}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          myTasksOnly={myTasksOnly}
          setMyTasksOnly={setMyTasksOnly}
          setDashboardOpen={setDashboardOpen}
        />
        {canEdit && nodes.length === 0 && !dashboardOpen && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center pointer-events-auto">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Target className="w-8 h-8 text-primary" />
              </div>
              <p className="text-muted-foreground text-sm mb-4">
                {t('empty.start')}
              </p>
              <Button onClick={handleAddGoal}>
                <Plus className="w-4 h-4" /> {t('empty.createApex')}
              </Button>
            </div>
          </div>
        )}
      </div>
      <EditorDialogs
        mapa={{
          activeMapId, mapId, mapKind, title, nodes, edges, members, effectiveMapAccess,
          ownerOptions, isMapOwner, mapRules,
        }}
        access={{ user, canEdit, canWork, ctenarSPraci, isPublicView, bufferEnabled }}
        node={{
          editNode, handleSaveNode, setEditNodeId, handleShareAdd, handleStashNode,
          setTaskStatsVersion, reloadMembers, setNodes, zrcadliStavDoZakladny, baseUpdated,
          openRulesFromNode, setMapRules,
        }}
        dialogs={{
          rulesOpen, rulesDefaults, setRulesOpen, handleEnableWaiting,
          taskNodeId, setTaskNodeId, saveTplOpen, setSaveTplOpen, skinOpen, setSkinOpen,
          shareOpen, setShareOpen, advisorOpen, setAdvisorOpen, handleAcceptAdvisor,
        }}
        ai={{ chatOpen, setChatOpen, handleApplyOperations, handleUndoAi, canUndoAi }}
      />
    </div>
  );
}

export default function GoalMapEditor({ personalMap = false }) {
  const { id } = useParams();
  return (
    <ReactFlowProvider>
      <EditorContent mapId={id} personalMap={personalMap} />
    </ReactFlowProvider>
  );
}
