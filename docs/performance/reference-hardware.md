# Reference-hardware performance validation

Issue #12 is validated by a manual Windows run on each reference GPU class. The runner builds an isolated Tauri installer, generates deterministic CBZ fixtures in a temporary directory, drives the installed app through WebView2 CDP, and writes JSON metrics only. It does not capture screenshots or upload publication pages.

## Required runs

Run once on a representative integrated-GPU Windows machine and once on a representative dedicated-GPU Windows machine. Use the same repository commit, Node/Rust toolchain, display scale, power mode, and fixture generator for both runs.

```powershell
$env:PERFORMANCE_GPU_CLASS = 'integrated'
$env:PERFORMANCE_RUNNER_LABEL = 'reference-integrated'
$env:PERFORMANCE_REPORT_DIR = 'artifacts/performance/integrated'
npm.cmd run test:performance
```

Repeat with `PERFORMANCE_GPU_CLASS='dedicated'`, a dedicated-GPU runner label, and `artifacts/performance/dedicated`. Compare the two reports after downloading both artifacts:

```powershell
npm.cmd run performance:compare -- `
  artifacts/performance/integrated/<run-id>/performance-report.json `
  artifacts/performance/dedicated/<run-id>/performance-report.json
```

The comparison exits nonzero unless both reports have the same schema/build identity and both pass the bounded-growth and quality-before-stall criteria.

## Scenarios and measurements

- `import`: imports a generated 50-page CBZ and records import completion latency.
- `first-frame`: records time from the import action to two animation frames after the reader surface is ready.
- `navigation-50-pages`: advances through all 50 pages and records browser frame samples, quality transitions, and cache usage before/after.
- `rapid-publication-switching`: imports two additional eight-page CBZs and opens them alternately 12 times.
- `long-reading-session`: traverses pages 1–50 and back twice, waits two seconds for steady state, and records process-tree memory plus cache growth.

Frame samples are browser `requestAnimationFrame` intervals. Memory is the private memory of the Tauri process and its descendants, sampled every 500 ms. Cache values come from the existing native `get_cache_info` command. No page pixels, OCR text, source paths, or screenshots are included in the report.

## Machine-checkable thresholds

| Metric | Limit |
| --- | ---: |
| First frame | ≤ 1500 ms |
| Navigation frame-time p95 | ≤ 33.4 ms |
| Rapid-switch frame-time p95 | ≤ 50 ms |
| Long-session steady minus baseline memory | ≤ 256 MiB |
| Long-session derived-cache growth | ≤ 512 MiB |

Quality evidence records `data-quality` transitions from the existing adaptive renderer. A transition to a lower quality tier must precede the first frame over the interaction-stall threshold. If no transition is needed and no stall occurs, the report records that quality reduction was not required.

## GitHub Actions

The `performance` job is manual (`workflow_dispatch`). Supply `performance_gpu_class` and `performance_runner`; use self-hosted runner labels for the integrated and dedicated reference systems. Each run uploads only `artifacts/performance/**` and the isolated Tauri bundle/logs. Run the job twice, then use `performance:compare` on the two downloaded JSON reports.
