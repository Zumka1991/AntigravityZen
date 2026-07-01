import { useState, useEffect, useRef } from 'react';
import { RoomList } from './components/RoomList';
import type { RoomInfo, Track } from './components/RoomList';
import type { MeditationBackground } from './components/RoomList';
import { MeditationRoom } from './components/MeditationRoom';
import { GlobalChat } from './components/GlobalChat';
import { BackgroundManager } from './components/BackgroundManager';
import { AboutPage } from './components/AboutPage';
import { EventPlanner } from './components/EventPlanner';
import type { MeditationEvent } from './components/EventPlanner';
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

type ActiveRoom = {
  id: string;
  name: string | null;
  duration?: number;
  trackId?: string;
  voiceTrackId?: string;
  backgroundId?: string;
  accessTicket?: string;
};

const restoreActiveRoom = (): ActiveRoom | null => {
  try {
    const stored = sessionStorage.getItem('zen_active_room');
    return stored ? JSON.parse(stored) : null;
  } catch {
    sessionStorage.removeItem('zen_active_room');
    return null;
  }
};

function App() {
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [isGuest, setIsGuest] = useState(false);
  const [isCheckingToken, setIsCheckingToken] = useState(true);
  
  // Auth Form States
  const [showLogin, setShowLogin] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  // Shared sound library states
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [trackTitle, setTrackTitle] = useState('');
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

  const [activeRoom, setActiveRoom] = useState<ActiveRoom | null>(restoreActiveRoom);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [backgrounds, setBackgrounds] = useState<MeditationBackground[]>([]);
  const [events, setEvents] = useState<MeditationEvent[]>([]);
  const sharedTracks = tracks.filter((track) => !track.ownerUsername || track.isPublic);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [requestedRoomId, setRequestedRoomId] = useState<string | null>(null);
  const [requestedEventId, setRequestedEventId] = useState<string | null>(null);
  
  // WebSocket and real-time state
  const [roomState, setRoomState] = useState<any>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const leavingRoomRef = useRef(false);
  const [voiceNarrator, setVoiceNarrator] = useState<string | null>(null);
  const [voiceFileUrl, setVoiceFileUrl] = useState<string | null>(null);
  const [isVoiceStatic, setIsVoiceStatic] = useState(false);
  const voiceListenersRef = useRef<((chunk: ArrayBuffer) => void)[]>([]);

  const registerVoiceListener = (listener: (chunk: ArrayBuffer) => void) => {
    voiceListenersRef.current.push(listener);
    return () => {
      voiceListenersRef.current = voiceListenersRef.current.filter(l => l !== listener);
    };
  };

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  const startGuestSession = async () => {
    try {
      const response = await fetch(`${API_BASE}/guest`, { method: 'POST' });
      if (!response.ok) throw new Error('Guest session failed');
      const data = await response.json();
      localStorage.setItem('zen_token', data.token);
      localStorage.setItem('zen_username', data.username);
      localStorage.setItem('zen_is_guest', 'true');
      setToken(data.token);
      setUsername(data.username);
      setIsGuest(true);
      return true;
    } catch (err) {
      console.error('Failed to start guest session:', err);
      return false;
    }
  };

  // Verify a durable session or quietly start a guest session.
  useEffect(() => {
    const savedToken = localStorage.getItem('zen_token');
    if (!savedToken) {
      void startGuestSession().finally(() => setIsCheckingToken(false));
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
            setIsGuest(Boolean(data.isGuest));
            localStorage.setItem('zen_is_guest', String(Boolean(data.isGuest)));
          } else {
            localStorage.removeItem('zen_token');
            localStorage.removeItem('zen_username');
            localStorage.removeItem('zen_is_guest');
            await startGuestSession();
          }
        } else {
          localStorage.removeItem('zen_token');
          localStorage.removeItem('zen_username');
          localStorage.removeItem('zen_is_guest');
          await startGuestSession();
        }
      } catch (err) {
        console.error('Failed to verify token:', err);
        // A deploy may briefly make the API unavailable. Keep the durable
        // credentials so the room can reconnect when the backend returns.
        const savedUsername = localStorage.getItem('zen_username');
        if (savedUsername) {
          setToken(savedToken);
          setUsername(savedUsername);
          setIsGuest(localStorage.getItem('zen_is_guest') === 'true');
        }
      } finally {
        setIsCheckingToken(false);
      }
    };

    verifyToken();
  }, []);

  useEffect(() => {
    if (activeRoom) {
      sessionStorage.setItem('zen_active_room', JSON.stringify(activeRoom));
    } else {
      sessionStorage.removeItem('zen_active_room');
    }
  }, [activeRoom]);

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
      const res = await fetch(`${API_BASE}/tracks`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTracks(data);
      }
    } catch (err) {
      console.error('Error fetching tracks:', err);
    }
  };

  const fetchBackgrounds = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/backgrounds`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setBackgrounds(await res.json());
      }
    } catch (err) {
      console.error('Error fetching backgrounds:', err);
    }
  };

  const fetchEvents = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/events`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) setEvents(await res.json());
    } catch (err) {
      console.error('Error fetching events:', err);
    }
  };

  const clearInvitationTarget = (param: 'roomId' | 'eventId') => {
    const url = new URL(window.location.href);
    url.searchParams.delete(param);
    const search = url.searchParams.toString();
    window.history.replaceState(
      {},
      document.title,
      `${url.pathname}${search ? `?${search}` : ''}${url.hash}`,
    );
  };

  // Keep invitation targets in the URL and memory while the user signs in or registers.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomIdParam = params.get('roomId');
    const eventIdParam = params.get('eventId');
    if (roomIdParam) {
      setRequestedRoomId(roomIdParam);
    }
    if (eventIdParam) {
      setRequestedEventId(eventIdParam);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    fetchTracks();
    fetchBackgrounds();
    fetchRooms();
    fetchEvents();

    // Poll room list every 5 seconds when in lobby
    const interval = setInterval(() => {
      if (!activeRoom) {
        fetchRooms();
        fetchEvents();
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

    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;
    let shouldReconnect = true;
    leavingRoomRef.current = false;

    const scheduleReconnect = () => {
      if (!shouldReconnect || leavingRoomRef.current) return;
      const delay = Math.min(1000 * (2 ** reconnectAttempt), 10000);
      reconnectAttempt += 1;
      setConnectionError(lang === 'ru'
        ? 'Соединение восстанавливается…'
        : 'Reconnecting…');
      reconnectTimer = window.setTimeout(connect, delay);
    };

    const connect = () => {
      if (!shouldReconnect) return;
      try {
      const durationParam = activeRoom.duration ? `&duration=${activeRoom.duration}` : '';
      const trackParam = activeRoom.trackId ? `&trackId=${activeRoom.trackId}` : '';
      const voiceTrackParam = activeRoom.voiceTrackId ? `&voiceTrackId=${activeRoom.voiceTrackId}` : '';
      const backgroundParam = activeRoom.backgroundId ? `&backgroundId=${activeRoom.backgroundId}` : '';
      const accessParam = activeRoom.accessTicket ? `&accessTicket=${encodeURIComponent(activeRoom.accessTicket)}` : '';
      const wsUrl = `${WS_BASE}?roomId=${activeRoom.id}&token=${token}&clientId=${clientId}&roomName=${encodeURIComponent(activeRoom.name || '')}${durationParam}${trackParam}${voiceTrackParam}${backgroundParam}${accessParam}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected to room:', activeRoom.id);
        reconnectAttempt = 0;
        setConnectionError(null);
      };

      ws.onmessage = (event) => {
        const lines = event.data.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const data = JSON.parse(line);
            switch (data.type) {
              case 'room_state': {
                const payload = data.payload;
                setRoomState(payload);
                // Auto-start static voice playback if room has a voiceTrack and is playing
                if (payload.status === 'playing' && payload.voiceTrack) {
                  setVoiceFileUrl(payload.voiceTrack.audioUrl);
                  setIsVoiceStatic(true);
                  setVoiceNarrator(payload.voiceTrack.ownerUsername || 'recorded');
                } else if (payload.status !== 'playing') {
                  setVoiceNarrator(null);
                  setVoiceFileUrl(null);
                  setIsVoiceStatic(false);
                }
                break;
              }
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
                const isStatic = data.payload && !!data.payload.is_static;
                setVoiceFileUrl(fileUrl);
                setIsVoiceStatic(isStatic);
                setVoiceNarrator(data.username);
                break;
              case 'voice_stop':
                setVoiceNarrator(null);
                setVoiceFileUrl(null);
                setIsVoiceStatic(false);
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
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        // Live microphone audio cannot survive a backend restart.
        // Static voice state is restored by the next room_state message.
        setVoiceNarrator(null);
        setVoiceFileUrl(null);
        setIsVoiceStatic(false);
        scheduleReconnect();
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        setConnectionError(lang === 'ru'
          ? 'Ошибка подключения. Пожалуйста, попробуйте ещё раз.'
          : 'WebSocket connection error. Please try again.');
      };
      } catch (err: any) {
        console.error('Failed to create WebSocket:', err);
        scheduleReconnect();
      }
    };

    connect();

    return () => {
      shouldReconnect = false;
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
      }
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.close();
      }
    };
  }, [activeRoom, token, clientId, lang]);

  const requestRoomAccess = async (roomId: string, password: string, creating: boolean) => {
    const response = await fetch(`${API_BASE}/rooms/access`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ roomId, password, clientId, creating }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t.roomAccessError);
    return data.ticket as string;
  };

  const handleJoinRoom = async (roomId: string, password?: string) => {
    const accessTicket = password ? await requestRoomAccess(roomId, password, false) : undefined;
    setActiveRoom({ id: roomId, name: null, accessTicket });
  };

  const handleCreateRoom = async (roomName: string, duration: number, trackId: string, backgroundId: string, voiceTrackId?: string, password?: string) => {
    const roomId = generateId().slice(0, 8);
    const accessTicket = password ? await requestRoomAccess(roomId, password, true) : undefined;
    setActiveRoom({ id: roomId, name: roomName, duration, trackId, voiceTrackId, backgroundId, accessTicket });
  };

  const handleCreateEvent = async (event: {
    title: string;
    description: string;
    startsAt: number;
    duration: number;
    trackId: string;
    voiceTrackId?: string;
    backgroundId: string;
  }) => {
    const response = await fetch(`${API_BASE}/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t.eventCreateError);
    await fetchEvents();
  };

  const handleEventAttendance = async (eventId: string, attending: boolean) => {
    const response = await fetch(`${API_BASE}/events/${eventId}/attendance`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ attending }),
    });
    if (!response.ok) throw new Error(t.eventAttendanceError);
    setEvents((current) => current.map((event) => event.id === eventId ? {
      ...event,
      isAttending: attending,
      attendeeCount: Math.max(0, event.attendeeCount + (attending ? 1 : -1)),
    } : event));
  };

  const handleDeleteEvent = async (eventId: string) => {
    const response = await fetch(`${API_BASE}/events/${eventId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(t.eventDeleteError);
    setEvents((current) => current.filter((event) => event.id !== eventId));
  };

  const handleLeaveRoom = () => {
    leavingRoomRef.current = true;
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'leave', payload: {} }));
      }
      wsRef.current.close();
    }
    setActiveRoom(null);
    fetchRooms();
    // Refresh tracks so any newly recorded sessions appear immediately
    // Two fetches: first at 500ms (optimistic), second at 2500ms (catches async DB save)
    setTimeout(() => fetchTracks(), 500);
    setTimeout(() => fetchTracks(), 2500);
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
          } else if (data.error.includes('reserved')) {
            errorMsg = t.authErrorReserved;
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
      localStorage.setItem('zen_is_guest', 'false');
      setUsername(data.username);
      setToken(data.token);
      setIsGuest(false);
      setShowAuthModal(false);
      setAuthPassword('');
      setAuthError(null);
    } catch (err) {
      console.error('Auth error:', err);
      setAuthError(t.authErrorGeneric);
    }
  };

  const handleLogout = async () => {
    leavingRoomRef.current = true;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'leave', payload: {} }));
      wsRef.current.close();
    }
    if (token) {
      await fetch(`${API_BASE}/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      }).catch((err) => console.error('Logout request failed:', err));
    }
    localStorage.removeItem('zen_token');
    localStorage.removeItem('zen_username');
    localStorage.removeItem('zen_is_guest');
    setToken(null);
    setUsername('');
    setIsGuest(false);
    setAuthUsername('');
    setAuthPassword('');
    setActiveRoom(null);
    await startGuestSession();
  };

  // Shared sound library operations
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

  const handleStartMeditation = (trackId: string, duration: number, voiceTrackId?: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const msg = {
        type: 'start',
        payload: { trackId, duration, voiceTrackId },
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
      <div className="app-container app-loading">
        <div className="glow-orb glow-purple" />
        <div className="glow-orb glow-teal" />
        <div className="loading-state" role="status" aria-label={lang === 'ru' ? 'Загрузка' : 'Loading'}>
          <div className="brand-icon loading-mark" />
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="app-container auth-page">
        <div className="glow-orb glow-purple" />
        <div className="glow-orb glow-teal" />
        
        <header className="app-header auth-header">
          <div className="brand">
            <div className="brand-icon" />
            <span>ZenWorld</span>
          </div>
        </header>

        <div className="glass-panel auth-card">
          <div className="auth-intro">
          <h1>
            {showLogin ? t.loginTitle : t.registerTitle}
          </h1>
          <p>
            {t.welcomeDesc}
          </p>
          </div>

          <form onSubmit={handleAuthSubmit} className="auth-form">
            <div className="form-group">
              <label htmlFor="auth-username">
                {t.usernameLabel}
              </label>
              <input
                id="auth-username"
                type="text"
                placeholder={t.usernamePlaceholder}
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
                required
                autoComplete="username"
              />
            </div>

            <div className="form-group">
              <label htmlFor="auth-password">
                {t.passwordLabel}
              </label>
              <input
                id="auth-password"
                type="password"
                placeholder={t.passwordPlaceholder}
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                required
                autoComplete={showLogin ? 'current-password' : 'new-password'}
              />
            </div>

            {authError && (
              <div className="notice notice-error" role="alert">
                {authError}
              </div>
            )}

            <button type="submit" className="btn btn-primary auth-submit">
              {showLogin ? t.signInBtn : t.signUpBtn}
            </button>
          </form>

          <div className="auth-switch">
            <span>{showLogin ? t.noAccountPrompt : t.haveAccountPrompt} </span>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setShowLogin(!showLogin);
                setAuthError(null);
                setAuthPassword('');
              }}
            >
              {showLogin ? t.signUpBtn : t.signInBtn}
            </button>
          </div>
          <button
            type="button"
            className="btn btn-secondary auth-guest-retry"
            onClick={() => void startGuestSession()}
          >
            {t.continueAsGuest}
          </button>
        </div>
        
        {/* Language Selector at the bottom of login */}
        <div className="language-switcher auth-language" aria-label={lang === 'ru' ? 'Язык' : 'Language'}>
          <button 
            className={`language-option ${lang === 'ru' ? 'active' : ''}`}
            onClick={() => handleSetLang('ru')} 
          >
            RU
          </button>
          <button 
            className={`language-option ${lang === 'en' ? 'active' : ''}`}
            onClick={() => handleSetLang('en')} 
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
      <header className="app-header main-header">
        <button
          className="brand brand-button"
          onClick={() => {
            setShowAbout(false);
            handleLeaveRoom();
          }}
          aria-label="ZenWorld"
        >
          <div className="brand-icon" />
          <span>ZenWorld</span>
        </button>
        <div className="header-actions">
          {/* Language Selector */}
          <div className="language-switcher" aria-label={lang === 'ru' ? 'Язык' : 'Language'}>
            <button 
              className={`language-option ${lang === 'ru' ? 'active' : ''}`}
              onClick={() => handleSetLang('ru')} 
            >
              RU
            </button>
            <button 
              className={`language-option ${lang === 'en' ? 'active' : ''}`}
              onClick={() => handleSetLang('en')} 
            >
              EN
            </button>
          </div>
          {!activeRoom && token && (
            <button
              className={`btn btn-quiet ${showAbout ? 'active' : ''}`}
              onClick={() => setShowAbout((value) => !value)}
            >
              {lang === 'ru' ? 'О проекте' : 'About'}
            </button>
          )}
          {!activeRoom && token && !isGuest && (
            <button 
              className="btn btn-quiet"
              onClick={() => setShowAdminPanel(true)}
            >
              {t.adminAccessBtn}
            </button>
          )}
          {!activeRoom && token && (
            <div className="user-badge" style={{ gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div className="user-avatar">{username.charAt(0).toUpperCase()}</div>
                <span>
                  {username}
                  {isGuest && <small className="guest-label">{t.guestLabel}</small>}
                </span>
              </div>
              {isGuest ? (
                <button
                  className="btn btn-primary guest-register-button"
                  onClick={() => {
                    setShowLogin(false);
                    setAuthError(null);
                    setShowAuthModal(true);
                  }}
                >
                  {t.createAccountBtn}
                </button>
              ) : (
                <button
                  className="btn logout-button"
                  onClick={() => void handleLogout()}
                >
                  {t.logoutBtn}
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {connectionError && (
        <div className="notice notice-error connection-notice" role="alert">
          <span>{connectionError}</span>
          <button className="notice-close" onClick={() => setConnectionError(null)} aria-label="Dismiss">×</button>
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
              isVoiceStatic={isVoiceStatic}
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
        ) : showAbout ? (
          <AboutPage language={lang} onBack={() => setShowAbout(false)} />
        ) : (
          <>
            <section className="glass-panel welcome-panel">
              <div>
                <h1>{t.welcomeTitle}</h1>
                <p>{t.welcomeDesc}</p>
              </div>
              <div className="user-badge">
                <div className="user-avatar">{username.charAt(0).toUpperCase()}</div>
                <span>{username}</span>
              </div>
            </section>
            <EventPlanner
              events={events}
              tracks={tracks}
              backgrounds={backgrounds}
              username={username}
              onCreate={handleCreateEvent}
              onAttendance={handleEventAttendance}
              onDelete={handleDeleteEvent}
              onEnter={handleJoinRoom}
              requestedEventId={requestedEventId}
              onRequestedEventHandled={() => {
                setRequestedEventId(null);
                clearInvitationTarget('eventId');
              }}
              t={t}
            />
            <RoomList
              rooms={rooms}
              tracks={tracks}
              backgrounds={backgrounds}
              onJoinRoom={handleJoinRoom}
              onCreateRoom={handleCreateRoom}
              requestedRoomId={requestedRoomId}
              onRequestedRoomHandled={() => {
                setRequestedRoomId(null);
                clearInvitationTarget('roomId');
              }}
              t={t}
            />
            <GlobalChat
              apiBase={API_BASE}
              token={token}
              username={username}
              t={t}
            />
          </>
        )}
      </main>

      {showAuthModal && (
        <div className="modal-overlay auth-modal-overlay" onClick={() => setShowAuthModal(false)}>
          <div className="glass-panel auth-card auth-modal-card" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowAuthModal(false)} aria-label={t.closeAuth}>
              &times;
            </button>
            <div className="auth-intro">
              <span className="eyebrow">{t.guestAccountEyebrow}</span>
              <h2>{showLogin ? t.loginTitle : t.registerTitle}</h2>
              <p>{showLogin ? t.loginBenefit : t.registrationBenefit}</p>
            </div>

            <form onSubmit={handleAuthSubmit} className="auth-form">
              <div className="form-group">
                <label htmlFor="modal-auth-username">{t.usernameLabel}</label>
                <input
                  id="modal-auth-username"
                  type="text"
                  placeholder={t.usernamePlaceholder}
                  value={authUsername}
                  onChange={(event) => setAuthUsername(event.target.value)}
                  required
                  autoComplete="username"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label htmlFor="modal-auth-password">{t.passwordLabel}</label>
                <input
                  id="modal-auth-password"
                  type="password"
                  placeholder={t.passwordPlaceholder}
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  required
                  autoComplete={showLogin ? 'current-password' : 'new-password'}
                />
              </div>
              {authError && <div className="notice notice-error" role="alert">{authError}</div>}
              <button type="submit" className="btn btn-primary auth-submit">
                {showLogin ? t.signInBtn : t.signUpBtn}
              </button>
            </form>

            <div className="auth-switch">
              <span>{showLogin ? t.noAccountPrompt : t.haveAccountPrompt} </span>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setShowLogin(!showLogin);
                  setAuthError(null);
                  setAuthPassword('');
                }}
              >
                {showLogin ? t.signUpBtn : t.signInBtn}
              </button>
            </div>
            <button className="text-button auth-stay-guest" type="button" onClick={() => setShowAuthModal(false)}>
              {t.stayAsGuest}
            </button>
          </div>
        </div>
      )}

      {/* Admin Panel Modal Overlay */}
      {showAdminPanel && (
        <div className="admin-overlay" style={{
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
          <div className="glass-panel admin-panel" style={{
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
            <div className="admin-panel-header">
              <div>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: 'var(--font-heading)', marginBottom: '0.35rem' }}>
                  {t.adminPanelTitle}
                </h2>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                  {t.sharedLibraryDesc}
                </p>
              </div>
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

              <div className="span-2" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', gridColumn: 'span 2' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                  {t.trackFileLabel}
                </label>
                <div className="audio-file-picker">
                  <input
                    id="admin-track-file"
                    className="audio-file-input"
                    type="file"
                    accept="audio/mp3,audio/*"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        const selectedFile = e.target.files[0];
                        setTrackFile(selectedFile);

                        const audio = document.createElement('audio');
                        const objectUrl = URL.createObjectURL(selectedFile);
                        audio.preload = 'metadata';
                        audio.onloadedmetadata = () => {
                          if (Number.isFinite(audio.duration)) {
                            setTrackDuration(Math.ceil(audio.duration).toString());
                          }
                          URL.revokeObjectURL(objectUrl);
                        };
                        audio.onerror = () => URL.revokeObjectURL(objectUrl);
                        audio.src = objectUrl;
                      }
                    }}
                    required
                    disabled={isUploading}
                  />
                  <label htmlFor="admin-track-file" className="audio-file-button">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 18V5l12-2v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </svg>
                    <span>{t.chooseAudioFile}</span>
                  </label>
                  <span className={`audio-file-name ${trackFile ? 'selected' : ''}`} title={trackFile?.name}>
                    {trackFile?.name || t.audioFileNotSelected}
                  </span>
                </div>
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
                {sharedTracks.length === 0 ? (
                  <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', textAlign: 'center', padding: '1rem' }}>
                    {t.noTracksMsg}
                  </p>
                ) : (
                  sharedTracks.map((track) => (
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
                          {track.ownerUsername ? `${t.uploadedBy}: ${track.ownerUsername} • ` : `${track.artist} • `}
                          {Math.floor(track.duration / 60)}m {track.duration % 60}s
                        </div>
                      </div>
                      {(username === 'admin' || track.ownerUsername?.toLowerCase() === username.toLowerCase()) && (
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
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {username === 'admin' && token && (
              <BackgroundManager
                apiBase={API_BASE}
                token={token}
                backgrounds={backgrounds}
                onChanged={fetchBackgrounds}
                t={t}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
