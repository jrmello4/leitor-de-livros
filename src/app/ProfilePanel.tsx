import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ActionName, CacheInfo, ReadingProfile } from '../domain/types';
import { bindingLabel } from '../domain/input';
import { actionLabel, availableLocales, getLocale, setLocale, t } from '../i18n/catalog';
import type { NamedReadingProfile } from '../domain/profiles';

interface ProfilePanelProps {
  profile: ReadingProfile;
  capturingAction: ActionName | null;
  onChange: (patch: Partial<ReadingProfile>) => void;
  onStartCapture: (action: ActionName) => void;
  onReset: () => void;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  cacheInfo?: CacheInfo;
  cacheAvailable?: boolean;
  onSetCacheLimit?: (maxBytes: number) => void | Promise<void>;
  onClearCache?: () => void | Promise<void>;
  profiles?: NamedReadingProfile[];
  activeProfileId?: string;
  onSelectProfile?: (profileId: string) => string | undefined;
  onCreateProfile?: (name: string) => string | undefined;
  onDuplicateProfile?: () => string | undefined;
  onRenameProfile?: (name: string) => string | undefined;
  onDeleteProfile?: () => string | undefined;
  isPreviewing?: boolean;
  onSavePreview?: () => void;
  onUndoPreview?: () => void;
  onImportProfiles?: (text: string) => string | undefined | Promise<string | undefined>;
  onExportProfiles?: () => void;
}

const CACHE_LIMITS = [
  { value: 512 * 1024 * 1024 },
  { value: 1 * 1024 * 1024 * 1024 },
  { value: 2 * 1024 * 1024 * 1024 },
  { value: 5 * 1024 * 1024 * 1024 },
] as const;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return t('profile.bytesGiB', {
      value: (bytes / (1024 * 1024 * 1024)).toFixed(bytes % (1024 * 1024 * 1024) === 0 ? 0 : 1),
    });
  }
  return t('profile.bytesMiB', { value: Math.round(bytes / (1024 * 1024)) });
}

function defaultCacheInfo(): CacheInfo {
  return { usedBytes: 0, maxBytes: 2 * 1024 * 1024 * 1024, entryCount: 0 };
}

const profileActions: ActionName[] = [
  'next_page',
  'previous_page',
  'toggle_library',
  'toggle_fullscreen',
  'toggle_settings',
  'toggle_spread',
  'toggle_navigator',
  'toggle_bookmark',
  'cancel',
];

export function ProfilePanel({
  profile,
  capturingAction,
  onChange,
  onStartCapture,
  onReset,
  onClose,
  triggerRef,
  cacheInfo = defaultCacheInfo(),
  cacheAvailable = true,
  onSetCacheLimit = () => undefined,
  onClearCache = () => undefined,
  profiles = [],
  activeProfileId = '',
  onSelectProfile = () => undefined,
  onCreateProfile = () => undefined,
  onDuplicateProfile = () => undefined,
  onRenameProfile = () => undefined,
  onDeleteProfile = () => undefined,
  isPreviewing = false,
  onSavePreview = () => undefined,
  onUndoPreview = () => undefined,
  onImportProfiles = () => undefined,
  onExportProfiles = () => undefined,
}: ProfilePanelProps) {
  const selectedCacheLimit = CACHE_LIMITS.some((limit) => limit.value === cacheInfo.maxBytes)
    ? cacheInfo.maxBytes
    : 2 * 1024 * 1024 * 1024;
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [nameDraft, setNameDraft] = useState(profile.name);
  const [currentLocale, setCurrentLocale] = useState(getLocale);
  const [profileError, setProfileError] = useState<string | undefined>();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setNameDraft(profile.name);
    setProfileError(undefined);
  }, [activeProfileId, profile.name]);

  const runProfileAction = (action: () => string | undefined) => {
    const error = action();
    setProfileError(error);
    if (!error) {
      setNameDraft('');
    }
  };

  const onImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    try {
      const error = await onImportProfiles(await file.text());
      setProfileError(error);
    } catch {
      setProfileError(t('profile.transferError'));
    }
  };

  useEffect(() => {
    const activeElement = document.activeElement;
    const opener = activeElement instanceof HTMLElement && activeElement !== document.body
      ? activeElement
      : triggerRef.current;
    closeRef.current?.focus();

    const focusableSelector = [
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const restoreTarget = opener?.isConnected ? opener : triggerRef.current;
      restoreTarget?.focus();
    };
  }, [triggerRef]);

  return (
    <aside
      ref={panelRef}
      className="profile-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-panel-title"
      tabIndex={-1}
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{t('profile.heading')}</span>
          <h2 id="profile-panel-title">{profile.name}</h2>
        </div>
        <button ref={closeRef} className="panel-close" onClick={onClose} aria-label={t('profile.close')}>×</button>
      </div>

      <div className="panel-scroll">
        <section className="settings-section profile-management-section">
          <span className="settings-label">{t('profile.named')}</span>
          <label className="setting-row" htmlFor="profile-select">
            <span>{t('profile.active')}</span>
            <select
              id="profile-select"
              aria-label={t('profile.activeAria')}
              value={activeProfileId || profile.id || profiles[0]?.id || ''}
              onChange={(event) => runProfileAction(() => onSelectProfile(event.target.value))}
            >
              {profiles.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
          </label>
          <label className="setting-row setting-row--stacked" htmlFor="profile-name">
            <span>{t('profile.name')}</span>
            <input
              id="profile-name"
              value={nameDraft}
              maxLength={80}
              onChange={(event) => setNameDraft(event.target.value)}
            />
          </label>
          <div className="profile-actions">
            <button type="button" className="secondary-button" onClick={() => runProfileAction(() => onRenameProfile(nameDraft))}>{t('profile.rename')}</button>
            <button type="button" className="secondary-button" onClick={() => runProfileAction(() => onCreateProfile(nameDraft))}>{t('profile.new')}</button>
            <button type="button" className="secondary-button" onClick={() => runProfileAction(onDuplicateProfile)}>{t('profile.duplicate')}</button>
            <button type="button" className="quiet-button" disabled={profiles.length <= 1} onClick={() => runProfileAction(onDeleteProfile)}>{t('profile.delete')}</button>
          </div>
          {profileError && <p className="settings-help profile-error" role="alert">{profileError}</p>}
          <p className="settings-help">{t('profile.copy')}</p>
          <div className="profile-transfer-actions">
            <button type="button" className="secondary-button" onClick={onExportProfiles}>{t('profile.export')}</button>
            <label className="secondary-button profile-import-button">
              {t('profile.import')}
              <input type="file" accept="application/json,.json" onChange={(event) => void onImportFile(event)} />
            </label>
          </div>
        </section>

        <section className="settings-section">
          <span className="settings-label">{t('profile.surface')}</span>
          <label className="setting-row" htmlFor="page-arrangement">
            <span>{t('profile.arrangement')}</span>
            <select id="page-arrangement" value={profile.mode} onChange={(event) => onChange({ mode: event.target.value as ReadingProfile['mode'] })}>
              <option value="single">{t('profile.single')}</option>
              <option value="spread">{t('profile.spread')}</option>
            </select>
          </label>
          <label className="setting-row" htmlFor="reading-direction">
            <span>{t('profile.direction')}</span>
            <select id="reading-direction" value={profile.direction} onChange={(event) => onChange({ direction: event.target.value as ReadingProfile['direction'] })}>
              <option value="ltr">{t('profile.ltr')}</option>
              <option value="rtl">{t('profile.rtl')}</option>
            </select>
          </label>
          <label className="setting-row" htmlFor="layout-zone">
            <span>{t('profile.layout')}</span>
            <select id="layout-zone" value={profile.layoutZone} onChange={(event) => onChange({ layoutZone: event.target.value as ReadingProfile['layoutZone'] })}>
              <option value="top">{t('profile.top')}</option>
              <option value="bottom">{t('profile.bottom')}</option>
              <option value="left">{t('profile.left')}</option>
              <option value="right">{t('profile.right')}</option>
            </select>
          </label>
          <label className="setting-row" htmlFor="profile-zoom-mode">
            <span>{t('profile.zoomMode')}</span>
            <select id="profile-zoom-mode" value={profile.zoomMode} onChange={(event) => onChange({ zoomMode: event.target.value as ReadingProfile['zoomMode'] })}>
              <option value="page">{t('profile.fitPage')}</option>
              <option value="width">{t('profile.fitWidth')}</option>
              <option value="manual">{t('profile.manualZoom')}</option>
            </select>
          </label>
          <label className="setting-row setting-row--stacked" htmlFor="profile-zoom-scale">
            <span>{t('profile.zoomScale', { percent: Math.round(profile.zoomScale * 100) })}</span>
            <input
              id="profile-zoom-scale"
              type="range"
              min="0.5"
              max="3"
              step="0.05"
              value={profile.zoomScale}
              onChange={(event) => onChange({ zoomScale: Number(event.target.value) })}
            />
          </label>
          <label className="setting-row setting-row--stacked" htmlFor="turn-duration">
            <span>{t('profile.turnDuration', { duration: profile.pageTurnDuration })}</span>
            <input
              id="turn-duration"
              type="range"
              min="180"
              max="900"
              step="30"
              value={profile.pageTurnDuration}
              onChange={(event) => onChange({ pageTurnDuration: Number(event.target.value) })}
            />
          </label>
        </section>

        <section className="settings-section">
          <span className="settings-label">{t('profile.access')}</span>
          <label className="toggle-row" htmlFor="reduced-motion">
            <span><strong>{t('profile.reducedMotion')}</strong><small>{t('profile.reducedMotionCopy')}</small></span>
            <input
              id="reduced-motion"
              type="checkbox"
              checked={profile.reducedMotion}
              onChange={(event) => onChange({ reducedMotion: event.target.checked })}
            />
          </label>
          <label className="setting-row" htmlFor="contrast-mode">
            <span>{t('profile.contrast')}</span>
            <select id="contrast-mode" value={profile.contrast} onChange={(event) => onChange({ contrast: event.target.value as ReadingProfile['contrast'] })}>
              <option value="standard">{t('profile.standard')}</option>
              <option value="high">{t('profile.highContrast')}</option>
            </select>
          </label>
          <label className="setting-row" htmlFor="interface-language">
            <span>{t('profile.language')}</span>
            <select
              id="interface-language"
              value={currentLocale}
              onChange={(event) => {
                setLocale(event.target.value);
                setCurrentLocale(event.target.value);
              }}
            >
              {availableLocales().map((locale) => (
                <option key={locale.code} value={locale.code}>{locale.label}</option>
              ))}
            </select>
          </label>
        </section>

        <section className="settings-section cache-section">
          <span className="settings-label">{t('profile.cache')}</span>
          <div className="cache-summary" aria-live="polite">
            <div>
              <strong>{formatBytes(cacheInfo.usedBytes)}</strong>
              <span>{t('profile.cacheUsed', { used: formatBytes(cacheInfo.usedBytes), max: formatBytes(cacheInfo.maxBytes) })}</span>
            </div>
            <span>{t('profile.derivedPages', { count: cacheInfo.entryCount })}</span>
          </div>
          <div className="cache-meter" aria-hidden="true">
            <span style={{ width: `${Math.min(100, cacheInfo.maxBytes > 0 ? (cacheInfo.usedBytes / cacheInfo.maxBytes) * 100 : 0)}%` }} />
          </div>
          {!cacheAvailable && <p className="settings-help cache-help">{t('profile.cacheDesktop')}</p>}
          <label className="setting-row" htmlFor="cache-limit">
            <span>{t('profile.cacheLimit')}</span>
            <select
              id="cache-limit"
              disabled={!cacheAvailable}
              value={selectedCacheLimit}
              onChange={(event) => void onSetCacheLimit(Number(event.target.value))}
            >
              {CACHE_LIMITS.map((limit) => (
                <option key={limit.value} value={limit.value}>{formatBytes(limit.value)}</option>
              ))}
            </select>
          </label>
          {cacheAvailable && <p className="settings-help cache-help">{t('profile.cacheHelp')}</p>}
          <button className="secondary-button cache-clear-button" type="button" disabled={!cacheAvailable} aria-label={t('profile.clearCacheAria')} onClick={() => void onClearCache()}>
            {t('profile.clearCache')}
          </button>
        </section>

        <section className="settings-section">
          <span className="settings-label">{t('profile.keyboard')}</span>
          <p className="settings-help">{t('profile.keyboardHelp')}</p>
          <div className="binding-list">
            {profileActions.map((action) => (
              <div className="binding-row" key={action}>
                <span>{actionLabel(action)}</span>
                <button className={capturingAction === action ? 'binding-key binding-key--waiting' : 'binding-key'} onClick={() => onStartCapture(action)}>
                  {capturingAction === action ? t('profile.pressKey') : bindingLabel(profile.bindings[action][0] ?? t('profile.unassigned'))}
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="panel-footer">
        {isPreviewing && (
          <>
            <button className="secondary-button" type="button" onClick={onUndoPreview}>{t('profile.undoPreview')}</button>
            <button className="primary-button" type="button" onClick={onSavePreview}>{t('profile.savePreview')}</button>
          </>
        )}
        <button className="quiet-button" onClick={onReset}>{t('profile.reset')}</button>
        <span>{isPreviewing ? t('profile.previewing') : t('profile.saved')}</span>
      </div>
    </aside>
  );
}
