import { useState } from 'react';
import { createSyncBundleFromState, mergeSyncBundle, validateSyncBundle, type SyncBundle } from '../domain/sync';
import {
  loadAchievementsMap,
  loadAllReviews,
  loadFavorites,
  loadReadingStats,
  saveAchievementsMap,
  saveRawStorageValue,
  saveReadingStats,
} from '../services/storage';
import { t } from '../i18n/catalog';
import { CloseIcon, SyncIcon } from './Icons';

export interface SyncModalProps {
  onClose: () => void;
  onSyncApplied?: () => void;
}

export function SyncModal({ onClose, onSyncApplied }: SyncModalProps) {
  const [copied, setCopied] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);

  const getFullLocalBundle = (): SyncBundle => {
    const stats = loadReadingStats();
    const achievements = loadAchievementsMap();
    const reviews = loadAllReviews();
    const favorites = loadFavorites();

    let bookmarks = {};
    let progress = {};
    try {
      bookmarks = JSON.parse(localStorage.getItem('tactile-reader/bookmarks/v1') || '{}');
      progress = JSON.parse(localStorage.getItem('tactile-reader/progress/v1') || '{}');
    } catch {
      // ignore
    }

    return createSyncBundleFromState({
      stats,
      achievements,
      reviews,
      favorites,
      bookmarks,
      progress,
    });
  };

  const handleCopyCode = async () => {
    const bundle = getFullLocalBundle();
    const jsonStr = JSON.stringify(bundle);
    try {
      await navigator.clipboard.writeText(jsonStr);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  const handleDownloadFile = () => {
    const bundle = getFullLocalBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tactile-reader-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleApplyImport = () => {
    setImportError(null);
    setImportSuccess(false);
    try {
      const parsed = JSON.parse(importText.trim());
      if (!validateSyncBundle(parsed)) {
        setImportError('Arquivo de backup inválido ou versão incompatível.');
        return;
      }

      const current = getFullLocalBundle();
      let merged;
      try {
        merged = mergeSyncBundle(current, parsed);
      } catch {
        setImportError('Não foi possível mesclar este backup.');
        return;
      }

      // Save merged data
      saveReadingStats(merged.stats);
      saveAchievementsMap(merged.achievements);
      saveRawStorageValue('tactile-reader/reviews/v1', merged.reviews);
      saveRawStorageValue('tactile-reader/favorites/v1', merged.favorites);
      saveRawStorageValue('tactile-reader/bookmarks/v1', merged.bookmarks);
      saveRawStorageValue('tactile-reader/progress/v1', merged.progress);

      setImportSuccess(true);
      onSyncApplied?.();
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch {
      setImportError('Texto de importação corrompido ou formato JSON inválido.');
    }
  };

  return (
    <div className="collector-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="collector-modal-panel sync-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('sync.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="collector-modal-header">
          <div className="collector-modal-title-area">
            <span className="collector-modal-eyebrow">Backup local · sem nuvem</span>
            <h2>{t('sync.title')}</h2>
          </div>
          <button
            type="button"
            className="collector-modal-close"
            onClick={onClose}
            aria-label="Fechar backup"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="collector-modal-body">
          <section className="sync-section">
            <h3>{t('sync.export')}</h3>
            <p className="sync-desc">
              Exporte hábitos de leitura, conquistas, avaliações e favoritos deste aparelho para um arquivo JSON. Nada sai do aparelho sozinho; originais nunca são alterados.
            </p>
            <div className="sync-export-buttons">
              <button
                type="button"
                className="primary-button"
                onClick={handleCopyCode}
              >
                <SyncIcon />
                <span>{copied ? t('sync.copied') : t('sync.copy')}</span>
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={handleDownloadFile}
              >
                Baixar backup .JSON
              </button>
            </div>
          </section>

          <hr className="sync-divider" />

          <section className="sync-section">
            <h3>{t('sync.import')}</h3>
            <p className="sync-desc">
              Cole o conteúdo de um backup gerado neste aparelho para mesclar os dados locais.
            </p>
            <textarea
              className="sync-textarea"
              placeholder="Cole o conteúdo do backup JSON aqui..."
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={4}
            />

            {importError && (
              <div className="sync-error-banner" role="alert">
                ⚠️ {importError}
              </div>
            )}

            {importSuccess && (
              <div className="sync-success-banner" role="status">
                ✓ Backup restaurado! Atualizando biblioteca...
              </div>
            )}

            <div className="sync-import-actions">
              <button
                type="button"
                className="primary-button"
                onClick={handleApplyImport}
                disabled={!importText.trim()}
              >
                Aplicar backup
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
