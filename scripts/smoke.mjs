import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const existing = process.env.WORLD_CREATOR_SMOKE_MODULE;
const find=process.env.WORLD_CREATOR_SMOKE_FIND, replacement=process.env.WORLD_CREATOR_SMOKE_REPLACE;
if(!existing||!path.isAbsolute(existing)||!find||!replacement||find===replacement)throw new Error('Explicit WORLD_CREATOR_SMOKE_MODULE absolute path, WORLD_CREATOR_SMOKE_FIND and WORLD_CREATOR_SMOKE_REPLACE required; use a trusted model source change that alters geometry.');
const resourceId = path.basename(existing);
const projects = path.join(root, '.local', `smoke-${crypto.randomUUID()}`, 'projects');
const workspace = path.join(projects, 'project_smoke/ai-sessions/workspace_smoke');
await fs.mkdir(path.join(workspace, 'assets/module'), { recursive: true });
await fs.cp(existing, path.join(workspace, 'assets/module', resourceId), { recursive: true });
await fs.cp(path.resolve(existing, '../../..', 'official'), path.join(workspace, 'official'), { recursive: true });
const server = path.join(root, 'src/server.mjs');
try { await fs.access(server); } catch { assert.fail('MCP server must be implemented for the real round trip'); }
const client = new Client({ name: 'world-creator-smoke', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [server], stderr: 'pipe', env: { ...process.env, WORLD_CREATOR_PROJECTS: projects } });
const selection = { projectId: 'project_smoke', workspaceId: 'workspace_smoke', resourceId };
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  return JSON.parse(result.content.find(c => c.type === 'text').text);
};
try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  const workspaces = await call('worldcreator_list_workspaces');
  assert.equal(workspaces.length, 1);
  const models = await call('worldcreator_models');
  assert.ok(models.defaults && models.configuredModels);
  const before = await call('worldcreator_inspect_model', { ...selection, query: 'nodes', nodePaths: [''] });
  const file = `assets/module/${resourceId}/static/preview-module.js`;
  const source = await call('worldcreator_read_file', { ...selection, file });
  assert.ok(source.content.includes(find), 'Smoke source must contain WORLD_CREATOR_SMOKE_FIND');
  const saved = await call('worldcreator_write_file', { ...selection, file, content: source.content.replace(find, replacement), expectedSha256: source.sha256 });
  assert.equal(await fs.readFile(saved.backupPath, 'utf8'), source.content);
  const after = await call('worldcreator_inspect_model', { ...selection, query: 'nodes', nodePaths: [''] });
  assert.notDeepEqual(after.nodes[0].boundingBox, before.nodes[0].boundingBox, 'Configured source change must change actual model geometry');
  const stale = await client.callTool({ name: 'worldcreator_write_file', arguments: { ...selection, file, content: source.content, expectedSha256: source.sha256 } });
  assert.equal(stale.isError, true);
  const archive = await call('worldcreator_archive_module', selection);
  assert.equal(archive.result.status, 'completed', JSON.stringify(archive));
  const model = await fs.readFile(path.join(workspace, 'assets/module', resourceId, 'package/model.glb'));
  assert.equal(model.toString('ascii', 0, 4), 'glTF');
  assert.equal(model.readUInt32LE(8), model.length);
  const invalid = await call('worldcreator_validate_lua', { source: 'local broken = ' });
  assert.equal(invalid.ok, false);
  const valid = await call('worldcreator_validate_lua', { source: 'local value = 2\nreturn value' });
  assert.equal(valid.ok, true);
  const report = { passed: true, toolCount: tools.length, workspace, resourceId, beforeBoundingBox: before.nodes[0].boundingBox, afterBoundingBox: after.nodes[0].boundingBox, archiveStatus: archive.result.status, glbBytes: model.length, backupPath: archive.backupPath, editorUiRefreshVerified: false };
  await fs.writeFile(path.join(root, '.local/smoke-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await client.close(); }
