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
  useUpdateNodeInternals,
  addEdge,
  SelectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { base44 } from '@/api/base44Client';
import { pb } from '@/api/pb';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Plus, Loader2, Check, Target, Trash2, Download, Search, X, Sparkles, Share2, Eye, Users, Undo2, MessageSquare, Filter, BarChart3, StickyNote, AlignCenter, CheckSquare, MoreVertical, LayoutGrid, Archive, ArchiveRestore, Lock, Unlock, Sun, Moon, FileJson, ChevronDown, Map as MapIcon, Palette, StretchHorizontal, Shrink, Maximize, ALargeSmall, Type, Heading, Zap, Columns3 } from 'lucide-react';
import ShareDialog from '@/components/goal-map/ShareDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import GoalNode from '@/components/goal-map/GoalNode';
import { MembersContext, labelForEmail } from '@/lib/memberLabel';
import { isExternalOwner, useMembersWithContacts } from '@/lib/externalContacts';
import SkinPattern from '@/components/shared/SkinPattern';
import ApexGoalNode from '@/components/goal-map/ApexGoalNode';
import StickyNoteNode from '@/components/goal-map/StickyNoteNode';
import PersonalRootNode from '@/components/goal-map/PersonalRootNode';
import DeletableEdge from '@/components/goal-map/DeletableEdge';
import NodeEditDialog from '@/components/shared/NodeEditDialog';
import RecurrenceSwitch from '@/components/node-dialog/sections/RecurrenceSwitch';
import { recurrenceOf } from '@/lib/recurrenceRule';
import RulesDialog from '@/components/rules/RulesDialog';
import NodeRulesPanel from '@/components/rules/NodeRulesPanel';
import UnblockRulesHint from '@/components/rules/UnblockRulesHint';
import { rulesApi } from '@/components/rules/rulesApi';
import SkinDialog from '@/components/shared/SkinDialog';
import UserMenu from '@/components/shared/UserMenu';
import AdvisorDialog from '@/components/goal-map/AdvisorDialog';
import AIChatPanel from '@/components/goal-map/AIChatPanel';
import BufferPanel, { useBufferNodes, BUFFER_DRAG_MIME } from '@/components/goal-map/BufferPanel';
import TimeLogPanel from '@/components/time/TimeLogPanel';
import ProgressDashboard from '@/components/goal-map/ProgressDashboard';
import { advisor } from '@/functions/advisor';
import { shareMap } from '@/functions/shareMap';
import { layoutTree, findFreeChildSpot } from '@/lib/treeLayout';
import { isApexNode as isApexNodeShared, advisorPreviewToMap } from '@/lib/mapNodes';
import { spojeniPovoleno, poskozeneHrany } from '@/lib/mapStructure';
import { cleanMapData as cleanMap } from '@/lib/cleanMap';
import { buildMapExport, downloadJson, exportFilename } from '@/lib/mapPortable';
import { useMapDirection } from '@/lib/useMapDirection';
import GoalMapContext from '@/components/goal-map/GoalMapContext';
import { useToast } from '@/components/ui/use-toast';
import { useLazyNs } from '@/i18n/lazyNs';
import { ToastAction } from '@/components/ui/toast';
import { captureAndSave } from '@/lib/mapExport';
import { getPublicMap } from '@/functions/getPublicMap';
import { useAiModes } from '@/hooks/useAiEnabled';
import { effectiveTheme, setTheme } from '@/lib/theme';
import NotificationBell from '@/components/shared/NotificationBell';
import { statusConfig, cycleStatus } from '@/lib/statusMeta';
import NodeTasksDialog from '@/components/tasks/NodeTasksDialog';
import SaveTemplateDialog from '@/components/shared/SaveTemplateDialog';
import { templateToMap, templateForLang } from '@/lib/templateConvert';
import { ALIGN_STYLES, ALIGN_OPTS, KLIC_ZAMEK, zamcenyStyl, platnyStyl, stylNoveMapy } from '@/lib/alignStyles';
import { createRulesFromTemplate } from '@/lib/createProject';
import { computeWaitingSet, findBlockingForOwner } from '@/lib/waitStatus';
import { nactiKlic, ulozKlic } from '@/lib/storageKeys';
import { KLIC_CITELNOST, nactiStupen, dalsiStupen } from '@/lib/citelnost';

const nodeTypes = { goalNode: GoalNode, apexNode: ApexGoalNode, note: StickyNoteNode, personalRoot: PersonalRootNode };
const edgeTypes = { deletable: DeletableEdge };

const defaultEdgeOptions = {
  type: 'deletable',
  animated: true,
  style: { stroke: 'hsl(var(--canvas-edge))', strokeWidth: 2 },
};

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

// těsnější rozestupy pro „Moje mapu" (plochá struktura pod „Já" → jinak velké mezery).
// Slot musí být ≥ velikost uzlu (uzly s popisem jsou vysoké) — jinak se překrývají:
// vodorovně stackují sourozence na Y (slot = výška), svisle vedle sebe na X (slot = šířka).
// Krok mezi úrovněmi musí být ≥ rozměr uzlu v ose úrovní: vodorovně = ŠÍŘKA uzlu
// (jinak se řady 2/3 překrývají do strany), svisle = VÝŠKA. Slot = rozestup sourozenců.
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

// Styl zvolený v „Moje mapě". Bez tohohle si popisek styl pamatoval, ale mapa
// se pokaždé stavěla klasicky — tlačítko tedy hlásilo něco, co na plátně
// nebylo (panel /checkup 12. 8.; táž vada, jakou vlna opravovala pro běžné mapy).
const optsMojiMapy = () => ALIGN_OPTS[platnyStyl(nactiKlic('kb-zarovnat-styl:moje-mapa'))] || {};

// ⚠️ VODOROVNÝ `slot` MUSÍ BÝT VĚTŠÍ NEŽ VÝŠKA KARTY — je to příčná osa, na
// které se sourozenci řadí pod sebe, takže při rovnosti se karty dotknou.
// Kompaktní karta „Mojí mapy" má naměřeno 108 / 116 / 120 px podle stupně
// Čitelnosti (product/tests/vysky-karet.js), takže ve stupni „jen název"
// sedí PŘESNĚ na starém slotu 120 — a na telefonu se dva uzly reálně
// překrývaly (změřeno 13. 8. 2026). Slot proto v tomhle stupni povyroste.
// Pozice „Mojí mapy" se NIKAM NEUKLÁDAJÍ (je to read-only agregát počítaný
// při každém vykreslení), takže se tím nic v datech nemění.
const PERSONAL_LAYOUT = (direction, citelnost) => direction === 'horizontal'
  ? { slot: citelnost === 'titleOnly' ? 136 : 120, step: 300, apexStep: 200 } // kruh 120 + mezera 80
  // apexStep i svisle: kořen „Já" je kruh 120 (ne apex 260) — bez toho by
  // default 380 zdvojnásobil mezeru pod kořenem (checkup před v0.13.2)
  : { slot: 245, step: 210, apexStep: 210 };

// „Moje mapa": read-only agregace mých uzlů napříč projekty (jen odkazy, ne kopie).
// Kořen „Já"; hierarchie se drží JEN mezi mými uzly (cizí mezičlánky se vynechají);
// + moje úkoly s termínem jako listy. Vrací i `targets` (vid→zdroj).
function buildPersonalMap(maps, tasks, email, rootLabel) {
  const targets = {};
  if (!email) return { nodes: [], edges: [], targets };
  // archivované projekty do osobního přehledu nepatří (uzly ani jejich úkoly) —
  // stejně jako panel Můj den a serverový digest
  const archivedIds = new Set(maps.filter((m) => m.archived).map((m) => m.id));
  const shown = new Set();
  // sběr položek (uzel + hrana + termín); pushneme až SEŘAZENÉ dle termínu, aby
  // sourozenci šli zleva od nejbližšího termínu (bez termínu na konec)
  const items = [];
  // Struktura kopíruje PROJEKTY (Richard 11. 8.: „moje mapa má řešit více
  // projektů… proč nevypadá stejně a jde do šířky?" — 18 položek jednoho
  // projektu viselo vedle sebe přímo pod kořenem). Pod kořenem je uzel za
  // každý projekt (klik → mapa) a POD ním moje uzly zavěšené přes SKUTEČNÉ
  // mezičlánky projektu — i cizí/nepřiřazené (jen kontext, klik vede do mapy).
  const projItems = {};
  const apexOf = (m) => ((m.nodes || []).find((n) => String(n.type || '').startsWith('apex')) || {}).id || '';
  const ensureProject = (m) => {
    if (projItems[m.id]) return projItems[m.id];
    const vid = `proj::${m.id}`;
    targets[vid] = { type: 'node', mapId: m.id, nodeId: apexOf(m) };
    const it = {
      deadline: '',
      node: { id: vid, type: 'goalNode', position: { x: 0, y: 0 }, data: {
        nodeType: 'normal', collapsed: false, title: m.title || '—', status: 'todo',
        deadline: '', owner: '', color: m.color || '#64748b', description: '' } },
      edge: { id: `pe-${vid}`, source: 'me', target: vid, type: 'deletable' },
    };
    projItems[m.id] = it;
    items.push(it);
    return it;
  };
  const mapById = {};
  for (const m of maps) mapById[m.id] = m;
  for (const m of maps) {
    if (m.archived) continue;
    const mine = new Set();
    const byId = {};
    for (const n of (m.nodes || [])) {
      byId[n.id] = n;
      const d = n.data || {};
      if (n.type !== 'note' && d.owner === email && d.status !== 'done') mine.add(n.id);
    }
    if (!mine.size) continue;
    ensureProject(m);
    const apex = apexOf(m);
    const blocking = findBlockingForOwner(m.nodes || [], m.edges || [], email); // moje uzly, co blokují cizí
    const parentOf = {};
    for (const e of (m.edges || [])) parentOf[e.target] = e.source;
    // mezičlánky: celý řetěz předků mých uzlů až k vrcholu (vrchol zastupuje
    // uzel projektu) — díky tomu má větev projektu STEJNÝ tvar jako mapa
    const context = new Set();
    for (const nid of mine) {
      let p = parentOf[nid]; const seen = new Set();
      while (p && p !== apex && !seen.has(p)) {
        if (!mine.has(p) && byId[p] && byId[p].type !== 'note') context.add(p);
        seen.add(p); p = parentOf[p];
      }
    }
    for (const nid of mine) shown.add(`${m.id}::${nid}`);
    const included = (id) => mine.has(id) || context.has(id);
    const sourceFor = (nid) => {
      const p = parentOf[nid];
      if (!p || p === apex || !included(p)) return `proj::${m.id}`;
      return `${m.id}::${p}`;
    };
    for (const nid of [...mine, ...context]) {
      const d = byId[nid].data || {};
      const vid = `${m.id}::${nid}`;
      targets[vid] = { type: 'node', mapId: m.id, nodeId: nid };
      items.push({
        deadline: d.deadline || '',
        // popis vynecháme → uzly mají jednotnou výšku a rozestup jde rovnoměrně těsný
        node: { id: vid, type: 'goalNode', position: { x: 0, y: 0 }, data: { ...d, nodeType: 'normal', collapsed: false, description: '', title: d.title || d.apexText || '—', blocks: mine.has(nid) ? (blocking[nid] || '') : '' } },
        edge: { id: `pe-${vid}`, source: sourceFor(nid), target: vid, type: 'deletable' },
      });
    }
  }
  for (const tk of tasks) {
    if (tk.parent_id || tk.status === 'done') continue;
    if (tk.map_id && archivedIds.has(tk.map_id)) continue;
    const mineTask = tk.assignee_email === email || (tk.created_by === email && !tk.assignee_email);
    if (!mineTask) continue;
    // úkol vždy patří do projektu — jako list se ukazuje jen s termínem
    // (klik vede na uzel/mapu projektu); legacy úkol bez mapy = fallback na dialog
    if (tk.map_id && !tk.deadline) continue;
    if (tk.map_id && tk.node_id && shown.has(`${tk.map_id}::${tk.node_id}`)) continue;
    const vid = `task::${tk.id}`;
    targets[vid] = tk.map_id ? { type: 'node', mapId: tk.map_id, nodeId: tk.node_id } : { type: 'task', taskId: tk.id };
    // úkol s projektem visí pod SVÝM projektem; bez mapy (legacy) pod kořenem
    const proj = tk.map_id && mapById[tk.map_id] && !mapById[tk.map_id].archived ? ensureProject(mapById[tk.map_id]) : null;
    items.push({
      deadline: tk.deadline || '',
      node: { id: vid, type: 'goalNode', position: { x: 0, y: 0 }, data: { nodeType: 'normal', collapsed: false, title: tk.title, status: tk.status, deadline: tk.deadline || '', owner: '', color: '' } },
      edge: { id: `pe-${vid}`, source: proj ? proj.node.id : 'me', target: vid, type: 'deletable' },
    });
  }
  // řazení dle NEJBLIŽŠÍHO termínu v celém PODSTROMU — větev se posune podle
  // nejdřívějšího potomka (uzel bez termínu, ale s brzkým potomkem, jde dopředu)
  const childrenOf = {};
  const deadlineOf = {};
  for (const it of items) {
    deadlineOf[it.node.id] = it.deadline || '9999-99-99';
    (childrenOf[it.edge.source] = childrenOf[it.edge.source] || []).push(it.node.id);
  }
  const subMinCache = {};
  const subMin = (vid) => {
    if (subMinCache[vid] !== undefined) return subMinCache[vid];
    subMinCache[vid] = '…'; // ochrana proti cyklu
    let m = deadlineOf[vid] || '9999-99-99';
    for (const c of (childrenOf[vid] || [])) { const cm = subMin(c); if (cm < m) m = cm; }
    subMinCache[vid] = m;
    return m;
  };
  items.sort((a, b) => subMin(a.node.id).localeCompare(subMin(b.node.id)));
  const nodes = [{ id: 'me', type: 'personalRoot', position: { x: 0, y: 0 }, data: { title: rootLabel } }];
  const edges = [];
  items.forEach((it, i) => {
    it.node.position = { x: i, y: 0 }; // pořadí dle termínu (crossOf) pro layoutTree
    nodes.push(it.node);
    edges.push(it.edge);
  });
  const pos = layoutTree(nodes, edges, 'vertical', { ...PERSONAL_LAYOUT('vertical'), ...optsMojiMapy() });
  for (const n of nodes) { const p = pos[n.id]; if (p) n.position = { x: p.x, y: p.y }; }
  return { nodes, edges, targets };
}

// „Zadal jsem" — druhá záložka Mojí mapy: položky, které jsem zadal JINÝM.
// Uzly s owner≠já v MÝCH mapách + úkoly, které jsem zadal (created_by=já,
// řešitel≠já); dedup jako panel Můj den (úkol na uzlu téhož řešitele počítá
// uzel). grouping: 'flat' (dle termínu) | 'people' (dle lidí) | 'projects'.
function buildDelegatedMap(maps, tasks, email, rootLabel, grouping, members = []) {
  const targets = {};
  if (!email) return { nodes: [], edges: [], targets };
  const items = []; // { deadline, assignee, project, node }
  const nodeByKey = {};
  const mapById = {};
  for (const m of maps) {
    mapById[m.id] = m;
    if (m.archived) continue;
    const iOwn = m.created_by === email;
    for (const n of (m.nodes || [])) {
      if (n.type === 'note') continue;
      const d = n.data || {};
      nodeByKey[`${m.id}:${n.id}`] = { owner: d.owner || '', mapOwner: m.created_by };
      if (!iOwn || !d.owner || d.owner === email || d.status === 'done') continue;
      const vid = `${m.id}::${n.id}`;
      targets[vid] = { type: 'node', mapId: m.id, nodeId: n.id };
      items.push({
        deadline: d.deadline || '', assignee: d.owner, project: m.title || '—', projectId: m.id,
        node: { id: vid, type: 'goalNode', position: { x: 0, y: 0 }, data: { ...d, nodeType: 'normal', collapsed: false, description: '', title: d.title || d.apexText || '—' } },
      });
    }
  }
  for (const tk of tasks) {
    if (tk.parent_id || tk.status === 'done') continue;
    if (tk.map_id && mapById[tk.map_id]?.archived) continue; // archiv do přehledu nepatří
    if (tk.created_by !== email || !tk.assignee_email || tk.assignee_email === email) continue;
    const node = tk.map_id && tk.node_id ? nodeByKey[`${tk.map_id}:${tk.node_id}`] : null;
    if (node && node.mapOwner === email && node.owner === tk.assignee_email) continue; // fold do uzlu
    const vid = `task::${tk.id}`;
    targets[vid] = tk.node_id ? { type: 'node', mapId: tk.map_id, nodeId: tk.node_id } : { type: 'task', taskId: tk.id };
    items.push({
      deadline: tk.deadline || '', assignee: tk.assignee_email, project: mapById[tk.map_id]?.title || '—', projectId: tk.map_id || '',
      node: { id: vid, type: 'goalNode', position: { x: 0, y: 0 }, data: { nodeType: 'normal', collapsed: false, title: tk.title, status: tk.status, deadline: tk.deadline || '', owner: tk.assignee_email, color: '' } },
    });
  }
  const nodes = [{ id: 'me', type: 'personalRoot', position: { x: 0, y: 0 }, data: { title: rootLabel } }];
  const edges = [];
  const byDeadline = (a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999');
  let order = 0;
  if (grouping === 'flat') {
    items.sort(byDeadline);
    for (const it of items) {
      it.node.position = { x: order++, y: 0 }; // pořadí dle termínu (crossOf) pro layoutTree
      nodes.push(it.node);
      edges.push({ id: `pe-${it.node.id}`, source: 'me', target: it.node.id, type: 'deletable' });
    }
  } else {
    // mezistupeň = člověk/projekt; skupiny řazené dle nejbližšího termínu uvnitř.
    // Projekty klíčovat ID (dva stejně pojmenované projekty se nesmí slít).
    const keyOf = grouping === 'people' ? (it) => it.assignee : (it) => it.projectId;
    // externí kontakt se ukazuje JMÉNEM (pseudo-e-mail nikdy); členové zůstávají
    // e-mailem jako dosud — jméno se u nich řeší až v uzlu (labelForEmail v GoalNode)
    const labelOf = grouping === 'people'
      ? (it) => (isExternalOwner(it.assignee) ? labelForEmail(members, it.assignee) : it.assignee)
      : (it) => it.project;
    const groups = {};
    for (const it of items) {
      const k = keyOf(it);
      (groups[k] = groups[k] || { key: k, label: labelOf(it), list: [] }).list.push(it);
    }
    const entries = Object.values(groups);
    for (const g of entries) g.list.sort(byDeadline);
    entries.sort((a, b) => (a.list[0]?.deadline || '9999').localeCompare(b.list[0]?.deadline || '9999'));
    for (const { key, label, list } of entries) {
      const gid = `grp::${key}`;
      nodes.push({ id: gid, type: 'goalNode', position: { x: order++, y: 0 }, data: {
        nodeType: 'normal', collapsed: false, title: label, status: 'todo', deadline: '', color: '#64748b',
        owner: grouping === 'people' ? label : '', description: '',
      } });
      edges.push({ id: `pe-${gid}`, source: 'me', target: gid, type: 'deletable' });
      for (const it of list) {
        it.node.position = { x: order++, y: 0 };
        nodes.push(it.node);
        edges.push({ id: `pe-${it.node.id}`, source: gid, target: it.node.id, type: 'deletable' });
      }
    }
  }
  const pos = layoutTree(nodes, edges, 'vertical', { ...PERSONAL_LAYOUT('vertical'), ...optsMojiMapy() });
  for (const n of nodes) { const p = pos[n.id]; if (p) n.position = { x: p.x, y: p.y }; }
  return { nodes, edges, targets };
}

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
  // směr rozložení mapy (na výšku/na šířku); na mobilu se v režimu auto překlopí
  const { setMode: setDirMode, direction, narrow } = useMapDirection();
  const updateNodeInternals = useUpdateNodeInternals(); // přeměřit konektory po změně strany (jinak hrany vedou ke staré pozici)
  // zámek proti omylnému posunu uzlu (hlavně na mobilu) — default zamčeno na malém displeji
  const [locked, setLocked] = useState(narrow);
  // motiv (světlý/tmavý) — přesunut z lišty dolů k ovládání mapy
  const [theme, setThemeState] = useState(effectiveTheme);
  const toggleTheme = () => { const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next); setThemeState(next); };
  const recenterMap = () => { setTimeout(() => { try { rfInstance?.fitView({ padding: 0.2, duration: 300 }); } catch { /* ignore */ } }, 60); };
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [conflict, setConflict] = useState(false); // B3: mapa změněna z jiného místa
  // Hlídání na pozadí zjistilo cizí změnu DŘÍV, než uživatel začal psát.
  // Ukazuje se jako nenásilný pruh, ne dialog — nic se ještě nerozbilo.
  const [remoteChanged, setRemoteChanged] = useState(false);
  // Uzly tak, jak je naposledy znal server. Podle nich se pozná, JESTLI je cizí
  // změna jen posun stavu (automatizace doběhla, kolega odškrtl) — to jde slít
  // tiše — nebo skutečná kolize obsahu, kde se musí zeptat člověk.
  const serverNodes = useRef([]);
  // otisk toho, co už v databázi JE — aby autosave neposílal prázdné uložení
  // (viz „PRÁZDNÉ ULOŽENÍ SE NEPOSÍLÁ" u saveTimer). `null` = zatím nevíme,
  // pak se porovnání nikdy netrefí a chová se to jako dřív.
  const ulozenyOtisk = useRef(null);
  // Stupeň Čitelnosti přes ref: rozestupy „Mojí mapy" ho potřebují v callbacích,
  // které vznikají DŘÍV, než se stav deklaruje (viz PERSONAL_LAYOUT). Výchozí
  // hodnota se čte z prohlížeče, ať první vykreslení nesedí vedle.
  const citelnostRef = useRef(nactiStupen());
  const [saveStatus, setSaveStatus] = useState('idle');
  const [editNodeId, setEditNodeId] = useState(null);
  const [exporting, setExporting] = useState(false);
  // minimapa jde schovat — překrývá malůvku skinu a na malých mapách zavazí
  const [miniMapOpen, setMiniMapOpen] = useState(() => nactiKlic('kb-minimap-open') !== '0');
  const [skinOpen, setSkinOpen] = useState(false);   // dialog Vzhled i z editoru
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const ai = useAiModes();
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false); // lupa v levé liště
  const [rfInstance, setRfInstance] = useState(null);
  const [canEdit, setCanEdit] = useState(true);
  const personalTargets = useRef({}); // „Moje mapa": vid uzlu → { type, mapId/nodeId/taskId }
  // „Moje mapa": záložka mine=„Mám udělat" / delegated=„Zadal jsem" (?view=delegated)
  // + seskupení záložky Zadal jsem (flat=dle termínu / people / projects)
  const [personalView, setPersonalView] = useState(() =>
    new URLSearchParams(location.search).get('view') === 'delegated' ? 'delegated' : 'mine');
  const [delegatedGrouping, setDelegatedGrouping] = useState(() => nactiKlic('kb-delegated-grouping') || 'flat');
  const [sharedCount, setSharedCount] = useState(0);
  const [isPublicView, setIsPublicView] = useState(false);  // veřejně sdílená mapa ≠ demo
  const [activeMapId, setActiveMapId] = useState(null);
  const [isTemplatePreview, setIsTemplatePreview] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [expandingNodeId, setExpandingNodeId] = useState(null);
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  const [ownerEmails, setOwnerEmails] = useState([]);
  // Deep-link /map/:id?view=dashboard — druhá cesta k dashboardu z dlaždice
  // projektu na titulce („šéf se ptá, v jaké fázi to je" → jeden klik).
  // Tlačítko v liště je pod 1850 px schované v ⋮ menu, takže tohle není zdvojení,
  // ale jediná rychlá cesta na běžném notebooku.
  const [dashboardOpen, setDashboardOpen] = useState(
    () => new URLSearchParams(location.search).get('view') === 'dashboard');
  const [commentCounts, setCommentCounts] = useState({});
  const [taskStats, setTaskStats] = useState({});
  const [mapTasks, setMapTasks] = useState([]);
  const [mapTaskCount, setMapTaskCount] = useState(0);
  const [taskStatsVersion, setTaskStatsVersion] = useState(0);
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
  const baseUpdated = useRef(null); // B3: poslední známé updated_date pro detekci konfliktu
  // PATCH mapy právě letí — hlídání na pozadí musí mlčet, jinak GET verze
  // předběhne odpověď vlastního uložení a vyrobí falešný poplach.
  const saveInFlight = useRef(false);
  const directionRef = useRef('vertical'); // aktuální směr pro save/handlery (bez re-renderu)
  const appliedDirRef = useRef('vertical'); // směr posledního přerovnání view (detekce překlopení)
  const canonicalPosRef = useRef(new Map()); // svislé (kanonické) pozice — vodorovné view je NEpřepisuje
  const alignMapKeyRef = useRef(null); // klíč stylu TÉTO mapy — čte i AI přelayout, který nemá závislosti
  const templateSeriesRef = useRef(null); // id číslované šablony z náhledu (state maže replaceState)
  const templateSeedsRef = useRef(null); // {idMap, rules} z náhledu šablony — pravidla se založí až s mapou
  const saveTimer = useRef(null);
  const historyRef = useRef([]);
  const [canUndo, setCanUndo] = useState(false);
  const aiSnapshotRef = useRef(null);
  const [canUndoAi, setCanUndoAi] = useState(false);
  const buffer = useBufferNodes(user);
  const [bufferOpen, setBufferOpen] = useState(() => nactiKlic('kb-buffer-open') === '1');
  // levé panely (zásobník × měření času) se vzájemně vylučují — překrývaly by se
  const [timeLogOpen, setTimeLogOpen] = useState(() =>
    nactiKlic('kb-timelog-open') === '1' && nactiKlic('kb-buffer-open') !== '1');
  const toggleBuffer = useCallback(() => {
    setBufferOpen((v) => {
      ulozKlic('kb-buffer-open', v ? '0' : '1');
      if (!v) { setTimeLogOpen(false); ulozKlic('kb-timelog-open', '0'); }
      return !v;
    });
  }, []);
  const toggleTimeLog = useCallback(() => {
    setTimeLogOpen((v) => {
      ulozKlic('kb-timelog-open', v ? '0' : '1');
      if (!v) { setBufferOpen(false); ulozKlic('kb-buffer-open', '0'); }
      return !v;
    });
  }, []);

  const pushHistory = useCallback(() => {
    historyRef.current.push({ nodes, edges });
    if (historyRef.current.length > 50) historyRef.current.shift();
    setCanUndo(historyRef.current.length > 0);
  }, [nodes, edges]);

  const handleUndo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current.pop();
    skipNextSave.current = true;
    setNodes(prev.nodes.map((n) => ({ ...n })));
    setEdges(prev.edges.map((e) => ({ ...e })));
    setCanUndo(historyRef.current.length > 0);
  }, [setNodes, setEdges]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const res = await shareMap({ action: 'share', mapId: activeMapId, email, permission: 'work' });
      if (res.data?.error) {
        toast({ title: t('tasks:tasksPage.shareFailed'), description: res.data.error, variant: 'destructive' });
        return false;
      }
      // sdílení bumplo `updated` mapy → posunout základ, jinak následné uložení
      // uzlu (owner+termín) spadne na 409 a přisdílená osoba/termín se ztratí
      if (res.data?.updated) baseUpdated.current = res.data.updated;
      setMapShare((s) => ({ ...s, sharedWith: [...(s?.sharedWith || []), email] }));
      setSharedCount((c) => c + 1);
      toast({ title: t('tasks:tasksPage.mapShared'), description: t('tasks:tasksPage.mapSharedDesc', { email }) });
      return true;
    } catch (e) {
      const msg = e.response?.data?.error || t('tasks:tasksPage.shareOwnerOnly');
      toast({ title: t('tasks:tasksPage.shareFailed'), description: msg, variant: 'destructive' });
      return false;
    }
  }, [activeMapId, toast]);
  const isDraft = mapId === 'new' && !activeMapId;
  // Zásobník jen pro přihlášené a mimo demo/náhled šablony (tam se mapa neukládá
  // a vložení by nápad ze zásobníku nenávratně spotřebovalo)
  const bufferEnabled = !!user && !isPublicView && !isTemplatePreview;

  // Build children map from edges
  const childrenMap = useMemo(() => {
    const map = {};
    for (const edge of edges) {
      if (!map[edge.source]) map[edge.source] = [];
      map[edge.source].push(edge.target);
    }
    return map;
  }, [edges]);

  // Compute visible nodes/edges based on collapsed state
  const { visibleNodes, visibleEdges, hiddenCounts } = useMemo(() => {
    const countDescendants = (nodeId) => {
      let count = 0;
      const stack = [...(childrenMap[nodeId] || [])];
      while (stack.length > 0) {
        const current = stack.pop();
        count += 1;
        stack.push(...(childrenMap[current] || []));
      }
      return count;
    };

    const hidden = new Set();
    for (const node of nodes) {
      if (node.data?.collapsed) {
        const stack = [...(childrenMap[node.id] || [])];
        while (stack.length > 0) {
          const current = stack.pop();
          hidden.add(current);
          stack.push(...(childrenMap[current] || []));
        }
      }
    }

    const counts = {};
    for (const node of nodes) {
      counts[node.id] = countDescendants(node.id);
    }

    const vNodes = nodes
      .filter((n) => !hidden.has(n.id))
      // deletable:false na vrcholu — xyflow pak z Delete/Backspace vynechá uzel
      // I JEHO HRANY (samotný filtr remove změn hrany neochránil: deleteElements
      // je posílá zvlášť a děti by tiše osiřely — nález checkupu 2. 8.)
      .map((n) => ({ ...n, zIndex: n.type === 'note' ? 0 : (n.zIndex ?? 10), ...(isApexNodeShared(n) ? { deletable: false } : {}) }));
    const visibleIds = new Set(vNodes.map((n) => n.id));
    const vEdges = edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));

    return { visibleNodes: vNodes, visibleEdges: vEdges, hiddenCounts: counts };
  }, [nodes, edges, childrenMap]);

  // „Moje mapa": (pře)načte agregaci mých uzlů + volných úkolů. Voláno při vstupu
  // i při změně zásobníku (nápad+termín→volný úkol se objeví bez ruční aktualizace).
  const loadPersonalMap = useCallback(async () => {
    try {
      const [allMaps, allTasks] = await Promise.all([
        base44.entities.GoalMap.list('-updated_date', 200),
        user ? base44.entities.Task.list('-created_date', 1000) : Promise.resolve([]),
      ]);
      const rootLabel = user?.full_name || t('myday:myMap.rootLabel');
      const { nodes: pn, edges: pe, targets } = personalView === 'delegated'
        ? buildDelegatedMap(allMaps, allTasks, user?.email, rootLabel, delegatedGrouping, members)
        : buildPersonalMap(allMaps, allTasks, user?.email, rootLabel);
      personalTargets.current = targets;
      // Respektovat AKTUÁLNÍ směr zobrazení (mobil auto = vodorovně): buildery
      // vracejí kanonické svislé pozice a view-only překlopení se jinak aplikuje
      // jen při ZMĚNĚ směru — re-build (záložka, seskupení, zásobník) by mapu
      // na mobilu tiše vrátil do svislé podoby.
      if (directionRef.current === 'horizontal') {
        canonicalPosRef.current = new Map(pn.filter((n) => n.type !== 'note').map((n) => [n.id, { ...n.position }]));
        const hpos = layoutTree(pn, pe, 'horizontal', PERSONAL_LAYOUT('horizontal', citelnostRef.current));
        for (const n of pn) { const p = hpos[n.id]; if (p) n.position = p; }
        appliedDirRef.current = 'horizontal'; // překlopeno už tady — efekt směru nesmí přerovnávat podruhé
      }
      skipNextSave.current = true;
      setNodes(pn);
      setEdges(pe);
    } catch (e) { console.error(e); }
  }, [user, t, setNodes, setEdges, personalView, delegatedGrouping, members]);

  // Load map
  useEffect(() => {
    (async () => {
      // „Moje mapa" — read-only agregace mých uzlů napříč projekty (žádné ukládání)
      if (personalMap) {
        setCanEdit(false);
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
            const hasEdit = (m.shared_with_edit || []).includes(user?.email) || m.team_access === 'edit';
            setCanEdit(isOwner || hasEdit);
            setCanWork(!isOwner && !hasEdit && (m.shared_with_work || []).includes(user?.email));
            setIsMapOwner(isOwner);
            setArchived(!!m.archived);
            setMapKind(m.kind || '');
            archiveOfferShown.current = false;
            setActiveMapId(mapId);
            baseUpdated.current = m.updated_date; // B3 výchozí verze
            serverNodes.current = m.nodes || [];
            // otisk stavu v databázi hned po načtení — bez něj by prázdné
            // uložení proklouzlo aspoň jednou (hned první přepnutí čitelnosti)
            ulozenyOtisk.current = stableJson({
              title: m.title || '', color: m.color || '', nodes: m.nodes || [], edges: m.edges || [],
            });
            setSharedCount(((m.shared_with || []).concat(m.shared_with_edit || [])).filter((v, i, a) => a.indexOf(v) === i).length);
            setOwnerEmails([user?.email, ...(m.shared_with_edit || [])].filter((v, i, a) => v && a.indexOf(v) === i));
            setMapShare({ ownerEmail: m.created_by, sharedWith: m.shared_with || [], teamAccess: m.team_access || '', sharedWithWork: m.shared_with_work || [] });
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
          const map = result.data?.map;
          if (map) {
            setCanEdit(true);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId, personalMap]);

  // „Moje mapa": přepnutí záložky (Mám udělat/Zadal jsem) nebo seskupení.
  // Dofit až PO dokončení přestavby — load je async; dřívější recenter v onClick
  // napasoval STARÝ obsah a nové uzly (hlavně 1–2) končily maličké mimo výřez.
  useEffect(() => {
    if (!personalMap || loading) return;
    loadPersonalMap().then(() => {
      setTimeout(() => { try { rfInstance?.fitView({ padding: 0.2, maxZoom: 1, duration: 300 }); } catch { /* ignore */ } }, 80);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personalView, delegatedGrouping]);

  // „Moje mapa": adresář (členové + externí kontakty) dobíhá async — první
  // sestavení mohlo proběhnout s members=[] a jména externích ve skupinách
  // „podle lidí" jsou ZAPEČENÁ do dat uzlů (zůstala by „Externí kontakt").
  // Po dojetí/změně adresáře proto přestavět. (Nález kontrolního panelu 11. 8.)
  useEffect(() => {
    if (!personalMap || loading || !members.length) return;
    loadPersonalMap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);

  // „Moje mapa": při změně zásobníku (nápad→volný úkol) přenačíst, ať se úkol
  // objeví bez ruční aktualizace mapy
  useEffect(() => {
    if (!personalMap || loading) return;
    loadPersonalMap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer.items]);

  // Load comment counts for this map
  useEffect(() => {
    if (!activeMapId || isPublicView) return;
    (async () => {
      try {
        const comments = await base44.entities.Comment.filter({ goalmap_id: activeMapId }, 'created_date', 500);
        const counts = {};
        for (const c of comments || []) {
          counts[c.node_id] = (counts[c.node_id] || 0) + 1;
        }
        setCommentCounts(counts);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [activeMapId, isPublicView, editNodeId]);

  // Úkoly mapy → progres na uzlech (podúkoly dědí node_id, počítají se také).
  // Úkoly žijí ve vlastní kolekci — nezasahují do auto-save JSON mapy.
  useEffect(() => {
    if (!activeMapId || isPublicView || !user) return;
    (async () => {
      try {
        const tasks = await base44.entities.Task.filter({ map_id: activeMapId }, 'created_date', 1000);
        const stats = {};
        for (const task of tasks || []) {
          if (!task.node_id) continue;
          const s = (stats[task.node_id] = stats[task.node_id] || { total: 0, done: 0 });
          s.total += 1;
          if (task.status === 'done') s.done += 1;
        }
        setTaskStats(stats);
        setMapTasks(tasks || []);
        setMapTaskCount((tasks || []).length);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [activeMapId, isPublicView, user, taskStatsVersion]);

  // Jen na stránce editoru vypnout zoom prohlížeče, ať dvouprstové gesto patří plátnu
  // mapy (React Flow pinch). Mimo editor (Home/Úkoly/dialogy) zůstává zoom stránky funkční.
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return undefined;
    const prev = meta.getAttribute('content');
    meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
    return () => { meta.setAttribute('content', prev || 'width=device-width, initial-scale=1.0'); };
  }, []);

  // Deep-link ?node= má PŘEDNOST před automatickými fitView. Bez téhle závory
  // spolu obojí závodí: onInit fituje 120 ms po initu plátna, centrování na uzel
  // 60 ms po tom, co jsou k dispozici data mapy. Podle toho, jestli data dorazí
  // před initem nebo po něm, jednou vyhraje zaostření na uzel a podruhé celková
  // mapa — přesně to „jednou to funguje, jindy ne".
  const pendingDeepLink = useRef(false);
  useEffect(() => {
    if (new URLSearchParams(location.search).get('node')) pendingDeepLink.current = true;
  }, [location.search]);

  // Vycentrovat pohled na uzel (i s okolím) — deep-link, AI-expand, přepínač směru.
  const centerOnNode = useCallback((nodeId, opts = {}) => {
    const n = nodes.find((x) => x.id === nodeId);
    const pos = opts.pos || n?.position;
    if (!pos || !rfInstance) return;
    const w = n?.measured?.width || n?.width || 220;
    const h = n?.measured?.height || n?.height || 150;
    const z = opts.zoom ?? (narrow ? 0.7 : 1.0);
    setTimeout(() => { try { rfInstance.setCenter(pos.x + w / 2, pos.y + h / 2, { zoom: z, duration: 500 }); } catch { /* ignore */ } }, opts.delay ?? 60);
  }, [nodes, rfInstance, narrow]);

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

  // latest-ref vzor: přiřazení při KAŽDÉM renderu, ať refy nikdy nezaostávají
  nodesNow.current = nodes;
  edgesNow.current = edges;

  const cleanMapData = () => {
    // Ve vodorovném (mobilním) view jsou pozice jen pro ZOBRAZENÍ — nikdy je
    // neukládat, jinak by mobil rozhodil svislé rozložení sdílené s desktopem.
    // Uloží se kanonické svislé: existující dle snapshotu, nové dopočítat.
    // Kanonický tvar dat drží sdílená lib/cleanMap.js (parita se serverem).
    // Čte se z refů (nodesNow/edgesNow), ne z uzávěru — letící autosave po
    // await potřebuje SOUČASNÝ stav (viz převzetí mutací pravidel níže).
    const nds = nodesNow.current;
    const eds = edgesNow.current;
    const horizontalView = directionRef.current === 'horizontal';
    const vlayForSave = horizontalView ? layoutTree(nds, eds, 'vertical') : null;
    const posOf = (n) => (horizontalView
      ? (canonicalPosRef.current.get(n.id) || vlayForSave[n.id] || n.position)
      : n.position);
    return cleanMap(nds, eds, posOf);
  };

  // Debounced auto-save
  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (!canEdit || isPublicView || isTemplatePreview) return;

    // Draft mode: create the map only when there's actual content
    if (isDraft) {
      const hasContent = nodes.length > 0 || title.trim().length > 0;
      if (!hasContent) return;
      setSaveStatus('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          const { cleanNodes, cleanEdges } = cleanMapData();
          const newMap = await base44.entities.GoalMap.create({
            title: title.trim() || t('defaults.newMapTitle'),
            description: '',
            nodes: cleanNodes,
            edges: cleanEdges,
            color,
          });
          setActiveMapId(newMap.id);
          baseUpdated.current = newMap.updated_date; // B3
          skipNextSave.current = true;
          window.history.replaceState(null, '', `/map/${newMap.id}`);
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 2000);
        } catch (e) {
          console.error(e);
          setSaveStatus('idle');
        }
      }, 1200);
      return () => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
      };
    }

    if (!activeMapId) return;
    // ⚠️ „Ukládání…" se rozsvítí AŽ když se opravdu bude ukládat. Dřív se
    // nastavovalo hned tady, takže po stisku Čitelnosti lišta blikla
    // „Ukládání…" a zhasla — a tooltip i návod přitom slibují, že se do mapy
    // nic nezapisuje. Uživatel viděl opak toho, co mu říkáme (panel 13. 8.).
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const { cleanNodes, cleanEdges } = cleanMapData();
        // PRÁZDNÉ ULOŽENÍ SE NEPOSÍLÁ (panel /checkup 13. 8. 2026).
        // Autosave visí na referenci `nodes`, jenže tu vyrobí i změna, která
        // s obsahem mapy nemá nic společného — ReactFlow posílá `dimensions`
        // change, kdykoli se změní NAMĚŘENÉ rozměry karty. Stačilo tedy
        // přepnout velikost písma (tlačítko Čitelnost) a odešel PATCH
        // s daty shodnými s databází; jediné, co se změnilo, bylo `updated`.
        // Následky: mapa přeskočí v řazení „naposledy upravené" a kolegovi,
        // který ji má otevřenou, se rozjede `base_updated` → konflikt 409.
        // Porovnává se kanonický tvar (`stableJson` srovnává pořadí klíčů
        // i prázdné hodnoty), takže se zahodí JEN opravdu prázdný zápis.
        const otisk = stableJson({ title, color, nodes: cleanNodes, edges: cleanEdges });
        if (otisk === ulozenyOtisk.current) return;   // nic se nemění → ani indikátor
        setSaveStatus('saving');
        saveInFlight.current = true;
        const updated = await base44.entities.GoalMap.update(activeMapId, {
          title,
          color,
          nodes: cleanNodes,
          edges: cleanEdges,
          base_updated: baseUpdated.current, // B3: verze, ze které vycházíme
        });
        baseUpdated.current = updated.updated_date; // B3: posunout na novou verzi
        serverNodes.current = updated.nodes || cleanNodes;
        ulozenyOtisk.current = otisk;
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
        // AUTOMATIZAČNÍ PRAVIDLA běží UVNITŘ PATCHe, ale AŽ PO uložení — jejich
        // mutace (set_owner, stav, pod-uzly…) v HTTP odpovědi NENÍ a base_updated
        // z odpovědi je hned zastaralé. Bez dorovnání uživatel změnu neuvidí
        // a příští autosave skončí 409/konfliktem. (Richardův klik-test 15. 8.:
        // „změnil jsem na Probíhá a nic se nerozjelo" — set_owner přitom
        // na serveru proběhl, jen zůstal neviditelný.) Levná kontrola verze
        // se dělá JEN když má mapa zapnutá pravidla.
        if ((mapRulesNow.current || []).some((rl) => rl && rl.enabled)) {
          const ver = await base44.entities.GoalMap.get(activeMapId, { fields: 'updated' });
          if (ver?.updated_date && ver.updated_date !== updated.updated_date) {
            const fresh = (await base44.entities.GoalMap.filter({ id: activeMapId }))?.[0];
            if (fresh) {
              // psal uživatel během letícího PATCHe? Porovnává se OBSAH
              // (kanonický tvar z refů), ne počítadlo změn — ReactFlow sype
              // i „dimensions" změny bez obsahu a ty převzetí blokovat nesmí.
              const akt = cleanMapData();
              const aktOtisk = stableJson({ nodes: akt.cleanNodes, edges: akt.cleanEdges });
              const sentContent = stableJson({ nodes: cleanNodes, edges: cleanEdges });
              if (aktOtisk === sentContent) {
                // od odeslání nikdo nic nenapsal → bezpečně převzít stav serveru.
                // ⚠️ base_updated se posouvá VÝHRADNĚ tady, uvnitř převzetí —
                // panel 15. 8.: posun v druhé větvi vypínal 409 ochranu a další
                // autosave mohl tiše přepsat souběžnou práci / mutaci pravidla.
                baseUpdated.current = fresh.updated_date;
                serverNodes.current = fresh.nodes || [];
                skipNextSave.current = true;
                // ⚠️ SLÉVAT, ne vyměnit vše: velkoplošná výměna objektů brala
                // uzlům interní stav React Flow (measured…) a plátno pak umělo
                // PŘESTAT KRESLIT hrany, dokud se mapa nezavřela a neotevřela
                // (Richardův nález 15. 8. při kanbanu: „zmizely všechny čáry",
                // data v DB přitom zdravá; vzácný souběh — chycen 1× ze ~40 kol).
                // Nezměněný uzel/hrana si proto drží PŮVODNÍ objekt (identita
                // = žádné překreslení), změněné přebírají measured ze starého.
                setNodes((prev) => {
                  const stare = new Map(prev.map((n) => [n.id, n]));
                  return (fresh.nodes || []).map((n) => {
                    const s = stare.get(n.id);
                    const novy = {
                      ...n,
                      type: n.type === 'note' ? 'note' : (isApexNodeShared(n) ? 'apexNode' : 'goalNode'),
                      data: { ...n.data, collapsed: n.data?.collapsed || false },
                    };
                    if (s && stableJson({ p: s.position, d: s.data, t: s.type }) === stableJson({ p: novy.position, d: novy.data, t: novy.type })) return s;
                    return s?.measured ? { ...novy, measured: s.measured } : novy;
                  });
                });
                setEdges((prev) => {
                  const stare = new Map(prev.map((e2) => [e2.id, e2]));
                  return (fresh.edges || []).map((ed) => {
                    const s = stare.get(ed.id);
                    if (s && s.source === ed.source && s.target === ed.target) return s;
                    return { ...ed, type: 'deletable' };
                  });
                });
                ulozenyOtisk.current = stableJson({ title: fresh.title || '', color: fresh.color || '', nodes: fresh.nodes || [], edges: fresh.edges || [] });
              } else {
                // rozepsaná změna se tiše přepsat nesmí — základna zůstává STARÁ
                // (příští autosave narazí na 409 → standardní merge/konflikt)
                // a pruh „mapa se změnila" to řekne rovnou
                setRemoteChanged(true);
              }
            }
          }
        }
      } catch (e) {
        // B3: cizí klient mezitím mapu změnil → nabídnout přenačtení místo přepsání
        if (e?.status === 409) {
          // Automatizace doběhla a označila uzel za hotový → mapa se posunula pod
          // rukama. Tvrdý dotaz „načíst znovu?" by tady znamenal ztrátu rozepsané
          // změny, a to zrovna ve scénáři, kvůli kterému se automatizace zavádějí.
          // Když je cizí změna JEN posun stavu uzlů, slijeme ji tiše a uložíme znovu.
          const merged = await mergeServerStatuses();
          if (merged) return;
          setConflict(true);
          setSaveStatus('idle');
          return;
        }
        console.error(e);
        setSaveStatus('idle');
      } finally {
        saveInFlight.current = false;
      }
    }, 1200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [nodes, edges, title, color, isDraft, activeMapId, canEdit, isPublicView, isTemplatePreview]);

  // Porovnání dat uzlu MUSÍ být nezávislé na pořadí klíčů: náš kanonický tvar
  // (lib/cleanMap.js) má vlastní pořadí, ale server totéž vrací abecedně, takže
  // prosté JSON.stringify by hlásilo rozdíl i u naprosto shodných dat.
  // Prázdná hodnota chodí ze serveru jednou jako chybějící klíč, jindy jako null
  // nebo '' — pro porovnání je to totéž a rozdíl by falešně hlásil kolizi obsahu.
  const stableJson = (v) => JSON.stringify(v, (k, val) => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val).sort().reduce((acc, kk) => {
        const x = val[kk];
        acc[kk] = (x === null || x === undefined) ? '' : x;
        return acc;
      }, {});
    }
    return val;
  });

  // Pokus o tiché slití po 409. Vrací true, když se konflikt vyřešil sám.
  // Slévá VÝHRADNĚ `data.status` a jen u uzlů, které uživatel sám nezměnil —
  // cokoli jiného (přejmenování, přesun, přidaný/ubraný uzel) je skutečná kolize
  // a patří před člověka.
  const mergeServerStatuses = useCallback(async () => {
    try {
      const fresh = await base44.entities.GoalMap.filter({ id: activeMapId });
      const srv = fresh?.[0];
      if (!srv) return false;
      const before = new Map((serverNodes.current || []).map((n) => [n.id, n]));
      const after = new Map((srv.nodes || []).map((n) => [n.id, n]));
      if (before.size !== after.size) return false;
      const statusChanges = new Map();
      for (const [id, a] of after) {
        const b = before.get(id);
        if (!b) return false; // jiná sada uzlů = skutečná změna struktury
        const bs = { ...(b.data || {}) }; const as = { ...(a.data || {}) };
        if ((bs.status || '') !== (as.status || '')) statusChanges.set(id, as.status);
        delete bs.status; delete as.status;
        if (stableJson(bs) !== stableJson(as)) return false; // změnilo se i něco jiného
        if (stableJson(b.position) !== stableJson(a.position)) return false;
      }
      if (statusChanges.size === 0) return false;
      // uživatel mohl mezitím tentýž uzel přepnout sám — jeho volba má přednost
      const mine = new Map((serverNodes.current || []).map((n) => [n.id, (n.data || {}).status || '']));
      skipNextSave.current = false;
      setNodes((prev) => prev.map((n) => {
        if (!statusChanges.has(n.id)) return n;
        const untouched = (n.data?.status || '') === (mine.get(n.id) || '');
        return untouched ? { ...n, data: { ...n.data, status: statusChanges.get(n.id) } } : n;
      }));
      baseUpdated.current = srv.updated_date;
      serverNodes.current = srv.nodes || [];
      toast({ title: t('toasts.mapMergedStatus') });
      return true;
    } catch (err) {
      return false;
    }
  }, [activeMapId, setNodes, toast, t]);

  // „Ponechat moje změny" v dialogu konfliktu: převezme čerstvou verzi jako
  // základnu a VĚDOMĚ uloží můj rozepsaný stav přes cizí úpravy. Server dál
  // drží autoritu (base_updated) — tohle není tiché přepsání, ale volba
  // uživatele s vysvětleným následkem. Když mezi GET verze a PATCH uloží
  // někdo další (409), dialog zůstává a jde to zkusit znovu — záměrně žádná
  // automatická smyčka, každý pokus = nové vědomé rozhodnutí.
  const handleKeepMine = async () => {
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveStatus('saving');
      saveInFlight.current = true;
      const fresh = await base44.entities.GoalMap.get(activeMapId, { fields: 'updated' });
      const { cleanNodes, cleanEdges } = cleanMapData();
      const updated = await base44.entities.GoalMap.update(activeMapId, {
        title,
        color,
        nodes: cleanNodes,
        edges: cleanEdges,
        base_updated: fresh.updated_date,
      });
      baseUpdated.current = updated.updated_date;
      serverNodes.current = cleanNodes;
      ulozenyOtisk.current = stableJson({ title, color, nodes: cleanNodes, edges: cleanEdges });
      setConflict(false);
      setRemoteChanged(false);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
      toast({ title: t('conflict.keptSaved') });
    } catch {
      setSaveStatus('idle');
      toast({ title: t('conflict.keepFailed'), variant: 'destructive' });
    } finally {
      saveInFlight.current = false;
    }
  };

  // Levné hlídání na pozadí: do 13. 8. se aplikace serveru ptala jen dík vadě
  // (autosave posílal i prázdná uložení). Po její opravě by se cizí změna
  // poznala až u první vlastní úpravy — tedy nejdřív 409, pak dialog. Tenhle
  // tick se periodicky zeptá JEN na `updated` (ne celou mapu) a při rozdílu
  // ukáže nenásilný pruh dřív, než uživatel začne psát. Změny, které by 409
  // větev slila tiše (jen posun stavů), slije tiše i tady — obě cesty se musí
  // chovat stejně. `kb-native-resume` kryje probuzení mobilu (timery ve WebView
  // po zamčení umírají) a testům dává páku, jak kontrolu vynutit hned.
  useEffect(() => {
    if (!activeMapId || isDraft || isPublicView || isTemplatePreview || !canEdit) return undefined;
    let busy = false;
    const tick = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      if (saveInFlight.current || conflict || remoteChanged) return;
      busy = true;
      try {
        const fresh = await base44.entities.GoalMap.get(activeMapId, { fields: 'updated' });
        if (fresh.updated_date && baseUpdated.current
            && fresh.updated_date !== baseUpdated.current && !saveInFlight.current) {
          const merged = await mergeServerStatuses();
          if (!merged) setRemoteChanged(true);
        }
      } catch { /* výpadek sítě/práv ohlásí až skutečné uložení; pruh-spam je horší */ }
      busy = false;
    };
    const iv = setInterval(tick, 45000);
    window.addEventListener('kb-native-resume', tick);
    return () => { clearInterval(iv); window.removeEventListener('kb-native-resume', tick); };
  }, [activeMapId, isDraft, isPublicView, isTemplatePreview, canEdit, conflict, remoteChanged, mergeServerStatuses]);

  // Přepnutí směru (na výšku ↔ na šířku) = VIEW-ONLY přerovnání. Pozice se
  // nepersistují (cleanMapData ukládá kanonické svislé); konektory uzlů se
  // přehodí přes context. Záměrně bez nodes/edges v deps, ať to neběhá pořád.
  useEffect(() => {
    directionRef.current = direction;
    if (loading) return;
    if (appliedDirRef.current === direction) return;
    appliedDirRef.current = direction;
    // Zvolený styl musí přepnutí směru PŘEŽÍT (Richard 11. 8. v noci: „jsem
    // v PC režimu dle kategorií, přepnu na mobilní a neudrží to, dá do šířky").
    // Dřív se tu layoutovalo bez stylu, takže přepnutí směru zarovnání zahodilo.
    const stylOpts = ALIGN_OPTS[alignStyleRef.current] || {};
    const smerOpts = (dir) => (personalMap ? { ...PERSONAL_LAYOUT(dir, citelnostRef.current), ...stylOpts } : stylOpts);
    if (direction === 'horizontal') {
      const snap = new Map();
      nodes.forEach((n) => { if (n.type !== 'note') snap.set(n.id, n.position); });
      canonicalPosRef.current = snap;
      const pos = layoutTree(nodes, edges, 'horizontal', smerOpts('horizontal'));
      skipNextSave.current = true;
      setNodes((prev) => prev.map((n) => (pos[n.id] ? { ...n, position: pos[n.id] } : n)));
    } else {
      const canon = canonicalPosRef.current;
      const vlay = layoutTree(nodes, edges, 'vertical', smerOpts('vertical'));
      skipNextSave.current = true;
      setNodes((prev) => prev.map((n) => {
        if (n.type === 'note') return n;
        const p = canon.get(n.id) || vlay[n.id];
        return p ? { ...n, position: p } : n;
      }));
    }
    setTimeout(() => {
      try {
        // KLÍČOVÉ: po překlopení strany konektorů přeměřit uzly, jinak React Flow
        // drží starou pozici konektoru a hrany vedou špatným směrem (doprava místo dolů)
        nodes.forEach((n) => { if (n.type !== 'note') updateNodeInternals(n.id); });
        if (!pendingDeepLink.current) rfInstance?.fitView({ padding: 0.2, duration: 300 });
      } catch { /* ignore */ }
    }, 80);
  }, [direction, loading]);

  const handleSaveTemplate = useCallback(async () => {
    if (!user) {
      // nepřihlášený návštěvník v náhledu šablony → k uložení je potřeba účet
      navigate('/register');
      return;
    }
    setSavingTemplate(true);
    try {
      const { cleanNodes, cleanEdges } = cleanMapData();
      const newMap = await base44.entities.GoalMap.create({
        title: title.trim() || t('defaults.newMapTitle'),
        description: '',
        nodes: cleanNodes,
        edges: cleanEdges,
        ...(templateSeriesRef.current ? { series: templateSeriesRef.current } : {}),
      });
      setIsTemplatePreview(false);
      setActiveMapId(newMap.id);
      setIsMapOwner(true);
      // u číslované série server přepsal název a záznam je novější — srovnat,
      // jinak by první autosave poslal starý title (a starou verzi → 409)
      skipNextSave.current = true;
      setTitle(newMap.title || '');
      baseUpdated.current = newMap.updated_date;
      templateSeriesRef.current = null;
      // pravidla ze šablony — až teď, když mapa existuje; ref se nuluje
      // PŘED zakládáním (ochrana proti dvojímu založení)
      if (templateSeedsRef.current) {
        const { idMap, rules } = templateSeedsRef.current;
        templateSeedsRef.current = null;
        try {
          await createRulesFromTemplate(rules, idMap, newMap.id);
        } catch (e2) { console.error('pravidla ze šablony', e2); }
      }
      window.history.replaceState(null, '', `/map/${newMap.id}`);
      toast({ title: t('toasts.mapSaved'), description: t('toasts.mapSavedDesc') });
    } catch (e) {
      console.error(e);
      toast({ title: t('toasts.error'), description: t('toasts.saveMapFailed'), variant: 'destructive' });
    } finally {
      setSavingTemplate(false);
    }
  }, [nodes, edges, title, toast, user, navigate]);

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
    (n) => {
      if (!n?.data?.deadline) return true;
      if (isMapOwner) return true;
      const assigner = n.data.assignedBy || effectiveMapAccess.ownerEmail || '';
      return !!user?.email && user.email === assigner;
    },
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
  }, [rfInstance, setNodes, setEditNodeId]);

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

  // Zásobník: vložení = přesun (uzel vznikne v mapě, ze zásobníku zmizí)
  const insertBufferItem = useCallback(
    (item, position) => {
      // Bez pozice (tlačítko se šipkou, typicky mobil) se uzel VĚŠÍ POD VRCHOL
      // i s hranou. Dřív vznikl volně plovoucí uzel uprostřed viewportu — na
      // mobilu bez drag&drop slepá ulička: „skočil náhodně a neměl jsem ho kam
      // dát" (Richard 7. 8. 2026 v noci). Strom nezná uzly bez rodiče.
      // Drop myší (position) nechává pozici i volnost napojení jak byly.
      const id = `node-${Date.now()}`;
      const apex = nodes.find((n) => n.type === 'apexNode');
      let pos = position;
      if (!pos) {
        if (apex) {
          const sourozenci = edges.filter((e) => e.source === apex.id).length;
          pos = direction === 'vertical'
            ? { x: apex.position.x + 40 + sourozenci * 40, y: apex.position.y + 260 }
            : { x: apex.position.x + 320, y: apex.position.y + 40 + sourozenci * 40 };
        } else if (rfInstance) {
          const center = rfInstance.screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          });
          pos = { x: center.x - 110, y: center.y - 60 };
        } else {
          pos = { x: 250, y: 150 };
        }
      }
      pushHistory();
      setNodes((prev) => [
        ...prev,
        {
          id: id,
          type: 'goalNode',
          position: pos,
          data: {
            title: item.title,
            status: 'todo',
            description: item.description || '',
            color: item.color || '',
            deadline: item.deadline || '',
            nodeType: 'normal',
            goalType: '',
            apexText: '',
          },
        },
      ]);
      if (!position && apex) {
        setEdges((prev) => [...prev, { id: `edge-${Date.now()}`, source: apex.id, target: id }]);
      }
      buffer.remove(item.id);
    },
    [rfInstance, setNodes, setEdges, pushHistory, buffer, nodes, edges, direction]
  );

  const handleBufferDragOver = useCallback((e) => {
    if (e.dataTransfer.types.includes(BUFFER_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const handleBufferDrop = useCallback(
    (e) => {
      const raw = e.dataTransfer.getData(BUFFER_DRAG_MIME);
      if (!raw) return;
      e.preventDefault();
      let item;
      try {
        item = JSON.parse(raw);
      } catch {
        return;
      }
      let pos;
      if (rfInstance) {
        const p = rfInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        pos = { x: p.x - 110, y: p.y - 30 };
      }
      insertBufferItem(item, pos);
    },
    [rfInstance, insertBufferItem]
  );

  const handleStashNode = useCallback(
    async (nodeId, override) => {
      const node = nodes.find((n) => n.id === nodeId);
      // override = rozeditované hodnoty z dialogu (uzel v mapě je může mít starší/prázdné)
      const nodeTitle = (override?.title ?? node?.data?.title ?? '').trim();
      if (!node || !nodeTitle) return;
      // stash = odstranění z mapy — cizí zadaný úkol nesmí zmizet do soukromého
      // zásobníku (obchvat zámku termínu); kontrola PŘED zápisem do bufferu,
      // jinak by se nápad zduplikoval a uzel v mapě zůstal
      if (!canRemoveNodeShared(node)) { assignedDeleteRefused(node); return; }
      try {
        await buffer.add({
          title: nodeTitle,
          description: override?.description ?? node.data?.description ?? '',
          color: override?.color ?? node.data?.color ?? '',
          deadline: override?.deadline ?? node.data?.deadline ?? '',
        });
      } catch {
        toast({ title: t('tasks:tasksPage.stashFailed'), description: t('common:misc.tryAgainPlease'), variant: 'destructive' });
        return;
      }
      handleDeleteNode(nodeId);
      setEditNodeId(null);
      toast({ title: t('tasks:tasksPage.stashedToBuffer'), description: nodeTitle });
    },
    [nodes, buffer, handleDeleteNode, toast, canRemoveNodeShared, assignedDeleteRefused]
  );

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
  // uzly, nad kterými PRÁVĚ běží automatizace (pending/running běh) — jen pro
  // indikátor na uzlu; realtime na agent_runs drží stav bez reloadu
  const [runningAgentNodes, setRunningAgentNodes] = useState(new Set());
  useEffect(() => {
    if (!activeMapId) { setRunningAgentNodes(new Set()); return undefined; }
    const load = () => {
      base44.entities.AgentRun
        .filter({ map_id: activeMapId }, '-created_date', 200)
        .then((rows) => setRunningAgentNodes(new Set(
          rows.filter((r) => r.status === 'pending' || r.status === 'running').map((r) => r.node_id)
        )))
        .catch(() => {});
    };
    load();
    // callback agenta mění běh mimo tenhle prohlížeč → bez realtime by indikátor
    // zůstal tepat i po doběhnutí. Debounce: cron odešle dávku běhů naráz a bez
    // něj by každá událost spustila vlastní dotaz na 200 řádků.
    let unsubscribe;
    let timer;
    const debounced = () => { clearTimeout(timer); timer = setTimeout(load, 300); };
    pb.collection('agent_runs').subscribe('*', debounced).then((u) => { unsubscribe = u; }).catch(() => {});
    return () => { clearTimeout(timer); if (unsubscribe) unsubscribe(); };
  }, [activeMapId]);

  // automatizační pravidla mapy — pro badge blesku na uzlech a kategorii
  // Automatizace v okně uzlu. Jen editor (routa /rules je editor-only);
  // bez realtime — pravidla se mění výhradně přes RulesDialog, který po
  // změně zavolá reload (onRulesChanged).
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rulesDefaults, setRulesDefaults] = useState({});
  const [mapRules, setMapRules] = useState([]);
  mapRulesNow.current = mapRules; // latest-ref pro letící autosave (viz výš)
  useEffect(() => {
    if (!activeMapId || !canEdit || isPublicView) { setMapRules([]); return; }
    rulesApi.list(activeMapId).then(setMapRules).catch(() => setMapRules([]));
  }, [activeMapId, canEdit, isPublicView]);
  const ruleNodes = useMemo(() => new Set(mapRules.filter((r) => r.node_id).map((r) => r.node_id)), [mapRules]);
  // 🔁 uzly s čistým opakovacím pravidlem (v0.35) — badge na kartě cíle
  const recurrenceNodes = useMemo(() => {
    const out = new Set();
    for (const r of mapRules) {
      if (!r?.node_id) continue;
      const st = recurrenceOf(mapRules, r.node_id);
      if (st && !st.custom) out.add(r.node_id);
    }
    return out;
  }, [mapRules]);
  // KANBAN REŽIM: mapa má zapnutá pravidla posunu. Tlačítko Zarovnat se mění
  // na indikátor „Kanban" (Richard 15. 8.): na kanban desce styly zarovnání
  // nemají co přeskládat (sloupce mají děti), cyklení názvů naprázdno matlo —
  // rozložení tu drží pravidla posunu, ne styly. Vědomá výjimka z pravidla
  // „Zarovnat musí vždy něco udělat": tady místo akce ŘEKNE, proč nekoná.
  const kanbanAktivni = useMemo(() => mapRules.some((r) => r.enabled && (r.actions || []).some((a) => a.type === 'move_node')), [mapRules]);
  // texty indikátoru žijí v LAZY namespace `rules` (lite dieta — práh 490 kB
  // se nezvedá); než se donačte, ukazuje se běžné Zarovnat
  const kanbanNsReady = useLazyNs('rules');
  // společný vstup do builderu z kontextu uzlu (panel Automatizace, Chování);
  // triggerType přednastaví spouštěč (propojka „po odblokování")
  const openRulesFromNode = useCallback((nid, openNew, triggerType, showRunsRule, openKanban) => {
    // showRunsRule: undefined = bez logu; '' = log celé mapy; id = log pravidla
    // (nález Richarda 15. 8.: z panelu uzlu se na log běhů nedalo dostat)
    // openKanban: rovnou průvodce „Zapnout kanban na řadě" s uzlem jako řadou
    setRulesDefaults({ node_id: nid, openNew, trigger_type: triggerType || '', showRunsRule, openKanban });
    setRulesOpen(true);
  }, []);
  // slíbená náprava z builderu: pravidlo „po odblokování" na uzlu bez čekání
  // by se nikdy nespustilo → zapnout standardní cestou (setNodes + autosave).
  // ⚠️ Otevřený dialog uzlu se tím přenačte ze stavu mapy (stejné chování jako
  // u každé jiné změny uzlu na pozadí) — přepínač v Chování ukáže nový stav.
  const handleEnableWaiting = useCallback((nodeId) => {
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, waitForChildren: true } } : n)));
  }, [setNodes]);

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
        const res = await pb.send('/api/kb/node-status', { method: 'POST', body: { mapId: activeMapId, nodeId, status: next } });
        setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status: next } } : n)));
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

  const progressMap = useMemo(() => {
    const nodeMap = {};
    for (const node of nodes) nodeMap[node.id] = node;

    const compute = (nodeId) => {
      const children = childrenMap[nodeId] || [];
      if (children.length === 0) {
        return { total: 1, done: nodeMap[nodeId]?.data?.status === 'done' ? 1 : 0 };
      }
      let total = 0, done = 0;
      for (const childId of children) {
        const r = compute(childId);
        total += r.total;
        done += r.done;
      }
      return { total, done };
    };

    const result = {};
    for (const node of nodes) {
      const { total, done } = compute(node.id);
      result[node.id] = total > 0 ? Math.round((done / total) * 100) : 0;
    }
    return result;
  }, [nodes, childrenMap]);

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

  // Plný přelayout mapy (AI rozpad, AI operace, Zarovnat): kanonické pozice
  // jsou VŽDY svislé. Ve vodorovném (mobilním) view se svislé zapíší do
  // canonicalPosRef (odtud čte ukládání) a ZOBRAZENÍ dostane vodorovný layout.
  // Dřív každé místo řešilo směr po svém: rozpad layoutoval v aktuálním směru
  // bez zápisu kanonu, AI operace vždy svisle i ve vodorovném view (uzly přes
  // sebe / špatně otočené) — část nálezu „AI mapa na šířku" (task #17).
  const layoutAllForView = useCallback((allNodes, allEdges, layoutOpts) => {
    // Bez explicitních opts (AI rozpad/operace) se drží styl TÉHLE MAPY.
    // ⚠️ Dřív se četl GLOBÁLNÍ klíč, takže na mapě A stačilo zmáčknout
    // „kompaktně", otevřít mapu B (kde je uložené „kolem středu", a popisek to
    // hlásí) a spustit AI operaci — mapa se přerovnala kompaktně, ale tlačítko
    // dál tvrdilo „kolem středu". Je to TÁŽ vada „popisek lže", kterou vlna
    // opravovala pro tlačítko, jen jinou cestou (nález panelu 12. 8. 2026).
    // Globální klíč zůstává jako záloha pro stav, kdy mapa ještě nemá id.
    const klicMapy = alignMapKeyRef.current;
    const stylMapy = klicMapy ? platnyStyl(nactiKlic('kb-zarovnat-styl:' + klicMapy)) : '';
    const styl = layoutOpts
      || ALIGN_OPTS[stylMapy || platnyStyl(nactiKlic('kb-zarovnat-styl')) || 'classic']
      || {};
    // „Moje mapa" má vlastní, těsnější rozestupy (PERSONAL_LAYOUT) — styl se
    // s nimi slučuje, aby tam Zarovnat dělalo totéž co jinde, ale mapa si
    // udržela svůj tvar (Richard 11. 8. v noci: „stačí tam vložit stejné
    // funkce zarovnání"). Rozestupy dává PERSONAL_LAYOUT, střídání styl.
    const o = (dir) => (personalMap ? { ...PERSONAL_LAYOUT(dir, citelnostRef.current), ...styl } : styl);
    // Ve vodorovném view nesou node.position VODOROVNÉ souřadnice — svislý
    // (kanonický) průchod by sourozence řadil podle X, což je tam HLOUBKA,
    // ne pořadí v řadě. Jakmile sevřené styly daly sourozencům různou hloubku,
    // zarovnání ve vodorovném view PŘEHÁZELO pořadí (nález Richarda 11. 8.:
    // „podcíl se mi dostane doprostřed mapy"). Pro svislý výpočet se proto
    // osy prohodí — pořadí sourozenců pak odpovídá tomu, co uživatel vidí.
    const horiz = directionRef.current === 'horizontal';
    const vstup = horiz
      ? allNodes.map((n) => (n.type === 'note' || !n.position ? n : { ...n, position: { x: n.position.y, y: n.position.x } }))
      : allNodes;
    const vpos = layoutTree(vstup, allEdges, 'vertical', o('vertical'));
    if (!horiz) return vpos;
    canonicalPosRef.current = new Map(
      allNodes.filter((n) => n.type !== 'note').map((n) => [n.id, vpos[n.id] || n.position])
    );
    return layoutTree(allNodes, allEdges, 'horizontal', o('horizontal'));
  }, [personalMap]);

  const handleAcceptAdvisor = useCallback(
    (preview, goalType, goalText) => {
      // Konverze náhledu je sdílená s useMapCreation (lib/mapNodes.js) a vrací
      // KANONICKÉ SVISLÉ pozice. Dřív se layoutovalo v aktuálním směru — na
      // mobilu (vodorovné view) pak save vydával vodorovné pozice za svislé
      // a mapa se po otevření na desktopu rozsypala (task #17).
      const { nodes: newNodes, edges: newEdges } = advisorPreviewToMap(preview, goalType, goalText, t('defaults.newGoal'));

      let laidOutNodes = newNodes;
      if (directionRef.current === 'horizontal') {
        // vodorovné view: kanonické svislé pozice zapsat do canonicalPosRef
        // (ať je save čte odtud) a pro ZOBRAZENÍ spočítat vodorovný layout
        for (const n of newNodes) canonicalPosRef.current.set(n.id, { ...n.position });
        const hpos = layoutTree(newNodes, newEdges, 'horizontal');
        laidOutNodes = newNodes.map((n) => ({ ...n, position: hpos[n.id] || n.position }));
      }

      setNodes((prev) => [...prev, ...laidOutNodes]);
      setEdges((prev) => [...prev, ...newEdges]);

      toast({
        title: t('toasts.structureAdded'),
        description: t('toasts.structureAddedDesc', { count: newNodes.length }),
      });
    },
    [setNodes, setEdges, toast, t]
  );

  const handleExpandNode = useCallback(
    async (nodeId, action = 'subgoals') => {
      const clickedNode = nodes.find((n) => n.id === nodeId);
      if (!clickedNode) return;

      // Build parent map from edges
      const parentMap = {};
      for (const edge of edges) {
        parentMap[edge.target] = edge.source;
      }

      // Find root node by following parent chain
      let rootId = nodeId;
      while (parentMap[rootId]) {
        rootId = parentMap[rootId];
      }
      const rootNode = nodes.find((n) => n.id === rootId);
      const rootText = rootNode?.data?.apexText || rootNode?.data?.title || '';

      // Build path from root to clicked node
      const path = [];
      let currentId = nodeId;
      while (currentId) {
        const node = nodes.find((n) => n.id === currentId);
        if (!node) break;
        path.unshift(node.data.title || node.data.apexText || '');
        currentId = parentMap[currentId];
      }

      setExpandingNodeId(nodeId);
      try {
        const isRewrite = action === 'rewrite';
        const result = await advisor({
          goal: rootText,
          mode: 'expand',
          action,
          path,
          node: {
            id: nodeId,
            title: clickedNode.data.title || clickedNode.data.apexText || '',
            description: clickedNode.data.description || '',
          },
          count: isRewrite ? 1 : 3,
        });
        const data = result.data;
        if (data?.error) {
          toast({ title: t('tasks:nodeTasksDialog.aiError'), description: data.error, variant: 'destructive' });
          return;
        }
        if (!data?.nodes || !Array.isArray(data.nodes)) {
          toast({ title: t('tasks:nodeTasksDialog.aiError'), description: t('toasts.aiInvalidResponse'), variant: 'destructive' });
          return;
        }

        if (isRewrite) {
          const updated = data.nodes[0];
          if (updated) {
            setNodes((prev) => prev.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, title: updated.title || n.data.title, description: updated.description || n.data.description } }
                : n
            ));
          }
          toast({ title: t('toasts.nodeImproved'), description: t('toasts.nodeImprovedDesc') });
          return;
        }

        const ts = Date.now();
        const newNodes = data.nodes.map((n, i) => ({
          id: `node-${ts}-${i}`,
          type: 'goalNode',
          position: { x: 0, y: 0 },
          data: {
            title: n.title || t('defaults.newGoal'),
            description: n.description || '',
            status: 'todo',
            color: '',
            collapsed: false,
          },
        }));
        const newEdges = data.nodes.map((n, i) => ({
          id: `edge-${ts}-${i}`,
          source: nodeId,
          target: `node-${ts}-${i}`,
          type: 'deletable',
        }));

        const allNodes = [...nodes, ...newNodes];
        const allEdges = [...edges, ...newEdges];
        const positions = layoutAllForView(allNodes, allEdges);
        const laidOutNodes = allNodes.map((n) => ({
          ...n,
          position: positions[n.id] || n.position,
        }));

        pushHistory();
        setNodes(laidOutNodes);
        setEdges(allEdges);

        // Přepočet layoutu uzel posune → vycentrovat pohled zpět NA NĚJ (i s okolím),
        // ať to „neuletí" jinam. Stejně jako při otevření mapy na uzel.
        centerOnNode(nodeId, { pos: positions[nodeId], delay: 80 });

        toast({
          title: t('toasts.subgoalsAdded'),
          description: t('toasts.subgoalsAddedDesc', { count: newNodes.length }),
        });
      } catch (err) {
        const msg = err.response?.data?.error || err.message || t('toasts.aiConnectionError');
        toast({ title: t('tasks:nodeTasksDialog.aiError'), description: msg, variant: 'destructive' });
      } finally {
        setExpandingNodeId(null);
      }
    },
    [nodes, edges, toast, setNodes, setEdges, pushHistory, centerOnNode, layoutAllForView]
  );

  const handleApplyOperations = useCallback(
    (operations) => {
      if (!operations || !operations.length) return;
      aiSnapshotRef.current = { nodes: nodes.map((n) => ({ ...n })), edges: edges.map((e) => ({ ...e })) };
      setCanUndoAi(true);
      pushHistory();

      const parentMap = {};
      for (const edge of edges) {
        parentMap[edge.target] = edge.source;
      }
      const rootNode = nodes.find((n) => !parentMap[n.id]);
      const rootId = rootNode?.id;

      let updatedNodes = [...nodes];
      let updatedEdges = [...edges];
      let counter = 0;

      for (const op of operations) {
        const suffix = `${Date.now()}-${counter++}`;

        if (op.op === 'add') {
          const parentId = op.parentId || rootId;
          if (!parentId) continue;
          const newId = `node-${suffix}`;
          updatedNodes = [
            ...updatedNodes,
            {
              id: newId,
              type: 'goalNode',
              position: { x: 0, y: 0 },
              data: {
                title: op.title || t('defaults.newGoal'),
                description: op.description || '',
                status: 'todo',
                color: '',
                collapsed: false,
              },
            },
          ];
          updatedEdges = [
            ...updatedEdges,
            { id: `edge-${suffix}`, source: parentId, target: newId, type: 'deletable' },
          ];
        } else if (op.op === 'update') {
          updatedNodes = updatedNodes.map((n) => {
            if (n.id !== op.id) return n;
            const dataUpdate = {};
            if (op.title !== undefined) dataUpdate.title = op.title;
            if (op.description !== undefined) dataUpdate.description = op.description;
            if (op.status !== undefined) dataUpdate.status = op.status;
            return { ...n, data: { ...n.data, ...dataUpdate } };
          });
        } else if (op.op === 'delete') {
          const parentId = (updatedEdges.find((e) => e.target === op.id) || {}).source;
          updatedEdges = updatedEdges
            .filter((e) => e.target !== op.id)
            .map((e) => e.source === op.id ? (parentId ? { ...e, source: parentId } : e) : e);
          updatedNodes = updatedNodes.filter((n) => n.id !== op.id);
        } else if (op.op === 'move') {
          updatedEdges = updatedEdges.map((e) =>
            e.target === op.id
              ? op.newParentId
                ? { ...e, source: op.newParentId }
                : null
              : e
          ).filter(Boolean);
        }
      }

      const positions = layoutAllForView(updatedNodes, updatedEdges);
      const laidOutNodes = updatedNodes.map((n) => ({
        ...n,
        position: positions[n.id] || n.position,
      }));

      setNodes(laidOutNodes);
      setEdges(updatedEdges);

      toast({
        title: t('toasts.opsApplied'),
        description: t('toasts.opsAppliedDesc', { count: operations.length }),
      });
    },
    [nodes, edges, setNodes, setEdges, pushHistory, toast, layoutAllForView]
  );

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

  const handleExport = async (format) => {
    setExporting(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      await captureAndSave(visibleNodes, title, format);
    } catch (e) {
      console.error(e);
    } finally {
      setExporting(false);
    }
  };

  // Export schématu do JSON — pro sdílení mezi lidmi i instancemi. Skládá se
  // z KANONICKÉHO tvaru (cleanMapData), tedy přesně z toho, co je v DB.
  const handleExportJson = async (includePeople) => {
    setExporting(true);
    try {
      const { cleanNodes, cleanEdges } = cleanMapData();
      let exportTasks = [];
      try {
        exportTasks = await base44.entities.Task.filter({ map_id: activeMapId }, 'created_date', 1000);
      } catch (err) { /* projekt bez úkolů nebo bez práv na ně */ }
      let exportRules = [];
      try {
        // čerstvě ze serveru (stav v editoru může být starší); GET /rules chce
        // editační práva — divák exportuje bez pravidel, to je záměr
        exportRules = await rulesApi.list(activeMapId);
      } catch (err) { /* bez práv na pravidla → export bez nich */ }
      downloadJson(exportFilename(title), buildMapExport({
        map: { title, description: '' },
        nodes: cleanNodes,
        edges: cleanEdges,
        tasks: exportTasks,
        rules: exportRules,
        includePeople,
        exportedBy: user?.email || '',
      }));
      toast({ title: t('toasts.jsonExported') });
    } catch (e) {
      console.error(e);
      toast({ title: t('toasts.jsonExportFailed'), variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  // Zarovnat STŘÍDÁ tři styly jedním tlačítkem (Richard 11. 8.: „rozklikávání
  // je několik zbytečných kliků — mačkám a mění se to; ať jsou 3"). Tlačítko
  // ukazuje styl, který na mapě PRÁVĚ JE — stisk přepne na další a popisek
  // se srovná s plátnem. (První verze ukazovala styl PŘÍŠTÍHO stisku a Richard
  // ji četl jako popis plátna — přirozeně; popisek musí sedět s tím, co vidí.)
  // Vzhled tlačítka nahrazuje vyskakovací hlášky. Poslední použitý styl se
  // pamatuje a drží ho i AI přelayouty.
  // Styl si pamatuje KAŽDÁ MAPA zvlášť. Dřív byl klíč jeden pro všechny, takže
  // čerstvě otevřená mapa zdědila popisek z mapy, kde se naposledy mačkalo, a
  // tvrdila styl, který na ní vůbec nebyl — první stisk pak popisek jen srovnal
  // a mapa se nehnula (Richard 11. 8. v noci). Globální klíč zůstává, ale slouží
  // už jen AI přelayoutům, které si drží poslední volbu uživatele.
  const [alignStyle, setAlignStyle] = useState('');
  // Styl čte i efekt přepínače směru, který ZÁMĚRNĚ nemá nodes/edges v deps —
  // proto přes ref, ne přes závislost (jinak by se mapa přerovnávala pořád).
  const alignStyleRef = useRef(alignStyle);
  alignStyleRef.current = alignStyle;
  // „Moje mapa" nemá záznam v databázi (staví se za běhu), ale styl si pamatovat
  // má taky — dostane vlastní jméno klíče
  const alignMapKey = personalMap ? 'moje-mapa' : activeMapId;
  // čte i layoutAllForView (AI přelayout), který záměrně nemá závislosti
  alignMapKeyRef.current = alignMapKey;
  useEffect(() => {
    if (!alignMapKey) return;                       // rozepsaná mapa ještě nemá id
    const ulozeny = platnyStyl(nactiKlic('kb-zarovnat-styl:' + alignMapKey));
    if (ulozeny) { setAlignStyle(ulozeny); return; }
    // Mapa právě vznikla (autosave jí přidělil id) — styl zvolený PŘED
    // uložením se přenese, jinak se popisek sám vynuloval, ačkoli mapa v tom
    // stylu je (panel /checkup 12. 8.).
    if (alignStyleRef.current) { ulozKlic('kb-zarovnat-styl:' + alignMapKey, alignStyleRef.current); return; }
    setAlignStyle('');
  }, [alignMapKey]);

  // ZÁMEČEK: zamčený styl platí pro všechny mapy (Richard 11. 8. v noci:
  // „na jedné to prokliká, zjistí, že se mu to líbí, a pak dá zámeček").
  // Richard vědomě zvolil, že se má uplatnit VŽDY při otevření mapy — tedy
  // i tam, kde si někdo uzly rozmístil ručně. Proto se při zapnutí říká
  // nahlas, co to udělá, a zámek nikdy nesahá na cizí/veřejnou mapu ani
  // na mapu bez práva editace.
  // ZÁMEK JE NA ÚČTU (vzor skin_id) — Richard 12. 8.: „udělej to stejně jako
  // skin". Dřív žil jen v prohlížeči, takže zámek zapnutý na počítači na
  // mobilu neplatil, ačkoli nápověda slibovala „pro všechny mapy".
  // localStorage zůstává jako záloha pro stav před načtením uživatele.
  const [alignLock, setAlignLock] = useState(() => zamcenyStyl());
  useEffect(() => {
    if (!user) return;
    const zUctu = platnyStyl(user.align_lock);
    setAlignLock(zUctu);
    ulozKlic(KLIC_ZAMEK, zUctu);   // ať to sedí i při příštím startu offline
  }, [user]);
  const zamekAplikovan = useRef(null);
  useEffect(() => {
    if (!alignLock || loading || !alignMapKey || isPublicView) return;
    if (!canEdit && !personalMap) return;                 // cizí mapa bez práv
    // ⚠️ V CIZÍ mapě se zámek NEUPLATNÍ VŮBEC (rozhodnutí Richarda 12. 8. 2026).
    // Původní „jen překreslit" nestačilo: `skipNextSave` potlačí jen NEJBLIŽŠÍ
    // uložení, takže první skutečná úprava (přejmenování uzlu, změna stavu)
    // uložila i přerovnání a vlastníkovi tiše přepsala rozmístění, které si
    // naklikal. Uživatel v tu chvíli souhlasil s přejmenováním, ne s přeházením
    // cizí mapy. Zarovnat si jde v cizí mapě pořád zmáčknout ručně.
    if (!isMapOwner && !personalMap) return;
    if (zamekAplikovan.current === alignMapKey) return;   // na mapu jen jednou
    if (!nodes.length) return;                            // ještě se načítá
    zamekAplikovan.current = alignMapKey;
    // ⚠️ Zámek jen PŘEKRESLUJE, NEUKLÁDÁ. Bez téhle pojistky autosave uložil
    // přerovnání hned po otevření — a protože `canEdit` platí i pro CIZÍ
    // sdílenou mapu, přepsalo by to rozmístění, které si naklikal její
    // vlastník, a mapě by to změnilo „naposledy upraveno" jen tím, že se na ni
    // někdo podíval. Schválené bylo „mapa se otevře v mém stylu", ne zápis do
    // cizích dat (panel /checkup 12. 8.). Uloží se to až s první skutečnou
    // úpravou, tedy se souhlasem uživatele.
    skipNextSave.current = true;
    const positions = layoutAllForView(nodes, edges, ALIGN_OPTS[alignLock] || {});
    setNodes((prev) => prev.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n)));
    setAlignStyle(alignLock);
    ulozKlic('kb-zarovnat-styl:' + alignMapKey, alignLock);
    recenterMap();
  }, [alignLock, loading, alignMapKey, isPublicView, canEdit, isMapOwner, personalMap, nodes, edges, layoutAllForView, setNodes, recenterMap]);

  // Zámek se ovládá PODRŽENÍM tlačítka Zarovnat, ne vlastní ikonou (Richard
  // 11. 8. v noci: „solo tlačítko mě štve… to tlačítko, co přepíná vzhledy,
  // jestli by nešlo déle podržet a změnilo by barvu"). Další stisk zámek zase
  // pustí a rovnou přepne styl dál.
  const DRZENI_MS = 600;
  const drzeniTimer = useRef(null);
  const bylDlouhyStisk = useRef(false);

  const ulozZamek = useCallback((styl) => {
    ulozKlic(KLIC_ZAMEK, styl);
    setAlignLock(styl);
    if (user?.id) {
      base44.entities.User.update(user.id, { align_lock: styl }).catch(() => {});
      patchUser({ align_lock: styl });
    }
  }, [user, patchUser]);

  const zamkniAktualniStyl = useCallback(() => {
    const styl = alignStyle || 'classic';
    ulozZamek(styl);
    // Když se zamyká na dosud nezarovnané mapě, musí se styl projevit HNED —
    // dřív se tlačítko jen obarvilo a mapa zůstala, jak byla (projevilo se to
    // až při příštím otevření). Zase ten pocit „tlačítko nic nedělá".
    if (!alignStyle) zamekAplikovan.current = null;  // ať mapu dorovná efekt zámku
    else zamekAplikovan.current = alignMapKey;       // v tomhle stylu už je
    toast({ title: t('toasts.alignLocked', { styl: t(`toolbar.alignShort_${styl}`) }), description: t('toasts.alignLockedDesc') });
  }, [alignStyle, alignMapKey, toast, t]);

  const alignPressStart = useCallback(() => {
    bylDlouhyStisk.current = false;
    clearTimeout(drzeniTimer.current);
    drzeniTimer.current = setTimeout(() => {
      bylDlouhyStisk.current = true;
      zamkniAktualniStyl();
    }, DRZENI_MS);
  }, [zamkniAktualniStyl]);

  const alignPressEnd = useCallback(() => { clearTimeout(drzeniTimer.current); }, []);
  useEffect(() => () => clearTimeout(drzeniTimer.current), []);
  const handleAlign = useCallback(() => {
    // po podržení (zamknutí) se klik už nekoná — jinak by zámek hned přeskočil
    // na další styl
    if (bylDlouhyStisk.current) { bylDlouhyStisk.current = false; return; }
    // „Když zase začneš mačkat, tak to zrušíš a změníš" — stisk zámek pustí
    // a rovnou pokračuje v cyklu stylů
    if (alignLock) {
      ulozZamek('');
      toast({ title: t('toasts.alignUnlocked'), description: t('toasts.alignUnlockedDesc') });
    }
    // Zarovnat přepíše rozmístění všech uzlů — musí jít vzít Zpět. Dřív to
    // jako jediná destruktivní operace historii neplnilo, takže ručně
    // srovnaná mapa byla po stisku nenávratně pryč (panel /checkup 12. 8.).
    pushHistory();
    // z „ještě nezarovnáno" (prázdný styl) jde první stisk na klasiku
    const dalsi = alignStyle
      ? (ALIGN_STYLES[(ALIGN_STYLES.indexOf(alignStyle) + 1) % ALIGN_STYLES.length] || 'classic')
      : 'classic';
    ulozKlic('kb-zarovnat-styl', dalsi);            // pro AI přelayouty
    if (alignMapKey) ulozKlic('kb-zarovnat-styl:' + alignMapKey, dalsi); // pro popisek téhle mapy
    setAlignStyle(dalsi);
    const positions = layoutAllForView(nodes, edges, ALIGN_OPTS[dalsi] || {});
    setNodes((prev) =>
      prev.map((n) => {
        const pos = positions[n.id];
        return pos ? { ...n, position: pos } : n;
      })
    );
    // Přerovnaná mapa skončí jinde, než kam se uživatel díval — bez tohohle
    // zůstane mimo obrazovku a vypadá to, že Zarovnat mapu ztratilo
    // (Richard 11. 8. v noci). Stejné vycentrování jako tlačítko čtverečku.
    recenterMap();
  }, [nodes, edges, setNodes, layoutAllForView, alignStyle, recenterMap, alignMapKey, alignLock, toast, t, pushHistory, ulozZamek]);

  // Čitelnost STŘÍDÁ tři stupně velikosti písma v uzlu, stejným pohybem jako
  // Zarovnat (Richard 12. 8. 2026: „mačkám a mění se styl"). Na rozdíl od
  // Zarovnat se NIC NEPŘEPOČÍTÁVÁ — uzly zůstávají na svých pozicích, mění se
  // jen sazba uvnitř karty. Volba je PER ZAŘÍZENÍ (localStorage): na velkém
  // monitoru dává smysl jiná než na telefonu.
  //
  // ⚠️ Že se uzly nehýbou, NESTAČÍ na to, aby se nic neuložilo — stupně mění
  // VÝŠKU karty a ReactFlow na to pošle `dimensions` change, což rozhýbe
  // autosave (panel /checkup 13. 8. 2026, naměřeno: 1 stisk = 1 PATCH).
  // Řeší se to u příčiny — autosave neposílá změnu, která nic nemění; viz
  // „prázdné uložení" u saveTimer. Tady se proto nic potlačovat NESMÍ:
  // `skipNextSave` ruší NEJBLIŽŠÍ uložení, takže kdyby uživatel psal název
  // a do 1,2 s stiskl Čitelnost, spolkla by se mu skutečná změna.
  const [citelnost, setCitelnost] = useState(nactiStupen);
  citelnostRef.current = citelnost;
  const handleCitelnost = useCallback(() => {
    setCitelnost((predchozi) => {
      const dalsi = dalsiStupen(predchozi);
      ulozKlic(KLIC_CITELNOST, dalsi);
      return dalsi;
    });
  }, []);

  const handleUndoAi = useCallback(() => {
    const snapshot = aiSnapshotRef.current;
    if (!snapshot) return;
    skipNextSave.current = true;
    setNodes(snapshot.nodes.map((n) => ({ ...n })));
    setEdges(snapshot.edges.map((e) => ({ ...e })));
    aiSnapshotRef.current = null;
    setCanUndoAi(false);
    toast({ title: t('toasts.aiUndone'), description: t('toasts.aiUndoneDesc') });
  }, [setNodes, setEdges, toast]);

  const contextValue = useMemo(
    () => ({
      onAddChild: canEdit ? handleAddChild : undefined,
      // spolupracovník (work) uzel od 14. 8. 2026 OTEVÍRÁ taky — dostane
      // zjednodušené okno (variant="work" níže); cyklování stavu klikem na
      // odznak zůstává beze změny (anti-bloat: žádný klik navíc)
      onEditNode: canEdit || canWork ? setEditNodeId : undefined,
      onDeleteNode: canEdit ? handleDeleteNode : undefined,
      onDeleteEdge: canEdit ? handleDeleteEdge : undefined,
      onExpandNode: canEdit && ai.has('expand') && user ? handleExpandNode : undefined,
      onToggleCollapse: handleToggleCollapse,
      onCycleStatus: canEdit ? handleCycleStatus : (canWork ? handleCycleStatusWork : undefined),
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
    [handleAddChild, handleDeleteNode, handleDeleteEdge, handleExpandNode, handleToggleCollapse, handleCycleStatus, handleCycleStatusWork, canWork, progressMap, hiddenCounts, nodes, edges, searchQuery, canEdit, expandingNodeId, myTasksOnly, user, commentCounts, handleUpdateNote, bufferEnabled, handleStashNode, handleDetachNode, taskStats, activeMapId, isPublicView, ai, waitingSet, runningAgentNodes, ruleNodes, recurrenceNodes, direction, personalMap, citelnost, mapKind]
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
      {conflict && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl shadow-lg max-w-md w-full p-5 space-y-3">
            <h3 className="font-heading font-semibold text-lg">{t('conflict.title')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('conflict.body')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('conflict.keepMineHint')} {t('conflict.reloadHint')}
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" className="mr-auto" disabled={exporting} onClick={() => handleExportJson(true)}>
                {t('conflict.download')}
              </Button>
              <Button variant="outline" disabled={saveStatus === 'saving'} onClick={handleKeepMine}>
                {t('conflict.keepMine')}
              </Button>
              <Button onClick={() => window.location.reload()}>{t('conflict.reload')}</Button>
            </div>
          </div>
        </div>
      )}
      {isPublicView && (
        <div className="h-9 bg-amber-50 border-b border-amber-200 dark:bg-amber-950/40 dark:border-amber-900 flex items-center justify-center gap-3 px-4 text-sm shrink-0">
          <span className="text-amber-800 dark:text-amber-300 font-medium">{t('banner.publicMap')}</span>
          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => navigate('/login')}>{t('banner.login')}</Button>
        </div>
      )}
      {archived && (
        <div className="h-9 bg-secondary border-b flex items-center justify-center gap-3 px-4 text-sm shrink-0">
          <span className="text-muted-foreground font-medium flex items-center gap-1.5">
            <Archive className="w-3.5 h-3.5" /> {t('banner.archivedProject')}
          </span>
          {isMapOwner && (
            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={handleToggleArchive}>
              <ArchiveRestore className="w-3 h-3" /> {t('banner.restore')}
            </Button>
          )}
        </div>
      )}
      {isTemplatePreview && (
        <div className="h-9 bg-indigo-50 border-b border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-900 flex items-center justify-center gap-3 px-4 text-sm shrink-0">
          <span className="text-indigo-800 dark:text-indigo-300 font-medium">{t('banner.templatePreview')}</span>
          <Button size="sm" className="h-6 text-xs" disabled={savingTemplate} onClick={handleSaveTemplate}>
            {savingTemplate ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            {t('banner.useTemplate')}
          </Button>
        </div>
      )}
      {remoteChanged && !conflict && (
        <div className="h-9 bg-amber-50 border-b border-amber-200 dark:bg-amber-950/40 dark:border-amber-900 flex items-center justify-center gap-3 px-4 text-sm shrink-0">
          <span className="text-amber-800 dark:text-amber-300 font-medium">{t('banner.mapChanged')}</span>
          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => window.location.reload()}>
            {t('conflict.reload')}
          </Button>
        </div>
      )}
      <header className="min-h-14 sm:h-14 border-b bg-card flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-2 gap-y-1.5 px-3 sm:px-4 py-1.5 sm:py-0 z-10 shrink-0">
        <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto sm:flex-1">
          {/* NAŠE značka patří úplně doleva, před šipku zpět (Richard 6. 8.).
              U názvu projektu být nesmí — tam si zákazník dává svoje vlastní
              logo a dvě loga vedle sebe by si konkurovala.
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
            <span className="flex items-center" aria-hidden="true">
              <img src="/znak-ikona.webp" alt="" width="512" height="512"
                   className="sm:hidden h-5 w-5 rounded-sm" />
              <span className="hidden sm:flex items-center">
                <img src="/znak-tmavy.webp" alt="" width="525" height="320"
                     className="hidden dark:block h-5 w-auto" />
                <img src="/znak-svetly.webp" alt="" width="493" height="320"
                     className="dark:hidden h-5 w-auto" />
              </span>
            </span>
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
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            readOnly={!canEdit}
            className="bg-transparent text-sm font-heading font-semibold outline-none flex-1 min-w-0"
            placeholder={t('toolbar.titlePlaceholder')}
          />
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
              onClick={() => canEdit && setShareOpen(true)}
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
          {canEdit && user && !isDraft && !isTemplatePreview && (
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
              {canEdit && user && !isDraft && !isTemplatePreview && (
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
        {dashboardOpen ? (
          <ProgressDashboard nodes={nodes} edges={edges} tasks={mapTasks} mapTitle={title} mapId={personalMap ? '' : (activeMapId || '')} />
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
            onNodeClick={personalMap ? (e, node) => {
              const tgt = personalTargets.current[node.id];
              if (!tgt) return;
              if (tgt.type === 'task') navigate(`/tasks?task=${tgt.taskId}`);
              else navigate(`/map/${tgt.mapId}?node=${tgt.nodeId}`);
            } : undefined}
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
        </MembersContext.Provider>
        </GoalMapContext.Provider>
        )}
        {bufferEnabled && !dashboardOpen && (
          <BufferPanel
            buffer={buffer}
            canEdit={canEdit}
            onInsert={insertBufferItem}
            // Jednoklikový „převod na úkol" z editoru ODEBRÁN (Richard 7. 8.
            // 2026 v noci): tiše zakládal úkolový záznam na vrcholu — nikde
            // nebyl vidět a model říká „zakládáme uzly". Návrat do mapy dělá
            // vložení (šipka). Vědomý převod s výběrem projektu zůstává na
            // stránce Úkoly (otevírá plný dialog).
            open={bufferOpen}
            onToggle={toggleBuffer}
            leftOffset={timeLogOpen ? 320 : 0}
          />
        )}
        {user && !isPublicView && !dashboardOpen && (
          <TimeLogPanel mapId={activeMapId || mapId} nodes={nodes} open={timeLogOpen} onToggle={toggleTimeLog} leftOffset={bufferOpen ? 288 : 0} />
        )}
        {/* Levá lišta pod zásobníkem (top-16) a časovačem (top-28): LUPA
            rozbalí vyhledávání, FILTR přepíná Moje úkoly (Richard 11. 8. —
            z horní lišty pryč, „je to jen filtr"). Aktivní stav je vidět na
            ikoně, panely lištu odsouvají stejně jako ouška. */}
        {!dashboardOpen && (() => {
          const railLeft = bufferOpen ? 288 : timeLogOpen ? 320 : 0;
          const railCls = railLeft ? '' : 'border-l-0';
          return (
            <>
              {searchOpen ? (
                <div style={{ left: railLeft }} className={`absolute top-40 z-30 flex items-center gap-1 rounded-r-lg border ${railCls} bg-card pl-1 pr-1 py-1.5 shadow-md`}>
                  {/* lupa je přepínač: druhý klik pole zavře (dotaz zůstává platný
                      a zavřená lupa ho ukazuje podbarvením); křížek maže a zavírá */}
                  <button
                    onClick={() => setSearchOpen(false)}
                    className="p-1 shrink-0 text-primary hover:text-foreground"
                    title={t('toolbar.searchPlaceholder')}
                  >
                    <Search className="w-4 h-4" />
                  </button>
                  <input
                    autoFocus
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') { setSearchQuery(''); setSearchOpen(false); } }}
                    placeholder={t('toolbar.searchPlaceholder')}
                    className="h-7 w-44 bg-transparent text-sm outline-none"
                  />
                  <button
                    onClick={() => { setSearchQuery(''); setSearchOpen(false); }}
                    className="p-1 text-muted-foreground hover:text-foreground"
                    title={t('common:actions.close')}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setSearchOpen(true)}
                  style={{ left: railLeft }}
                  title={t('toolbar.searchPlaceholder')}
                  className={`absolute top-40 z-30 flex items-center rounded-r-lg border ${railCls} bg-card px-2 py-2.5 shadow-md hover:bg-secondary transition-all`}
                >
                  <Search className={`w-4 h-4 ${searchQuery ? 'text-primary' : 'text-muted-foreground'}`} />
                </button>
              )}
              {user && (
                <button
                  onClick={() => setMyTasksOnly((v) => !v)}
                  style={{ left: railLeft }}
                  title={t('toolbar.myTasksTitle')}
                  className={`absolute top-52 z-30 flex items-center rounded-r-lg border ${railCls} px-2 py-2.5 shadow-md transition-all ${myTasksOnly ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-secondary'}`}
                >
                  <Filter className="w-4 h-4" />
                </button>
              )}
            </>
          );
        })()}
        {/* Dashboard v levé liště POD filtrem (Richard 11. 8.) — vědomě MIMO
            guard !dashboardOpen: při otevřeném dashboardu zůstává viditelný
            (podbarvený) a druhým klikem ho zavřeš. Panely jsou v tu chvíli
            schované, takže lišta sedí u kraje. */}
        <button
          onClick={() => setDashboardOpen((v) => !v)}
          style={{ left: dashboardOpen ? 0 : (bufferOpen ? 288 : timeLogOpen ? 320 : 0) }}
          title={t('toolbar.dashboardTitle')}
          className={`absolute top-64 z-30 flex items-center rounded-r-lg border px-2 py-2.5 shadow-md transition-all ${dashboardOpen ? 'bg-primary text-primary-foreground border-l-0' : `bg-card text-muted-foreground hover:bg-secondary ${(bufferOpen || timeLogOpen) ? '' : 'border-l-0'}`}`}
        >
          <BarChart3 className="w-4 h-4" />
        </button>
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
      <NodeEditDialog
        variant={canEdit ? 'full' : 'work'}
        orgMap={mapKind === 'org'}
        node={editNode}
        mapId={activeMapId || mapId}
        onSave={handleSaveNode}
        onClose={() => setEditNodeId(null)}
        mapAccess={effectiveMapAccess}
        members={members}
        onShareAdd={user && activeMapId ? handleShareAdd : undefined}
        onStash={bufferEnabled && canEdit ? handleStashNode : undefined}
        map={user && activeMapId && !isPublicView ? { id: activeMapId, title, nodes } : undefined}
        emailOptions={ownerOptions}
        onTasksChanged={() => setTaskStatsVersion((v) => v + 1)}
        onContactsChanged={reloadMembers}
        onWorkStatusSaved={(nodeId, next, updated) => {
          // zrcadlo handleCycleStatusWork: lokální stav + verze pro base_updated
          setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status: next } } : n)));
          if (updated) baseUpdated.current = updated;
        }}
        extraExecutorContent={canEdit && editNode && editNode.type !== 'apexNode' ? (
          <NodeRulesPanel rules={mapRules} nodeId={editNode.id} onOpenRules={openRulesFromNode} />
        ) : undefined}
        extraAssignmentContent={canEdit && user && activeMapId && !isPublicView && mapKind !== 'org' && editNode && editNode.type !== 'apexNode' ? (
          <RecurrenceSwitch
            mapId={activeMapId}
            nodeId={editNode.id}
            nodeTitle={editNode.data?.title || ''}
            rules={mapRules}
            onRulesChanged={setMapRules}
          />
        ) : undefined}
        extraBehaviorContent={canEdit && editNode && editNode.type !== 'apexNode' ? (
          <UnblockRulesHint rules={mapRules} nodeId={editNode.id} onOpenRules={openRulesFromNode} />
        ) : undefined}
      />
      {canEdit && user && activeMapId && !isPublicView && (
        <RulesDialog
          open={rulesOpen}
          mapId={activeMapId}
          nodes={nodes}
          edges={edges}
          members={members}
          mapAccess={effectiveMapAccess}
          onShareAdd={user && activeMapId ? handleShareAdd : undefined}
          onContactsChanged={reloadMembers}
          defaults={rulesDefaults}
          onClose={() => setRulesOpen(false)}
          onRulesChanged={setMapRules}
          onEnableWaiting={handleEnableWaiting}
        />
      )}
      {taskNodeId && activeMapId && (
        <NodeTasksDialog
          map={{ id: activeMapId, title, nodes }}
          nodeId={taskNodeId}
          canEdit={canEdit}
          members={members}
          onClose={() => setTaskNodeId(null)}
          onChanged={() => setTaskStatsVersion((v) => v + 1)}
        />
      )}
      <SaveTemplateDialog
        open={saveTplOpen}
        mapTitle={title}
        nodes={nodes}
        edges={edges}
        onClose={() => setSaveTplOpen(false)}
      />
      <SkinDialog open={skinOpen} onClose={() => setSkinOpen(false)} />
      <ShareDialog
        open={shareOpen}
        mapId={mapId}
        onClose={() => setShareOpen(false)}
        onMapBumped={(u) => { baseUpdated.current = u; }}
      />
      <AdvisorDialog
        open={advisorOpen}
        onClose={() => setAdvisorOpen(false)}
        onAccept={handleAcceptAdvisor}
      />
      <AIChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        mapTitle={title}
        nodes={nodes}
        edges={edges}
        onApplyOperations={handleApplyOperations}
        onUndoAi={handleUndoAi}
        canUndoAi={canUndoAi}
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
