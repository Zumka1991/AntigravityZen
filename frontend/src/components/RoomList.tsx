import React, { useState } from 'react';
import type { translations } from '../translations';

export interface Track {
  id: string;
  title: string;
  artist: string;
  audioUrl: string;
  duration: number;
}

export interface RoomInfo {
  id: string;
  name: string;
  hostId: string;
  memberCount: number;
  status: string;
  activeTrack?: Track;
}

interface RoomListProps {
  rooms: RoomInfo[];
  tracks: Track[];
  username: string;
  onJoinRoom: (roomId: string) => void;
  onCreateRoom: (roomName: string, duration: number, trackId: string) => void;
  t: typeof translations.en;
}

export const RoomList: React.FC<RoomListProps> = ({
  rooms,
  tracks,
  username,
  onJoinRoom,
  onCreateRoom,
  t,
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [duration, setDuration] = useState(60);
  const [selectedTrackId, setSelectedTrackId] = useState(tracks[0]?.id || '');
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

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim()) return;
    onCreateRoom(roomName.trim(), duration, selectedTrackId);
    setShowCreateModal(false);
    setRoomName('');
  };

  // Helper to translate track names
  const getTrackTitle = (track: Track) => {
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
    <div style={{ position: 'relative', zIndex: 10 }}>
      {/* Welcome / Username Banner */}
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.25rem' }}>{t.welcomeTitle}</h2>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>{t.welcomeDesc}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div className="user-badge">
            <div className="user-avatar">{username.charAt(0).toUpperCase()}</div>
            <span>{username}</span>
          </div>
        </div>
      </div>

      {/* Title & Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 700 }}>{t.activeRooms}</h2>
        <button className="btn btn-primary" onClick={() => {
          if (tracks.length > 0 && !selectedTrackId) {
            setSelectedTrackId(tracks[0].id);
          }
          setShowCreateModal(true);
        }}>
          {t.createRoomBtn}
        </button>
      </div>

      {/* Rooms Grid */}
      {rooms.length === 0 ? (
        <div className="glass-panel" style={{ padding: '4rem 2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.05)' }}>
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
                <span className={`status-badge ${room.status}`}>
                  {getStatusText(room.status)}
                </span>
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
                  onClick={() => onJoinRoom(room.id)}
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

              <div className="form-group">
                <label>{t.selectSoundscape}</label>
                <div className="track-selector">
                  {tracks.map((track) => (
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

              <button type="submit" className="btn btn-primary" style={{ marginTop: '0.5rem' }}>
                {t.createAndEnterRoom}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
