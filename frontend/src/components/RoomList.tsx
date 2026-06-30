import React, { useState } from 'react';
import type { translations } from '../translations';

export interface Track {
  id: string;
  title: string;
  artist: string;
  audioUrl: string;
  duration: number;
  ownerUsername?: string;
  isPublic: boolean;
}

export interface MeditationBackground {
  id: string;
  title: string;
  imageUrl: string;
  isDefault: boolean;
  uploadedBy?: string;
}

export interface RoomInfo {
  id: string;
  name: string;
  hostId: string;
  memberCount: number;
  status: string;
  activeTrack?: Track;
  background?: MeditationBackground;
  isProtected: boolean;
}

interface RoomListProps {
  rooms: RoomInfo[];
  tracks: Track[];
  backgrounds: MeditationBackground[];
  username: string;
  onJoinRoom: (roomId: string, password?: string) => Promise<void>;
  onCreateRoom: (roomName: string, duration: number, trackId: string, backgroundId: string, voiceTrackId?: string, password?: string) => Promise<void>;
  requestedRoomId?: string | null;
  onRequestedRoomHandled?: () => void;
  t: typeof translations.en;
}

export const RoomList: React.FC<RoomListProps> = ({
  rooms,
  tracks,
  backgrounds,
  username,
  onJoinRoom,
  onCreateRoom,
  requestedRoomId,
  onRequestedRoomHandled,
  t,
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [protectRoom, setProtectRoom] = useState(false);
  const [roomPassword, setRoomPassword] = useState('');
  const [joinTarget, setJoinTarget] = useState<RoomInfo | null>(null);
  const [joinPassword, setJoinPassword] = useState('');
  const [accessError, setAccessError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [duration, setDuration] = useState(60);
  const ambientTracks = tracks.filter(t => !t.ownerUsername || t.isPublic);
  const recordedTracks = tracks.filter(t => !!t.ownerUsername && !t.isPublic);
  const [selectedTrackId, setSelectedTrackId] = useState(ambientTracks[0]?.id || '');
  const [selectedVoiceTrackId, setSelectedVoiceTrackId] = useState<string>('none');
  const [selectedBackgroundId, setSelectedBackgroundId] = useState(backgrounds[0]?.id || '');
  const [openCreationSection, setOpenCreationSection] = useState<'sound' | 'background' | 'voice' | null>('sound');
  const [previewTrackId, setPreviewTrackId] = useState<string | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  const formatDurationText = (seconds: number) => {
    if (seconds < 60) {
      return `${seconds}${t.durationSeconds}`;
    }
    const mins = Math.floor(seconds / 60);
    const hrText = t.durationMinutes === 'мин' ? 'ч' : 'h';
    const minText = t.durationMinutes === 'мин' ? 'мин' : 'm';
    
    if (mins >= 60) {
      const hours = Math.floor(mins / 60);
      const remainingMins = mins % 60;
      return remainingMins > 0 
        ? `${hours} ${hrText} ${remainingMins} ${minText}`
        : `${hours} ${hrText}`;
    }
    return `${mins} ${t.durationMinutes}`;
  };

  // Stop audio when modal closes or component unmounts
  React.useEffect(() => {
    if (!showCreateModal) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPreviewTrackId(null);
    }
  }, [showCreateModal]);

  React.useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const togglePreview = (track: Track, e: React.MouseEvent) => {
    e.stopPropagation(); // Предотвращаем выбор трека при клике на прослушивание

    if (previewTrackId === track.id) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPreviewTrackId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      
      const audio = new Audio(track.audioUrl);
      audio.volume = 0.5;
      audioRef.current = audio;
      audio.play().catch(err => console.error("Audio preview play failed:", err));
      setPreviewTrackId(track.id);

      audio.onended = () => {
        setPreviewTrackId(null);
      };
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim()) return;
    const voiceId = selectedVoiceTrackId !== 'none' ? selectedVoiceTrackId : undefined;
    setIsSubmitting(true);
    setAccessError('');
    try {
      await onCreateRoom(roomName.trim(), duration, selectedTrackId, selectedBackgroundId, voiceId, protectRoom ? roomPassword : undefined);
      setShowCreateModal(false);
      setRoomName('');
      setRoomPassword('');
      setProtectRoom(false);
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : t.roomAccessError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJoin = async (room: RoomInfo, password?: string) => {
    if (room.isProtected && !password) {
      setJoinTarget(room);
      setAccessError('');
      return;
    }
    setIsSubmitting(true);
    setAccessError('');
    try {
      await onJoinRoom(room.id, password);
      setJoinTarget(null);
      setJoinPassword('');
    } catch {
      setAccessError(t.incorrectRoomPassword);
    } finally {
      setIsSubmitting(false);
    }
  };

  React.useEffect(() => {
    if (!requestedRoomId) return;
    const requestedRoom = rooms.find((room) => room.id === requestedRoomId);
    if (!requestedRoom) return;
    onRequestedRoomHandled?.();
    void handleJoin(requestedRoom);
  }, [requestedRoomId, rooms]);

  // Helper to translate track names
  const getTrackTitle = (track: Track | undefined) => {
    if (!track) return '';
    return (t as any)[track.id] || track.title;
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'lobby': return t.lobbyStatus;
      case 'playing': return t.meditatingStatus;
      case 'finished': return t.endedStatus;
      default: return status;
    }
  };

  return (
    <div className="lobby-page">
      {/* Welcome / Username Banner */}
      <section className="glass-panel welcome-panel">
        <div>
          <h1>{t.welcomeTitle}</h1>
          <p>{t.welcomeDesc}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div className="user-badge">
            <div className="user-avatar">{username.charAt(0).toUpperCase()}</div>
            <span>{username}</span>
          </div>
        </div>
      </section>

      {/* Title & Actions */}
      <div className="section-heading">
        <div>
          <span className="eyebrow">{rooms.length} · {t.globalChatLive}</span>
          <h2>{t.activeRooms}</h2>
        </div>
        <button className="btn btn-primary" onClick={() => {
          if (ambientTracks.length > 0 && !selectedTrackId) {
            setSelectedTrackId(ambientTracks[0].id);
          }
          if (backgrounds.length > 0 && !selectedBackgroundId) {
            setSelectedBackgroundId(backgrounds[0].id);
          }
          setShowCreateModal(true);
        }}>
          {t.createRoomBtn}
        </button>
      </div>

      {/* Rooms Grid */}
      {rooms.length === 0 ? (
        <div className="glass-panel empty-state">
          <div className="empty-state-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
          </div>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: '0.25rem' }}>{t.noActiveRooms}</h3>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>{t.firstRoomPrompt}</p>
          </div>
        </div>
      ) : (
        <div className="rooms-grid">
          {rooms.map((room) => (
            <div key={room.id} className="room-card glass-panel">
              <div className="room-card-header">
                <h3>{room.name}</h3>
                <div className="room-card-badges">
                  {room.isProtected && <span className="protected-badge" title={t.protectedRoom}>⌁ {t.privateRoom}</span>}
                  <span className={`status-badge ${room.status}`}>{getStatusText(room.status)}</span>
                </div>
              </div>

              <div className="room-card-meta">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                  <span>{room.memberCount} {t.membersActive}</span>
                </div>
                {room.activeTrack && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--color-primary)' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
                    <span>{getTrackTitle(room.activeTrack)}</span>
                  </div>
                )}
              </div>

              <div className="room-card-footer">
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                  {room.status === 'playing' ? t.meditationInProgress : t.waitingForHost}
                </span>
                <button
                  className="btn btn-primary"
                  onClick={() => handleJoin(room)}
                  style={{ padding: '0.5rem 1.25rem', fontSize: '0.9rem', borderRadius: '10px' }}
                >
                  {t.joinRoom}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Room Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowCreateModal(false)}>&times;</button>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '0.75rem' }}>{t.createRoomModalTitle}</h2>
            
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="form-group">
                <label htmlFor="room-name">{t.roomNameLabel}</label>
                <input
                  id="room-name"
                  type="text"
                  placeholder={t.roomNamePlaceholder}
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className={`room-protection ${protectRoom ? 'enabled' : ''}`}>
                <label className="room-protection-toggle">
                  <input
                    type="checkbox"
                    checked={protectRoom}
                    onChange={(event) => {
                      setProtectRoom(event.target.checked);
                      setAccessError('');
                    }}
                  />
                  <span className="toggle-track" aria-hidden="true"><span /></span>
                  <span>
                    <strong>{t.protectRoom}</strong>
                    <small>{t.protectRoomHint}</small>
                  </span>
                </label>
                {protectRoom && (
                  <input
                    type="password"
                    name="new-room-access-code"
                    value={roomPassword}
                    onChange={(event) => setRoomPassword(event.target.value)}
                    placeholder={t.roomPasswordPlaceholder}
                    minLength={4}
                    required
                    autoComplete="new-password"
                    data-1p-ignore
                    data-lpignore="true"
                    data-bwignore="true"
                  />
                )}
              </div>

              <div className="form-group">
                <label>{t.durationLabel}: {formatDurationText(duration)}</label>
                <input
                  type="range"
                  min="30"
                  max="7200"
                  step="30"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  style={{ cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                />
                <div style={{ position: 'relative', height: '1.2rem', fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '0.2rem' }}>
                  <span style={{ position: 'absolute', left: '0%' }}>30{t.durationSeconds}</span>
                  <span style={{ position: 'absolute', left: '25%', transform: 'translateX(-50%)' }}>30{t.durationMinutes}</span>
                  <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>1{t.durationMinutes === 'мин' ? 'ч' : 'h'}</span>
                  <span style={{ position: 'absolute', right: '0%' }}>2{t.durationMinutes === 'мин' ? 'ч' : 'h'}</span>
                </div>
              </div>

              <div className={`creation-accordion ${openCreationSection === 'sound' ? 'open' : ''}`}>
                <button
                  type="button"
                  className="creation-accordion-trigger"
                  onClick={() => setOpenCreationSection(openCreationSection === 'sound' ? null : 'sound')}
                >
                  <span>
                    <strong>♫ {t.selectSoundscape}</strong>
                    <small>{getTrackTitle(ambientTracks.find((track) => track.id === selectedTrackId))}</small>
                  </span>
                  <span className="creation-accordion-chevron">⌄</span>
                </button>
                {openCreationSection === 'sound' && (
                  <div className="creation-accordion-content">
                    <div className="track-selector">
                  {ambientTracks.map((track) => (
                    <div
                      key={track.id}
                      className={`track-option ${selectedTrackId === track.id ? 'selected' : ''}`}
                      onClick={() => setSelectedTrackId(track.id)}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{getTrackTitle(track)}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{track.artist}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <button
                          type="button"
                          className="btn"
                          onClick={(e) => togglePreview(track, e)}
                          style={{
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.75rem',
                            borderRadius: '6px',
                            background: previewTrackId === track.id ? 'var(--color-accent)' : 'rgba(255, 255, 255, 0.05)',
                            color: '#fff',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem'
                          }}
                        >
                          {previewTrackId === track.id ? (
                            <>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"></rect></svg>
                              <span>{t.stopPreviewBtn}</span>
                            </>
                          ) : (
                            <>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>
                              <span>{t.previewBtn}</span>
                            </>
                          )}
                        </button>
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                          {Math.floor(track.duration / 60)}:{(track.duration % 60).toString().padStart(2, '0')}
                        </span>
                      </div>
                    </div>
                  ))}
                    </div>
                  </div>
                )}
              </div>

              <div className={`creation-accordion ${openCreationSection === 'background' ? 'open' : ''}`}>
                <button
                  type="button"
                  className="creation-accordion-trigger"
                  onClick={() => setOpenCreationSection(openCreationSection === 'background' ? null : 'background')}
                >
                  <span>
                    <strong>▧ {t.selectBackground}</strong>
                    <small>
                      {(t as any)[selectedBackgroundId]
                        || backgrounds.find((background) => background.id === selectedBackgroundId)?.title}
                    </small>
                  </span>
                  <span className="creation-accordion-chevron">⌄</span>
                </button>
                {openCreationSection === 'background' && (
                  <div className="creation-accordion-content">
                    <div className="background-selector">
                  {backgrounds.map((background) => (
                    <button
                      key={background.id}
                      type="button"
                      className={`background-option ${selectedBackgroundId === background.id ? 'selected' : ''}`}
                      onClick={() => setSelectedBackgroundId(background.id)}
                      style={{ backgroundImage: `url("${background.imageUrl}")` }}
                    >
                      <span>{(t as any)[background.id] || background.title}</span>
                    </button>
                  ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Voice Accompaniment Selector */}
              <div className={`creation-accordion ${openCreationSection === 'voice' ? 'open' : ''}`}>
                <button
                  type="button"
                  className="creation-accordion-trigger"
                  onClick={() => setOpenCreationSection(openCreationSection === 'voice' ? null : 'voice')}
                >
                  <span>
                    <strong>🎙️ {t.durationMinutes === 'мин' ? 'Голосовое сопровождение' : 'Voice Accompaniment'}</strong>
                    <small>
                      {selectedVoiceTrackId === 'none'
                        ? (t.durationMinutes === 'мин' ? 'Без голоса' : 'No voice')
                        : tracks.find((track) => track.id === selectedVoiceTrackId)?.title}
                    </small>
                  </span>
                  <span className="creation-accordion-chevron">⌄</span>
                </button>
                {openCreationSection === 'voice' && (
                  <div className="creation-accordion-content">
                {recordedTracks.length === 0 ? (
                  <div style={{
                    padding: '0.85rem 1rem',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px dashed rgba(255, 255, 255, 0.08)',
                    borderRadius: '10px',
                    fontSize: '0.82rem',
                    color: 'var(--color-text-secondary)',
                    textAlign: 'center',
                    lineHeight: '1.5'
                  }}>
                    {t.durationMinutes === 'мин'
                      ? 'Нет записанных медитаций. Войдите в комнату как диктор и запишите сессию.'
                      : 'No recorded meditations yet. Enter a room as host and record a session.'}
                  </div>
                ) : (
                  <div className="track-selector">
                    {/* "No voice" option */}
                    <div
                      className={`track-option ${selectedVoiceTrackId === 'none' ? 'selected' : ''}`}
                      onClick={() => setSelectedVoiceTrackId('none')}
                      style={{ opacity: 0.7 }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                          🔇 {t.durationMinutes === 'мин' ? 'Без голоса (только музыка)' : 'No Voice (Music Only)'}
                        </div>
                      </div>
                    </div>

                    {recordedTracks.map((track) => (
                      <div
                        key={track.id}
                        className={`track-option ${selectedVoiceTrackId === track.id ? 'selected' : ''}`}
                        onClick={() => setSelectedVoiceTrackId(track.id)}
                      >
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>💾 {track.title}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                            {track.ownerUsername} • {Math.floor(track.duration / 60)}:{(track.duration % 60).toString().padStart(2, '0')}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <button
                            type="button"
                            className="btn"
                            onClick={(e) => togglePreview(track, e)}
                            style={{
                              padding: '0.25rem 0.5rem',
                              fontSize: '0.75rem',
                              borderRadius: '6px',
                              background: previewTrackId === track.id ? 'var(--color-accent)' : 'rgba(255, 255, 255, 0.05)',
                              color: '#fff',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.25rem'
                            }}
                          >
                            {previewTrackId === track.id ? (
                              <>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"></rect></svg>
                                <span>{t.stopPreviewBtn}</span>
                              </>
                            ) : (
                              <>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>
                                <span>{t.previewBtn}</span>
                              </>
                            )}
                          </button>
                          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                            {Math.floor(track.duration / 60)}:{(track.duration % 60).toString().padStart(2, '0')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                  </div>
                )}
              </div>

              {accessError && <div className="notice notice-error">{accessError}</div>}
              <button type="submit" className="btn btn-primary" disabled={isSubmitting} style={{ marginTop: '0.5rem' }}>
                {t.createAndEnterRoom}
              </button>
            </form>
          </div>
        </div>
      )}

      {joinTarget && (
        <div className="modal-overlay" onClick={() => setJoinTarget(null)}>
          <div className="modal-content glass-panel password-modal" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setJoinTarget(null)}>&times;</button>
            <div className="password-modal-icon">⌁</div>
            <h2>{t.enterRoomPassword}</h2>
            <p>{t.enterRoomPasswordHint.replace('{room}', joinTarget.name)}</p>
            <form onSubmit={(event) => {
              event.preventDefault();
              handleJoin(joinTarget, joinPassword);
            }}>
              <input
                type="password"
                name="room-access-code"
                value={joinPassword}
                onChange={(event) => setJoinPassword(event.target.value)}
                placeholder={t.roomPasswordPlaceholder}
                autoFocus
                required
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore="true"
              />
              {accessError && <div className="notice notice-error">{accessError}</div>}
              <button className="btn btn-primary" disabled={isSubmitting}>{t.unlockRoom}</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
