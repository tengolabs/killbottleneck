// My day chips → filters of the Tasks page, written ONCE for both pages that render the panel
// (code analysis 4, F3-01). Home turns the result into an address, Tasks sets its filter state —
// before, each page had its own chain of conditions and Tasks lacked the `delegatedOverdue`
// branch, so the counter "With others, overdue" opened the list of MY tasks.
//
// Result: owner 'delegated' | null · assignee 'me' | null · deadline 'overdue' | 'today' | 'week' |
// null · status 'done' | null (null = the filter stays on "all").
const DEADLINES = ['overdue', 'today', 'week'];

export function chipFilters(kind) {
  if (kind === 'delegated') return { owner: 'delegated', assignee: null, deadline: null, status: null };
  if (kind === 'delegatedOverdue') return { owner: 'delegated', assignee: null, deadline: 'overdue', status: null };
  return {
    owner: null,
    assignee: 'me',
    deadline: DEADLINES.includes(kind) ? kind : null,
    // "done: N" in the panel → show the finished work
    status: kind === 'done' ? 'done' : null,
  };
}

// The same filters as the address of the Tasks page (deep link from Home).
export function chipTasksUrl(kind) {
  const f = chipFilters(kind);
  const q = [];
  if (f.owner) q.push(`owner=${f.owner}`);
  if (f.assignee) q.push(`assignee=${f.assignee}`);
  if (f.deadline) q.push(`deadline=${f.deadline}`);
  if (f.status) q.push(`status=${f.status}`);
  return `/tasks?${q.join('&')}`;
}
