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
          <span style={{ fontSize: '1.2rem', marginRight: '0.25rem' }}>+</span> {t.createRoomBtn}
        </button>
      </div>

      {/* Rooms Grid */}
      {rooms.length === 0 ? (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          <p style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>{t.noActiveRooms}</p>
          <p style={{ fontSize: '0.9rem' }}>{t.firstRoomPrompt}</p>
        </div>
      ) : (
        <div className="rooms-grid">
          {rooms.map((room) => (
            <div key={room.id} className="glass-panel room-card">
              <div className="room-card-header">
                <div>
                  <h3>{room.name}</h3>
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>ID: {room.id}</span>
                </div>
                <span className={`badge-status ${room.status}`}>
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
                <label>{t.durationLabel}: {duration / 60} {t.durationMinutes} ({duration}{t.durationSeconds})</label>
                <input
                  type="range"
                  min="30"
                  max="1200"
                  step="30"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  style={{ cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                  <span>30{t.durationSeconds}</span>
                  <span>5{t.durationMinutes}</span>
                  <span>10{t.durationMinutes}</span>
                  <span>20{t.durationMinutes}</span>
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
                      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                        {Math.floor(track.duration / 60)}:{(track.duration % 60).toString().padStart(2, '0')}
                      </span>
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
