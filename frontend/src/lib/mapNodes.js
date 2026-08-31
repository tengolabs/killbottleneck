// Založení uzlu v projektu — JEDNO místo pro celou aplikaci.
//
// Model (Richard 27. 7. 2026): **úkol musí mít vždy uzel.** Buď žije v mapě
// pověšený na uzlu, nebo z něj vznikne nápad v zásobníku. Úkol bez uzlu je
// okrajový stav, který nemá kde bydlet a nikde se pořádně nezobrazí.
// Proto tuhle funkci potřebuje i rychlé přidání v lite režimu, nejen
// stránka Úkoly — kdyby ji každý měl vlastní, rozejdou se.
//
// Layout: stejná logika jako AI mapy a tlačítko Zarovnat, ať nový uzel
// nepřistane přes jiný.
import { base44 } from '@/api/base44Client';
import { layoutTree } from '@/lib/treeLayout';
import { optsNoveMapy } from '@/lib/alignStyles';

// JEDEN predikát vrcholu pro celou aplikaci (editor ho potřebuje na třech
// místech — dva vlastní tvary by se rozešly, viz historie tohohle souboru).
export const isApexNode = (n) => !!n && (n.type === 'apexNode' || n.data?.nodeType === 'apex');

// parentNodeId: id rodiče, nebo 'auto' = pověsit pod vrcholový (apex) uzel.
// data: volitelná pole uzlu navíc (owner, deadline…).
// Vrací { nodeId, nodes, edges } — volající si podle toho posune vlastní stav.
// Zápis do mapy s optimistickým zámkem (Richard 27. 8. 2026, nález S6-04 analýzy kódu):
// řádkové akce (Úkoly, Můj den, zásobník) dřív zapisovaly celé `nodes` BEZ `base_updated`,
// takže při souběhu s otevřeným editorem tiše přepsaly kolegovu změnu. `mutace(fresh)`
// vrátí { nodes, edges? } (nebo null = nic); při 409 se mapa načte znovu a mutace se
// zopakuje JEDNOU — řádková akce mění jediný uzel, do čerstvého stavu se vejde;
// druhé 409 už propadne volajícímu (dialog konfliktu má editor, tady stačí hláška).
export async function ulozDoMapy(mapId, mutace) {
  for (let pokus = 0; pokus < 2; pokus++) {
    const fresh = (await base44.entities.GoalMap.filter({ id: mapId }))[0];
    if (!fresh) throw new Error('mapNotFound');
    const zmena = mutace(fresh);
    if (!zmena) return { fresh, nodes: fresh.nodes || [], edges: fresh.edges || [] };
    try {
      await base44.entities.GoalMap.update(mapId, { ...zmena, base_updated: fresh.updated_date });
      return { fresh, nodes: zmena.nodes || fresh.nodes || [], edges: zmena.edges || fresh.edges || [] };
    } catch (e) {
      if (e?.status !== 409 || pokus === 1) throw e;
    }
  }
  return null;
}

export async function addNodeToMap(mapId, parentNodeId, title, data = {}) {
  let newId = null;
  const vysl = await ulozDoMapy(mapId, (fresh) => {

    let parentId = parentNodeId;
    if (parentId === 'auto') {
      const targets = new Set((fresh.edges || []).map((e) => e.target));
      const roots = (fresh.nodes || []).filter((n) => n.type !== 'note' && !targets.has(n.id));
      parentId = (roots.find((r) => r.type === 'apexNode') || roots[0])?.id || null;
    }
    const parent = parentId ? (fresh.nodes || []).find((n) => n.id === parentId) : null;

    const ts = Date.now();
    newId = `node-${ts}`;
    const newNode = {
      id: newId,
      type: 'goalNode',
      position: { x: 0, y: 0 },
      data: {
        title,
        status: 'todo',
        description: '',
        collapsed: false,
        color: parent?.data?.color || '',
        nodeType: 'normal',
        goalType: '',
        apexText: '',
        deadline: '',
        owner: '',
        ...data,
      },
    };

    let nodes = [...(fresh.nodes || []), newNode];
    const edges = parentId
      ? [...(fresh.edges || []), { id: `edge-${ts}`, source: parentId, target: newId, type: 'deletable' }]
      : (fresh.edges || []);
    // stejný styl jako u mapy ze šablony — jinak vzniká mapa klasicky,
    // popisek tlačítka hlásí něco jiného a první stisk „nic neudělá"
    // (Richard 12. 8.: „u nové mapy musím 2× zmáčknout")
    const positions = layoutTree(nodes, edges, 'vertical', optsNoveMapy());
    nodes = nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n));

    return { nodes, edges };
  });
  return { nodeId: newId, nodes: vysl.nodes, edges: vysl.edges };
}

// AI náhled (Navrhnout s AI / Mapa z textu) → uzly a hrany mapy. JEDNO místo
// pro editor (přijetí do otevřené mapy) i useMapCreation (nová mapa se zakládá
// ROVNOU s obsahem). Pozice jsou vždy KANONICKÉ SVISLÉ — vodorovné (mobilní)
// zobrazení je view-only starost editoru; layout v aktuálním směru tady dřív
// končil tak, že se vodorovné pozice uložily do DB jako svislé (task #17).
// newGoalLabel: fallback titulku uzlu bez názvu (překlad si nese volající).
export function advisorPreviewToMap(preview, goalType, goalText, newGoalLabel = '') {
  const ts = Date.now();
  // AI polím id/parentId NEVĚŘIT (kontrakt brány je nezakazuje): duplicitní id
  // zahodit (první vyhrává), self-parent a hrana zavírající cyklus se zruší —
  // uzel se stane kořenem a layout ho normálně položí (jinak by celý kruh
  // ležel bez pozice na 0,0 a mapa neměla vrchol).
  const seen = new Set();
  const items = [];
  for (const n of preview.nodes) {
    const id = String(n.id);
    if (seen.has(id)) continue;
    seen.add(id);
    items.push(n);
  }
  const parentOf = {};
  for (const n of items) {
    const id = String(n.id);
    const pid = n.parentId == null ? '' : String(n.parentId);
    if (pid && pid !== id && seen.has(pid)) parentOf[id] = pid;
  }
  for (const id of Object.keys(parentOf)) {
    const chain = new Set([id]);
    let prev = id;
    let cur = parentOf[id];
    while (cur) {
      if (chain.has(cur)) { delete parentOf[prev]; break; }
      chain.add(cur);
      prev = cur;
      cur = parentOf[cur];
    }
  }

  const nodes = items.map((n) => {
    const isRoot = !parentOf[String(n.id)];
    return {
      id: `node-${ts}-${n.id}`,
      type: isRoot ? 'apexNode' : 'goalNode',
      position: { x: 0, y: 0 },
      data: isRoot
        ? {
            nodeType: 'apex',
            goalType,
            apexText: n.title || goalText,
            title: (n.title || goalText).slice(0, 60),
            description: n.description || '',
            status: 'todo',
            color: '',
            collapsed: false,
          }
        : {
            nodeType: 'normal',
            title: n.title || newGoalLabel,
            description: n.description || '',
            status: 'todo',
            color: '',
            collapsed: false,
          },
    };
  });

  const edges = items
    .filter((n) => parentOf[String(n.id)])
    .map((n) => ({
      id: `edge-${ts}-${n.id}`,
      source: `node-${ts}-${parentOf[String(n.id)]}`,
      target: `node-${ts}-${n.id}`,
      type: 'deletable',
    }));

  const positions = layoutTree(nodes, edges, 'vertical');
  return {
    nodes: nodes.map((n) => ({ ...n, position: positions[n.id] || n.position })),
    edges,
  };
}
