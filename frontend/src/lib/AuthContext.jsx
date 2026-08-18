import React, { createContext, useState, useContext, useEffect } from 'react';
import i18next from 'i18next';
import { base44 } from '@/api/base44Client';
import { pb } from '@/api/pb';
import { LANGS, setLang } from '@/lib/lang';
import { syncSkin } from '@/lib/theme';

// Zachovává rozhraní původního Base44 AuthContextu (user, isAuthenticated,
// isLoadingAuth, authError, logout, navigateToLogin, ...), ale stojí nad
// lokálním PocketBase. appPublicSettings/isLoadingPublicSettings zůstávají
// kvůli kompatibilitě komponent, u lokální verze nemají co načítat.

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    checkUserAuth();
  }, []);

  const checkUserAuth = async () => {
    setIsLoadingAuth(true);
    setAuthError(null);
    // Kdo se právě přihlásil, musí dostat čerstvé údaje organizace — držená
    // odpověď mohla vzniknout ještě bez přihlášení, tedy prázdná.
    base44.org.forget();
    if (!pb.authStore.isValid) {
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
      setUser(null);
      setIsAuthenticated(false);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      if (error.status === 401 || error.status === 403) {
        setAuthError({ type: 'auth_required', message: 'Authentication required' });
      }
    }
  };

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
