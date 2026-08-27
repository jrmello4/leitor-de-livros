import { useMemo, useState } from 'react';
import { generateLocalRecap, fetchGeminiRecap } from '../domain/recap';
import type { Publication } from '../domain/types';
import { t } from '../i18n/catalog';
import { CloseIcon, SparklesIcon } from './Icons';

export interface RecapModalProps {
  publication: Publication;
  currentPageIndex: number;
  onClose: () => void;
}

export function RecapModal({ publication, currentPageIndex, onClose }: RecapModalProps) {
  const recap = useMemo(() => generateLocalRecap(publication, currentPageIndex), [publication, currentPageIndex]);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem('tactile-reader/gemini-api-key') || '';
    } catch {
      return '';
    }
  });
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);

  const handleGenerateAi = async () => {
    if (!apiKey.trim()) {
      setShowApiKeyInput(true);
      return;
    }
    setIsLoadingAi(true);
    setAiError(null);
    try {
      localStorage.setItem('tactile-reader/gemini-api-key', apiKey.trim());
      const result = await fetchGeminiRecap(publication, currentPageIndex, apiKey.trim());
      setAiSummary(result);
      setShowApiKeyInput(false);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Falha ao conectar à API do Gemini.');
    } finally {
      setIsLoadingAi(false);
    }
  };

  return (
    <div className="collector-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="collector-modal-panel recap-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('recap.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="collector-modal-header">
          <div className="collector-modal-title-area">
            <span className="collector-modal-eyebrow">{t('recap.title')}</span>
            <h2>{publication.title}</h2>
            <p className="recap-progress-badge">
              <span>Página {recap.pageIndex + 1} de {recap.pageCount}</span>
              <span className="recap-progress-percent">({recap.progressPercent}% lido)</span>
            </p>
          </div>
          <button
            type="button"
            className="collector-modal-close"
            onClick={onClose}
            aria-label="Fechar resumo"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="collector-modal-body">
          <div className="recap-milestone-banner">
            <span className="recap-milestone-icon">🧭</span>
            <div>
              <strong>{t('recap.milestone')}</strong>
              <p>{recap.currentMilestone}</p>
            </div>
          </div>

          <section className="recap-section">
            <h3>{t('recap.premise')}</h3>
            <p className="recap-premise-text">{recap.premise}</p>
          </section>

          {recap.activeCharacters.length > 0 && (
            <section className="recap-section">
              <h3>{t('recap.characters')}</h3>
              <div className="collector-tags-row">
                {recap.activeCharacters.map((char) => (
                  <span key={char} className="collector-char-tag">{char}</span>
                ))}
              </div>
            </section>
          )}

          {/* AI Narrative Expansion */}
          <section className="recap-ai-section">
            <div className="recap-ai-header">
              <div className="recap-ai-title">
                <SparklesIcon />
                <span>Resumo Dinâmico com IA (Sem Spoilers)</span>
              </div>
              <button
                type="button"
                className="secondary-button recap-ai-trigger"
                onClick={handleGenerateAi}
                disabled={isLoadingAi}
              >
                {isLoadingAi ? 'Sintetizando...' : t('recap.aiRefresh')}
              </button>
            </div>

            {showApiKeyInput && (
              <div className="recap-api-key-box">
                <p className="eyebrow">Insira sua chave gratuita da API do Gemini (Google AI Studio):</p>
                <div className="recap-api-key-row">
                  <input
                    type="password"
                    className="recap-api-key-input"
                    placeholder="AIzaSy..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  <button
                    type="button"
                    className="primary-button"
                    onClick={handleGenerateAi}
                    disabled={!apiKey.trim()}
                  >
                    Confirmar
                  </button>
                </div>
              </div>
            )}

            {aiError && (
              <div className="recap-error-banner" role="alert">
                ⚠️ {aiError}
              </div>
            )}

            {aiSummary && (
              <div className="recap-ai-content">
                <p>{aiSummary}</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
