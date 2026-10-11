# Changelog

## 0.6.0 — 2026-10-11

- Enforce the configured full project directory for all renderer operations, including discovery and preflight before GLB reads/uploads. Reject conflicting caller-supplied project roots.
- Reject Windows reserved device filenames and invalid author-path characters before filesystem access.
- Correct network/executable-code permission hints for local preview, model inspection and archive.
- Replace personal paths and private smoke fixtures with explicit configuration; import integration tests require an explicit project, model path and upload flag.
- Add stdio discovery/annotation regression tests, public tool catalog, CI and source-only release packaging with checksums.
- Preserve 56 tools. No claim of Lua breakpoint support or fully verified world publishing.

## 0.5.x

- Added asset search, sprinkle selection, environment/world settings and project Lua management.
- Added native terrain queries, canvas capture and runtime object diagnostics.
- Verified an enterable forge and native sword pickup/holding/drop workflow through authored scene scripts. World assets are not included in this repository.
