// "Back" closes what is open instead of leaving the app (Richard 17 Nov 2026: in Brain training → sudoku the mouse
// back button jumped out of the app to the sign-in page).
//
// Zones, panels, viewers and dialogs are React state, not routes, so the browser's back (mouse button, Alt+←, the
// phone's back, the Windows app's app-command, Android's hardware back via nativeApp.js) used to walk the page
// history underneath them. Now every open layer owns ONE extra history entry (a "guard") on top of the current page,
// pushed when the layer opens. Back pops the top guard → the topmost layer closes and the router never hears about
// it. Closing a layer by its own button eats its guard again (history.go(-n)), so the next back is a normal one.
//
// Rules worth knowing:
// · a guard is pushed only when a layer OPENS — i.e. right after the person clicked something. Chrome and Electron
//   (the Windows app) mark a history entry as skippable when the page adds the next one without a fresh user
//   activation, and their back button / Alt+← / app-command then jump over it (verified with a probe in Electron 44:
//   a guard re-pushed from a popstate handler made the next back leave the page). So a closed layer's guard is never
//   re-pushed; a layer that refuses to close (locked relax, a dialog guarding unsaved changes) gets its guard back
//   with history.forward(), which adds no entry;
// · a guard copies the router's state (`idx`, `key`) plus its depth (1, 2, … above the page), so React Router sees
//   nothing (it would otherwise re-render the page as a navigation). Landing on depth d of the same page closes the
//   layers above d — even when the browser skipped some guards;
// · the router and the map editor rewrite the CURRENT entry (replace navigation, first save of a new map). When that
//   entry is a guard, the guard keeps its depth and the new address is remembered; every entry of the page we land
//   on later is brought up to date, so the router's idea of the page and the address bar stay the same;
// · navigating to another page while layers are open leaves their guards behind (the layers become "unguarded");
//   back or forward later landing on such a stale guard steps over it in the same direction.

const MARK = 'kbBackGuard';
const stack = []; // open layers, bottom first: { level, get: () => ({ onBack, block }) }
let base = 0; // how many layers at the bottom of the stack have no guard on this page (opened on another page)
let curDepth = 0; // depth of the current history entry (0 = the page itself, n = the n-th guard above it)
let pageIdx = null; // the router's index of the current page (guards share it)
let pageState = {}; // the page's router state without our mark (= what each entry of the page must hold)
let pageHref = '';
const closedByBack = new Set(); // layers we told to close because back popped their guard (no guard to eat)
let eatCount = 0; // guards to eat, collected in one microtask (several layers closing in one render)
let eatPending = false; // our own history.go(-n) is on its way
let eatN = 0; // … and how many guards it eats
let pushedWhileEating = null; // the app navigated before that go arrived (a dialog closed, then the page changed)
let swallow = null; // { key, steps, max }: our forward() steps undoing such a go (see onPop)
let restoring = false; // our forward() putting back the guard of a layer that refused to close
let stepping = false; // our own back()/forward() stepping over a stale guard
let leaving = false; // the app is navigating away (sign-out, expired session): never touch history again
let timer = 0;
let stepTimer = 0;
let installed = false;
let origPush;
let origReplace;

const stateOf = (s) => (s && typeof s === 'object' ? s : {});
const withoutMark = (s) => { const c = { ...stateOf(s) }; delete c[MARK]; return c; };
const idxOf = (s) => (s && typeof s === 'object' && typeof s.idx === 'number' ? s.idx : null);
// (`true` = a guard written by the first version of this module, still in the history of an open tab)
const depthOf = (s) => { const m = stateOf(s)[MARK]; return typeof m === 'number' ? m : (m ? 1 : 0); };
const keyOf = (s) => (s && typeof s === 'object' && s.key != null ? String(s.key) : JSON.stringify(stateOf(s)));
const guarded = () => stack.length - base; // how many guards the open layers own on this page
const entryState = (d) => (d ? { ...pageState, [MARK]: d } : { ...pageState });

function safe(fn) { try { fn(); } catch { /* Safari throttles history calls (SecurityError): back still works next time */ } }

function pushGuard() {
  safe(() => {
    origPush.call(window.history, entryState(curDepth + 1), '');
    curDepth += 1;
  });
}

// the entry we landed on takes over the page's (possibly rewritten) address and state
function refreshEntry() {
  safe(() => origReplace.call(window.history, entryState(curDepth), '', pageHref || undefined));
}

// our own step over a stale guard; a forward() with nothing ahead never arrives, so the flag cannot stay forever
function step(forward) {
  stepping = true;
  clearTimeout(stepTimer);
  stepTimer = setTimeout(() => { stepping = false; settle(); }, 600);
  if (forward) window.history.forward(); else window.history.back();
}

function settle() {
  // layers opened while our own history step was on its way get their guards now (one per layer)
  if (eatPending || swallow || restoring || stepping || leaving) return;
  while (curDepth < guarded()) pushGuard();
}

function eatGuards() {
  if (eatPending || swallow || restoring || stepping) { setTimeout(eatGuards, 200); return; } // after our own step
  eatCount = 0;
  const n = curDepth - guarded();
  if (n <= 0 || leaving) return;
  eatPending = true;
  eatN = n;
  pushedWhileEating = null;
  clearTimeout(timer);
  // a step that never arrives (blocked by the browser) must not freeze the module
  timer = setTimeout(() => { eatPending = false; pushedWhileEating = null; swallow = null; settle(); }, 1000);
  window.history.go(-n);
}

// the layer at the top refused to close (unsaved changes) or is locked: give it its guard back without a new entry
function restoreGuards(n) {
  restoring = true;
  clearTimeout(timer);
  timer = setTimeout(() => { if (restoring) { restoring = false; settle(); } }, 600); // no forward entry: push
  window.history.go(n);
}

function closeDown(target) {
  // close the layers above `target` from the top; a locked one (and everything under it) keeps its guard
  const asked = [];
  while (stack.length - asked.length > target) {
    const top = stack[stack.length - 1 - asked.length];
    const { onBack, block } = top.get();
    if (block || !onBack) break;
    closedByBack.add(top);
    asked.push(top);
    onBack();
  }
  const kept = stack.length - asked.length - target;
  if (kept > 0) restoreGuards(kept); // back does nothing on a locked layer
  if (!asked.length) return;
  // React closes on the next render; a layer still open then refused (it asks about unsaved changes first)
  setTimeout(() => {
    const refused = asked.filter((l) => stack.includes(l) && closedByBack.delete(l));
    if (refused.length && !eatPending && !swallow && !restoring && curDepth < guarded()) restoreGuards(guarded() - curDepth);
  }, 150);
}

function onPop(e) {
  if (!e.isTrusted) return; // a page's own PopStateEvent (desktopApp.js tells the router about its pushState)
  if (leaving) return;
  const st = e.state;
  const d = depthOf(st);
  const idx = idxOf(st);
  const samePage = idx === pageIdx;
  if (swallow) {
    // our forward() steps towards the page the app navigated to; the router already shows it
    e.stopImmediatePropagation();
    if (keyOf(st) !== swallow.key && ++swallow.steps < swallow.max) { window.history.forward(); return; }
    swallow = null;
    clearTimeout(timer);
    curDepth = d;
    settle(); // a layer opened on the new page meanwhile
    return;
  }
  if (eatPending) {
    // our own go(-n) after layers closed by their buttons: the page stays, nothing else closes
    eatPending = false;
    clearTimeout(timer);
    if (pushedWhileEating) {
      // the go took the app off its NEW page (Chrome aims a traversal when it is called: at the entry under the
      // guards, so the new page AND the guards are now ahead) → hide it from the router and step forward until the
      // new page; the guards stay behind as stale entries (stepped over later)
      swallow = { key: pushedWhileEating, steps: 0, max: eatN + 3 };
      pushedWhileEating = null;
      timer = setTimeout(() => { swallow = null; }, 1000);
      e.stopImmediatePropagation();
      window.history.forward();
      return;
    }
    if (samePage) {
      e.stopImmediatePropagation();
      curDepth = d;
      refreshEntry();
    }
    settle();
    return;
  }
  if (restoring) {
    restoring = false;
    clearTimeout(timer);
    if (samePage) e.stopImmediatePropagation();
    curDepth = d;
    settle();
    return;
  }
  if (!samePage) {
    // another page: the router's business. Its guards (if any) belong to layers that are gone or not ours now.
    const forward = pageIdx != null && idx != null && idx > pageIdx;
    pageIdx = idx;
    pageState = withoutMark(st);
    pageHref = window.location.href;
    curDepth = d;
    base = stack.length;
    stepping = false;
    if (d > 0) step(forward);
    return;
  }
  const prev = curDepth;
  if (!d && !prev) {
    // no guard on either side: a page's own history step (Signup's entry for the phone's back, no router there)
    pageState = withoutMark(st);
    pageHref = window.location.href;
    return;
  }
  // the same page and a guard involved: only we care
  e.stopImmediatePropagation();
  curDepth = d;
  refreshEntry();
  const wasStale = prev > guarded();
  if (stepping) {
    // our step over a stale guard landed; keep going while still on one
    clearTimeout(stepTimer);
    stepping = false;
    if (d > guarded()) step(d > prev);
    else settle();
    return;
  }
  if (d > prev) {
    // forward onto a guard whose layer is closed: step over it towards a later page (nothing if there is none)
    if (d > guarded()) step(true);
    return;
  }
  if (wasStale && d >= guarded()) {
    // back from a stale guard (a reload with a layer open, a dialog closed by navigation): the press would do
    // nothing visible → carry it on as a real back
    window.history.back();
    return;
  }
  closeDown(base + d);
}

export function installBackLayers() {
  if (installed || typeof window === 'undefined' || !window.history) return;
  installed = true;
  origPush = window.history.pushState;
  origReplace = window.history.replaceState;
  // Others' history writes: a push (router navigation) is a new page and leaves our guards behind; a replace of a
  // guard keeps its depth
  window.history.pushState = function pushState(state, title, url) {
    const r = origPush.call(this, state, title, url);
    if (eatPending) pushedWhileEating = keyOf(state);
    if (swallow) swallow.key = keyOf(state);
    pageIdx = idxOf(state);
    pageState = withoutMark(state);
    pageHref = window.location.href;
    curDepth = 0;
    base = stack.length;
    return r;
  };
  window.history.replaceState = function replaceState(state, title, url) {
    const r = curDepth && !eatPending && !swallow
      ? origReplace.call(this, { ...stateOf(state), [MARK]: curDepth }, title, url)
      : origReplace.call(this, state, title, url);
    // a redirect right after a navigation (`<Navigate replace>`) changes the key we are waiting for
    if (eatPending && pushedWhileEating) pushedWhileEating = keyOf(state);
    if (swallow) swallow.key = keyOf(state);
    pageIdx = idxOf(state);
    pageState = withoutMark(state);
    pageHref = window.location.href;
    return r;
  };
  const s = window.history.state;
  pageIdx = idxOf(s);
  pageState = withoutMark(s);
  pageHref = window.location.href;
  curDepth = depthOf(s); // a reload with a layer open: the entry is still a guard (stale until a layer opens)
  // registered before the router mounts (main.jsx), so stopImmediatePropagation keeps our pops away from it
  window.addEventListener('popstate', onPop);
}

// `level` orders layers that open in one render (React runs a child's effect before its parent's): the higher level
// is the one on top, closed first. Otherwise the layer opened last is on top.
export function openLayer(layer) {
  installBackLayers();
  let i = stack.length;
  while (i > base && (stack[i - 1].level || 0) > (layer.level || 0)) i -= 1;
  stack.splice(i, 0, layer);
  settle(); // (standing on a stale guard after a reload: it simply becomes this layer's guard)
}

export function closeLayer(layer) {
  const i = stack.indexOf(layer);
  if (i < 0) return;
  stack.splice(i, 1);
  if (closedByBack.delete(layer)) return; // its guard is already gone
  if (i < base) { base -= 1; return; } // opened on another page: no guard here
  // closed by its own button (not by back): eat its guard, so the next back is an ordinary one
  if (leaving) return;
  eatCount += 1;
  if (eatCount === 1) queueMicrotask(eatGuards); // several layers closing in one render → one step
}

// The app is leaving (sign-out, expired session → location.replace('/login')): layers unmounting now must not start
// a history step that could race the navigation.
export function leavingApp() {
  leaving = true;
}

// How many steps an in-app "← back to where I came from" button has to go (the map editor): guards are not pages.
export function routeBackSteps() {
  return curDepth + 1;
}
