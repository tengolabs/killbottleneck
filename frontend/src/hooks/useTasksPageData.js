import { useState, useEffect, useMemo, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { isExternalOwner, useMembersWithContacts } from '@/lib/externalContacts';

// Načítání dat stránky Úkoly: mapy (dvoufázově), organizace, členové,
// počty komentářů a e-maily pro našeptávače. Vytaženo z pages/Tasks.jsx
// (analýza kódu 27. 8. 2026, F3-10) BEZE ZMĚNY chování — `dialogOpen` je stav
// dialogu stránky (badge komentářů se přenačítá po jeho zavření), proto
// přichází jako vstup.
export function useTasksPageData({ user, items, dialogOpen }) {
  const [maps, setMaps] = useState([]);
  // členové + externí kontakty (external:true) — viz useMembersWithContacts
  const [members, reloadMembers] = useMembersWithContacts(user);
  const [org, setOrg] = useState(null);

  // Načtení map je i mimo první render: řádková akce v „Můj den" může sáhnout
  // na uzel mapy, a pak je potřeba znovu natáhnout stromy, ne jen úkoly.
  const loadMaps = useCallback(async () => {
    try {
      // org struktura (kind='org') do tabulky úkolů NEPATŘÍ — popisuje kdo je
      // kdo, ne práci; server na ní úkoly stejně odmítá (nález Richardova
      // klik-testu 15. 8.: organizace se tu ukazovala jako projekt)
      const bezOrg = (list) => list.filter((m) => m.kind !== 'org');
      // fáze 1: metadata bez JSON blobů — okamžitý render hlaviček/filtrů
      const meta = await base44.entities.GoalMap.list('-updated_date', 200, {
        fields: 'id,title,owner,owner_email,shared_with,shared_with_edit,shared_with_work,is_public,team_access,color,archived,kind,created,updated',
      });
      setMaps((prev) => (prev.length ? prev : bezOrg(meta)));
      // fáze 2: plné mapy (stromy uzlů) na pozadí
      setMaps(bezOrg(await base44.entities.GoalMap.list('-updated_date', 200)));
    } catch {
      // mapy jen obohacují zobrazení
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    loadMaps();
    base44.org.get().then(setOrg).catch(() => {});
  }, [user, loadMaps]);

  // počty komentářů úkolů pro badge v tabulce/kanbanu; přenačítá se po zavření dialogu
  const [commentCounts, setCommentCounts] = useState({});
  useEffect(() => {
    if (!user || dialogOpen) return;
    base44.entities.TaskComment.list('-created_date', 1000)
      .then((list) => {
        const counts = {};
        for (const c of list || []) counts[c.task_id] = (counts[c.task_id] || 0) + 1;
        setCommentCounts(counts);
      })
      .catch(() => {});
  }, [user, dialogOpen]);

  // e-maily pro našeptávač/filtr: členové týmu + sdílení map + assignees úkolů
  // (BEZ pseudo-e-mailů externích kontaktů — do e-mailových našeptávačů nepatří)
  const emailOptions = useMemo(() => {
    const set = new Set();
    if (user?.email) set.add(user.email);
    for (const m of members) if (!m.external) set.add(m.email);
    for (const m of maps) {
      if (m.created_by) set.add(m.created_by);
      for (const em of m.shared_with || []) set.add(em);
    }
    for (const task of items) if (task.assignee_email && !isExternalOwner(task.assignee_email)) set.add(task.assignee_email);
    return [...set].sort();
  }, [maps, items, user, members]);

  return { maps, setMaps, loadMaps, org, members, reloadMembers, commentCounts, emailOptions };
}
