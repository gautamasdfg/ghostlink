import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import AuthPage from './pages/AuthPage';
import MainApp from './pages/MainApp';
import './styles.css';

function AppInner() {
  const { user, token, loading } = useAuth();
  if (loading) return (
    <div className="splash">
      <div className="splash-logo">
        <span className="ghost-icon">👻</span>
        <span className="splash-name">GhostLink</span>
      </div>
    </div>
  );
  if (!user) return <AuthPage />;
  return (
    <SocketProvider token={token}>
      <MainApp />
    </SocketProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
