// Jediný zdroj pravdy pro KANONICKÝ ukládaný tvar mapy (nodes/edges).
// Vytaženo z GoalMapEditor.cleanMapData, aby tvar šel držet v syncu se serverovou
// normalizací (pb_hooks/helpers.js:normalizeMapData) — paritu hlídá
// product/tests/cleanmap-parity.js (vzor layout-parity.js). Změna tady = změna tam!
// posOf: volitelný přepočet pozice uzlu (editor v mobilním vodorovném view ukládá
// kanonické svislé pozice místo zobrazených); default = pozice uzlu beze změny.
// Vykonavatel: dnes jen 'human' | 'automation'. Uzly uložené v mezistavu vývoje
// (nebo z API) můžou nést 'ai'/'cron' — obojí je automatizace.
// JS dvojče: helpers.js:normalizeExecutorKind — držet v synchronizaci!
export function normalizeExecutorKind(kind) {
  return (kind === 'automation' || kind === 'ai' || kind === 'cron') ? 'automation' : 'human';
}

export function cleanMapData(nodes, edges, posOf = (n) => n.position) {
  const cleanNodes = nodes.map((n) => {
    if (n.type === 'note') {
      return {
        id: n.id,
        type: 'note',
        position: n.position,
        width: n.width || n.data?.width || 220,
        height: n.height || n.data?.height || 180,
        data: {
          text: n.data?.text || '',
          color: n.data?.color || '',
          width: n.width || n.data?.width || 220,
          height: n.height || n.data?.height || 180,
        },
      };
    }
    return {
      id: n.id,
      type: n.type,
      position: posOf(n),
      data: {
        title: n.data.title,
        status: n.data.status,
        description: n.data.description,
        collapsed: n.data.collapsed || false,
        color: n.data.color || '',
        icon: n.data.icon || '',
        nodeType: n.data.nodeType || 'normal',
        goalType: n.data.goalType || '',
        apexText: n.data.apexText || '',
        deadline: n.data.deadline || '',
        owner: n.data.owner || '',
        // „Kdy to chci řešit" (YYYY-MM-DD) — NENÍ termín. Termín je dohoda
        // s někým jiným a mění se vědomě přes kalendář; tohle je jen můj plán,
        // a proto ho posun na zítra NEPŘEPISUJE (rozhodnutí Richarda 27. 7. 2026).
        // Starý `pinnedOn` se čte jako záloha (migrace 1785150000_planned_on.js).
        plannedOn: n.data.plannedOn || n.data.pinnedOn || '',
        // položka úvodní prohlídky (uvodni_mapa.js) — lite ji řadí pod vlastní zápisy
        // a dotazník účelu podle ní pozná nedotčenou mapu; jen `true`, jinak vypadne
        // (server canonicalNodeData dělá totéž; panel /checkup 25. 8. 2026: autosave
        // z editoru ho dřív smazal ze všech uzlů)
        tour: n.data.tour === true ? true : undefined,
        waitForChildren: !!n.data.waitForChildren,
        // KDO krok vykoná: člověk, nebo automatizace. Rozdíl mezi AI agentem
        // a cronem uživatele nezajímá (rozhodnutí Richarda 26.7.) — starší data
        // s 'ai'/'cron' se proto překlápí na 'automation'.
        // `owner` zůstává e-mail zodpovědného ČLOVĚKA (garanta) i u automatizace.
        executorKind: normalizeExecutorKind(n.data.executorKind),
        // JAKÁ automatizace tu běží — evidence stávajícího stavu, ne příkaz.
        // Odpovídá názvu v registru AI agentů, pokud je na něj napojená.
        executorName: n.data.executorName || '',
        // „tady by se hodila automatizace" — přání, které dostane správce AI agentů
        automationWanted: !!n.data.automationWanted,
        automationNote: n.data.automationNote || '',
        automationRequestedBy: n.data.automationRequestedBy || '',
        // zadavatel úkolu (kdo první nastavil termín) — razítkuje výhradně
        // server; tady jen nesmí vypadnout z kanonického tvaru při autosave
        assignedBy: n.data.assignedBy || '',
        // žádost o změnu termínu (razítko žadatele opět drží server)
        deadlineChangeWanted: n.data.deadlineChangeWanted || '',
        deadlineChangeNote: n.data.deadlineChangeNote || '',
        deadlineChangeRequestedBy: n.data.deadlineChangeRequestedBy || '',
        // ORGANIZAČNÍ STRUKTURA (mapa kind='org'): pozice/funkce + držitel
        // + zástupce pozice. Serverové dvojče: helpers.js:canonicalNodeData —
        // POŘADÍ KLÍČŮ je závazné (cleanmap-parity.js). Na běžných mapách prázdné.
        positionKind: n.data.positionKind === 'position' || n.data.positionKind === 'function' ? n.data.positionKind : '',
        holder: n.data.holder || '',
        deputy: n.data.deputy || '',
      },
    };
  });
  const cleanEdges = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
  }));
  return { cleanNodes, cleanEdges };
}
