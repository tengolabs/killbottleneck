import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import i18next from 'i18next';
import { base44 } from '@/api/base44Client';
import { pb, AUTH_CHECK_EVENT } from '@/api/pb';
import { forgetKbConfig } from '@/hooks/useKbConfig';
import { LANGS, setLang } from '@/lib/lang';
import { syncSkin } from '@/lib/theme';
import { leavingApp } from '@/lib/backLayers';

// Zachovává rozhraní původního Base44 AuthContextu (user, isAuthenticated,
// isLoadingAuth, authError, logout, navigateToLogin, ...), ale stojí nad
// lokálním PocketBase. appPublicSettings/isLoadingPublicSettings zůstávají
// kvůli kompatibilitě komponent, u lokální verze nemají co načítat.

const AuthContext = createContext();

// Left for the sign-in page: it says WHY the person is looking at it again.
export const SESSION_ENDED_KEY = 'kb-session-ended';
const AUTH_PAGES = ['/login', '/register', '/forgot-password', '/reset-password'];
// how old a successful verification may be before coming back to the tab asks again
const REVERIFY_AFTER_MS = 10 * 60 * 1000;
const refused = (error) => error?.status === 401 || error?.status === 403;
// an unconfirmed sign-in is re-checked on its own: 15 s, then doubling up to 5 min
const RETRY_FIRST_MS = 15 * 1000;
const RETRY_MAX_MS = 5 * 60 * 1000;
// The person is leaving on purpose (changed their own password → sign-out follows): a
// request refused in between must not send them to the sign-in page with "your sign-in
// stopped being valid".
let leavingOnPurpose = false;
export const markLeavingOnPurpose = (on = true) => { leavingOnPurpose = on; };

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  // signed in from what the browser remembers, the server has not confirmed it yet (F5-02)
  const unverified = useRef(false);
  const verifiedAt = useRef(0);
  const verifying = useRef(null);
  const signedIn = useRef(false);
  const retry = useRef({ timer: null, delay: RETRY_FIRST_MS });
  signedIn.current = isAuthenticated;

  useEffect(() => {
    checkUserAuth();
  }, []);

  const checkUserAuth = async () => {
    setIsLoadingAuth(true);
    setAuthError(null);
    // Kdo se právě přihlásil, musí dostat čerstvé údaje organizace — držená
    // odpověď mohla vzniknout ještě bez přihlášení, tedy prázdná. Totéž config.
    base44.org.forget();
    forgetKbConfig();
    if (!pb.authStore.isValid) {
      pb.authStore.clear(); // an expired token is of no use and would keep raising kb:auth-check
      setUser(null);
      setIsAuthenticated(false);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      syncSkin(null).catch(() => {});   // instanční skin obarví i login obrazovku
      return;
    }
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      unverified.current = false;
      verifiedAt.current = Date.now();

      // Jazyk uloženy u účtu je po přihlášení zdroj pravdy (přenáší volbu mezi
      // zařízeními); účet bez volby převezme aktuální jazyk z tohoto zařízení.
      try {
        if (LANGS.includes(currentUser.language)) {
          if (currentUser.language !== i18next.language) setLang(currentUser.language);
        } else {
          base44.entities.User.update(currentUser.id, { language: i18next.language }).catch(() => {});
        }
      } catch (e) { /* jazyk nesmí shodit přihlášení */ }

      // Skin: volba účtu > instanční default (stejná dělba jako jazyk; cache
      // v localStorage už drží poslední stav, tohle jen tiše srovná rozdíl).
      syncSkin(currentUser).catch(() => {});

      // Záznam přihlášení (fire and forget)
      try {
        await base44.entities.LoginLog.create({});
      } catch (e) { /* ignore */ }
    } catch (error) {
      console.error('User auth check failed:', error);
      // Signed out ONLY when the server refused the sign-in. No network, a 5xx during a
      // deploy or a 429 say nothing about the account: the person stays signed in with what
      // the browser remembers (the lite view then reads the last "My day" kept by the service
      // worker) and the check repeats when the network is back (finding F5-02).
      const remembered = refused(error) ? null : base44.auth.rememberedUser();
      if (remembered) {
        unverified.current = true;
        setUser(remembered);
        setIsAuthenticated(true);
        scheduleRetry();
      } else {
        setUser(null);
        setIsAuthenticated(false);
        if (refused(error)) setAuthError({ type: 'auth_required', message: 'Authentication required' });
      }
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  };

  // The sign-in ended under an open tab → the sign-in page, in a clean state (nothing of
  // the previous session stays in memory), with the address to come back to.
  const endSession = () => {
    base44.org.forget();
    forgetKbConfig();
    base44.auth.logout(); // clears the token and the offline data; no redirect of its own
    setUser(null);
    setIsAuthenticated(false);
    setAuthError({ type: 'auth_required', message: 'Authentication required' });
    if (leavingOnPurpose) return; // their own sign-out is on its way
    const { pathname, search } = window.location;
    if (AUTH_PAGES.some((p) => pathname.startsWith(p))) return;
    try { sessionStorage.setItem(SESSION_ENDED_KEY, '1'); } catch { /* the note is a courtesy */ }
    leavingApp();
    window.location.replace(`/login?next=${encodeURIComponent(pathname + search)}`); // the dead page must not wait behind the form
  };

  // Quiet re-check of a running session: no spinner, no login record. One at a time.
  // A sign-in the server has not confirmed (start during an outage) gets no `online` or
  // tab event when the outage was the server's — so it asks again by itself.
  const scheduleRetry = () => {
    const r = retry.current;
    if (r.timer) return;
    r.timer = setTimeout(() => {
      r.timer = null;
      r.delay = Math.min(r.delay * 2, RETRY_MAX_MS);
      // signedIn is read at fire time; the first render after the remembered sign-in has set it
      if (unverified.current) (verifySession() || Promise.resolve()).then(() => { if (unverified.current && signedIn.current) scheduleRetry(); });
    }, r.delay);
  };
  useEffect(() => () => { clearTimeout(retry.current.timer); }, []);

  const verifySession = () => {
    if (!signedIn.current) return null;
    if (!verifying.current) {
      verifying.current = base44.auth.me()
        .then((fresh) => {
          unverified.current = false;
          verifiedAt.current = Date.now();
          retry.current.delay = RETRY_FIRST_MS;
          // the same object when nothing changed: effects keyed on `user` (open forms in
          // the account dialog, notification settings) must not reset on every re-check
          setUser((prev) => {
            if (!prev) return prev;
            const next = { ...prev, ...fresh };
            return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
          });
        })
        .catch((error) => { if (refused(error)) endSession(); /* otherwise: still unknown, stay */ })
        .finally(() => { verifying.current = null; });
    }
    return verifying.current;
  };

  useEffect(() => {
    // a request was refused as "not signed in" (api/pb.js) → ask the server right away
    const onRefused = () => { verifySession(); };
    // back online / back in the tab → confirm a sign-in the server has not confirmed yet,
    // or one confirmed long ago (a tab left open past the token's validity)
    const onReturn = () => {
      if (document.visibilityState === 'hidden') return;
      if (unverified.current || Date.now() - verifiedAt.current > REVERIFY_AFTER_MS) verifySession();
    };
    window.addEventListener(AUTH_CHECK_EVENT, onRefused);
    window.addEventListener('online', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener(AUTH_CHECK_EVENT, onRefused);
      window.removeEventListener('online', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  // the handlers read refs only
  }, []);

  // Lokální merge do přihlášeného uživatele po úspěšném uložení na server.
  // Záměrně NE checkUserAuth() — ta dělá authRefresh a zapisuje LoginLog, takže
  // by každé přepnutí předvolby vyrobilo falešný záznam přihlášení.
  const patchUser = (fields) => {
    setUser((prev) => (prev ? { ...prev, ...fields } : prev));
  };

  const logout = (shouldRedirect = true) => {
    // Údaje organizace se drží v paměti klienta (base44.org.get). Bez zapomenutí
    // by po odhlášení viděl název a logo firmy i další člověk u téhož počítače.
    base44.org.forget();
    forgetKbConfig();
    setUser(null);
    setIsAuthenticated(false);
    if (shouldRedirect) {
      base44.auth.logout(window.location.href);
    } else {
      base44.auth.logout();
    }
  };

  const navigateToLogin = () => {
    base44.auth.redirectToLogin();
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authError,
      appPublicSettings: null,
      authChecked,
      logout,
      patchUser,
      navigateToLogin,
      checkUserAuth,
      checkAppState: checkUserAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
