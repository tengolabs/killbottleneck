import { lazy, Suspense, useEffect, useState } from 'react';
import { bindAppDialogs, answerAppDialog } from '@/lib/appDialogs';

// Root host of the app's confirmations and notices (lib/appDialogs.js). It only listens; the
// dialog itself (with the dialog library) is a lazy chunk fetched with the first question, so the
// main bundle — which the light mode carries too — does not grow (tests/lite-bundle.js).
// If the chunk cannot be fetched (offline, a new deploy), the question still gets asked: by the
// browser's own window, never answered silently.
function NativeFallback({ queue }) {
  const item = queue[0] || null;
  useEffect(() => {
    if (!item) return;
    answerAppDialog(item, item.kind === 'notice' ? (window.alert(item.message), true) : window.confirm(item.message));
  }, [item]);
  return null;
}
const Dialogs = lazy(() => import('./AppDialogs').catch(() => ({ default: NativeFallback })));

export default function AppDialogsHost() {
  const [queue, setQueue] = useState([]);
  const [used, setUsed] = useState(false);
  useEffect(() => bindAppDialogs((q) => { setQueue(q); if (q.length) setUsed(true); }), []);
  if (!used) return null;
  return <Suspense fallback={null}><Dialogs queue={queue} /></Suspense>;
}
