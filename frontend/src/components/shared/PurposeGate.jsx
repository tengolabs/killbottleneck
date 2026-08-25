import { useState, useEffect, lazy, Suspense } from 'react';
import { pb } from '@/api/pb';
import { useAuth } from '@/lib/AuthContext';

// Brána dotazníku účelu: jediný lehký fetch /api/kb/config; samotný dialog
// (Radix Dialog, ikony) se stáhne až ve chvíli, kdy se má ukázat — prvnímu
// adminovi bez zvoleného účelu. Díky tomu nezatěžuje balíček /lite
// (product/tests/lite-bundle.js: strop 500 kB).
const PurposeDialog = lazy(() => import('./PurposeDialog'));

export default function PurposeGate() {
  const { user } = useAuth();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!user || user.role !== 'admin') { setShow(false); return undefined; }
    let zivy = true;
    pb.send('/api/kb/config', { method: 'GET' })
      .then((c) => { if (zivy) setShow(c.purpose_ask !== false && !c.purpose && c.user_count === 1); })
      .catch(() => {});
    return () => { zivy = false; };
  }, [user]);
  if (!show) return null;
  return (
    <Suspense fallback={null}>
      <PurposeDialog />
    </Suspense>
  );
}
