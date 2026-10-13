import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { useKbConfig } from '@/hooks/useKbConfig';
import { useAuth } from '@/lib/AuthContext';
import { ucelCeka } from './PurposeGate';

// Brána dialogu „Připoj svého AI agenta": stejný lehký vzor jako PurposeGate —
// jeden sdílený fetch /api/kb/config, dialog (Radix, ikony, texty) se stáhne až
// ve chvíli, kdy se má ukázat → balíček /lite nic nenese (lite-bundle.js, 500 kB).
const AgentSetupDialog = lazy(() => import('./AgentSetupDialog'));

// Zjednodušené zobrazení / telefon: tam se do Claude Code nic nevkládá — dialog
// jen v plné aplikaci (Richard 10. 10. 2026); přihlašovací a consent stránky
// taky ne (consent agenta nesmí překrýt dialog o agentovi).
const MIMO = ['/lite', '/light', '/oauth/authorize', '/login', '/register', '/forgot-password', '/reset-password'];

export default function AgentSetupGate() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const { config } = useKbConfig(!!user);
  if (!user || user.agent_setup_seen || !config) return null;
  if (config.agent_setup_ask === false) return null;
  if (MIMO.some((p) => pathname === p || pathname.startsWith(p + '/'))) return null;
  // nejdřív dotazník účelu (PurposeGate, první admin) — po uložení účelu config
  // invaliduje a tahle brána naskočí sama; nikdy dva dialogy přes sebe
  if (ucelCeka(user, config)) return null;
  return (
    <Suspense fallback={null}>
      <AgentSetupDialog />
    </Suspense>
  );
}
