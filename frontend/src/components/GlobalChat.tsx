import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { translations } from '../translations';

interface GlobalChatMessage {
  id: number;
  username: string;
  text: string;
  timestamp: number;
}

interface GlobalChatProps {
  apiBase: string;
  token: string;
  username: string;
  t: typeof translations.en;
}

const visibleMessageLimit = 200;

export function GlobalChat({ apiBase, token, username, t }: GlobalChatProps) {
  const [messages, setMessages] = useState<GlobalChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const latestMessageId = useRef(0);
  const messagesRef = useRef<HTMLDivElement>(null);

  const mergeMessages = (incoming: GlobalChatMessage[]) => {
    if (incoming.length === 0) return;

    latestMessageId.current = Math.max(
      latestMessageId.current,
      ...incoming.map((message) => message.id),
    );
    setMessages((current) => {
      const byId = new Map(current.map((message) => [message.id, message]));
      incoming.forEach((message) => byId.set(message.id, message));
      return Array.from(byId.values())
        .sort((a, b) => a.id - b.id)
        .slice(-visibleMessageLimit);
    });
  };

  useEffect(() => {
    let isActive = true;
    let isFetching = false;
    let activeRequest: AbortController | null = null;

    const fetchMessages = async () => {
      if (isFetching) return;
      isFetching = true;
      activeRequest = new AbortController();

      try {
        const cursor = latestMessageId.current;
        const query = cursor > 0 ? `?after=${cursor}&limit=100` : '?limit=50';
        const response = await fetch(`${apiBase}/global-chat${query}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: activeRequest.signal,
        });
        if (!response.ok) throw new Error('Failed to load global chat');

        const incoming = await response.json() as GlobalChatMessage[];
        if (isActive) {
          mergeMessages(incoming);
          setError(null);
        }
      } catch (fetchError) {
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return;
        console.error('Failed to fetch global chat:', fetchError);
        if (isActive) setError(t.globalChatLoadError);
      } finally {
        isFetching = false;
        activeRequest = null;
      }
    };

    fetchMessages();
    const interval = window.setInterval(fetchMessages, 3000);
    return () => {
      isActive = false;
      activeRequest?.abort();
      window.clearInterval(interval);
    };
  }, [apiBase, token, t.globalChatLoadError]);

  useEffect(() => {
    const container = messagesRef.current;
    container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || isSending) return;

    setIsSending(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/global-chat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error('Failed to send global chat message');

      const message = await response.json() as GlobalChatMessage;
      mergeMessages([message]);
      setInput('');
    } catch (sendError) {
      console.error('Failed to send global chat message:', sendError);
      setError(t.globalChatSendError);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <section className="global-chat glass-panel">
      <div className="global-chat-header">
        <div>
          <h2>{t.globalChatTitle}</h2>
          <p>{t.globalChatDesc}</p>
        </div>
        <span className="global-chat-live">{t.globalChatLive}</span>
      </div>

      <div className="global-chat-messages" ref={messagesRef}>
        {messages.length === 0 ? (
          <div className="global-chat-empty">{t.globalChatEmpty}</div>
        ) : (
          messages.map((message) => {
            const isSelf = message.username === username;
            return (
              <div key={message.id} className={`chat-message ${isSelf ? 'self' : ''}`}>
                <div className="chat-msg-header">
                  {!isSelf && <span style={{ fontWeight: 600 }}>{message.username}</span>}
                  <span>
                    {new Date(message.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="chat-msg-bubble">{message.text}</div>
              </div>
            );
          })
        )}
      </div>

      {error && <div className="global-chat-error">{error}</div>}

      <form onSubmit={handleSubmit} className="chat-input-area">
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t.globalChatPlaceholder}
          maxLength={500}
          disabled={isSending}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={isSending || !input.trim()}
          aria-label={t.globalChatSend}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
          <span>{t.globalChatSend}</span>
        </button>
      </form>
    </section>
  );
}
