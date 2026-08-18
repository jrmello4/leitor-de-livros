import { parseVisualBackend, type VisualBackend } from '../release/testModes';

export function resolveBackendPreference(search: string, visualBuild: boolean): VisualBackend {
  return parseVisualBackend(search, visualBuild);
}
