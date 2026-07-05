import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';
import type { Language } from '../translations';
import { ProfileCard } from './ProfileCard';

type Profile = {
  username: string;
  hostedCount: number;
  participatedCount: number;
  likesCount: number;
  likedByMe: boolean;
  ignoredByMe: boolean;
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
  ignoredByMe: boolean;
};

type Props = {
  apiBase: string;
  token: string;
  username: string;
  language: Language;
  initialTab: 'profiles' | 'messages';
  /** Optional username to open a direct-message dialog with immediately. */
  initialDialog?: string | null;
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
  initialDialog = null,
  onBack,
  onUnreadChange,
}: Props) {
  const ru = language === 'ru';
  const [tab, setTab] = useState<'profiles' | 'messages'>(initialTab);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [activeDialog, setActiveDialog] = useState<string | null>(initialDialog);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<
    | {
        messageId: number;
        x: number;
        y: number;
      }
    | null
  >(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const profileDetailRef = useRef<HTMLDivElement | null>(null);

  const unreadTotal = useMemo(
    () => conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0),
    [conversations],
  );
  const activeIgnored = useMemo(() => {
    if (!activeDialog) return false;
    return conversations.find((item) => item.username.toLowerCase() === activeDialog.toLowerCase())?.ignoredByMe
      ?? profiles.find((item) => item.username.toLowerCase() === activeDialog.toLowerCase())?.ignoredByMe
      ?? false;
  }, [activeDialog, conversations, profiles]);

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

  // Закрытие контекстного меню при смене диалога и при unmount.
  useEffect(() => {
    setContextMenu(null);
  }, [activeDialog]);

  useEffect(
    () => () => {
      if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
    },
    [],
  );

  // Корректировка позиции меню — не вылезать за границы экрана.
  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const rect = contextMenuRef.current.getBoundingClientRect();
    const padding = 8;
    let { x, y } = contextMenu;
    if (x + rect.width + padding > window.innerWidth) {
      x = Math.max(padding, window.innerWidth - rect.width - padding);
    }
    if (y + rect.height + padding > window.innerHeight) {
      y = Math.max(padding, window.innerHeight - rect.height - padding);
    }
    if (x < padding) x = padding;
    if (y < padding) y = padding;
    if (x !== contextMenu.x || y !== contextMenu.y) {
      setContextMenu({ ...contextMenu, x, y });
    }
  }, [contextMenu]);

  // Закрытие по клику/тачу вне меню и по Escape.
  useEffect(() => {
    if (!contextMenu) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && contextMenuRef.current?.contains(target)) return;
      setContextMenu(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', handlePointerDown);
      document.addEventListener('touchstart', handlePointerDown);
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

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

  const setIgnored = async (other: string, ignored: boolean) => {
    if (ignored && !window.confirm(ru
      ? `Игнорировать пользователя ${other}? Вы не сможете писать друг другу.`
      : `Ignore ${other}? You will not be able to message each other.`)) return;
    setError(null);
    const response = await fetch(`${apiBase}/profiles/${encodeURIComponent(other)}/ignore`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ ignored }),
    });
    if (!response.ok) {
      setError(ru ? 'Не удалось изменить игнор' : 'Could not update ignore state');
      return;
    }
    setProfiles((current) => current.map((profile) => (
      profile.username.toLowerCase() === other.toLowerCase()
        ? { ...profile, ignoredByMe: ignored }
        : profile
    )));
    setConversations((current) => current.map((conversation) => (
      conversation.username.toLowerCase() === other.toLowerCase()
        ? { ...conversation, ignoredByMe: ignored }
        : conversation
    )));
    setSelectedProfile((current) => (
      current?.username.toLowerCase() === other.toLowerCase()
        ? { ...current, ignoredByMe: ignored }
        : current
    ));
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
      setError(response.status === 403
        ? (ru ? 'Сообщения между вами заблокированы' : 'Messages between you are blocked')
        : (ru ? 'Сообщение не отправилось' : 'Message was not sent'));
      return;
    }
    const message: DirectMessage = await response.json();
    setMessages((current) => [...current, message]);
    await loadConversations();
  };

  const deleteMessage = async (messageID: number) => {
    if (!window.confirm(ru ? 'Удалить это сообщение?' : 'Delete this message?')) return;
    setError(null);
    const response = await fetch(`${apiBase}/messages/${messageID}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    if (!response.ok) {
      setError(ru ? 'Не удалось удалить сообщение' : 'Could not delete message');
      return;
    }
    setMessages((current) => current.filter((message) => message.id !== messageID));
    await loadConversations();
  };

  const openContextMenu = (messageId: number, x: number, y: number) => {
    setContextMenu({ messageId, x, y });
  };

  const handleMessageContextMenu = (event: ReactMouseEvent, messageId: number) => {
    event.preventDefault();
    openContextMenu(messageId, event.clientX, event.clientY);
  };

  const handleMessageClick = (event: ReactMouseEvent, messageId: number) => {
    const target = event.target as HTMLElement;
    if (target.closest('button')) return;
    if (window.getSelection()?.toString()) return;
    openContextMenu(messageId, event.clientX, event.clientY);
  };

  const handleMessageTouchStart = (event: ReactTouchEvent, messageId: number) => {
    const touch = event.touches[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
    touchTimerRef.current = setTimeout(() => {
      openContextMenu(messageId, touch.clientX, touch.clientY);
    }, 500);
  };

  const handleMessageTouchMove = (event: ReactTouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = event.touches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    if (Math.hypot(dx, dy) > 10 && touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  };

  const handleMessageTouchEnd = () => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  };

  const copyMessage = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        // ignore — пользователь увидит, что меню закрылось
      }
      document.body.removeChild(ta);
    }
    setContextMenu(null);
  };

  const contextMessage = contextMenu
    ? messages.find((m) => m.id === contextMenu.messageId)
    : null;
  const contextIsOwn = !!contextMessage &&
    contextMessage.sender.toLowerCase() === username.toLowerCase();

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

          <div ref={profileDetailRef}>
            {selectedProfile ? (
              <ProfileCard
                apiBase={apiBase}
                token={token}
                viewerUsername={username}
                language={language}
                username={selectedProfile.username}
                variant="panel"
              />
            ) : (
              <div className="glass-panel profile-detail profile-card-embedded">
                <div className="profile-placeholder">
                  <span>✦</span>
                  <h2>{ru ? 'Выберите профиль' : 'Choose a profile'}</h2>
                  <p>{ru ? 'Здесь появится статистика участника.' : 'Member statistics will appear here.'}</p>
                </div>
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
                  <div className="dialog-user">
                    <strong>{activeDialog}</strong>
                    <small>{activeIgnored
                      ? (ru ? 'пользователь в игноре' : 'user ignored')
                      : (ru ? 'личный диалог' : 'direct conversation')}</small>
                  </div>
                  <button
                    className={`dialog-ignore ${activeIgnored ? 'active' : ''}`}
                    type="button"
                    onClick={() => void setIgnored(activeDialog, !activeIgnored)}
                    title={activeIgnored
                      ? (ru ? 'Снять игнор' : 'Unignore')
                      : (ru ? 'Игнорировать пользователя' : 'Ignore user')}
                    aria-label={activeIgnored
                      ? (ru ? 'Снять игнор' : 'Unignore')
                      : (ru ? 'Игнорировать' : 'Ignore')}
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      {activeIgnored ? (
                        <>
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </>
                      ) : (
                        <>
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </>
                      )}
                    </svg>
                    <span>{activeIgnored
                      ? (ru ? 'Снять игнор' : 'Unignore')
                      : (ru ? 'Игнорировать' : 'Ignore')}</span>
                  </button>
                </div>
                <div className="dialog-messages" aria-live="polite">
                  {messages.map((message) => {
                    const own = message.sender.toLowerCase() === username.toLowerCase();
                    return (
                      <div
                        key={message.id}
                        className={`direct-message ${own ? 'own' : ''}`}
                        onClick={(event) => handleMessageClick(event, message.id)}
                        onContextMenu={(event) => handleMessageContextMenu(event, message.id)}
                        onTouchStart={(event) => handleMessageTouchStart(event, message.id)}
                        onTouchMove={handleMessageTouchMove}
                        onTouchEnd={handleMessageTouchEnd}
                        onTouchCancel={handleMessageTouchEnd}
                      >
                        <p>{message.text}</p>
                        <span className="direct-message-meta">
                          <span>
                            {formatTime(message.createdAt, language)}
                            {own && ` · ${message.readAt ? (ru ? 'прочитано' : 'read') : (ru ? 'доставлено' : 'delivered')}`}
                          </span>
                          <button
                            type="button"
                            className="message-menu-trigger"
                            onClick={(event) => {
                              event.stopPropagation();
                              const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
                              openContextMenu(
                                message.id,
                                rect.right - 4,
                                rect.bottom + 4,
                              );
                            }}
                            title={ru ? 'Действия' : 'Actions'}
                            aria-label={ru ? 'Действия с сообщением' : 'Message actions'}
                            aria-haspopup="menu"
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <circle cx="12" cy="5" r="1" />
                              <circle cx="12" cy="12" r="1" />
                              <circle cx="12" cy="19" r="1" />
                            </svg>
                          </button>
                        </span>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
                {activeIgnored ? (
                  <div className="dialog-blocked">
                    {ru
                      ? 'Вы игнорируете этого пользователя. Снимите игнор, чтобы продолжить переписку.'
                      : 'You are ignoring this user. Stop ignoring them to continue the conversation.'}
                  </div>
                ) : (
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
                )}
              </>
            ) : (
              <div className="profile-placeholder">
                <span>✉</span>
                <h2>{ru ? 'Выберите диалог' : 'Choose a conversation'}</h2>
                <p>{ru ? 'Или откройте профиль и напишите человеку.' : 'Or open a profile and message someone.'}</p>
              </div>
            )}
            {contextMenu && contextMessage && (
              <div
                ref={contextMenuRef}
                className="message-context-menu"
                role="menu"
                style={{ top: contextMenu.y, left: contextMenu.x }}
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="message-context-menu-item"
                  onClick={() => void copyMessage(contextMessage.text)}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  <span>{ru ? 'Скопировать текст' : 'Copy text'}</span>
                </button>
                {contextIsOwn && (
                  <button
                    type="button"
                    role="menuitem"
                    className="message-context-menu-item danger"
                    onClick={() => {
                      setContextMenu(null);
                      void deleteMessage(contextMessage.id);
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                    </svg>
                    <span>{ru ? 'Удалить' : 'Delete'}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
