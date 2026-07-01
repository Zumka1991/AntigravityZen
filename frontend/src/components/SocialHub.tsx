import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Language } from '../translations';

type Profile = {
  username: string;
  hostedCount: number;
  participatedCount: number;
  likesCount: number;
  likedByMe: boolean;
};

type DirectMessage = {
  id: number;
  sender: string;
  recipient: string;
  text: string;
  createdAt: number;
  readAt?: number;
};

type Conversation = {
  username: string;
  lastMessage: string;
  lastAt: number;
  unreadCount: number;
};

type Props = {
  apiBase: string;
  token: string;
  username: string;
  language: Language;
  initialTab: 'profiles' | 'messages';
  onBack: () => void;
  onUnreadChange: (count: number) => void;
};

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

const formatTime = (timestamp: number, language: Language) => new Intl.DateTimeFormat(
  language === 'ru' ? 'ru-RU' : 'en-US',
  { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
).format(timestamp);

export function SocialHub({
  apiBase,
  token,
  username,
  language,
  initialTab,
  onBack,
  onUnreadChange,
}: Props) {
  const ru = language === 'ru';
  const [tab, setTab] = useState<'profiles' | 'messages'>(initialTab);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [activeDialog, setActiveDialog] = useState<string | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const profileDetailRef = useRef<HTMLDivElement | null>(null);

  const unreadTotal = useMemo(
    () => conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0),
    [conversations],
  );

  useEffect(() => {
    setTab(initialTab);
    setSelectedProfile(null);
    if (initialTab === 'profiles') setActiveDialog(null);
  }, [initialTab]);

  const loadProfiles = useCallback(async (query = '') => {
    const response = await fetch(`${apiBase}/profiles?q=${encodeURIComponent(query)}`, {
      headers: authHeaders(token),
    });
    if (!response.ok) throw new Error(ru ? 'Не удалось загрузить профили' : 'Could not load profiles');
    setProfiles(await response.json());
  }, [apiBase, token, ru]);

  const loadConversations = useCallback(async () => {
    const response = await fetch(`${apiBase}/messages`, { headers: authHeaders(token) });
    if (!response.ok) throw new Error(ru ? 'Не удалось загрузить сообщения' : 'Could not load messages');
    const data: Conversation[] = await response.json();
    setConversations(data);
    onUnreadChange(data.reduce((sum, conversation) => sum + conversation.unreadCount, 0));
  }, [apiBase, token, ru, onUnreadChange]);

  const loadMessages = useCallback(async (other: string, quiet = false) => {
    const response = await fetch(`${apiBase}/messages/${encodeURIComponent(other)}`, {
      headers: authHeaders(token),
    });
    if (!response.ok) {
      if (!quiet) setError(ru ? 'Не удалось открыть диалог' : 'Could not open conversation');
      return;
    }
    setMessages(await response.json());
    await loadConversations();
  }, [apiBase, token, ru, loadConversations]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([loadProfiles(), loadConversations()])
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [loadProfiles, loadConversations]);

  useEffect(() => {
    if (!activeDialog) return;
    void loadMessages(activeDialog);
    const interval = window.setInterval(() => void loadMessages(activeDialog, true), 5000);
    return () => window.clearInterval(interval);
  }, [activeDialog, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages]);

  const openProfile = (profile: Profile) => {
    setSelectedProfile(profile);
    setActiveDialog(null);
    if (window.matchMedia('(max-width: 800px)').matches) {
      window.requestAnimationFrame(() => {
        profileDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };

  const openDialog = (other: string) => {
    setTab('messages');
    setSelectedProfile(null);
    setActiveDialog(other);
    setMessages([]);
  };

  const toggleLike = async (profile: Profile) => {
    setError(null);
    const response = await fetch(`${apiBase}/profiles/${encodeURIComponent(profile.username)}/like`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ liked: !profile.likedByMe }),
    });
    if (!response.ok) {
      setError(ru ? 'Не удалось поставить отметку' : 'Could not update like');
      return;
    }
    const updated: Profile = await response.json();
    setProfiles((current) => current.map((item) => (
      item.username === updated.username ? updated : item
    )));
    setSelectedProfile(updated);
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeDialog || !draft.trim()) return;
    const text = draft.trim();
    setDraft('');
    const response = await fetch(`${apiBase}/messages/${encodeURIComponent(activeDialog)}`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      setDraft(text);
      setError(ru ? 'Сообщение не отправилось' : 'Message was not sent');
      return;
    }
    const message: DirectMessage = await response.json();
    setMessages((current) => [...current, message]);
    await loadConversations();
  };

  const changeTab = (next: 'profiles' | 'messages') => {
    setTab(next);
    setSelectedProfile(null);
    if (next === 'profiles') setActiveDialog(null);
  };

  return (
    <section className="social-page">
      <div className="social-heading">
        <button className="btn btn-secondary" type="button" onClick={onBack}>← {ru ? 'Назад' : 'Back'}</button>
        <div>
          <span className="social-kicker">{ru ? 'Сообщество ZenWorld' : 'ZenWorld community'}</span>
          <h1>{ru ? 'Люди и личные сообщения' : 'People and direct messages'}</h1>
        </div>
      </div>

      <div className="social-tabs" role="tablist">
        <button
          className={tab === 'profiles' ? 'active' : ''}
          type="button"
          onClick={() => changeTab('profiles')}
        >
          {ru ? 'Профили' : 'Profiles'}
        </button>
        <button
          className={tab === 'messages' ? 'active' : ''}
          type="button"
          onClick={() => changeTab('messages')}
        >
          {ru ? 'Сообщения' : 'Messages'}
          {unreadTotal > 0 && <span className="notification-count">{unreadTotal}</span>}
        </button>
      </div>

      {error && <div className="notice notice-error social-error">{error}</div>}

      {loading ? (
        <div className="glass-panel social-loading">{ru ? 'Загружаем сообщество…' : 'Loading community…'}</div>
      ) : tab === 'profiles' ? (
        <div className="social-layout">
          <div className="glass-panel profile-directory">
            <form
              className="profile-search"
              onSubmit={(event) => {
                event.preventDefault();
                void loadProfiles(search).catch((err) => setError(err.message));
              }}
            >
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={ru ? 'Найти пользователя' : 'Find a user'}
                aria-label={ru ? 'Поиск пользователей' : 'Search users'}
              />
              <button className="btn btn-secondary" type="submit">{ru ? 'Найти' : 'Search'}</button>
            </form>
            <div className="profile-list">
              {profiles.map((profile) => (
                <button
                  key={profile.username}
                  className={`profile-list-item ${selectedProfile?.username === profile.username ? 'active' : ''}`}
                  type="button"
                  onClick={() => openProfile(profile)}
                >
                  <span className="user-avatar">{profile.username.charAt(0).toUpperCase()}</span>
                  <span>
                    <strong>{profile.username}</strong>
                    <small>♥ {profile.likesCount}</small>
                  </span>
                </button>
              ))}
              {profiles.length === 0 && <p className="social-empty">{ru ? 'Никого не нашли' : 'No users found'}</p>}
            </div>
          </div>

          <div className="glass-panel profile-detail" ref={profileDetailRef}>
            {selectedProfile ? (
              <>
                <div className="profile-hero">
                  <div className="profile-avatar">{selectedProfile.username.charAt(0).toUpperCase()}</div>
                  <div>
                    <span>{ru ? 'Профиль участника' : 'Member profile'}</span>
                    <h2>{selectedProfile.username}</h2>
                  </div>
                </div>
                <div className="profile-stats">
                  <div><strong>{selectedProfile.hostedCount}</strong><span>{ru ? 'раз ведущий' : 'hosted'}</span></div>
                  <div><strong>{selectedProfile.participatedCount}</strong><span>{ru ? 'раз участник' : 'joined'}</span></div>
                  <div><strong>{selectedProfile.likesCount}</strong><span>{ru ? 'лайков' : 'likes'}</span></div>
                </div>
                <div className="profile-actions">
                  {selectedProfile.username.toLowerCase() !== username.toLowerCase() ? (
                    <>
                      <button className="btn btn-primary" type="button" onClick={() => openDialog(selectedProfile.username)}>
                        <span aria-hidden="true">✉</span> {ru ? 'Написать сообщение' : 'Send message'}
                      </button>
                      <button
                        className={`btn profile-like ${selectedProfile.likedByMe ? 'liked' : ''}`}
                        type="button"
                        onClick={() => void toggleLike(selectedProfile)}
                      >
                        {selectedProfile.likedByMe ? '♥' : '♡'} {ru
                          ? (selectedProfile.likedByMe ? 'Нравится' : 'Поставить лайк')
                          : (selectedProfile.likedByMe ? 'Liked' : 'Like profile')}
                      </button>
                    </>
                  ) : (
                    <div className="own-profile-note">
                      <span aria-hidden="true">✓</span>
                      <div>
                        <strong>{ru ? 'Это ваш профиль' : 'This is your profile'}</strong>
                        <small>{ru
                          ? 'Лайки и личные сообщения доступны в профилях других участников.'
                          : 'Likes and direct messages are available on other member profiles.'}</small>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="profile-placeholder">
                <span>✦</span>
                <h2>{ru ? 'Выберите профиль' : 'Choose a profile'}</h2>
                <p>{ru ? 'Здесь появится статистика участника.' : 'Member statistics will appear here.'}</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className={`glass-panel messenger ${activeDialog ? 'dialog-open' : ''}`}>
          <aside className="conversation-list">
            <h2>{ru ? 'Диалоги' : 'Conversations'}</h2>
            {conversations.map((conversation) => (
              <button
                key={conversation.username}
                className={activeDialog === conversation.username ? 'active' : ''}
                type="button"
                onClick={() => openDialog(conversation.username)}
              >
                <span className="user-avatar">{conversation.username.charAt(0).toUpperCase()}</span>
                <span className="conversation-copy">
                  <strong>{conversation.username}</strong>
                  <small>{conversation.lastMessage}</small>
                </span>
                {conversation.unreadCount > 0 && (
                  <span className="notification-count">{conversation.unreadCount}</span>
                )}
              </button>
            ))}
            {conversations.length === 0 && (
              <p className="social-empty">{ru ? 'Пока нет диалогов. Начните с профиля участника.' : 'No conversations yet. Start from a member profile.'}</p>
            )}
          </aside>
          <div className="dialog">
            {activeDialog ? (
              <>
                <div className="dialog-header">
                  <button
                    type="button"
                    className="mobile-dialog-back"
                    onClick={() => setActiveDialog(null)}
                    aria-label={ru ? 'Вернуться к диалогам' : 'Back to conversations'}
                  >
                    ←
                  </button>
                  <span className="user-avatar">{activeDialog.charAt(0).toUpperCase()}</span>
                  <div><strong>{activeDialog}</strong><small>{ru ? 'личный диалог' : 'direct conversation'}</small></div>
                </div>
                <div className="dialog-messages" aria-live="polite">
                  {messages.map((message) => {
                    const own = message.sender.toLowerCase() === username.toLowerCase();
                    return (
                      <div key={message.id} className={`direct-message ${own ? 'own' : ''}`}>
                        <p>{message.text}</p>
                        <span>
                          {formatTime(message.createdAt, language)}
                          {own && ` · ${message.readAt ? (ru ? 'прочитано' : 'read') : (ru ? 'доставлено' : 'delivered')}`}
                        </span>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
                <form className="dialog-compose" onSubmit={sendMessage}>
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    maxLength={2000}
                    rows={2}
                    placeholder={ru ? 'Напишите сообщение…' : 'Write a message…'}
                    aria-label={ru ? 'Текст сообщения' : 'Message text'}
                  />
                  <button className="btn btn-primary" type="submit" disabled={!draft.trim()}>
                    {ru ? 'Отправить' : 'Send'}
                  </button>
                </form>
              </>
            ) : (
              <div className="profile-placeholder">
                <span>✉</span>
                <h2>{ru ? 'Выберите диалог' : 'Choose a conversation'}</h2>
                <p>{ru ? 'Или откройте профиль и напишите человеку.' : 'Or open a profile and message someone.'}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
