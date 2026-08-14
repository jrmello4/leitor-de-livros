import { useRef, useState, type FormEvent } from 'react';

export type SmokeState =
  | { phase: 'ready' }
  | { phase: 'importing' }
  | { phase: 'imported' }
  | { phase: 'failed'; reason: 'missing-path' | 'import' };

export interface SmokeStatusCopy {
  ready: string;
  importing: string;
  imported: string;
  missingPath: string;
  importFailed: string;
}

const defaultSmokeStatusCopy: SmokeStatusCopy = {
  ready: 'Ready',
  importing: 'Importing…',
  imported: 'Imported',
  missingPath: 'Enter a source path',
  importFailed: 'Import failed',
};

export function smokeStatusText(state: SmokeState, copy: Partial<SmokeStatusCopy> = {}) {
  const statusCopy = { ...defaultSmokeStatusCopy, ...copy };
  if (state.phase === 'failed') {
    return state.reason === 'missing-path' ? statusCopy.missingPath : statusCopy.importFailed;
  }

  return statusCopy[state.phase];
}

export interface SmokeHarnessProps {
  onImportPath: (path: string) => Promise<void>;
  diagnostic: string | null;
  importSequence?: number;
  copy?: Partial<SmokeStatusCopy>;
}

export function SmokeHarness({ onImportPath, diagnostic, importSequence = 0, copy }: SmokeHarnessProps) {
  const [path, setPath] = useState('');
  const [state, setState] = useState<SmokeState>({ phase: 'ready' });
  const importInFlight = useRef(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.phase === 'importing' || importInFlight.current) {
      return;
    }

    const sourcePath = path.trim();
    if (!sourcePath) {
      setState({ phase: 'failed', reason: 'missing-path' });
      return;
    }

    importInFlight.current = true;
    setState({ phase: 'importing' });
    try {
      await onImportPath(sourcePath);
      setState({ phase: 'imported' });
    } catch {
      setState({ phase: 'failed', reason: 'import' });
    } finally {
      importInFlight.current = false;
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
        <button data-testid="smoke-import" type="submit" disabled={state.phase === 'importing'}>
          Import source
        </button>
      </form>
      <p data-testid="smoke-status" role="status" aria-live="polite">{smokeStatusText(state, copy)}</p>
      <span className="sr-only" data-testid="smoke-import-complete" data-sequence={importSequence} />
      <p data-testid="smoke-diagnostic" role="alert">{diagnostic ?? ''}</p>
    </aside>
  );
}
