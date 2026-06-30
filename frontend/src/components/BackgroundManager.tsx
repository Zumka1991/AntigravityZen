import { useState } from 'react';
import type { FormEvent } from 'react';
import type { MeditationBackground } from './RoomList';
import type { translations } from '../translations';

interface BackgroundManagerProps {
  apiBase: string;
  token: string;
  backgrounds: MeditationBackground[];
  onChanged: () => void;
  t: typeof translations.en;
}

export function BackgroundManager({
  apiBase,
  token,
  backgrounds,
  onChanged,
  t,
}: BackgroundManagerProps) {
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || !title.trim()) return;

    setIsUploading(true);
    setError(null);
    const formData = new FormData();
    formData.append('title', title.trim());
    formData.append('file', file);

    try {
      const response = await fetch(`${apiBase}/backgrounds`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to upload background');
      }

      setTitle('');
      setFile(null);
      const input = document.getElementById('admin-background-file') as HTMLInputElement | null;
      if (input) input.value = '';
      onChanged();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t.backgroundUploadError);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (background: MeditationBackground) => {
    setError(null);
    try {
      const response = await fetch(`${apiBase}/backgrounds?id=${encodeURIComponent(background.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete background');
      }
      onChanged();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t.backgroundDeleteError);
    }
  };

  return (
    <section className="background-manager">
      <div>
        <h3>{t.backgroundManagerTitle}</h3>
        <p>{t.backgroundManagerDesc}</p>
      </div>

      {error && <div className="global-chat-error">{error}</div>}

      <form onSubmit={handleSubmit} className="background-upload-form">
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t.backgroundTitlePlaceholder}
          required
          disabled={isUploading}
        />
        <div className="audio-file-picker">
          <input
            id="admin-background-file"
            className="audio-file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            required
            disabled={isUploading}
          />
          <label htmlFor="admin-background-file" className="audio-file-button">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
            <span>{t.chooseBackgroundFile}</span>
          </label>
          <span className={`audio-file-name ${file ? 'selected' : ''}`} title={file?.name}>
            {file?.name || t.imageFileNotSelected}
          </span>
        </div>
        <button type="submit" className="btn btn-primary" disabled={isUploading || !file || !title.trim()}>
          {isUploading ? t.uploadingMsg : t.uploadBackgroundBtn}
        </button>
      </form>

      <div className="background-manager-grid">
        {backgrounds.map((background) => (
          <article key={background.id} className="background-manager-card">
            <img src={background.imageUrl} alt="" />
            <div>
              <strong>{(t as any)[background.id] || background.title}</strong>
              <span>{background.isDefault ? t.defaultBackground : background.uploadedBy}</span>
            </div>
            {!background.isDefault && (
              <button
                type="button"
                className="background-delete-button"
                onClick={() => handleDelete(background)}
                aria-label={`${t.deleteTrackBtn}: ${background.title}`}
              >
                ×
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
