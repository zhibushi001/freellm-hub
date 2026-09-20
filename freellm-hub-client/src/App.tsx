import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect, lazy, Suspense } from 'react';
import Layout from './components/Layout';
import Login from './pages/Login';

// 代码分割 - 懒加载页面组件
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Channels = lazy(() => import('./pages/Channels'));
const HubKeys = lazy(() => import('./pages/HubKeys'));
const ModelRoutes = lazy(() => import('./pages/ModelRoutes'));
const Usage = lazy(() => import('./pages/Usage'));
const Profile = lazy(() => import('./pages/Profile'));
const Playground = lazy(() => import('./pages/Playground'));
const Chat = lazy(() => import('./pages/Chat'));
const API = lazy(() => import('./pages/API'));
const Cache = lazy(() => import('./pages/Cache'));
const Guardrails = lazy(() => import('./pages/Guardrails'));
const Fallback = lazy(() => import('./pages/Fallback'));
const ModelMappings = lazy(() => import('./pages/ModelMappings'));
const VirtualModels = lazy(() => import('./pages/VirtualModels'));

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/admin/auth/me', { credentials: 'include' })
      .then((res) => {
        if (res.ok) setAuthenticated(true);
        else setAuthenticated(false);
      })
      .catch(() => setAuthenticated(false));
  }, []);

  if (authenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            authenticated ? (
              <Navigate to="/admin/dashboard" replace />
            ) : (
              <Login onLogin={() => setAuthenticated(true)} />
            )
          }
        />
        <Route
          path="/admin/*"
          element={
            authenticated ? (
              <Layout onLogout={() => setAuthenticated(false)}>
                <Suspense fallback={
                  <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                  </div>
                }>
                <Routes>
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="channels" element={<Channels />} />
                  <Route path="hub-keys" element={<HubKeys />} />
                  <Route path="routes" element={<ModelRoutes />} />
                  <Route path="virtual-models" element={<VirtualModels />} />
                  <Route path="mappings" element={<ModelMappings />} />
                  <Route path="fallback" element={<Fallback />} />
                  <Route path="usage" element={<Usage />} />
                  <Route path="playground" element={<Playground />} />
                  <Route path="chat" element={<Chat />} />
                  <Route path="api" element={<API />} />
                  <Route path="guardrails" element={<Guardrails />} />
                  <Route path="cache" element={<Cache />} />
                  <Route path="profile" element={<Profile />} />
                  <Route path="*" element={<Navigate to="dashboard" replace />} />
                </Routes>
                </Suspense>
              </Layout>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
