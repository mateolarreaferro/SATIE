import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './lib/AuthContext';
import { Chat } from './ui/pages/Chat';
import { Editor } from './ui/pages/Editor';
import './ui/styles/interactions.css';

const Dashboard = lazy(() => import('./ui/pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Gallery = lazy(() => import('./ui/pages/Gallery').then(m => ({ default: m.Gallery })));
const SketchView = lazy(() => import('./ui/pages/SketchView').then(m => ({ default: m.SketchView })));
const Embed = lazy(() => import('./ui/pages/Embed').then(m => ({ default: m.Embed })));
const UserProfile = lazy(() => import('./ui/pages/UserProfile').then(m => ({ default: m.UserProfile })));
const Library = lazy(() => import('./ui/pages/Library').then(m => ({ default: m.Library })));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={null}>
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
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
