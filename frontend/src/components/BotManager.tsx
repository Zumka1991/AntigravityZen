import { useEffect, useState } from 'react';
import type { translations } from '../translations';

export interface BotSettings {
  enabled: boolean;
  maxConcurrent: number;
  activeCount: number;
  bots: string[];
  activeRooms: Record<string, string>;
}

interface BotManagerProps {
  apiBase: string;
  token: string;
  t: typeof translations.en;
}

export function BotManager({ apiBase, token, t }: BotManagerProps) {
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftMax, setDraftMax] = useState(0);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setError(null);
    try {
      const response = await fetch(`${apiBase}/admin/bots`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || t.botLoadError);
      }
      const data: BotSettings = await response.json();
      setSettings(data);
      setDraftEnabled(data.enabled);
      setDraftMax(Math.max(1, data.maxConcurrent));
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : t.botLoadError);
    }
  };

  useEffect(() => {
    void refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, token]);

  const handleSave = async () => {
    setStatus('saving');
    setError(null);
    try {
      const response = await fetch(`${apiBase}/admin/bots`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: draftEnabled, maxConcurrent: draftMax }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || t.botSaveError);
      }
      setStatus('saved');
      await refresh();
      setTimeout(() => setStatus('idle'), 1800);
    } catch (saveError) {
      setStatus('idle');
      setError(saveError instanceof Error ? saveError.message : t.botSaveError);
    }
  };

  const activeRoomsEntries = settings ? Object.entries(settings.activeRooms) : [];
  const isDirty = settings
    ? settings.enabled !== draftEnabled || settings.maxConcurrent !== draftMax
    : false;

  return (
    <section className="background-manager bot-manager">
      <div>
        <h3>{t.botManagerTitle}</h3>
        <p>{t.botManagerDesc}</p>
      </div>

      {error && <div className="global-chat-error">{error}</div>}

      {!settings ? (
        <div className="muted">…</div>
      ) : (
        <>
          <label className="bot-toggle-row">
            <input
              type="checkbox"
              checked={draftEnabled}
              onChange={(e) => setDraftEnabled(e.target.checked)}
            />
            <span>{t.botToggleLabel}</span>
          </label>

          <div className="bot-slider-row">
            <label htmlFor="bot-max">{t.botMaxConcurrentLabel}</label>
            <input
              id="bot-max"
              type="range"
              min={1}
              max={20}
              step={1}
              value={draftMax}
              onChange={(e) => setDraftMax(Number(e.target.value))}
            />
            <span className="bot-slider-value">{draftMax}</span>
          </div>

          <div className="bot-status-line">
            {settings.activeCount > 0
              ? t.botActiveNow.replace('{count}', String(settings.activeCount))
              : t.botNoActive}
          </div>

          {activeRoomsEntries.length > 0 && (
            <ul className="bot-active-rooms">
              {activeRoomsEntries.map(([roomID, botName]) => (
                <li key={roomID}>
                  <span className="bot-dot" />
                  <code>{roomID}</code>
                  <span>{botName}</span>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            className="btn btn-primary"
            disabled={!isDirty || status === 'saving'}
            onClick={handleSave}
          >
            {status === 'saving' ? '…' : status === 'saved' ? t.botSaved : t.save}
          </button>

          <div className="bot-roster">
            <div className="bot-roster-label">{t.botRosterLabel}</div>
            <div className="bot-roster-list">
              {settings.bots.map((bot) => (
                <code key={bot}>{bot}</code>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
