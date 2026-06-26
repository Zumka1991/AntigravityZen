import { useState, useEffect, useRef } from 'react';
import { RoomList } from './components/RoomList';
import type { RoomInfo, Track } from './components/RoomList';
import { MeditationRoom } from './components/MeditationRoom';
import { translations } from './translations';
import type { Language } from './translations';

// Random username helper
const generateRandomName = () => {
  const adjectives = ['Calm', 'Serene', 'Mindful', 'Peaceful', 'Quiet', 'Silent', 'Gentle', 'Placid'];
  const nouns = ['Lotus', 'River', 'Forest', 'Cloud', 'Mountain', 'Zen', 'Breeze', 'Ocean'];
  const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
  const randomNum = Math.floor(Math.random() * 900) + 100;
  return `${randomAdj}${randomNoun}${randomNum}`;
};

// Generate UUID-like string
const generateId = () => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const API_BASE = `http://${hostname}:8080/api`;
const WS_BASE = `ws://${hostname}:8080/ws`;

function App() {
  const [username, setUsername] = useState(() => {
    return localStorage.getItem('zen_username') || generateRandomName();
  });
  const [lang, setLang] = useState<Language>(() => {
    const saved = localStorage.getItem('zen_lang');
    if (saved === 'ru' || saved === 'en') return saved;
    return 'ru';
  });

  const handleSetLang = (newLang: Language) => {
    setLang(newLang);
    localStorage.setItem('zen_lang', newLang);
  };

  const t = translations[lang];

  const [clientId] = useState(() => {
    let id = localStorage.getItem('zen_client_id');
    if (!id) {
      id = generateId();
      localStorage.setItem('zen_client_id', id);
    }
    return id;
  });

  const [activeRoom, setActiveRoom] = useState<{ id: string; name: string | null; duration?: number; trackId?: string } | null>(null);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  
  // WebSocket and real-time state
  const [roomState, setRoomState] = useState<any>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // Sync username to localStorage
  const handleSetUsername = (name: string) => {
    setUsername(name);
    localStorage.setItem('zen_username', name);
  };

  // Fetch initial tracks and rooms
  const fetchRooms = async () => {
    try {
      const res = await fetch(`${API_BASE}/rooms`);
      if (res.ok) {
        const data = await res.json();
        setRooms(data);
      }
    } catch (err) {
      console.error('Error fetching rooms:', err);
    }
  };

  const fetchTracks = async () => {
    try {
      const res = await fetch(`${API_BASE}/tracks`);
      if (res.ok) {
        const data = await res.json();
        setTracks(data);
      }
    } catch (err) {
      console.error('Error fetching tracks:', err);
    }
  };

  // Check for roomId query param on startup to auto-join
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomIdParam = params.get('roomId');
    if (roomIdParam) {
      setActiveRoom({ id: roomIdParam, name: null });
      // Clean up the URL query param so refreshing doesn't force re-joining after leaving
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }
  }, []);

  useEffect(() => {
    fetchTracks();
    fetchRooms();

    // Poll room list every 5 seconds when in lobby
    const interval = setInterval(() => {
      if (!activeRoom) {
        fetchRooms();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [activeRoom]);

  // Connect to websocket when in room
  useEffect(() => {
    if (!activeRoom) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setRoomState(null);
      setChatMessages([]);
      return;
    }

    try {
      const durationParam = activeRoom.duration ? `&duration=${activeRoom.duration}` : '';
      const trackParam = activeRoom.trackId ? `&trackId=${activeRoom.trackId}` : '';
      const wsUrl = `${WS_BASE}?roomId=${activeRoom.id}&username=${encodeURIComponent(username)}&clientId=${clientId}&roomName=${encodeURIComponent(activeRoom.name || '')}${durationParam}${trackParam}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected to room:', activeRoom.id);
        setConnectionError(null);
      };

      ws.onmessage = (event) => {
        // Multiple JSON messages can be separated by newlines
        const lines = event.data.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const data = JSON.parse(line);
            switch (data.type) {
              case 'room_state':
                setRoomState(data.payload);
                break;
              case 'chat':
                setChatMessages((prev) => [...prev, {
                  type: 'chat',
                  username: data.username,
                  text: data.payload.text,
                  timestamp: data.timestamp,
                }]);
                break;
              default:
                console.log('Unknown websocket message type:', data.type);
            }
          } catch (err) {
            console.error('Error parsing WS message:', err, line);
          }
        }
      };

      ws.onclose = (event) => {
        console.log('WebSocket connection closed:', event.code, event.reason);
        if (event.code !== 1000 && event.code !== 1001 && event.code !== 1005) {
          setConnectionError(`Connection lost (Code: ${event.code}). Reason: ${event.reason || 'Server error'}`);
        }
        setActiveRoom(null);
        setRoomState(null);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        setConnectionError('WebSocket connection error. Please make sure the Go backend is running at http://localhost:8080.');
      };
    } catch (err: any) {
      console.error('Failed to create WebSocket:', err);
      setConnectionError(`Failed to establish connection: ${err.message || err}`);
      setActiveRoom(null);
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [activeRoom, username, clientId]);

  const handleJoinRoom = (roomId: string) => {
    setActiveRoom({ id: roomId, name: null });
  };

  const handleCreateRoom = (roomName: string, duration: number, trackId: string) => {
    // Generate a unique room ID
    const roomId = generateId().slice(0, 8);
    setActiveRoom({ id: roomId, name: roomName, duration, trackId });

    // We can also trigger the initial configuration if we are the host.
    // The Hub automatically creates the room when the client connects.
    // The client will establish connection in the useEffect hook.
  };

  const handleLeaveRoom = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    setActiveRoom(null);
    fetchRooms();
  };

  // Websocket actions
  const handleSendMessage = (text: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'chat',
        payload: { text },
      };
      wsRef.current.send(JSON.stringify(msg));
    }
  };

  const handleStartMeditation = (trackId: string, duration: number) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'start',
        payload: { trackId, duration },
      };
      wsRef.current.send(JSON.stringify(msg));
    }
  };

  const handleStopMeditation = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'stop',
      };
      wsRef.current.send(JSON.stringify(msg));
    }
  };

  return (
    <div className={`app-container ${activeRoom ? 'in-room' : ''}`}>
      {/* Decorative Glow Orbs */}
      <div className="glow-orb glow-purple" />
      <div className="glow-orb glow-teal" />

      {/* Main Header */}
      <header className="app-header" style={{ position: 'relative', zIndex: 10 }}>
        <div className="brand" onClick={handleLeaveRoom} style={{ cursor: 'pointer' }}>
          <div className="brand-icon" />
          <span>Antigravity Zen</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Language Selector */}
          <div style={{ display: 'flex', gap: '0.25rem', background: 'rgba(255, 255, 255, 0.03)', padding: '3px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
            <button 
              className="btn" 
              onClick={() => handleSetLang('ru')} 
              style={{ 
                padding: '0.35rem 0.65rem', 
                fontSize: '0.75rem', 
                borderRadius: '8px',
                background: lang === 'ru' ? 'var(--color-primary)' : 'transparent',
                color: lang === 'ru' ? '#06050e' : 'var(--color-text-secondary)',
                boxShadow: lang === 'ru' ? '0 2px 10px var(--color-primary-glow)' : 'none',
                fontWeight: 700
              }}
            >
              RU
            </button>
            <button 
              className="btn" 
              onClick={() => handleSetLang('en')} 
              style={{ 
                padding: '0.35rem 0.65rem', 
                fontSize: '0.75rem', 
                borderRadius: '8px',
                background: lang === 'en' ? 'var(--color-primary)' : 'transparent',
                color: lang === 'en' ? '#06050e' : 'var(--color-text-secondary)',
                boxShadow: lang === 'en' ? '0 2px 10px var(--color-primary-glow)' : 'none',
                fontWeight: 700
              }}
            >
              EN
            </button>
          </div>
          {!activeRoom && (
            <div className="user-badge">
              <div className="user-avatar">{username.charAt(0).toUpperCase()}</div>
              <span>{username}</span>
            </div>
          )}
        </div>
      </header>

      {connectionError && (
        <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1.5rem', border: '1px solid var(--color-accent)', background: 'rgba(244, 63, 94, 0.05)', color: 'var(--color-text-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 10 }}>
          <span>{connectionError}</span>
          <button className="btn btn-secondary" onClick={() => setConnectionError(null)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', borderRadius: '6px' }}>Dismiss</button>
        </div>
      )}

      {/* Primary Page Content */}
      <main style={{ flex: 1 }}>
        {activeRoom ? (
          roomState ? (
            <MeditationRoom
              roomState={roomState}
              clientId={clientId}
              username={username}
              tracks={tracks}
              messages={chatMessages}
              onSendMessage={handleSendMessage}
              onStartMeditation={handleStartMeditation}
              onStopMeditation={handleStopMeditation}
              onLeaveRoom={handleLeaveRoom}
              t={t}
            />
          ) : (
            <div className="glass-panel" style={{ padding: '3rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.5rem', textAlign: 'center', minHeight: '300px' }}>
              <div className="brand-icon" style={{ width: '48px', height: '48px', animation: 'pulseLight 1s infinite alternate' }} />
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  {lang === 'ru' ? 'Подключение к комнате...' : 'Connecting to room...'}
                </h3>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
                  {lang === 'ru' ? 'Пожалуйста, подождите, устанавливаем соединение.' : 'Please wait while establishing connection.'}
                </p>
              </div>
              <button className="btn btn-secondary" onClick={handleLeaveRoom}>
                {t.cancel}
              </button>
            </div>
          )
        ) : (
          <RoomList
            rooms={rooms}
            tracks={tracks}
            username={username}
            onSetUsername={handleSetUsername}
            onJoinRoom={handleJoinRoom}
            onCreateRoom={handleCreateRoom}
            t={t}
          />
        )}
      </main>
    </div>
  );
}

export default App;
