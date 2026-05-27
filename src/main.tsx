import { StrictMode, Suspense, useState, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './lib/AuthContext';
import { ThemeProvider } from './ui/theme/ThemeContext';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { RouteFallback, RouteErrorFallback } from './ui/components/RouteFallback';
import { SplashScreen } from './ui/components/SplashScreen';
import { Chat } from './ui/pages/Chat';
import { lazyRoute } from './lib/lazyWithRetry';
import { preloadCommonRoutes } from './lib/routePreload';
import './ui/styles/interactions.css';

// Chat is the landing page and must paint instantly, so it stays eager. Every
// other route is code-split (with retry + stale-chunk reload) and warmed via
// routePreload so navigations commit without a cold-fetch stall.
const Editor = lazyRoute(() => import('./ui/pages/Editor').then(m => ({ default: m.Editor })));
const Dashboard = lazyRoute(() => import('./ui/pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Gallery = lazyRoute(() => import('./ui/pages/Gallery').then(m => ({ default: m.Gallery })));
const SketchView = lazyRoute(() => import('./ui/pages/SketchView').then(m => ({ default: m.SketchView })));
const Embed = lazyRoute(() => import('./ui/pages/Embed').then(m => ({ default: m.Embed })));
const UserProfile = lazyRoute(() => import('./ui/pages/UserProfile').then(m => ({ default: m.UserProfile })));
const Library = lazyRoute(() => import('./ui/pages/Library').then(m => ({ default: m.Library })));
const NotFound = lazyRoute(() => import('./ui/pages/NotFound').then(m => ({ default: m.NotFound })));

function App() {
  const [splashDone, setSplashDone] = useState(false);
  const showTutorial = !localStorage.getItem('satie-onboarding-done');

  const handleSplashComplete = useCallback(() => {
    setSplashDone(true);
    if (showTutorial) {
      localStorage.setItem('satie-onboarding-done', '1');
    }
  }, [showTutorial]);

  // Warm the most-likely-next route chunks once the app is interactive, so
  // clicking a nav tab resolves instantly instead of cold-fetching a chunk.
  useEffect(() => {
    if (!splashDone) return;
    const ric = window.requestIdleCallback;
    if (ric) {
      const id = ric(() => preloadCommonRoutes());
      return () => window.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(preloadCommonRoutes, 1500);
    return () => clearTimeout(id);
  }, [splashDone]);

  if (!splashDone) {
    return <SplashScreen onComplete={handleSplashComplete} showTutorial={showTutorial} />;
  }

  return (
    <ErrorBoundary name="App" fallback={<RouteErrorFallback />}>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Chat />} />
          <Route path="/sketches" element={<Dashboard />} />
          <Route path="/editor" element={<Editor />} />
          <Route path="/editor/:sketchId" element={<Editor />} />
          <Route path="/explore" element={<Gallery />} />
          <Route path="/s/:id" element={<SketchView />} />
          <Route path="/embed/:id" element={<Embed />} />
          <Route path="/library" element={<Library />} />
          <Route path="/u/:username" element={<UserProfile />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
