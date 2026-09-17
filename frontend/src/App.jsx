import { Suspense, lazy } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import PurposeGate from '@/components/shared/PurposeGate';
import { TimerProvider } from '@/lib/TimerContext';
import { useTranslation } from 'react-i18next';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import DocumentTitle from '@/components/shared/DocumentTitle';
import ProtectedRoute from '@/components/ProtectedRoute';
import { shouldUseLite } from '@/lib/liteMode';
// Přihlašovací stránky zůstávají v hlavním balíku — jsou to první obrazovky,
// které nový člověk uvidí, a lazy chunk by tam přidal jen prodlevu navíc.
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import NativeOnboarding from './components/NativeOnboarding';
import { isNativeShell } from '@/lib/nativeShell';
import { getServerUrl } from '@/lib/serverUrl';
import { AsistentProvider, useAsistent } from '@/lib/AsistentContext';
import { useLocation } from 'react-router-dom';

// Stránky se načítají AŽ KDYŽ jsou potřeba. Bez toho by si telefon
// v zjednodušeném (lite) režimu stáhl i mapový editor s ReactFlow a všechny
// dialogy plné verze — a právě objem prvního načtení je změřená bolest
// (11,5 s na 4G ze studené cache, viz product/tests/scale-limits.js).
const Home = lazy(() => import('./pages/Home'));
const OAuthAuthorize = lazy(() => import('./pages/OAuthAuthorize'));
const GoalMapEditor = lazy(() => import('./pages/GoalMapEditor'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Archive = lazy(() => import('./pages/Archive'));
const UserAdmin = lazy(() => import('./pages/UserAdmin'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Organizace = lazy(() => import('./pages/Organizace'));
const LiteApp = lazy(() => import('./lite/LiteApp'));
// AI chat na boku — líně: do hlavního balíku nepatří a v lite není vůbec
const AsistentPanel = lazy(() => import('./components/asistent/AsistentPanel'));

const Spinner = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 dark:border-slate-700 dark:border-t-slate-200 rounded-full animate-spin"></div>
  </div>
);

// Titulní strana: přihlášenému na úzkém displeji (nebo tomu, kdo si lite zvolil)
// naskočí zjednodušené zobrazení. NEPŘIHLÁŠENÝ vidí vždycky plnou titulku —
// je to zároveň veřejná landing page. Přepnutí zpět je v lite režimu dole
// a volba se pamatuje, takže tohle nikoho neuvězní.
const HomeOrLite = () => {
  const { user } = useAuth();
  if (user && shouldUseLite()) return <Navigate to="/lite" replace />;
  return <Home />;
};

// AI chat na boku (13. 9. 2026): trvalý panel vpravo přes všechny stránky plné
// aplikace; v lite a na přihlašovacích stránkách není. Obsah stránek se
// odsune o šířku otevřeného panelu (na telefonu panel překryje celou šířku).
// Zda server chat vůbec nabízí (mód chat_panel) zjišťuje až líný panel — do
// hlavního balíku (ten se veze i do lite) tak nepřibývá nic než tenhle obal.
const AsistentHost = ({ children }) => {
  const { user } = useAuth();
  const A = useAsistent();
  const location = useLocation();
  const lite = location.pathname.startsWith('/lite') || location.pathname.startsWith('/light');
  const zobrazit = !!user && !lite;
  const odsun = zobrazit && A.dostupny && A.open && typeof window !== 'undefined' && window.innerWidth >= 640 ? A.width : 0;
  return (
    <>
      <div style={odsun ? { paddingRight: odsun } : undefined} className="transition-[padding]">{children}</div>
      {zobrazit && <Suspense fallback={null}><AsistentPanel /></Suspense>}
    </>
  );
};

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return <Spinner />;
  }

  if (authError?.type === 'user_not_registered') {
    return <UserNotRegisteredError />;
  }

  return (
    <Suspense fallback={<Spinner />}>
      {/* dotazník účelu — jednou, prvnímu adminovi; líně (viz PurposeGate) */}
      <PurposeGate />
      <AsistentHost>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/oauth/authorize" element={<OAuthAuthorize />} />
        <Route path="/" element={<HomeOrLite />} />
        <Route path="/map/:id" element={<GoalMapEditor />} />
        <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
          <Route path="/lite/*" element={<LiteApp />} />
          {/* Režim se 27. 7. 2026 přejmenoval z „light" na „lite" („light" v rozhraních
              znamená světlý motiv, a ten killBottleneck má taky). Stará adresa musí dál
              fungovat — lidé si ji mohli uložit na plochu telefonu jako appku. */}
          <Route path="/light/*" element={<Navigate to="/lite" replace />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/my-map" element={<GoalMapEditor personalMap />} />
          <Route path="/archive" element={<Archive />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/admin/users" element={<UserAdmin />} />
          {/* pohled shora pro admina a manažera (rozhodnutí 25. 8. 2026); role hlídá stránka i server */}
          <Route path="/organizace" element={<Organizace />} />
        </Route>
        <Route path="*" element={<PageNotFound />} />
      </Routes>
      </AsistentHost>
    </Suspense>
  );
};


function App() {
  // key = jazyk: po přepnutí se přemontuje strom pod Routerem, takže se
  // přeformátují i datumy v komponentách, které samy nevolají useTranslation.
  // Providery (auth/timer) zůstávají — jejich stav přepnutí jazyka nesmí shodit.
  const { i18n } = useTranslation();

  // Nativní obal bez zvoleného serveru: nejdřív volba serveru, žádné API
  // volání nemá kam jít (pb ukazuje na https://localhost = WebView sám).
  // AuthProvider je potřeba i tady — LanguageToggle v AuthLayout volá useAuth;
  // jeho API volání jen neškodně selžou. BEZ key={i18n.language}: remount by
  // při přepnutí jazyka zahodil rozepsaný registrační formulář; texty se
  // přerenderují samy přes useTranslation.
  if (isNativeShell() && !getServerUrl()) {
    return (
      <AuthProvider>
        <NativeOnboarding />
        <Toaster />
      </AuthProvider>
    );
  }

  return (
    <AuthProvider>
      <TimerProvider>
        <AsistentProvider>
          <Router key={i18n.language}>
            <ScrollToTop />
            <DocumentTitle />
            <AuthenticatedApp />
          </Router>
          <Toaster />
        </AsistentProvider>
      </TimerProvider>
    </AuthProvider>
  )
}

export default App
