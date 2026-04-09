import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../utils/api';
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('gl_token'));
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const saved = localStorage.getItem('gl_user');
    if (saved && token) { try { setUser(JSON.parse(saved)); } catch {} }
    setLoading(false);
  }, [token]);
  const login = async (ghostId, password) => {
    const data = await api.login(ghostId, password);
    localStorage.setItem('gl_token', data.token);
    localStorage.setItem('gl_user', JSON.stringify(data.user));
    setToken(data.token); setUser(data.user); return data;
  };
  const register = async (ghostId, password) => { await api.register(ghostId, password); return login(ghostId, password); };
  const logout = async () => {
    try { await api.logout(); } catch {}
    localStorage.removeItem('gl_token'); localStorage.removeItem('gl_user');
    setToken(null); setUser(null);
  };
  return <AuthContext.Provider value={{ user, token, login, register, logout, loading }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
