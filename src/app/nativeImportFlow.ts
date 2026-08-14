export type NativeImportRequest =
  | { kind: 'paths'; paths: string[] }
  | { kind: 'files' }
  | { kind: 'folder' };

export interface NativeImportPickers {
  chooseFiles(): Promise<string[]>;
  chooseFolder(): Promise<string[]>;
}

export type NativeImportResolution =
  | { kind: 'cancelled' }
  | { kind: 'selected'; paths: string[] };

export async function resolveNativeImportRequest(
  request: NativeImportRequest,
  pickers: NativeImportPickers,
): Promise<NativeImportResolution> {
  const paths = request.kind === 'paths'
    ? request.paths
    : request.kind === 'files'
      ? await pickers.chooseFiles()
      : await pickers.chooseFolder();

  return paths.length === 0
    ? { kind: 'cancelled' }
    : { kind: 'selected', paths };
}
