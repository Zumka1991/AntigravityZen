import { useCallback, useEffect, useState } from 'react';
import type { Language } from '../translations';

export type ProfileCardData = {
  username: string;
  hostedCount: number;
  participatedCount: number;
  likesCount: number;
  likedByMe: boolean;
  ignoredByMe: boolean;
};

type Props = {
  apiBase: string;
  token: string;
  viewerUsername: string;
  language: Language;
  /** Whose profile is rendered. */
  username: string;
  /**
   * "modal" — renders as a self-contained overlay with its own close/share
   * actions (used when opened from any in-app username click).
   * "panel" — renders as an embedded card without chrome (used inside SocialHub).
   */
  variant?: 'modal' | 'panel';
  /** Optional callback invoked when the user clicks "Send message" in the modal. */
  onWrite?: (username: string) => void;
  /** Required when variant === 'modal' — closes the overlay. */
  onClose?: () => void;
  isGuest?: boolean;
  onRequireAuth?: () => void;
};

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

const buildProfileShareUrl = (username: string): string => {
  if (typeof window === 'undefined') return `?profile=${encodeURIComponent(username)}`;
  const url = new URL(window.location.href);
  // Drop transient nav params so the shared link lands on the profile directly.
  url.searchParams.delete('roomId');
  url.searchParams.delete('eventId');
  url.searchParams.set('profile', username);
  url.hash = '';
  return url.toString();
};

const copyText = async (text: string): Promise<boolean> => {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('Clipboard write failed, falling back to execCommand:', err);
    }
  }
  if (typeof document === 'undefined') return false;
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch (err) {
    console.error('Fallback copy failed:', err);
    return false;
  }
};

export function ProfileCard({
  apiBase,
  token,
  viewerUsername,
  language,
  username,
  variant = 'panel',
  onWrite,
  onClose,
  isGuest = false,
  onRequireAuth,
}: Props) {
  const ru = language === 'ru';
  const [profile, setProfile] = useState<ProfileCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  const isSelf = !isGuest && (profile
    ? profile.username.toLowerCase() === viewerUsername.toLowerCase()
    : username.toLowerCase() === viewerUsername.toLowerCase());

  const loadProfile = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${apiBase}/profiles/${encodeURIComponent(username)}`,
        { headers: authHeaders(token), signal },
      );
      if (response.status === 404) {
        setProfile(null);
        setError(ru ? 'Профиль не найден' : 'Profile not found');
        return;
      }
      if (!response.ok) {
        throw new Error(ru ? 'Не удалось загрузить профиль' : 'Could not load profile');
      }
      const data: ProfileCardData = await response.json();
      setProfile(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('Failed to load profile:', err);
      setError(ru ? 'Не удалось загрузить профиль' : 'Could not load profile');
    } finally {
      setLoading(false);
    }
  }, [apiBase, token, username, ru]);

  useEffect(() => {
    const controller = new AbortController();
    void loadProfile(controller.signal);
    return () => controller.abort();
  }, [loadProfile]);

  const toggleLike = async () => {
    if (!profile) return;
    if (isGuest) {
      onRequireAuth?.();
      return;
    }
    setNotice(null);
    const response = await fetch(
      `${apiBase}/profiles/${encodeURIComponent(profile.username)}/like`,
      {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ liked: !profile.likedByMe }),
      },
    );
    if (!response.ok) {
      setNotice(ru ? 'Не удалось поставить отметку' : 'Could not update like');
      return;
    }
    const updated: ProfileCardData = await response.json();
    setProfile(updated);
  };

  const toggleIgnore = async () => {
    if (!profile) return;
    if (isGuest) {
      onRequireAuth?.();
      return;
    }
    if (!profile.ignoredByMe && !window.confirm(
      ru
        ? `Игнорировать пользователя ${profile.username}? Вы не сможете писать друг другу.`
        : `Ignore ${profile.username}? You will not be able to message each other.`,
    )) return;
    setNotice(null);
    const response = await fetch(
      `${apiBase}/profiles/${encodeURIComponent(profile.username)}/ignore`,
      {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ ignored: !profile.ignoredByMe }),
      },
    );
    if (!response.ok) {
      setNotice(ru ? 'Не удалось изменить игнор' : 'Could not update ignore state');
      return;
    }
    setProfile({ ...profile, ignoredByMe: !profile.ignoredByMe });
  };

  const handleShare = async () => {
    const url = buildProfileShareUrl(profile?.username ?? username);
    const ok = await copyText(url);
    setCopyState(ok ? 'copied' : 'error');
    window.setTimeout(() => setCopyState('idle'), 2500);
  };

  const handleWrite = () => {
    if (!profile) return;
    if (isGuest) {
      onRequireAuth?.();
      return;
    }
    if (onWrite) {
      onWrite(profile.username);
      return;
    }
    // Fallback: open SocialHub messages with the user pre-selected via hash params.
    const url = new URL(window.location.href);
    url.searchParams.set('dm', profile.username);
    window.location.assign(url.toString());
  };

  // Reset transient notice when username changes.
  useEffect(() => {
    setNotice(null);
    setCopyState('idle');
  }, [username]);

  // Close modal on Escape.
  useEffect(() => {
    if (variant !== 'modal' || !onClose) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [variant, onClose]);

  const renderAvatar = (name: string, size: 'small' | 'large' = 'large') => (
    <div className={size === 'large' ? 'profile-avatar' : 'user-avatar'}>
      {name.charAt(0).toUpperCase()}
    </div>
  );

  const renderStats = (data: ProfileCardData) => (
    <div className="profile-stats">
      <div>
        <strong>{data.hostedCount}</strong>
        <span>{ru ? 'раз ведущим' : 'times as host'}</span>
      </div>
      <div>
        <strong>{data.participatedCount}</strong>
        <span>{ru ? 'медитаций проведено' : 'meditations joined'}</span>
      </div>
      <div>
        <strong>{data.likesCount}</strong>
        <span>{ru ? 'лайков в профиле' : 'profile likes'}</span>
      </div>
    </div>
  );

  const renderActions = (data: ProfileCardData) => {
    if (isSelf) {
      return (
        <div className="own-profile-note">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>{ru ? 'Это ваш профиль' : 'This is your profile'}</strong>
            <small>
              {ru
                ? 'Поделитесь ссылкой, чтобы пригласить других. Лайки и сообщения доступны на чужих профилях.'
                : 'Share your link to invite others. Likes and direct messages work on other members.'}
            </small>
          </div>
        </div>
      );
    }
    return (
      <>
        <button
          className="btn btn-primary"
          type="button"
          onClick={handleWrite}
          disabled={!isGuest && data.ignoredByMe}
          title={!isGuest && data.ignoredByMe
            ? (ru ? 'Снимите игнор, чтобы написать' : 'Unignore to send a message')
            : undefined}
        >
          <span aria-hidden="true">✉</span> {ru ? 'Написать' : 'Send message'}
        </button>
        <button
          className={`btn profile-like ${data.likedByMe ? 'liked' : ''}`}
          type="button"
          onClick={() => void toggleLike()}
        >
          {data.likedByMe ? '♥' : '♡'} {data.likedByMe
            ? (ru ? 'Нравится' : 'Liked')
            : (ru ? 'Поставить лайк' : 'Like profile')}
        </button>
        {!isGuest && (
          <button
            className={`btn btn-secondary ignore-button ${data.ignoredByMe ? 'active' : ''}`}
            type="button"
            onClick={() => void toggleIgnore()}
          >
            {data.ignoredByMe
              ? (ru ? 'Перестать игнорировать' : 'Stop ignoring')
              : (ru ? 'Игнорировать' : 'Ignore')}
          </button>
        )}
      </>
    );
  };

  const renderShareBlock = (data: ProfileCardData) => {
    const shareUrl = buildProfileShareUrl(data.username);
    return (
      <div className="profile-share">
        <span className="profile-share-label">
          {ru ? 'Ссылка на профиль' : 'Profile link'}
        </span>
        <div className="profile-share-row">
          <input
            className="profile-share-input"
            value={shareUrl}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
            aria-label={ru ? 'Ссылка на профиль' : 'Profile link'}
          />
          <button
            className="btn btn-secondary profile-share-btn"
            type="button"
            onClick={() => void handleShare()}
          >
            {copyState === 'copied'
              ? (ru ? '✓ Скопировано' : '✓ Copied')
              : (ru ? 'Скопировать ссылку' : 'Copy link')}
          </button>
        </div>
        {copyState === 'error' && (
          <small className="profile-share-feedback">
            {ru ? 'Не удалось скопировать — скопируйте вручную' : 'Could not copy — please copy manually'}
          </small>
        )}
      </div>
    );
  };

  const body = (() => {
    if (loading) {
      return (
        <div className="profile-placeholder">
          <span>◌</span>
          <p>{ru ? 'Загружаем профиль…' : 'Loading profile…'}</p>
        </div>
      );
    }
    if (error || !profile) {
      return (
        <div className="profile-placeholder">
          <span>✦</span>
          <h2>{error ?? (ru ? 'Профиль не найден' : 'Profile not found')}</h2>
        </div>
      );
    }
    return (
      <>
        <div className="profile-hero">
          {renderAvatar(profile.username)}
          <div>
            <span>{ru ? 'Профиль участника' : 'Member profile'}</span>
            <h2>{profile.username}</h2>
          </div>
        </div>

        {renderStats(profile)}
        {renderShareBlock(profile)}

        <div className="profile-actions">
          {renderActions(profile)}
        </div>

        {notice && <div className="notice notice-error profile-notice">{notice}</div>}
      </>
    );
  })();

  if (variant === 'modal') {
    return (
      <div
        className="modal-overlay profile-modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={ru ? 'Профиль участника' : 'Member profile'}
        onClick={onClose}
      >
        <div
          className="glass-panel profile-detail profile-modal-card"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="modal-close profile-modal-close"
            onClick={onClose}
            aria-label={ru ? 'Закрыть профиль' : 'Close profile'}
          >
            ×
          </button>
          {body}
        </div>
      </div>
    );
  }

  return <div className="glass-panel profile-detail profile-card-embedded">{body}</div>;
}