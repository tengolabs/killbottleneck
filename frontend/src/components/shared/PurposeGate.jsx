import { lazy, Suspense } from 'react';
import { useKbConfig } from '@/hooks/useKbConfig';
import { useAuth } from '@/lib/AuthContext';

// Brána dotazníku účelu: jediný lehký fetch /api/kb/config; samotný dialog
// (Radix Dialog, ikony) se stáhne až ve chvíli, kdy se má ukázat — prvnímu
// adminovi bez zvoleného účelu. Díky tomu nezatěžuje balíček /lite
// (product/tests/lite-bundle.js: strop 500 kB).
const PurposeDialog = lazy(() => import('./PurposeDialog'));

// Jediná pravda o tom, kdy se ptáme na účel — sdílí ji AgentSetupGate (nikdy dva
// dialogy přes sebe): první admin, instance bez účelu, dotaz nevypnutý.
export function ucelCeka(user, config) {
  return !!user && user.role === 'admin' && !!config
    && config.purpose_ask !== false && !config.purpose && config.user_count === 1;
}

export default function PurposeGate() {
  const { user } = useAuth();
  const jeAdmin = !!user && user.role === 'admin';
  const { config } = useKbConfig(jeAdmin);
  // po uložení účelu PurposeDialog config invaliduje → brána se schová sama
  const show = ucelCeka(user, config);
  if (!show) return null;
  return (
    <Suspense fallback={null}>
      <PurposeDialog />
    </Suspense>
  );
}
