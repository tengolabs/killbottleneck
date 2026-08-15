import i18next from 'i18next';
import { base44 } from '@/api/base44Client';
import { pb } from '@/api/pb';
import { templateToMap, templateForLang, seedsToTasks } from '@/lib/templateConvert';
import { remapRuleIds } from '@/lib/ruleRemap';
import { rulesApi } from '@/components/rules/rulesApi';

// Jediné místo, kde vzniká projekt (= mapa s vrcholovým uzlem).
// Volá ho Home i stránka Úkoly — obě cesty vedou k identické struktuře.

export function buildApexNode(title, ts, icon = '') {
  return {
    id: `node-${ts}`,
    type: 'apexNode',
    position: { x: 250, y: 100 },
    data: {
      nodeType: 'apex',
      goalType: '', // typy mise/vize/strategie/cíl zrušeny
      apexText: title,
      title: title.slice(0, 60),
      description: '',
      status: 'todo',
      color: '',
      icon,
      collapsed: false,
      deadline: '',
      owner: '',
    },
  };
}

export async function createEmptyProject(title, { emoji = '', color = '', client = '' } = {}) {
  // JEDEN zdroj ikony: emoji jde do vrcholového (apex) uzlu; název projektu je čistý.
  const apex = buildApexNode(title, Date.now(), emoji);
  return base44.entities.GoalMap.create({ title, description: '', nodes: [apex], edges: [], color, client_id: client });
}

// Šablona → projekt (konverze přes lib/templateConvert — jediný zdroj pravdy).
// U procesní šablony: startDate řídí dopočet termínů z ofsetů a projekt se
// automaticky nasdílí (edit) všem přiřazeným osobám — server pak pošle
// každému notifikaci node_assigned (goalmaps create hook).
export async function createProjectFromTemplate(tpl, titleOverride, startDate, { emoji = '', color = '', client = '' } = {}) {
  const title = (titleOverride || '').trim() || tpl.title || i18next.t('home:newMap.newProject');
  const { nodes, edges, idMap } = templateToMap(tpl, { startDate });
  // emoji → ikona vrcholového uzlu (jeden zdroj), ne do názvu
  if (emoji) {
    const apex = nodes.find((n) => n.type === 'apexNode' || n.data?.nodeType === 'apex') || nodes[0];
    if (apex) apex.data = { ...apex.data, icon: emoji };
  }
  const me = pb.authStore.record?.email;
  const seeds = Array.isArray(tpl.task_seeds) ? tpl.task_seeds : [];
  const owners = [...new Set(
    nodes.map((n) => n.data?.owner)
      .concat(seeds.map((s) => s.assignee_email)) // i lidi z úkolů šablony
      .filter((o) => o && o !== me)
  )];
  const map = await base44.entities.GoalMap.create({
    title,
    description: '',
    nodes,
    edges,
    color,
    client_id: client,
    shared_with: owners,
    shared_with_edit: owners,
    // číslovaná série: posílá se jen id šablony — pořadové číslo a finální
    // název složí server (goalmaps create hook), vrácený záznam už je má
    ...(tpl.number_format && tpl.id ? { series: tpl.id } : {}),
  });
  await createTasksFromSeeds(seeds, idMap, startDate, map.id);
  // vestavěná pravidla šablony (kanban varianty) — název dle jazyka UI,
  // odkazy na uzly se přemapují přes idMap a založí normální cestou /rules/save
  await createRulesFromTemplate(templateForLang(tpl).rules, idMap, map.id);
  return map;
}

// Pravidla ze šablony s vestavěnými pravidly: sekvenčně přes /rules/save
// (server validuje a hlídá strop 50/mapa; autor = přihlášený). Selhání
// jednoho pravidla (ani všech) NESMÍ shodit založení projektu — mapa už
// existuje; vzor createTasksFromSeeds.
export async function createRulesFromTemplate(rules, idMap, mapId) {
  const list = Array.isArray(rules) ? rules : [];
  let count = 0;
  for (const r of list) {
    try {
      await rulesApi.save({ map: mapId, ...remapRuleIds(r, idMap) });
      count++;
    } catch (e) {
      console.error('template rule failed', e);
    }
  }
  return count;
}

// Úkoly ze šablony „včetně úkolů": sekvenčně (podúkoly potřebují id rodiče).
// Selhání jednoho úkolu nesmí shodit založení projektu — mapa už existuje.
export async function createTasksFromSeeds(seeds, idMap, startDate, mapId) {
  const payloads = seedsToTasks(seeds, idMap, startDate);
  if (payloads.length === 0) return 0;
  const created = {};
  let count = 0;
  for (const p of payloads) {
    try {
      if (p.parentSeedId && !created[p.parentSeedId]) continue;
      const task = await base44.entities.Task.create({
        ...p.data,
        map_id: mapId,
        ...(p.parentSeedId ? { parent_id: created[p.parentSeedId] } : {}),
      });
      created[p.seedId] = task.id;
      count++;
    } catch (e) {
      console.error('task seed failed', e);
    }
  }
  return count;
}
