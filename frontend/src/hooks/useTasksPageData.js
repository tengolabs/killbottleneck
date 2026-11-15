import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { isExternalOwner, useMembersWithContacts } from '@/lib/externalContacts';
import { listAllPages } from '@/lib/listAll';

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
  // the load of the maps failed — the page must say so instead of "no tasks yet" (F3-05)
  const [mapsError, setMapsError] = useState(false);
  const userId = user?.id || '';

  // Načtení map je i mimo první render: řádková akce v „Můj den" může sáhnout
  // na uzel mapy, a pak je potřeba znovu natáhnout stromy, ne jen úkoly.
  const loadGen = useRef(0); // only the load started last may write
  const loadMaps = useCallback(async () => {
    const gen = ++loadGen.current;
    try {
      // org struktura (kind='org') do tabulky úkolů NEPATŘÍ — popisuje kdo je
      // kdo, ne práci; server na ní úkoly stejně odmítá (nález Richardova
      // klik-testu 15. 8.: organizace se tu ukazovala jako projekt)
      const bezOrg = (list) => list.filter((m) => m.kind !== 'org');
      // fáze 1: metadata bez JSON blobů — okamžitý render hlaviček/filtrů
      // Both phases read ALL pages (code analysis 4, F5-06) — the former single page of 200
      // silently dropped the least recently changed projects of a larger organisation.
      const meta = await listAllPages(base44.entities.GoalMap, '-updated_date,id', 200, {
        fields: 'id,title,owner,owner_email,shared_with,shared_with_edit,shared_with_work,is_public,team_access,color,archived,kind,created,updated',
      });
      if (gen !== loadGen.current) return;
      setMaps((prev) => (prev.length ? prev : bezOrg(meta)));
      // fáze 2: plné mapy (stromy uzlů) na pozadí
      const full = bezOrg(await listAllPages(base44.entities.GoalMap, '-updated_date,id', 200));
      if (gen !== loadGen.current) return;
      setMaps(full);
      setMapsError(false);
    } catch {
      // what is already shown stays; the page shows the failure with "Try again"
      if (gen === loadGen.current) setMapsError(true);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    loadMaps();
    base44.org.get().then(setOrg).catch(() => {});
    // the ID, not the identity of the `user` object (patchUser makes a new one — F3-04)
  }, [userId, loadMaps]);

  // počty komentářů úkolů pro badge v tabulce/kanbanu; přenačítá se po zavření dialogu
  const [commentCounts, setCommentCounts] = useState({});
  useEffect(() => {
    if (!userId || dialogOpen) return;
    base44.entities.TaskComment.list('-created_date', 1000)
      .then((list) => {
        const counts = {};
        for (const c of list || []) counts[c.task_id] = (counts[c.task_id] || 0) + 1;
        setCommentCounts(counts);
      })
      .catch(() => {});
  }, [userId, dialogOpen]);

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

  return { maps, setMaps, loadMaps, mapsError, org, members, reloadMembers, commentCounts, emailOptions };
}
