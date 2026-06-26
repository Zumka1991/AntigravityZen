import React, { useState, useEffect, useRef } from 'react';
import type { RoomInfo, Track } from './RoomList';
import type { translations } from '../translations';

interface Message {
  type: string;
  username?: string;
  text?: string;
  timestamp: number;
}

interface MeditationRoomProps {
  roomState: RoomInfo & { clients: { id: string; username: string; isHost: boolean }[]; status: string; duration: number; startedAt: number; serverTime: number };
  clientId: string;
  username: string;
  tracks: Track[];
  messages: Message[];
  onSendMessage: (text: string) => void;
  onStartMeditation: (trackId: string, duration: number) => void;
  onStopMeditation: () => void;
  onLeaveRoom: () => void;
  t: typeof translations.en;
}

export const MeditationRoom: React.FC<MeditationRoomProps> = ({
  roomState,
  clientId,
  username,
  tracks,
  messages,
  onSendMessage,
  onStartMeditation,
  onStopMeditation,
  onLeaveRoom,
  t,
}) => {
  const [chatInput, setChatInput] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [breathPhase, setBreathPhase] = useState<'inhale' | 'exhale'>('inhale');
  const [breathScale, setBreathScale] = useState(1.0);
  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const isHost = roomState.hostId === clientId;
  const isPlaying = roomState.status === 'playing';

  // Configurable states for host before starting
  const [selectedTrackId, setSelectedTrackId] = useState(roomState.activeTrack?.id || tracks[0]?.id || '');
  const [selectedDuration, setSelectedDuration] = useState(roomState.duration || 60);

  const standardDurations = [30, 60, 300, 600, 900, 1200];
  const durationOptions = [...standardDurations];
  if (!durationOptions.includes(selectedDuration)) {
    durationOptions.push(selectedDuration);
    durationOptions.sort((a, b) => a - b);
  }

  const getDurationOptionLabel = (seconds: number) => {
    if (seconds === 30) return t.testDuration;
    if (seconds === 60) return t.minute1;
    if (seconds === 300) return t.minutes5;
    if (seconds === 600) return t.minutes10;
    if (seconds === 900) return t.minutes15;
    if (seconds === 1200) return t.minutes20;
    
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0 && secs > 0) {
      return `${mins} ${t.durationMinutes} ${secs} ${t.durationSeconds}`;
    } else if (mins > 0) {
      return `${mins} ${t.durationMinutes}`;
    } else {
      return `${secs} ${t.durationSeconds}`;
    }
  };

  const handleCopyLink = () => {
    const inviteUrl = `${window.location.origin}?roomId=${roomState.id}`;
    navigator.clipboard.writeText(inviteUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((err) => console.error('Could not copy text: ', err));
  };

  const serverOffsetRef = useRef(0);

  // Sync server offset when roomState update arrives
  useEffect(() => {
    if (roomState) {
      serverOffsetRef.current = roomState.serverTime - Date.now();
    }
  }, [roomState.serverTime]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Audio player synchronization
  useEffect(() => {
    const track = roomState.activeTrack;
    if (isPlaying && track) {
      // Calculate current elapsed time on server using our stable offset
      const currentServerTime = Date.now() + serverOffsetRef.current;
      const elapsedMs = currentServerTime - roomState.startedAt;
      const elapsedSeconds = Math.max(0, elapsedMs / 1000);

      if (elapsedSeconds < roomState.duration) {
        if (!audioRef.current) {
          audioRef.current = new Audio(track.audioUrl);
          audioRef.current.loop = true;
        } else if (audioRef.current.src !== track.audioUrl) {
          audioRef.current.src = track.audioUrl;
        }

        audioRef.current.muted = isMuted;
        audioRef.current.currentTime = elapsedSeconds;

        // Try to play audio
        audioRef.current.play()
          .then(() => {
            setAutoplayBlocked(false);
          })
          .catch((err) => {
            console.warn('Autoplay blocked:', err);
            setAutoplayBlocked(true);
          });
      } else {
        // Meditation already finished
        if (audioRef.current) {
          audioRef.current.pause();
        }
      }
    } else {
      // Not playing
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setAutoplayBlocked(false);
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, [isPlaying, roomState.activeTrack?.id, roomState.startedAt, roomState.duration]);

  // Handle mute/unmute
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
    }
  }, [isMuted]);

  // Sync state settings if host changed them in lobby
  useEffect(() => {
    if (!isPlaying) {
      if (roomState.activeTrack) {
        setSelectedTrackId(roomState.activeTrack.id);
      }
      if (roomState.duration) {
        setSelectedDuration(roomState.duration);
      }
    }
  }, [roomState.activeTrack?.id, roomState.duration, isPlaying]);

  // Real-time animation loop for remaining time & breathing visualizer
  useEffect(() => {
    let animationFrameId: number;

    const updateFrame = () => {
      if (isPlaying && roomState.startedAt) {
        const clientTimeNow = Date.now();
        const currentServerTime = clientTimeNow + serverOffsetRef.current;
        
        const elapsedMs = currentServerTime - roomState.startedAt;
        const elapsedSec = elapsedMs / 1000;
        
        const remaining = Math.max(0, roomState.duration - elapsedSec);
        setTimeRemaining(remaining);

        // Breathing calculations (5 seconds inhale, 5 seconds exhale)
        const breathCycle = 10; // total 10s cycle
        const cycleTime = elapsedSec % breathCycle;
        
        if (cycleTime < 5) {
          setBreathPhase('inhale');
          // Scale from 1.0 to 1.75
          const progress = cycleTime / 5;
          setBreathScale(1.0 + progress * 0.75);
        } else {
          setBreathPhase('exhale');
          // Scale from 1.75 down to 1.0
          const progress = (cycleTime - 5) / 5;
          setBreathScale(1.75 - progress * 0.75);
        }
      } else {
        setTimeRemaining(0);
        setBreathScale(1.0);
      }

      animationFrameId = requestAnimationFrame(updateFrame);
    };

    animationFrameId = requestAnimationFrame(updateFrame);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isPlaying, roomState.startedAt, roomState.duration]);

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (chatInput.trim()) {
      onSendMessage(chatInput.trim());
      setChatInput('');
    }
  };

  const forcePlayAudio = () => {
    if (audioRef.current && roomState.startedAt) {
      const currentServerTime = Date.now() + serverOffsetRef.current;
      const elapsedMs = currentServerTime - roomState.startedAt;
      const elapsedSeconds = Math.max(0, elapsedMs / 1000);

      try {
        audioRef.current.load();
        audioRef.current.currentTime = elapsedSeconds;
        audioRef.current.play()
          .then(() => {
            setAutoplayBlocked(false);
          })
          .catch(err => console.error("Force play failed:", err));
      } catch (err) {
        console.error("Error reloading and playing audio:", err);
      }
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Helper to translate track details
  const getTrackTitle = (track: Track | undefined) => {
    if (!track) return '';
    return (t as any)[track.id] || track.title;
  };

  return (
    <div className="room-grid">
      {/* Meditation Center Area */}
      <div className="glass-panel meditation-center">
        {/* Top left controls (Leave and Invite Link) */}
        <div style={{ position: 'absolute', top: '1.25rem', left: '1.25rem', display: 'flex', gap: '0.75rem', zIndex: 15 }}>
          <button 
            className="btn btn-secondary" 
            onClick={onLeaveRoom} 
            style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            {t.leaveRoom}
          </button>
          
          <button 
            className="btn btn-primary" 
            onClick={handleCopyLink} 
            style={{ 
              padding: '0.5rem 1rem', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.35rem',
              background: copied ? 'rgba(45, 212, 191, 0.2)' : 'var(--color-primary)',
              border: copied ? '1px solid var(--color-secondary)' : 'none',
              color: copied ? 'var(--color-secondary)' : '#06050e',
              transition: 'all 0.3s ease'
            }}
          >
            {copied ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                {t.linkCopied}
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>
                {t.copyLink}
              </>
            )}
          </button>
        </div>

        {/* Top right mute button (only shown when playing) */}
        {isPlaying && (
          <button
            className="btn btn-secondary"
            onClick={() => setIsMuted(!isMuted)}
            style={{ position: 'absolute', top: '1.25rem', right: '1.25rem', padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.35rem', zIndex: 15 }}
          >
            {isMuted ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
                {t.unmuteAudio}
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                {t.muteAudio}
              </>
            )}
          </button>
        )}

        {/* Meditation Player Active State */}
        {isPlaying ? (
          <div className="meditation-stage">
            <div className="track-info">
              <h2>{getTrackTitle(roomState.activeTrack)}</h2>
              <p>by {roomState.activeTrack?.artist}</p>
            </div>

            {/* Pulsing Breathing Ring */}
            <div className="visualizer-container">
              <div 
                className="breathing-ring" 
                style={{ 
                  transform: `scale(${breathScale})`, 
                  borderColor: breathPhase === 'inhale' ? 'rgba(45, 212, 191, 0.25)' : 'rgba(167, 139, 250, 0.25)',
                  boxShadow: breathPhase === 'inhale' ? '0 0 30px rgba(45, 212, 191, 0.15)' : '0 0 30px rgba(167, 139, 250, 0.15)'
                }}
              />
              <div 
                className="breathing-core"
                style={{
                  transform: `scale(${1 + (breathScale - 1) * 0.3})`,
                  background: breathPhase === 'inhale' 
                    ? 'linear-gradient(135deg, var(--color-secondary) 0%, var(--color-primary) 100%)'
                    : 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%)',
                }}
              >
                <div className="timer-display">
                  {formatTime(timeRemaining)}
                </div>
              </div>
            </div>

            {/* Breath Instruction Prompt */}
            <div className="breath-prompt" style={{ color: breathPhase === 'inhale' ? 'var(--color-secondary)' : 'var(--color-primary)' }}>
              {breathPhase === 'inhale' ? t.breatheIn : t.breatheOut}
            </div>

            {/* Autoplay Warning Banner */}
            {autoplayBlocked && (
              <div className="glass-panel" style={{ padding: '1rem', border: '1px solid var(--color-primary)', background: 'rgba(167, 139, 250, 0.05)', display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center', maxWidth: '300px' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-primary)', fontWeight: 600 }}>{t.audioBlocked}</span>
                <button className="btn btn-primary" onClick={forcePlayAudio} style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', borderRadius: '8px' }}>
                  {t.enableSoundSync}
                </button>
              </div>
            )}

            {/* Host Stop Button */}
            {isHost && (
              <button 
                className="btn btn-secondary" 
                onClick={onStopMeditation}
                style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)', padding: '0.6rem 1.5rem', fontSize: '0.9rem', marginTop: '1rem' }}
              >
                {t.endSessionEarly}
              </button>
            )}
          </div>
        ) : (
          /* Lobby / Meditation Config Screen */
          <div className="meditation-start-screen">
            <div className="brand-icon" style={{ width: '64px', height: '64px', marginBottom: '1rem' }} />
            <h2>{t.prepareMeditation}</h2>
            
            {isHost ? (
              <div className="lobby-controls" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', maxWidth: '360px', margin: '0 auto' }}>
                <p style={{ color: 'var(--color-text-secondary)', textAlign: 'center', fontSize: '0.95rem', marginBottom: '0.5rem' }}>
                  {t.hostInstructions}
                </p>

                {showSettings ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
                    <div className="setting-row">
                      <div className="form-group">
                        <label>{t.durationSetting}</label>
                        <select value={selectedDuration} onChange={(e) => setSelectedDuration(Number(e.target.value))}>
                          {durationOptions.map(val => (
                            <option key={val} value={val}>
                              {getDurationOptionLabel(val)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="form-group" style={{ width: '100%' }}>
                      <label>{t.backgroundSoundSetting}</label>
                      <select value={selectedTrackId} onChange={(e) => setSelectedTrackId(e.target.value)}>
                        {tracks.map(tOption => (
                          <option key={tOption.id} value={tOption.id}>
                            {(t as any)[tOption.id] || tOption.title} ({Math.floor(tOption.duration/60)}m)
                          </option>
                        ))}
                      </select>
                    </div>

                    <button 
                      className="btn btn-secondary" 
                      onClick={() => setShowSettings(false)}
                      style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', borderRadius: '10px', alignSelf: 'center' }}
                    >
                      {t.collapseSettings}
                    </button>
                  </div>
                ) : (
                  <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.04)', borderRadius: '12px' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                      {t.selectedSettings}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.95rem' }}>
                        <span>⏱️</span>
                        <span style={{ color: 'var(--color-text-primary)' }}>{getDurationOptionLabel(selectedDuration)}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.95rem' }}>
                        <span>🎵</span>
                        <span style={{ color: 'var(--color-text-primary)' }}>
                          {getTrackTitle(tracks.find(tr => tr.id === selectedTrackId))}
                        </span>
                      </div>
                    </div>
                    <button 
                      className="btn btn-secondary" 
                      onClick={() => setShowSettings(true)}
                      style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', borderRadius: '10px', alignSelf: 'center', marginTop: '0.25rem' }}
                    >
                      {t.changeSettings}
                    </button>
                  </div>
                )}

                <button 
                  className="btn btn-primary" 
                  onClick={() => onStartMeditation(selectedTrackId, selectedDuration)}
                  style={{ width: '100%', marginTop: '0.5rem', padding: '0.9rem' }}
                >
                  {t.startSessionBtn}
                </button>
              </div>
            ) : (
              <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: '1rem' }}>
                  {t.participantWaitPrompt}
                </p>
                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-primary)', animation: 'pulseLight 1s infinite alternate' }} />
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-primary)', animation: 'pulseLight 1s infinite alternate 0.2s' }} />
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-primary)', animation: 'pulseLight 1s infinite alternate 0.4s' }} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Side Panel: Members & Chat */}
      <div className="side-panel">
        {/* Members panel */}
        <div className="glass-panel panel-section">
          <div className="panel-header">{t.participantsTitle} ({roomState.clients.length})</div>
          <div className="member-list">
            {roomState.clients.map((member) => (
              <div key={member.id} className="member-item" style={{ background: member.id === clientId ? 'rgba(255, 255, 255, 0.02)' : 'transparent' }}>
                <div className="user-avatar" style={{ background: member.isHost ? 'var(--color-primary)' : 'rgba(255, 255, 255, 0.08)', color: member.isHost ? '#06050e' : 'white' }}>
                  {member.username.charAt(0).toUpperCase()}
                </div>
                <span className="member-name" style={{ fontWeight: member.id === clientId ? 600 : 400 }}>
                  {member.username} {member.id === clientId && t.youTag}
                </span>
                {member.isHost && <span className="member-role">{t.hostTag}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Chat panel */}
        <div className="glass-panel panel-section">
          <div className="panel-header">{t.roomChatTitle}</div>
          <div className="chat-container">
            <div className="chat-messages">
              {messages.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', fontSize: '0.8rem', textAlign: 'center' }}>
                  {t.chatWelcome}
                </div>
              ) : (
                messages.map((msg, index) => {
                  const isSelf = msg.username === username;
                  return (
                    <div key={index} className={`chat-message ${isSelf ? 'self' : ''}`}>
                      <div className="chat-msg-header">
                        {!isSelf && <span style={{ fontWeight: 600 }}>{msg.username}</span>}
                        <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div className="chat-msg-bubble">
                        {msg.text}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatBottomRef} />
            </div>

            <form onSubmit={handleSendChat} className="chat-input-area">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={t.chatPlaceholder}
                maxLength={100}
              />
              <button type="submit" className="btn btn-primary" style={{ padding: '0.5rem 1rem', borderRadius: '12px' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
