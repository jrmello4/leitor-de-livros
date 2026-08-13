import { useState, type FormEvent } from 'react';

export interface SmokeHarnessProps {
  onImportPath: (path: string) => Promise<void>;
  diagnostic: string | null;
}

export function SmokeHarness({ onImportPath, diagnostic }: SmokeHarnessProps) {
  const [path, setPath] = useState('');
  const [status, setStatus] = useState('Ready');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const sourcePath = path.trim();
    if (!sourcePath) {
      setStatus('Enter a source path');
      return;
    }

    setStatus('Importing…');
    try {
      await onImportPath(sourcePath);
      setStatus('Imported');
    } catch {
      setStatus('Import failed');
    }
  };

  return (
    <aside className="smoke-harness" data-testid="smoke-harness">
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Native smoke source
          <input
            data-testid="smoke-source-path"
            type="text"
            value={path}
            onChange={(event) => setPath(event.currentTarget.value)}
            placeholder="C:\\path\\to\\publication.cbz"
          />
        </label>
        <button data-testid="smoke-import" type="submit" disabled={status === 'Importing…'}>
          Import source
        </button>
      </form>
      <p data-testid="smoke-status" role="status" aria-live="polite">{status}</p>
      <p data-testid="smoke-diagnostic" role="alert">{diagnostic ?? ''}</p>
    </aside>
  );
}
