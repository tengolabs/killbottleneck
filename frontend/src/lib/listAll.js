// Reads a whole listing page by page through entity.listPage() (code analysis 4, F5-06).
// list()/filter() return ONE page and say nothing about the rest, so a caller with a fixed
// limit silently lost everything beyond it. The sort should carry the `id` tiebreak (records
// changed in the same millisecond could otherwise jump between pages); duplicates are dropped.
//
// Pages are cut by offset, so a record created, deleted or changed WHILE the pages are being
// read shifts the rest: one record lands on a page already read and is never seen (with
// `-updated_date` a record edited mid-load jumps to the top). Such a pass is recognisable —
// the total changed between the first and the last page, or fewer records arrived than the
// total says — and is read again, at most MAX_PASSES times. If the listing never holds still,
// the result is everything seen in any pass (a record deleted meanwhile may linger; a missing
// one would be worse).
// opts: rawFilter / query / fields (passed to listPage), onPage(itemsSoFar) after every page.
const MAX_PASSES = 3;
export async function listAllPages(entity, sort, perPage, { onPage, ...opts } = {}) {
  const known = new Map(); // id → newest copy, across passes
  const withEarlier = (list, seen) => list.concat([...known.values()].filter((it) => !seen.has(it.id)));
  for (let pass = 1; ; pass++) {
    const seen = new Set();
    let list = [];
    let totalPages = 1;
    let firstTotal = null;
    let lastTotal = null;
    for (let page = 1; page <= totalPages; page++) {
      const res = await entity.listPage(sort, page, perPage, opts);
      totalPages = res.totalPages || 1;
      lastTotal = res.totalItems;
      if (firstTotal === null) firstTotal = lastTotal;
      const fresh = res.items.filter((it) => !seen.has(it.id) && seen.add(it.id));
      for (const it of fresh) known.set(it.id, it);
      list = list.concat(fresh);
      // a repeated pass must not shrink what the caller already shows
      onPage?.(pass === 1 ? list : withEarlier(list, seen));
    }
    const still = totalPages <= 1 || !(lastTotal >= 0) || (firstTotal === lastTotal && list.length === lastTotal);
    if (still) return list;
    if (pass >= MAX_PASSES) return withEarlier(list, seen);
  }
}
