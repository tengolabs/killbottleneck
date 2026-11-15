// One-time token from a share invitation link (/register?email=…&invite=<token>).
// A project shared with an address that had no account is granted only to whoever proves
// they received the invitation — i.e. presents this token once signed in (server:
// POST /api/kb/share-invite/claim). The token waits in sessionStorage so it survives the
// hop between the sign-up and sign-in pages (and the Google redirect) in the same tab.
import { kbSend } from '@/api/kbSend';

const KEY = 'kb_share_invite';

export const rememberShareInvite = (token) => {
  if (!token) return;
  try { sessionStorage.setItem(KEY, String(token)); } catch { /* private mode — the link can be opened again */ }
};

export const pendingShareInvite = () => {
  try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; }
};

// Resolves to { claimed } (0 when there is nothing to claim); rejects when the server
// refuses the token (expired, used, another address). The token is dropped either way —
// a refused one would be refused again.
export const claimShareInvite = async () => {
  const token = pendingShareInvite();
  if (!token) return { claimed: 0 };
  try { sessionStorage.removeItem(KEY); } catch { /* nothing to drop */ }
  return kbSend('/api/kb/share-invite/claim', { body: { token } });
};

// Takes `invite=` out of the address bar once the token is remembered, so it does not
// stay in the browser history (the rest of the query — e-mail, next — is kept).
export const stripInviteFromAddress = () => {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('invite')) return;
    url.searchParams.delete('invite');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  } catch { /* an odd environment — the token then simply stays in the address */ }
};
