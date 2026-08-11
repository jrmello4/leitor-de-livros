import type { ActionName, ReadingProfile } from '../domain/types';
import { ACTION_LABELS, bindingLabel } from '../domain/input';

interface ProfilePanelProps {
  profile: ReadingProfile;
  capturingAction: ActionName | null;
  onChange: (patch: Partial<ReadingProfile>) => void;
  onStartCapture: (action: ActionName) => void;
  onReset: () => void;
  onClose: () => void;
}

const profileActions: ActionName[] = [
  'next_page',
  'previous_page',
  'toggle_library',
  'toggle_fullscreen',
  'toggle_settings',
  'toggle_spread',
  'cancel',
];

export function ProfilePanel({
  profile,
  capturingAction,
  onChange,
  onStartCapture,
  onReset,
  onClose,
}: ProfilePanelProps) {
  return (
    <aside className="profile-panel" aria-label="Reader settings">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">PROFILE / V1</span>
          <h2>{profile.name}</h2>
        </div>
        <button className="panel-close" onClick={onClose} aria-label="Close settings">×</button>
      </div>

      <div className="panel-scroll">
        <section className="settings-section">
          <span className="settings-label">Reading surface</span>
          <label className="setting-row" htmlFor="page-arrangement">
            <span>Page arrangement</span>
            <select id="page-arrangement" value={profile.mode} onChange={(event) => onChange({ mode: event.target.value as ReadingProfile['mode'] })}>
              <option value="single">Single page</option>
              <option value="spread">Two-page spread</option>
            </select>
          </label>
          <label className="setting-row" htmlFor="reading-direction">
            <span>Reading direction</span>
            <select id="reading-direction" value={profile.direction} onChange={(event) => onChange({ direction: event.target.value as ReadingProfile['direction'] })}>
              <option value="ltr">Left to right</option>
              <option value="rtl">Right to left</option>
            </select>
          </label>
          <label className="setting-row setting-row--stacked" htmlFor="turn-duration">
            <span>Turn duration <strong>{profile.pageTurnDuration} ms</strong></span>
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
          <span className="settings-label">Access</span>
          <label className="toggle-row" htmlFor="reduced-motion">
            <span><strong>Reduced motion</strong><small>Removes the fold animation and keeps navigation immediate.</small></span>
            <input
              id="reduced-motion"
              type="checkbox"
              checked={profile.reducedMotion}
              onChange={(event) => onChange({ reducedMotion: event.target.checked })}
            />
          </label>
          <label className="setting-row" htmlFor="contrast-mode">
            <span>Contrast</span>
            <select id="contrast-mode" value={profile.contrast} onChange={(event) => onChange({ contrast: event.target.value as ReadingProfile['contrast'] })}>
              <option value="standard">Paper standard</option>
              <option value="high">High contrast</option>
            </select>
          </label>
        </section>

        <section className="settings-section">
          <span className="settings-label">Keyboard actions</span>
          <p className="settings-help">Choose an action, then press a key. Conflicts are rejected so the route back to the library remains available.</p>
          <div className="binding-list">
            {profileActions.map((action) => (
              <div className="binding-row" key={action}>
                <span>{ACTION_LABELS[action]}</span>
                <button className={capturingAction === action ? 'binding-key binding-key--waiting' : 'binding-key'} onClick={() => onStartCapture(action)}>
                  {capturingAction === action ? 'Press a key…' : bindingLabel(profile.bindings[action][0] ?? 'Unassigned')}
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="panel-footer">
        <button className="quiet-button" onClick={onReset}>Reset profile</button>
        <span>Saved on this device</span>
      </div>
    </aside>
  );
}
