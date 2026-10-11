import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const modulePath = new URL('../src/workspace.mjs', import.meta.url);
test('Windows device names and invalid path characters are rejected before IO', async()=>{
 const {WorkspaceService}=await import(modulePath);
 const svc=new WorkspaceService({projectsRoot:os.tmpdir(),backupRoot:os.tmpdir()});
 for(const name of ['docs/CON.md','docs/nul.json','docs/COM1.lua','docs/LPT9.js','docs/COM¹.md','docs/a?.md','docs/a*.js','docs/a|b.json','docs/a\u0001.md']) {
  assert.throws(()=>svc.checkedPath(os.tmpdir(),name),/path|device/i,name);
 }
 assert.equal(svc.checkedPath(os.tmpdir(),'docs/console.md'),path.join(os.tmpdir(),'docs/console.md'));
});
test('workspace authoring preserves originals and blocks stale writes and path escapes', async () => {
  const implementation = await import(modulePath).catch(() => ({}));
  assert.equal(typeof implementation.WorkspaceService, 'function', 'WorkspaceService must be implemented');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'world-mcp-test-'));
  const projectsRoot = path.join(root, 'projects');
  const ws = path.join(projectsRoot, 'project_demo', 'ai-sessions', 'workspace_demo');
  const rel = 'assets/module/module-box/meta.json';
  await fs.mkdir(path.dirname(path.join(ws, rel)), { recursive: true });
  await fs.mkdir(ws + '_log');
  await fs.writeFile(path.join(ws, rel), '{"name":"before"}');
  const svc = new implementation.WorkspaceService({ projectsRoot, backupRoot: path.join(root, 'backups') });
  const items = await svc.listWorkspaces();
  assert.equal(items.length, 1);
  assert.equal(items[0].workspaceId, 'workspace_demo');
  const selection = { projectId: 'project_demo', workspaceId: 'workspace_demo' };
  const old = await svc.readFile({ ...selection, file: rel });
  assert.equal(old.content, '{"name":"before"}');
  await assert.rejects(svc.readFile({ ...selection, file: '../secret.txt' }), /path|relative|scope/i);
  await assert.rejects(svc.readFile({ ...selection, file: 'C:/Windows/win.ini' }), /path|relative|scope/i);
  await assert.rejects(svc.writeFile({ ...selection, file: rel, content: '{}', expectedSha256: '0'.repeat(64) }), /changed|hash/i);
  const saved = await svc.writeFile({ ...selection, file: rel, content: '{"name":"after"}', expectedSha256: old.sha256 });
  assert.equal(await fs.readFile(saved.backupPath, 'utf8'), old.content);
  assert.equal((await svc.readFile({ ...selection, file: rel })).content, '{"name":"after"}');
  await assert.rejects(svc.writeFile({ ...selection, file: 'assets/module/module-box/package/meta.json', content: '{}', expectedSha256: null }), /author|package/i);
  await assert.rejects(svc.writeFile({ ...selection, file: 'assets/module/module-box/Package/meta.json', content: '{}', expectedSha256: null }), /author|package/i);
  await fs.mkdir(path.join(root, 'outside'));
  await fs.writeFile(path.join(root, 'outside', 'secret.txt'), 'secret');
  await fs.symlink(path.join(root, 'outside'), path.join(ws, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(svc.readFile({ ...selection, file: 'escape/secret.txt' }), /link|scope/i);
});

test('two MCP service instances cannot operate concurrently through workspace case aliases; locks release on failure', async () => {
  const { WorkspaceService } = await import(modulePath);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'world-mcp-lock-'));
  const projectsRoot = path.join(root, 'projects');
  await fs.mkdir(path.join(projectsRoot, 'project_demo/ai-sessions/workspace_demo'), { recursive: true });
  const settings = { projectsRoot, backupRoot: path.join(root, 'backups') };
  const one = new WorkspaceService(settings), two = new WorkspaceService(settings);
  assert.equal(typeof one.withWorkspaceLock, 'function', 'Operations need canonical cross-process workspace locks');
  const first = { projectId: 'project_demo', workspaceId: 'workspace_demo' };
  const alias = process.platform === 'win32' ? { projectId: 'project_DEMO', workspaceId: 'workspace_DEMO' } : first;
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const running = one.withWorkspaceLock(first, async () => { entered(); await hold; });
  await ready;
  await assert.rejects(two.withWorkspaceLock(alias, async () => 'bad'), /in progress|locked/i);
  release(); await running;
  await assert.rejects(one.withWorkspaceLock(first, async () => { throw new Error('intentional'); }), /intentional/);
  assert.equal(await two.withWorkspaceLock(alias, async () => 'released'), 'released');
});
