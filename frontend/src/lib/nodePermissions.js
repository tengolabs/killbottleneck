// Čistá práva k uzlu — vytaženo z pages/GoalMapEditor.jsx (nález F1-07 analýzy
// kódu): `canRemoveNodeShared` a `smiMenitTermin` tam měly IDENTICKÉ tělo, tady
// je jednou. `useCallback` obálky v editoru zůstávají a jen volají sem.
// Čistý `isApexNode(node)` už žije v lib/mapNodes.js (editor ho importuje jako
// isApexNodeShared) — druhou kopii tu záměrně neděláme.

// Uzel se zadaným úkolem (termínem) odstraní / termín mu změní jen zadavatel
// (assignedBy, u starších uzlů fallback vlastník mapy) nebo vlastník — „smazat
// cizí zadání = odstranit důkaz" (Richard 7. 8.). Server to vynucuje na PATCH;
// tady jen nenecháme uživatele doklikat do chyby.
// ctx: { isMapOwner, ownerEmail (effectiveMapAccess.ownerEmail), userEmail }
export function jeZadavatelNeboVlastnik(n, { isMapOwner, ownerEmail, userEmail }) {
  if (!n?.data?.deadline) return true;          // první nastavení je volné
  if (isMapOwner) return true;
  const zadavatel = n.data.assignedBy || ownerEmail || '';
  return !!userEmail && userEmail === zadavatel;
}

// Uzly, kde mám SVOU práci: jsem garant uzlu, nebo na něm mám úkol jako
// řešitel. Stejný předpis jako serverová kontrola v /node-status — podle něj
// dostane ČTENÁŘ mapy tlačítka u svého kroku (a jen u něj).
export function mojePracovniUzlyZ(nodes, mapTasks, email) {
  if (!email) return new Set();
  const set = new Set(nodes.filter((n) => n.data?.owner === email).map((n) => n.id));
  for (const tk of mapTasks || []) {
    if (tk.node_id && tk.assignee_email === email) set.add(tk.node_id);
  }
  return set;
}
