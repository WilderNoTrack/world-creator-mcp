import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const MAX_TEXT = 1024 * 1024;
const isDirectory = p => { try { return fs.lstatSync(p).isDirectory(); } catch { return false; } };
const directories = p => isDirectory(p) ? fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory() && !d.isSymbolicLink()) : [];
const json = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } };

export class WorkspaceService {
  constructor({ projectsRoot, backupRoot }) {
    this.projectsRoot = path.resolve(projectsRoot);
    this.backupRoot = path.resolve(backupRoot);
  }

  // Reject links at every existing component, including junctions on Windows.
  checkedPath(root, relative) {
    if (typeof relative !== 'string' || !relative || /[:\\\0]/.test(relative) || path.isAbsolute(relative)) throw new Error('Expected a relative slash-separated path');
    const parts = relative.split('/');
    if (parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /[<>"|?*\x00-\x1f]/.test(p) || /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(p))) throw new Error('Invalid relative path or reserved device name');
    let current = root;
    for (const part of parts) {
      current = path.join(current, part);
      try {
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Links are outside the allowed scope');
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    const relation = path.relative(root, current);
    if (relation.startsWith('..') || path.isAbsolute(relation)) throw new Error('Path outside allowed scope');
    return current;
  }

  workspace({ projectId, workspaceId }) {
    if (!/^project_[A-Za-z0-9_-]+$/.test(projectId) || !/^workspace_[A-Za-z0-9_-]+$/.test(workspaceId) || workspaceId.endsWith('_log')) throw new Error('Invalid project/workspace identifier');
    const root = this.checkedPath(this.projectsRoot, `${projectId}/ai-sessions/${workspaceId}`);
    if (!isDirectory(root)) throw new Error('Workspace not found');
    return root;
  }

  async withWorkspaceLock(args, operation) {
    const actual = fs.realpathSync.native(this.workspace(args));
    const identity = process.platform === 'win32' ? actual.toLowerCase() : actual;
    const locksRoot = path.join(this.backupRoot, '..', 'locks');
    fs.mkdirSync(locksRoot, { recursive: true });
    const lock = path.join(locksRoot, `${sha256(identity)}.lock`);
    let descriptor;
    try { descriptor = fs.openSync(lock, 'wx'); }
    catch (e) {
      if (e.code === 'EEXIST') throw new Error(`Workspace operation in progress. If its process crashed, inspect the stale lock before removing it: ${lock}`);
      throw e;
    }
    try {
      fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, workspace: actual, startedAt: new Date().toISOString() }));
      return await operation();
    } finally {
      fs.closeSync(descriptor);
      fs.unlinkSync(lock);
    }
  }

  async listWorkspaces() {
    const result = [];
    for (const p of directories(this.projectsRoot).filter(d => /^project_[A-Za-z0-9_-]+$/.test(d.name))) {
      const projectRoot = this.checkedPath(this.projectsRoot, p.name);
      const sessions = this.checkedPath(projectRoot, 'ai-sessions');
      const projectName = json(path.join(projectRoot, 'project.json')).name || p.name;
      for (const w of directories(sessions).filter(d => /^workspace_[A-Za-z0-9_-]+$/.test(d.name) && !d.name.endsWith('_log'))) {
        result.push({ projectId: p.name, projectName, workspaceId: w.name });
      }
    }
    return result;
  }

  async listFiles(args) {
    const root = this.workspace(args);
    const prefix = args.directory || '';
    const start = prefix ? this.checkedPath(root, prefix) : root;
    if (!isDirectory(start)) throw new Error('Directory not found');
    const files = [];
    const walk = (dir, rel, depth) => {
      if (depth > 16 || files.length >= 1000) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (files.length >= 1000) break;
        if (entry.isSymbolicLink() || entry.name === 'node_modules' || entry.name === '.git') continue;
        const name = rel ? `${rel}/${entry.name}` : entry.name;
        const target = this.checkedPath(root, name);
        if (entry.isDirectory()) walk(target, name, depth + 1);
        else if (entry.isFile()) files.push({ file: name, bytes: fs.statSync(target).size });
      }
    };
    walk(start, prefix, 0);
    return { files, limit: 1000, possiblyTruncated: files.length >= 1000 };
  }

  async readFile(args) {
    const target = this.checkedPath(this.workspace(args), args.file);
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size > MAX_TEXT) throw new Error('Expected text file at most 1 MiB');
    const data = fs.readFileSync(target);
    if (data.includes(0)) throw new Error('Binary file cannot be read as text');
    const content = new TextDecoder('utf-8', { fatal: true }).decode(data);
    return { file: args.file, content, sha256: sha256(data), bytes: data.length };
  }

  async writeFile(args) {
    const root = this.workspace(args);
    const target = this.checkedPath(root, args.file);
    const author = /^assets\/(module|ui|map)\/(module|ui|map)-[a-z0-9-]+\//.test(args.file) || /^(scripts|docs)\//.test(args.file) || args.file === 'meta.json';
    if (!author || /(^|\/)(package|review|dist|node_modules)(\/|$)/i.test(args.file) || !/\.(json|js|mjs|ts|lua|md|html|css|svg)$/.test(args.file)) throw new Error('Only author text files may be written; package outputs are managed by archive');
    const data = Buffer.from(args.content, 'utf8');
    if (data.length > MAX_TEXT || data.includes(0)) throw new Error('Author text must be at most 1 MiB and contain no NUL');
    if (args.file.endsWith('.json')) JSON.parse(args.content);
    let existing;
    try { existing = fs.readFileSync(target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (existing ? sha256(existing) !== args.expectedSha256 : args.expectedSha256 !== null) throw new Error('File changed or hash mismatch; read again before writing (null means create only)');
    let backupPath;
    if (existing) {
      backupPath = path.join(this.backupRoot, crypto.randomUUID(), args.projectId, args.workspaceId, ...args.file.split('/'));
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.writeFileSync(backupPath, existing, { flag: 'wx' });
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, data, { flag: 'wx' });
    try {
      this.checkedPath(root, args.file);
      const now = fs.existsSync(target) ? sha256(fs.readFileSync(target)) : null;
      if (now !== (existing ? sha256(existing) : null)) throw new Error('File changed during write');
      fs.renameSync(temp, target);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    return { file: args.file, sha256: sha256(data), bytes: data.length, backupPath };
  }

  assertModule(args) {
    if (!/^module-[a-z0-9][a-z0-9-]*$/.test(args.resourceId)) throw new Error('Expected module- resource ID');
    const root = this.workspace(args);
    const moduleRoot = this.checkedPath(root, `assets/module/${args.resourceId}`);
    if (!isDirectory(moduleRoot)) throw new Error('Module not found');
    return { root, moduleRoot };
  }

  assertTree(root) {
    let bytes = 0;
    let count = 0;
    const visit = p => {
      const stat = fs.lstatSync(p);
      if (stat.isSymbolicLink()) throw new Error('Links are outside the allowed scope');
      if (++count > 20000) throw new Error('Resource tree has too many entries');
      if (stat.isDirectory()) for (const entry of fs.readdirSync(p)) visit(path.join(p, entry));
      else if (stat.isFile()) { bytes += stat.size; if (bytes > 256 * 1024 * 1024) throw new Error('Resource tree exceeds 256 MiB'); }
      else throw new Error('Unsupported filesystem entry');
    };
    visit(root);
  }

  backupModule(args) {
    const { root, moduleRoot } = this.assertModule(args);
    this.assertTree(moduleRoot);
    const topPackage = this.checkedPath(root, 'package');
    if (fs.existsSync(topPackage)) this.assertTree(topPackage);
    const backupPath = path.join(this.backupRoot, `archive-${crypto.randomUUID()}`);
    fs.mkdirSync(backupPath, { recursive: true });
    fs.cpSync(moduleRoot, path.join(backupPath, 'assets', 'module', args.resourceId), { recursive: true });
    if (fs.existsSync(topPackage)) fs.cpSync(topPackage, path.join(backupPath, 'package'), { recursive: true });
    fs.writeFileSync(path.join(backupPath, 'backup.json'), JSON.stringify({ projectId: args.projectId, workspaceId: args.workspaceId, resourceId: args.resourceId, workspacePath: root, createdAt: new Date().toISOString() }, null, 2));
    return backupPath;
  }
}
