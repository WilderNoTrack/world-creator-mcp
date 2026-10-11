# Security model

This unofficial adapter is intended for a trusted local MCP client and a trusted, signed-in editor. It is not a sandbox for untrusted agents, JavaScript, Lua, models, or users.

## Enforced boundaries

- CDP discovery and WebSocket targets are restricted to a configured loopback HTTP origin and the editor/homepage route. The debug endpoint has no separate MCP authentication; do not expose or forward it to a network.
- Every project-scoped renderer call pins the full configured project directory. Discovery rejects projects outside the configured root. Repeated project IDs in another directory do not authorize changes there.
- Workspace text paths reject traversal, links/junctions, Windows device names and invalid characters. Author writes require SHA-256 comparison and back up previous bytes. Project script writes preserve native identity annotations, compile Lua, and use a project lock plus editor lease.
- Native child processes omit known credential environment variables, have bounded output and a timeout. They still run with the current OS user's privileges: executable author JavaScript can read files or access the network. Only inspect/archive trusted workspaces.
- There is no arbitrary JavaScript-evaluation MCP tool. Fixed renderer handlers still depend on the editor's internal services and the local debug connection.
- GLB import uploads the explicitly supplied file through the editor account. PCG may consume credits. World upload requires a prepared plan, unchanged scene and scripts, an explicit confirmation flag and request ID. Client hints/confirmation flags are not a substitute for human authorization.

## Failure recovery

Native timeouts have an unknown outcome. Read the scene, job and save state before retrying. Job deduplication survives MCP reconnects but not renderer restarts. Cancellation can leave partial scene changes. Do not switch projects or manually edit affected content during an operation.

Backups, captures and lock files remain in `.local/`. A crashed worker may leave a lock; check its recorded PID and the current editor state before removing it. A interrupted script lease may require reconnecting or restarting the editor. Never delete backup files as an automatic recovery step.

The OS filesystem and editor can be modified concurrently by other trusted processes. Hash checks and locks reduce accidental conflicts; they are not isolation from a malicious process running as the same user. Future editor upgrades require renewed testing.

## Public distribution

Release packaging uses a tracked-file allowlist and rejects unexpected paths, private-key/token patterns and local adapter output. Dependencies and proprietary editor bundles are excluded. This reduces accidental publication risk; automated scans do not prove the absence of all secrets or vulnerabilities.

To report an issue, use a minimal sanitized reproduction. Never post tokens, signed asset URLs, complete private projects, or editor logs containing credentials in public issues. Use GitHub private vulnerability reporting if enabled on the repository.
