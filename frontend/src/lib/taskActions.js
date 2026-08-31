// Řádkové akce nad položkou práce — JEDINÉ místo, kde se v celé aplikaci píše
// „hotovo / naplánovat / delegovat" bez otevírání dialogu.
//
// Proč sdílený primitiv: tyhle akce potřebuje „Můj den", stránka Úkoly i
// zjednodušený (light) režim. Kdyby vznikly v každém pohledu zvlášť, budou
// tři různá chování téže věci a rozejdou se — přesně ten tichý drift, na který
// se doplácí později. Změna sémantiky se dělá TADY, ne v komponentě.
//
// Práce má v aplikaci dvě podoby a obě musí umět totéž:
//   • úkol   = záznam v kolekci `tasks`
//   • uzel   = položka v JSON blobu mapy (`goalmaps.nodes`), bez vlastní DB identity
//   • nápad  = `buffer_nodes` (zásobník) — nese jen termín, „hotovo" u něj nedává smysl
// Volající proto nepracuje s kolekcemi, ale s cílem (`target`) z toTarget().

import { base44 } from '@/api/base44Client';
import { pb } from '@/api/pb';
import { ulozDoMapy } from '@/lib/mapNodes';

// 'en-CA' = datový klíč YYYY-MM-DD v LOKÁLNÍ zóně (formát DB), NE zobrazení —
// neměnit podle jazyka (stejná konvence jako v MyDaySection).
// Pozn.: pomocné funkce nad daty jsou ZÁMĚRNĚ deklarace `function`, ne šipky —
// unit test product/tests/task-actions.js si je vytahuje ze zdrojáku (stejný
// postup jako cleanmap-parity.js), protože soubor jinak importuje datovou
// vrstvu přes alias @/, který mimo Vite neexistuje.
export function todayKey(d = new Date()) {
  return d.toLocaleDateString('en-CA');
}

function addDays(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return todayKey(d);
}

// Den, na který si práci plánuji. Počítá se VŽDY ode dneška, ne od termínu:
// „zítra" musí znamenat zítra i u úkolu, který je týden po termínu.
export function planDate(when) {
  if (when === 'today') return todayKey();
  if (when === 'tomorrow') return addDays(1);
  if (when === 'nextWeek') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    // nejbližší pondělí (dnešní pondělí = za týden, ne dnes)
    const delta = ((8 - d.getDay()) % 7) || 7;
    d.setDate(d.getDate() + delta);
    return todayKey(d);
  }
  throw new Error(`neznámé naplánování: ${when}`);
}

// Plán do MINULOSTI je neplatný — po půlnoci se seznam nevleče včerejškem
// a není potřeba žádný úklidový cron. Vrací '' | 'today' | 'tomorrow' | 'later'.
export function planState(value) {
  if (!value) return '';
  const today = todayKey();
  if (value < today) return '';        // propadlý plán = žádný plán
  if (value === today) return 'today';
  if (value === planDate('tomorrow')) return 'tomorrow';
  return 'later';
}


// Sjednocení dvou tvarů položky, které v aplikaci existují:
//   „Můj den"  → { kind: 'task'|'node'|'delegated'|'idea', id, mapId, isNode }
//   Úkoly      → { id, map_id, node_id, isNode }
// Vrací { kind, id, mapId, nodeId } — nebo null, když položka není akční.
export function toTarget(item) {
  if (!item) return null;
  const mapId = item.mapId || item.map_id || '';
  if (item.kind === 'idea') return { kind: 'idea', id: item.id, mapId: '', nodeId: '' };
  if (item.kind === 'node' || item.isNode) {
    const nodeId = item.nodeId || item.node_id || (item.kind === 'node' ? item.id : '');
    if (!mapId || !nodeId) return null; // uzel bez mapy = osiřelý řádek, nesahat
    return { kind: 'node', id: nodeId, mapId, nodeId };
  }
  return { kind: 'task', id: item.id, mapId, nodeId: item.node_id || '' };
}

// Zápis do uzlu mapy s optimistickým zámkem (ulozDoMapy: čerstvé načtení + base_updated,
// při 409 jedno opakování nad čerstvým stavem). Do 27. 8. 2026 se base_updated ZÁMĚRNĚ
// neposílal („řádková akce mění jediné pole"), jenže celé `nodes` bez zámku při souběhu
// s otevřeným editorem tiše přepsalo kolegovu změnu (nález S6-04; rozhodnutí Richarda).
// nodePatch = volitelná pole SAMOTNÉHO uzlu (dnes jen `type`). Je tu schválně:
// volající, který mění typ i data, musí uložit JEDNOU. Dvojí uložení za sebou
// znamená dvojí okno pro kolizi s auto-savem otevřeného editoru a dva řádky
// v záznamníku změn za jednu akci uživatele.
export async function patchNodeData(mapId, nodeId, patch, nodePatch) {
  const mutace = (fresh) => ({ nodes: (fresh.nodes || []).map((n) =>
    n.id === nodeId ? { ...n, ...(nodePatch || {}), data: { ...n.data, ...patch } } : n) });
  try {
    return (await ulozDoMapy(mapId, mutace)).nodes;
  } catch (e) {
    // Spolupracovník (work) nemá RLS právo na PATCH mapy — čistou změnu STAVU
    // pustí cílená routa /node-status (jeho jediná zapisovací cesta). Bez tohohle
    // by mu odškrtnutí z Mého dne / stránky Úkoly / mobilu spadlo na 403/404.
    const statusOnly = !nodePatch && Object.keys(patch || {}).every((k) => k === 'status');
    if (!statusOnly || !(e?.status === 403 || e?.status === 404)) throw e;
    await pb.send('/api/kb/node-status', { method: 'POST', body: { mapId, nodeId, status: patch.status } });
    const fresh = (await base44.entities.GoalMap.filter({ id: mapId }))[0];
    return fresh ? (fresh.nodes || []) : [];
  }
}

// Každá akce vrací { target, patch, nodes? } — volající si podle toho posune
// vlastní stav bez dalšího dotazu na server (nodes = nový obsah mapy).
const applyTask = async (target, patch) => {
  await base44.entities.Task.update(target.id, patch);
  return { target, patch };
};

const applyNode = async (target, patch) => {
  const nodes = await patchNodeData(target.mapId, target.nodeId, patch);
  return { target, patch, nodes };
};

const applyIdea = async (target, patch) => {
  await base44.entities.BufferNode.update(target.id, patch);
  return { target, patch };
};

// Úkol i uzel nesou tutéž vlastnost pod jiným názvem — mapa polí na jednom místě.
// `deadline` tu zůstává jako dokumentace modelu, ale ŽÁDNÁ řádková akce ho
// nemění: termín je dohoda s někým jiným a mění se výhradně v detailu úkolu.
const FIELD = {
  task: { status: 'status', deadline: 'deadline', planned: 'planned_on', assignee: 'assignee_email' },
  node: { status: 'status', deadline: 'deadline', planned: 'plannedOn', assignee: 'owner' },
  // nápad ze zásobníku plánovat jde, hotovo u něj nedává smysl
  idea: { deadline: 'deadline', planned: 'planned_on' },
};

const apply = (target, patch) => {
  if (target.kind === 'node') return applyNode(target, patch);
  if (target.kind === 'idea') return applyIdea(target, patch);
  return applyTask(target, patch);
};

const fieldPatch = (target, key, value) => {
  const name = FIELD[target.kind]?.[key];
  if (!name) throw new Error(`akce ${key} není pro ${target.kind} podporovaná`);
  return { [name]: value };
};

export const markDone = (target) => apply(target, fieldPatch(target, 'status', 'done'));
// vrácení omylem odbavené práce PŘESNĚ do stavu, ve kterém byla
export const setStatus = (target, status) => apply(target, fieldPatch(target, 'status', status));

// ⚠️ PLÁNOVÁNÍ SE NEDOTÝKÁ TERMÍNU. Dřív „odložit na zítra" přepsalo termín,
// což tichým kliknutím v seznamu měnilo dohodu s někým jiným. Termín se mění
// výhradně vědomě přes kalendář v detailu (rozhodnutí Richarda 27. 7. 2026:
// „termín je termín"). Tohle je jen MŮJ plán, kdy se tomu chci věnovat.
export const plan = (target, when) => apply(target, fieldPatch(target, 'planned', planDate(when)));
export const unplan = (target) => apply(target, fieldPatch(target, 'planned', ''));

// Které akce dávají u dané položky smysl. Řídí se tím jak řádková lišta, tak
// lite režim — ať se nabídka nerozejde s tím, co server přijme.
// Delegovanou položku (práce někoho jiného) záměrně NEjde odbavit za něj:
// řádek ji ukazuje jen proto, abych hlídal termín.
export function availableActions(item) {
  const target = toTarget(item);
  if (!target) return [];
  if (item.kind === 'delegated') return [];
  if (target.kind === 'idea') return ['plan'];
  return ['done', 'plan'];
}
