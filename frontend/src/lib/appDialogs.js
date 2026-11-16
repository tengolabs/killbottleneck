// Confirmations and notices as dialogs of the app instead of the browser's own windows
// (window.confirm / window.alert): the same look everywhere — web, phone, desktop app.
// Richard's decision 15 Nov 2026.
//
//   if (!(await askConfirm(text))) return;          // neutral question, button "Confirm"
//   if (!(await askDelete(text))) return;           // destructive, red button "Delete"
//   showNotice(text);                               // one button "Got it"; await it if needed
//
// The dialog itself is components/shared/AppDialogs.jsx, mounted once next to the toaster.
// Requests are queued: a second question waits until the first one is answered.
let host = null;
const queue = [];

const push = (item) => {
  // a fast double click asks the same thing twice: one dialog, both callers get its answer
  const same = queue.find((q) => q.kind === item.kind && q.message === item.message);
  if (same) return same.promise;
  let entry;
  const promise = new Promise((resolve) => { entry = { ...item, resolve }; });
  entry.promise = promise;
  enqueue(entry);
  return promise;
};

const enqueue = (entry) => {
  const { resolve } = entry;
  queue.push(entry);
  if (host) host([...queue]);
  else {
    // no host on the page (must not happen in the app) → the browser's window, never a silent yes
    const q = queue.pop();
    if (q.kind === 'notice') { window.alert(q.message); resolve(undefined); } else resolve(window.confirm(q.message));
  }
};

// opts: { title, confirmLabel, cancelLabel, danger }
export const askConfirm = (message, opts = {}) => push({ kind: 'confirm', message: String(message ?? ''), ...opts });
export const askDelete = (message, opts = {}) => askConfirm(message, { danger: true, ...opts });
// opts: { title, okLabel }
export const showNotice = (message, opts = {}) => push({ kind: 'notice', message: String(message ?? ''), ...opts });

// for AppDialogs.jsx only
export function bindAppDialogs(fn) {
  host = fn;
  if (fn && queue.length) fn([...queue]);
  return () => { if (host === fn) host = null; };
}
export function answerAppDialog(item, value) {
  const i = queue.indexOf(item);
  if (i < 0) return;
  queue.splice(i, 1);
  item.resolve(item.kind === 'notice' ? undefined : !!value);
  if (host) host([...queue]);
}
