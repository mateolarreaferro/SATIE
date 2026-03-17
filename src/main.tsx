import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './lib/AuthContext';
import { Dashboard } from './ui/pages/Dashboard';
import { Editor } from './ui/pages/Editor';
import './ui/styles/interactions.css';

const Gallery = lazy(() => import('./ui/pages/Gallery').then(m => ({ default: m.Gallery })));
const SketchView = lazy(() => import('./ui/pages/SketchView').then(m => ({ default: m.SketchView })));
const Embed = lazy(() => import('./ui/pages/Embed').then(m => ({ default: m.Embed })));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/editor" element={<Editor />} />
            <Route path="/editor/:sketchId" element={<Editor />} />
            <Route path="/explore" element={<Gallery />} />
            <Route path="/s/:id" element={<SketchView />} />
            <Route path="/embed/:id" element={<Embed />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
