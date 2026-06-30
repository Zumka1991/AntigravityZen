import { useState, useEffect, useRef } from 'react';
import { RoomList } from './components/RoomList';
import type { RoomInfo, Track } from './components/RoomList';
import { MeditationRoom } from './components/MeditationRoom';
import { translations } from './translations';
import type { Language } from './translations';

// Generate UUID-like string
const generateId = () => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
const apiProtocol = isSecure ? 'https:' : 'http:';
const wsProtocol = isSecure ? 'wss:' : 'ws:';
const port = typeof window !== 'undefined' && window.location.port ? `:${window.location.port}` : '';

const API_BASE = `${apiProtocol}//${hostname}${port}/api`;
const WS_BASE = `${wsProtocol}//${hostname}${port}/ws`;

function App() {
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [isCheckingToken, setIsCheckingToken] = useState(true);
  
  // Auth Form States
  const [showLogin, setShowLogin] = useState(true);
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  // Admin Panel States
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [trackTitle, setTrackTitle] = useState('');
  const [trackArtist, setTrackArtist] = useState('');
  const [trackFile, setTrackFile] = useState<File | null>(null);
  const [trackDuration, setTrackDuration] = useState('');
  const [adminError, setAdminError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

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
    let id = sessionStorage.getItem('zen_client_id');
    if (!id) {
      id = generateId();
      sessionStorage.setItem('zen_client_id', id);
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
  const [voiceNarrator, setVoiceNarrator] = useState<string | null>(null);
  const [voiceFileUrl, setVoiceFileUrl] = useState<string | null>(null);
  const voiceListenersRef = useRef<((chunk: ArrayBuffer) => void)[]>([]);

  const registerVoiceListener = (listener: (chunk: ArrayBuffer) => void) => {
    voiceListenersRef.current.push(listener);
    return () => {
      voiceListenersRef.current = voiceListenersRef.current.filter(l => l !== listener);
    };
  };

  // Verify token on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('zen_token');
    if (!savedToken) {
      setIsCheckingToken(false);
      return;
    }

    const verifyToken = async () => {
      try {
        const res = await fetch(`${API_BASE}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: savedToken }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.valid) {
            setToken(savedToken);
            setUsername(data.username);
          } else {
            localStorage.removeItem('zen_token');
            localStorage.removeItem('zen_username');
          }
        } else {
          localStorage.removeItem('zen_token');
          localStorage.removeItem('zen_username');
        }
      } catch (err) {
        console.error('Failed to verify token:', err);
        localStorage.removeItem('zen_token');
        localStorage.removeItem('zen_username');
      } finally {
        setIsCheckingToken(false);
      }
    };

    verifyToken();
  }, []);

  // Fetch initial tracks and rooms when logged in
  const fetchRooms = async () => {
    if (!token) return;
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
    if (!token) return;
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
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    fetchTracks();
    fetchRooms();

    // Poll room list every 5 seconds when in lobby
    const interval = setInterval(() => {
      if (!activeRoom) {
        fetchRooms();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [activeRoom, token]);

  // Connect to websocket when in room
  useEffect(() => {
    if (!activeRoom || !token) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setRoomState(null);
      setChatMessages([]);
      setVoiceNarrator(null);
      return;
    }

    try {
      const durationParam = activeRoom.duration ? `&duration=${activeRoom.duration}` : '';
      const trackParam = activeRoom.trackId ? `&trackId=${activeRoom.trackId}` : '';
      const wsUrl = `${WS_BASE}?roomId=${activeRoom.id}&token=${token}&clientId=${clientId}&roomName=${encodeURIComponent(activeRoom.name || '')}${durationParam}${trackParam}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected to room:', activeRoom.id);
        setConnectionError(null);
      };

      ws.onmessage = (event) => {
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
              case 'chat_history':
                if (Array.isArray(data.payload)) {
                  setChatMessages(data.payload.map((msg: any) => ({
                    type: 'chat',
                    username: msg.username,
                    text: msg.text,
                    timestamp: msg.timestamp,
                  })));
                }
                break;
              case 'voice_start':
                const fileUrl = data.payload && data.payload.file_url ? data.payload.file_url : null;
                setVoiceFileUrl(fileUrl);
                setVoiceNarrator(data.username);
                break;
              case 'voice_stop':
                setVoiceNarrator(null);
                setVoiceFileUrl(null);
                break;
              case 'voice_data':
                if (data.payload && data.payload.data) {
                  try {
                    const binaryString = window.atob(data.payload.data);
                    const len = binaryString.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) {
                      bytes[i] = binaryString.charCodeAt(i);
                    }
                    voiceListenersRef.current.forEach(listener => listener(bytes.buffer));
                  } catch (e) {
                    console.error('Error decoding voice chunk:', e);
                  }
                }
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
      setRoomState(null);
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [activeRoom, token, clientId]);

  const handleJoinRoom = (roomId: string) => {
    setActiveRoom({ id: roomId, name: null });
  };

  const handleCreateRoom = (roomName: string, duration: number, trackId: string) => {
    const roomId = generateId().slice(0, 8);
    setActiveRoom({ id: roomId, name: roomName, duration, trackId });
  };

  const handleLeaveRoom = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    setActiveRoom(null);
    fetchRooms();
  };

  // Auth operations
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    const endpoint = showLogin ? '/login' : '/register';
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authUsername, password: authPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        let errorMsg = t.authErrorGeneric;
        if (data.error) {
          if (data.error.includes('taken')) {
            errorMsg = t.authErrorTaken;
          } else if (data.error.includes('password must be')) {
            errorMsg = t.authErrorPasswordShort;
          } else {
            errorMsg = data.error;
          }
        }
        setAuthError(errorMsg);
        return;
      }

      localStorage.setItem('zen_token', data.token);
      localStorage.setItem('zen_username', data.username);
      setUsername(data.username);
      setToken(data.token);
      setAuthPassword('');
      setAuthError(null);
    } catch (err) {
      console.error('Auth error:', err);
      setAuthError(t.authErrorGeneric);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('zen_token');
    localStorage.removeItem('zen_username');
    setToken(null);
    setUsername('');
    setAuthUsername('');
    setAuthPassword('');
    setActiveRoom(null);
  };

  // Admin Operations
  const handleAddTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminError(null);

    const durationNum = parseInt(trackDuration);
    if (isNaN(durationNum) || durationNum <= 0) {
      setAdminError('Duration must be a positive number');
      return;
    }

    if (!trackFile) {
      setAdminError('Please select an audio file to upload');
      return;
    }

    setIsUploading(true);

    const formData = new FormData();
    formData.append('title', trackTitle);
    formData.append('artist', trackArtist);
    formData.append('duration', durationNum.toString());
    formData.append('file', trackFile);

    try {
      const res = await fetch(`${API_BASE}/tracks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      if (!res.ok) {
        const data = await res.json();
        setAdminError(data.error || 'Failed to add track');
        return;
      }

      fetchTracks();
      setTrackTitle('');
      setTrackArtist('');
      setTrackFile(null);
      setTrackDuration('');
      
      const fileInput = document.getElementById('admin-track-file') as HTMLInputElement;
      if (fileInput) fileInput.value = '';

    } catch (err) {
      console.error('Failed to add track:', err);
      setAdminError('Failed to add track due to server connection error');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteTrack = async (id: string) => {
    setAdminError(null);
    try {
      const res = await fetch(`${API_BASE}/tracks?id=${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const data = await res.json();
        setAdminError(data.error || 'Failed to delete track');
        return;
      }

      fetchTracks();
    } catch (err) {
      console.error('Failed to delete track:', err);
      setAdminError('Failed to delete track due to server connection error');
    }
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

  const handleVoiceStart = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'voice_start', payload: {} }));
    }
  };

  const handleVoiceStop = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'voice_stop', payload: {} }));
    }
  };

  const handleVoiceData = (arrayBuffer: ArrayBuffer) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(arrayBuffer);
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

  if (isCheckingToken) {
    return (
      <div className="app-container">
        <div className="glow-orb glow-purple" />
        <div className="glow-orb glow-teal" />
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
          <div className="brand-icon" style={{ width: '48px', height: '48px', animation: 'pulseLight 1s infinite alternate' }} />
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: '1rem' }}>
        <div className="glow-orb glow-purple" />
        <div className="glow-orb glow-teal" />
        
        <header className="app-header" style={{ borderBottom: 'none', marginBottom: '1.5rem', width: '100%', maxWidth: '400px', justifyContent: 'center' }}>
          <div className="brand">
            <div className="brand-icon" />
            <span>Antigravity Zen</span>
          </div>
        </header>

        <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', padding: '2.5rem 2rem', position: 'relative', zIndex: 10 }}>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.5rem', textAlign: 'center', fontFamily: 'var(--font-heading)' }}>
            {showLogin ? t.loginTitle : t.registerTitle}
          </h2>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', marginBottom: '2rem', textAlign: 'center' }}>
            {t.welcomeDesc}
          </p>

          <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                {t.usernameLabel}
              </label>
              <input
                type="text"
                placeholder={t.usernamePlaceholder}
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
                required
                style={{ padding: '0.75rem 1rem', borderRadius: '12px' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                {t.passwordLabel}
              </label>
              <input
                type="password"
                placeholder={t.passwordPlaceholder}
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                required
                style={{ padding: '0.75rem 1rem', borderRadius: '12px' }}
              />
            </div>

            {authError && (
              <div style={{ color: 'var(--color-accent)', fontSize: '0.85rem', background: 'rgba(244, 63, 94, 0.05)', border: '1px solid rgba(244, 63, 94, 0.15)', padding: '0.75rem', borderRadius: '10px', textAlign: 'center' }}>
                {authError}
              </div>
            )}

            <button type="submit" className="btn btn-primary" style={{ padding: '0.85rem', borderRadius: '12px', marginTop: '0.5rem', fontWeight: 700, cursor: 'pointer' }}>
              {showLogin ? t.signInBtn : t.signUpBtn}
            </button>
          </form>

          <div style={{ marginTop: '2rem', textAlign: 'center', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
            <span>{showLogin ? t.noAccountPrompt : t.haveAccountPrompt} </span>
            <button
              className="btn"
              onClick={() => {
                setShowLogin(!showLogin);
                setAuthError(null);
                setAuthPassword('');
              }}
              style={{
                background: 'transparent',
                border: 'none',
                boxShadow: 'none',
                color: 'var(--color-primary)',
                padding: '0 0.25rem',
                fontWeight: 600,
                textDecoration: 'underline',
                cursor: 'pointer'
              }}
            >
              {showLogin ? t.signUpBtn : t.signInBtn}
            </button>
          </div>
        </div>
        
        {/* Language Selector at the bottom of login */}
        <div style={{ display: 'flex', gap: '0.25rem', background: 'rgba(255, 255, 255, 0.03)', padding: '3px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.05)', marginTop: '2rem' }}>
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
      </div>
    );
  }

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
          {!activeRoom && token && username === 'admin' && (
            <button 
              className="btn" 
              onClick={() => setShowAdminPanel(true)}
              style={{ 
                padding: '0.35rem 0.65rem', 
                fontSize: '0.75rem', 
                borderRadius: '8px',
                background: 'rgba(167, 139, 250, 0.1)',
                color: 'var(--color-primary)',
                border: '1px solid rgba(167, 139, 250, 0.2)',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              {t.adminAccessBtn}
            </button>
          )}
          {!activeRoom && token && (
            <div className="user-badge" style={{ gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div className="user-avatar">{username.charAt(0).toUpperCase()}</div>
                <span>{username}</span>
              </div>
              <button 
                className="btn" 
                onClick={handleLogout}
                style={{ 
                  padding: '0.35rem 0.65rem', 
                  fontSize: '0.75rem', 
                  borderRadius: '8px',
                  background: 'rgba(244, 63, 94, 0.1)',
                  color: 'var(--color-accent)',
                  border: '1px solid rgba(244, 63, 94, 0.2)',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {t.logoutBtn}
              </button>
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
              voiceNarrator={voiceNarrator}
              voiceFileUrl={voiceFileUrl}
              registerVoiceListener={registerVoiceListener}
              onVoiceStart={handleVoiceStart}
              onVoiceStop={handleVoiceStop}
              onVoiceData={handleVoiceData}
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
            onJoinRoom={handleJoinRoom}
            onCreateRoom={handleCreateRoom}
            t={t}
          />
        )}
      </main>

      {/* Admin Panel Modal Overlay */}
      {showAdminPanel && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(5, 4, 15, 0.75)',
          backdropFilter: 'blur(15px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 100,
          padding: '1.5rem'
        }}>
          <div className="glass-panel" style={{
            width: '100%',
            maxWidth: '650px',
            padding: '2.5rem',
            maxHeight: '90vh',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '2rem',
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: 'var(--font-heading)' }}>
                {t.adminPanelTitle}
              </h2>
              <button 
                className="btn btn-secondary" 
                onClick={() => {
                  setShowAdminPanel(false);
                  setAdminError(null);
                }}
                style={{ padding: '0.5rem 1rem', borderRadius: '10px' }}
              >
                {t.closeBtn}
              </button>
            </div>

            {adminError && (
              <div style={{
                color: 'var(--color-accent)',
                background: 'rgba(244, 63, 94, 0.05)',
                border: '1px solid rgba(244, 63, 94, 0.15)',
                padding: '0.75rem 1rem',
                borderRadius: '10px',
                fontSize: '0.9rem',
                textAlign: 'center'
              }}>
                {adminError}
              </div>
            )}

            {/* Add Track Form */}
            <form onSubmit={handleAddTrack} className="admin-track-form">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                  {t.trackTitleLabel}
                </label>
                <input
                  type="text"
                  placeholder={t.trackTitlePlaceholder}
                  value={trackTitle}
                  onChange={(e) => setTrackTitle(e.target.value)}
                  required
                  disabled={isUploading}
                  style={{ padding: '0.6rem 0.9rem', fontSize: '0.9rem' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                  {t.trackArtistLabel}
                </label>
                <input
                  type="text"
                  placeholder={t.trackArtistPlaceholder}
                  value={trackArtist}
                  onChange={(e) => setTrackArtist(e.target.value)}
                  required
                  disabled={isUploading}
                  style={{ padding: '0.6rem 0.9rem', fontSize: '0.9rem' }}
                />
              </div>

              <div className="span-2" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', gridColumn: 'span 2' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                  {t.trackFileLabel}
                </label>
                <input
                  id="admin-track-file"
                  type="file"
                  accept="audio/mp3,audio/*"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setTrackFile(e.target.files[0]);
                    }
                  }}
                  required
                  disabled={isUploading}
                  style={{ padding: '0.6rem 0.9rem', fontSize: '0.9rem' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                  {t.trackDurationLabel}
                </label>
                <input
                  type="number"
                  placeholder={t.trackDurationPlaceholder}
                  value={trackDuration}
                  onChange={(e) => setTrackDuration(e.target.value)}
                  required
                  min="1"
                  disabled={isUploading}
                  style={{ padding: '0.6rem 0.9rem', fontSize: '0.9rem' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  disabled={isUploading}
                  style={{ 
                    width: '100%', 
                    padding: '0.65rem', 
                    borderRadius: '12px', 
                    fontWeight: 700, 
                    height: '38px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    background: isUploading ? 'var(--color-text-secondary)' : 'var(--color-primary)',
                    cursor: isUploading ? 'not-allowed' : 'pointer'
                  }}
                >
                  {isUploading ? t.uploadingMsg : t.addTrackBtn}
                </button>
              </div>
            </form>

            {/* Track List Manager */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>{t.backgroundSoundSetting}</h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto', paddingRight: '0.25rem' }}>
                {tracks.length === 0 ? (
                  <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', textAlign: 'center', padding: '1rem' }}>
                    {t.noTracksMsg}
                  </p>
                ) : (
                  tracks.map((track) => (
                    <div key={track.id} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: 'rgba(255, 255, 255, 0.02)',
                      padding: '0.75rem 1rem',
                      borderRadius: '12px',
                      border: '1px solid rgba(255, 255, 255, 0.04)'
                    }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{(t as any)[track.id] || track.title}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                          {track.artist} • {Math.floor(track.duration / 60)}m {track.duration % 60}s
                        </div>
                      </div>
                      <button 
                        className="btn" 
                        onClick={() => handleDeleteTrack(track.id)}
                        style={{
                          padding: '0.35rem 0.65rem',
                          fontSize: '0.8rem',
                          borderRadius: '8px',
                          background: 'rgba(244, 63, 94, 0.1)',
                          color: 'var(--color-accent)',
                          border: '1px solid rgba(244, 63, 94, 0.2)',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        {t.deleteTrackBtn}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
