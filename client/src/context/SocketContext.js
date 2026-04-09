import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext(null);

export function SocketProvider({ children, token }) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!token) return;

    // Auto-detect server URL: works without .env file
    // In development (localhost:3000), connect to localhost:4000
    // In production, connect to same origin
    const serverUrl = process.env.REACT_APP_SERVER_URL ||
      (window.location.hostname === 'localhost'
        ? `http://localhost:4000`
        : window.location.origin);

    const socket = io(serverUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      timeout: 20000,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
      withCredentials: false,
    });

    socketRef.current = socket;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    return () => { socket.disconnect(); socketRef.current = null; setConnected(false); };
  }, [token]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
