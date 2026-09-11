import { useCallback, useEffect, useState } from 'react';
import { t } from '../i18n/catalog';
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  isUpdaterAvailable,
  type UpdateManifest,
} from '../services/updater';

export type UpdateCheckState = 'idle' | 'checking' | 'available' | 'up-to-date' | 'downloading' | 'error';

export interface AppUpdaterProps {
  currentVersion: string;
}

export function AppUpdater({ currentVersion }: AppUpdaterProps) {
  const [state, setState] = useState<UpdateCheckState>('idle');
  const [manifest, setManifest] = useState<UpdateManifest | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const runCheck = useCallback(async () => {
    if (!isUpdaterAvailable()) {
      setState('idle');
      setMessage(t('updater.androidOnly'));
      return;
    }
    setState('checking');
    setMessage(null);
    try {
      const next = await checkForUpdate(currentVersion);
      if (next) {
        setManifest(next);
        setState('available');
      } else {
        setManifest(null);
        setState('up-to-date');
      }
    } catch (error) {
      setManifest(null);
      setState('error');
      setMessage(error instanceof Error ? error.message : t('updater.checkFailed'));
    }
  }, [currentVersion]);

  useEffect(() => {
    if (isUpdaterAvailable()) {
      void runCheck();
    }
  }, [runCheck]);

  const runInstall = useCallback(async () => {
    if (!manifest?.url) {
      return;
    }
    setState('downloading');
    setMessage(null);
    try {
      await downloadAndInstallUpdate(manifest.url);
      // The system installer takes over; keep a short status line.
      setMessage(t('updater.installerOpened'));
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : t('updater.installFailed'));
    }
  }, [manifest]);

  if (!isUpdaterAvailable()) {
    return (
      <section className="settings-section app-updater-section" data-testid="app-updater">
        <span className="settings-label">{t('updater.title')}</span>
        <p className="settings-help">{t('updater.androidOnly')}</p>
      </section>
    );
  }

  return (
    <section className="settings-section app-updater-section" data-testid="app-updater">
      <span className="settings-label">{t('updater.title')}</span>
      <p className="settings-help">
        {t('updater.current', { version: currentVersion })}
      </p>
      {state === 'available' && manifest && (
        <p className="settings-help app-updater-available" role="status">
          {t('updater.available', { version: manifest.version })}
          {manifest.notes ? ` — ${manifest.notes}` : ''}
        </p>
      )}
      {state === 'up-to-date' && (
        <p className="settings-help" role="status">{t('updater.upToDate')}</p>
      )}
      {state === 'checking' && (
        <p className="settings-help" role="status">{t('updater.checking')}</p>
      )}
      {message && (
        <p className="settings-help app-updater-message" role={state === 'error' ? 'alert' : 'status'}>
          {message}
        </p>
      )}
      <div className="app-updater-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => void runCheck()}
          disabled={state === 'checking' || state === 'downloading'}
        >
          {t('updater.check')}
        </button>
        {manifest && (state === 'available' || state === 'downloading' || state === 'error') && (
          <button
            type="button"
            className="primary-button"
            onClick={() => void runInstall()}
            disabled={state === 'downloading'}
          >
            {state === 'downloading' ? t('updater.downloading') : t('updater.install')}
          </button>
        )}
      </div>
    </section>
  );
}
