import { useEffect, useMemo, useRef, useState } from 'react';
import type { MeditationBackground, Track } from './RoomList';
import type { translations } from '../translations';

export interface MeditationEvent {
  id: string;
  title: string;
  description: string;
  hostUsername: string;
  roomId: string;
  startsAt: number;
  duration: number;
  trackId?: string;
  voiceTrackId?: string;
  backgroundId?: string;
  attendeeCount: number;
  isAttending: boolean;
  hostPresent: boolean;
  roomStatus?: string;
}

interface EventPlannerProps {
  events: MeditationEvent[];
  tracks: Track[];
  backgrounds: MeditationBackground[];
  username: string;
  onCreate: (event: {
    title: string;
    description: string;
    startsAt: number;
    duration: number;
    trackId: string;
    voiceTrackId?: string;
    backgroundId: string;
  }) => Promise<void>;
  onAttendance: (eventId: string, attending: boolean) => Promise<void>;
  onDelete: (eventId: string) => Promise<void>;
  onEnter: (roomId: string) => Promise<void>;
  t: typeof translations.en;
}

const toLocalDateTimeValue = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

export function EventPlanner({
  events,
  tracks,
  backgrounds,
  username,
  onCreate,
  onAttendance,
  onDelete,
  onEnter,
  t,
}: EventPlannerProps) {
  const [now, setNow] = useState(Date.now());
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(20, 0, 0, 0);
    return toLocalDateTimeValue(tomorrow);
  });
  const [duration, setDuration] = useState(20 * 60);
  const [trackId, setTrackId] = useState('');
  const [voiceTrackId, setVoiceTrackId] = useState('none');
  const [backgroundId, setBackgroundId] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [openSection, setOpenSection] = useState<'sound' | 'background' | 'voice' | null>('sound');
  const [previewTrackId, setPreviewTrackId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const ambientTracks = useMemo(
    () => tracks.filter((track) => !track.ownerUsername || track.isPublic),
    [tracks],
  );
  const recordedTracks = useMemo(
    () => tracks.filter((track) => !!track.ownerUsername && !track.isPublic),
    [tracks],
  );
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeZoneLabel = useMemo(() => {
    const part = new Intl.DateTimeFormat(t.eventLocale, { timeZoneName: 'short' })
      .formatToParts(now)
      .find((item) => item.type === 'timeZoneName');
    return part?.value || timeZone;
  }, [now, t.eventLocale, timeZone]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const pageSize = 3;
  const currentEvents = events;
  const pageCount = Math.max(1, Math.ceil(currentEvents.length / pageSize));
  const visibleEvents = currentEvents.slice(page * pageSize, (page + 1) * pageSize);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  useEffect(() => {
    if (!trackId && ambientTracks[0]) setTrackId(ambientTracks[0].id);
    if (!backgroundId && backgrounds[0]) setBackgroundId(backgrounds[0].id);
  }, [ambientTracks, backgrounds, trackId, backgroundId]);

  useEffect(() => {
    if (!showCreate && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPreviewTrackId(null);
    }
  }, [showCreate]);

  useEffect(() => () => audioRef.current?.pause(), []);

  const togglePreview = (track: Track, clickEvent: React.MouseEvent) => {
    clickEvent.stopPropagation();
    audioRef.current?.pause();
    if (previewTrackId === track.id) {
      audioRef.current = null;
      setPreviewTrackId(null);
      return;
    }
    const audio = new Audio(track.audioUrl);
    audio.volume = 0.5;
    audio.onended = () => setPreviewTrackId(null);
    audio.play().catch(() => setPreviewTrackId(null));
    audioRef.current = audio;
    setPreviewTrackId(track.id);
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds} ${t.durationSeconds}`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} ${t.durationMinutes}`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `${hours} ${t.eventHours}${rest ? ` ${rest} ${t.durationMinutes}` : ''}`;
  };

  const formatDate = (timestamp: number) =>
    new Intl.DateTimeFormat(t.eventLocale, {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(timestamp);

  const getTiming = (event: MeditationEvent) => {
    if (event.roomStatus === 'playing') return { live: true, label: t.meditationInProgress };
    const delta = event.startsAt - now;
    if (delta <= 0) return {
      live: true,
      label: event.hostPresent ? t.eventWaitingToStart : t.eventHostAbsent,
    };
    const minutes = Math.ceil(delta / 60_000);
    if (minutes < 60) return { live: false, label: t.eventInMinutes.replace('{count}', String(minutes)) };
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return { live: false, label: t.eventInHours.replace('{count}', String(hours)) };
    return { live: false, label: formatDate(event.startsAt) };
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setPendingId('create');
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim(),
        startsAt: new Date(startsAt).getTime(),
        duration,
        trackId,
        voiceTrackId: voiceTrackId === 'none' ? undefined : voiceTrackId,
        backgroundId,
      });
      setTitle('');
      setDescription('');
      setShowCreate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.eventCreateError);
    } finally {
      setPendingId(null);
    }
  };

  const toggleAttendance = async (event: MeditationEvent) => {
    setPendingId(event.id);
    setError('');
    try {
      await onAttendance(event.id, !event.isAttending);
    } catch {
      setError(t.eventAttendanceError);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section className="planner-section">
      <div className="section-heading planner-heading">
        <div>
          <span className="eyebrow">{t.eventEyebrow}</span>
          <h2>{t.eventPlannerTitle}</h2>
          <p>{t.eventPlannerDescription}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <span aria-hidden="true">＋</span> {t.createEvent}
        </button>
      </div>

      {error && <div className="notice notice-error planner-notice">{error}</div>}

      {currentEvents.length === 0 ? (
        <div className="glass-panel planner-empty">
          <div className="planner-calendar-icon" aria-hidden="true">◷</div>
          <div>
            <h3>{t.noEvents}</h3>
            <p>{t.noEventsHint}</p>
          </div>
        </div>
      ) : (
        <div className="event-list">
          {visibleEvents.map((event, index) => {
            const timing = getTiming(event);
            const isHost = event.hostUsername.toLowerCase() === username.toLowerCase();
            const track = tracks.find((item) => item.id === event.trackId);
            const voiceTrack = tracks.find((item) => item.id === event.voiceTrackId);
            return (
              <article
                className={`glass-panel event-card ${timing.live ? 'is-live' : ''} ${index === 0 ? 'is-next' : ''}`}
                key={event.id}
              >
                <div className="event-date-block" title={t.eventTimezoneHint.replace('{zone}', timeZone)}>
                  <span>{new Intl.DateTimeFormat(t.eventLocale, { month: 'short' }).format(event.startsAt)}</span>
                  <strong>{new Date(event.startsAt).getDate()}</strong>
                  <small>{new Intl.DateTimeFormat(t.eventLocale, { hour: '2-digit', minute: '2-digit' }).format(event.startsAt)}</small>
                  <em>{timeZoneLabel}</em>
                </div>
                <div className="event-main">
                  <div className="event-topline">
                    <span className={`event-time-pill ${timing.live ? 'live' : ''} ${timing.live && !event.hostPresent && event.roomStatus !== 'playing' ? 'host-absent' : ''}`}>
                      {timing.live && <i />} {timing.label}
                    </span>
                    {isHost && <span className="event-host-label">{t.youAreHost}</span>}
                  </div>
                  <h3>{event.title}</h3>
                  {event.description && <p className="event-description">{event.description}</p>}
                  <div className="event-meta">
                    <span>{t.eventHost}: <strong>{event.hostUsername}</strong></span>
                    <span>·</span>
                    <span>{Math.round(event.duration / 60)} {t.durationMinutes}</span>
                    {track && <><span>·</span><span>♫ {track.title}</span></>}
                    {voiceTrack && <><span>·</span><span>🎙 {voiceTrack.title}</span></>}
                  </div>
                </div>
                <div className="event-actions">
                  <div className="attendee-count" title={t.eventAttendees}>
                    <span className="attendee-faces" aria-hidden="true">
                      <i>{event.hostUsername.charAt(0).toUpperCase()}</i>
                      {event.attendeeCount > 1 && <i>+</i>}
                    </span>
                    <strong>{event.attendeeCount}</strong>
                    <span>{t.eventGoingCount}</span>
                  </div>
                  {timing.live ? (
                    <button className="btn btn-event-live" onClick={() => onEnter(event.roomId)}>
                      {t.enterEventRoom} <span aria-hidden="true">→</span>
                    </button>
                  ) : !isHost ? (
                    <button
                      className={`btn ${event.isAttending ? 'btn-attending' : 'btn-secondary'}`}
                      disabled={pendingId === event.id}
                      onClick={() => toggleAttendance(event)}
                    >
                      {event.isAttending ? `✓ ${t.eventGoing}` : t.eventWillCome}
                    </button>
                  ) : null}
                  {isHost && (
                    <button
                      className="event-delete"
                      onClick={() => onDelete(event.id)}
                      aria-label={t.deleteEvent}
                      title={t.deleteEvent}
                    >×</button>
                  )}
                </div>
              </article>
            );
          })}
          {currentEvents.length > pageSize && (
            <nav className="event-pagination" aria-label={t.eventPaginationLabel}>
              <button
                type="button"
                className="event-page-arrow"
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                disabled={page === 0}
                aria-label={t.previousEvents}
              >←</button>
              <div className="event-page-dots">
                {Array.from({ length: pageCount }, (_, index) => (
                  <button
                    type="button"
                    className={index === page ? 'active' : ''}
                    onClick={() => setPage(index)}
                    aria-label={t.eventPage.replace('{page}', String(index + 1))}
                    aria-current={index === page ? 'page' : undefined}
                    key={index}
                  >{index + 1}</button>
                ))}
              </div>
              <button
                type="button"
                className="event-page-arrow"
                onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
                disabled={page === pageCount - 1}
                aria-label={t.nextEvents}
              >→</button>
            </nav>
          )}
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-content glass-panel event-modal" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowCreate(false)}>&times;</button>
            <div className="event-modal-heading">
              <span className="eyebrow">{t.eventEyebrow}</span>
              <h2>{t.createEventTitle}</h2>
              <p>{t.createEventHint}</p>
            </div>
            <form onSubmit={submit}>
              <div className="form-group">
                <label htmlFor="event-title">{t.eventTitleLabel}</label>
                <input
                  id="event-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t.eventTitlePlaceholder}
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label htmlFor="event-description">{t.eventDescriptionLabel}</label>
                <textarea
                  id="event-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t.eventDescriptionPlaceholder}
                  rows={3}
                />
              </div>
              <div className="form-group">
                <label htmlFor="event-time">{t.eventDateTimeLabel}</label>
                <input
                  id="event-time"
                  type="datetime-local"
                  value={startsAt}
                  min={toLocalDateTimeValue(new Date())}
                  onChange={(event) => setStartsAt(event.target.value)}
                  required
                />
                <small className="form-hint">{t.eventTimezoneHint.replace('{zone}', timeZone)}</small>
              </div>

              <div className="form-group event-duration-control">
                <label htmlFor="event-duration">{t.durationLabel}: <strong>{formatDuration(duration)}</strong></label>
                <input
                  id="event-duration"
                  type="range"
                  min="30"
                  max="7200"
                  step="30"
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                />
                <div className="event-duration-scale" aria-hidden="true">
                  <span>30 {t.durationSeconds}</span>
                  <span>30 {t.durationMinutes}</span>
                  <span>1 {t.eventHours}</span>
                  <span>2 {t.eventHours}</span>
                </div>
              </div>

              <div className={`creation-accordion ${openSection === 'sound' ? 'open' : ''}`}>
                <button type="button" className="creation-accordion-trigger" onClick={() => setOpenSection(openSection === 'sound' ? null : 'sound')}>
                  <span>
                    <strong>♫ {t.selectSoundscape}</strong>
                    <small>{ambientTracks.find((track) => track.id === trackId)?.title}</small>
                  </span>
                  <span className="creation-accordion-chevron">⌄</span>
                </button>
                {openSection === 'sound' && (
                  <div className="creation-accordion-content">
                    <div className="track-selector">
                      {ambientTracks.map((track) => (
                        <div className={`track-option ${trackId === track.id ? 'selected' : ''}`} onClick={() => setTrackId(track.id)} key={track.id}>
                          <div>
                            <div className="event-track-title">{track.title}</div>
                            <div className="event-track-subtitle">{track.artist}</div>
                          </div>
                          <div className="event-track-actions">
                            <button type="button" className={`event-preview-button ${previewTrackId === track.id ? 'playing' : ''}`} onClick={(event) => togglePreview(track, event)}>
                              {previewTrackId === track.id ? `■ ${t.stopPreviewBtn}` : `▶ ${t.previewBtn}`}
                            </button>
                            <span>{Math.floor(track.duration / 60)}:{(track.duration % 60).toString().padStart(2, '0')}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className={`creation-accordion ${openSection === 'background' ? 'open' : ''}`}>
                <button type="button" className="creation-accordion-trigger" onClick={() => setOpenSection(openSection === 'background' ? null : 'background')}>
                  <span>
                    <strong>▧ {t.selectBackground}</strong>
                    <small>{backgrounds.find((background) => background.id === backgroundId)?.title}</small>
                  </span>
                  <span className="creation-accordion-chevron">⌄</span>
                </button>
                {openSection === 'background' && (
                  <div className="creation-accordion-content">
                    <div className="background-selector">
                      {backgrounds.map((background) => (
                        <button
                          type="button"
                          className={`background-option ${backgroundId === background.id ? 'selected' : ''}`}
                          style={{ backgroundImage: `url("${background.imageUrl}")` }}
                          onClick={() => setBackgroundId(background.id)}
                          key={background.id}
                        >
                          <span>{background.title}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className={`creation-accordion ${openSection === 'voice' ? 'open' : ''}`}>
                <button type="button" className="creation-accordion-trigger" onClick={() => setOpenSection(openSection === 'voice' ? null : 'voice')}>
                  <span>
                    <strong>🎙 {t.eventVoiceTitle}</strong>
                    <small>{voiceTrackId === 'none' ? t.eventNoVoice : tracks.find((track) => track.id === voiceTrackId)?.title}</small>
                  </span>
                  <span className="creation-accordion-chevron">⌄</span>
                </button>
                {openSection === 'voice' && (
                  <div className="creation-accordion-content">
                    <div className="track-selector">
                      <div className={`track-option ${voiceTrackId === 'none' ? 'selected' : ''}`} onClick={() => setVoiceTrackId('none')}>
                        <div>
                          <div className="event-track-title">🔇 {t.eventNoVoice}</div>
                          <div className="event-track-subtitle">{t.eventNoVoiceHint}</div>
                        </div>
                      </div>
                      {recordedTracks.length === 0 ? (
                        <div className="event-no-recordings">{t.noRecordingsMsg}</div>
                      ) : recordedTracks.map((track) => (
                        <div className={`track-option ${voiceTrackId === track.id ? 'selected' : ''}`} onClick={() => setVoiceTrackId(track.id)} key={track.id}>
                          <div>
                            <div className="event-track-title">🎙 {track.title}</div>
                            <div className="event-track-subtitle">{track.ownerUsername}</div>
                          </div>
                          <div className="event-track-actions">
                            <button type="button" className={`event-preview-button ${previewTrackId === track.id ? 'playing' : ''}`} onClick={(event) => togglePreview(track, event)}>
                              {previewTrackId === track.id ? `■ ${t.stopPreviewBtn}` : `▶ ${t.previewBtn}`}
                            </button>
                            <span>{Math.floor(track.duration / 60)}:{(track.duration % 60).toString().padStart(2, '0')}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {error && <div className="notice notice-error">{error}</div>}
              <div className="event-modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>{t.cancel}</button>
                <button type="submit" className="btn btn-primary" disabled={pendingId === 'create' || !title.trim()}>
                  {t.publishEvent}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
