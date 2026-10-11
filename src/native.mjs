import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const workerPath = fileURLToPath(new URL('../.local/native-worker.cjs', import.meta.url));

export async function runNative(operation, workspace, args, signal) {
  if (!fs.existsSync(workerPath)) throw new Error('Native adapter missing: run npm run build:adapter');
  return new Promise((resolve, reject) => {
    // Do not pass API keys or editor tokens to author code.
    const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
    const adapterInfo = JSON.parse(fs.readFileSync(new URL('../.local/adapter-info.json', import.meta.url), 'utf8'));
    env.OPENCODE_CONFIG_DIR = path.join(adapterInfo.installRoot, 'resources/addon/agent-runtime');
    const child = spawn(process.execPath, [workerPath], { windowsHide: true, cwd: workspace || undefined, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', failure;
    // Keep the workspace lock until the child has actually exited after cancellation.
    const fail = error => { if (!failure) { failure = error; child.kill(); } };
    const timeout = setTimeout(() => fail(new Error('Native operation exceeded 90 seconds; inspect backups before retrying an archive')), 90000);
    const abort = () => fail(new Error('Native operation cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { if (!failure) { stdout += chunk; if (Buffer.byteLength(stdout) > 8 * 1024 * 1024) fail(new Error('Native result exceeds output limit')); } });
    child.stderr.on('data', chunk => { if (stderr.length < 8192) stderr += chunk; });
    child.stdin.on('error', fail);
    child.on('error', fail);
    child.on('close', code => {
      clearTimeout(timeout); signal?.removeEventListener('abort', abort);
      if (failure) { reject(failure); return; }
      try {
        const parsed = JSON.parse(stdout);
        if (!parsed.ok || code !== 0) throw new Error(parsed.error || 'Native worker failed');
        resolve(parsed);
      } catch (e) { reject(new Error(`Native tool failed: ${e.message}${stdout ? '' : ` (${stderr.slice(0, 800)})`}`)); }
    });
    child.stdin.end(JSON.stringify({ operation, workspace, args }));
  });
}
