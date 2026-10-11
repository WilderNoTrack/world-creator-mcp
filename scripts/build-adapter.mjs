import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const installRoot = process.env.WORLD_CREATOR_INSTALL || 'D:/造世界编辑器';
const runtime = path.join(installRoot, 'resources/addon/agent-runtime');
const inspector = path.join(runtime, 'tools/model-inspection/worldplay-glb-model-inspector.ts');
const archive = path.join(runtime, 'tools/archive/module/worldplay-module-archive-tool-runner.ts');
const lua = path.join(runtime, 'lua-validation/lua-compiler.ts');
const inspectionV2 = (await fs.readFile(inspector, 'utf8')).includes('nodePath is required');
await fs.mkdir(path.join(projectRoot, '.local'), { recursive: true });
await build({
  stdin: { contents: `
    import { WorldplayGlbModelInspector } from ${JSON.stringify(inspector)};
    import { WorldplayModuleArchiveToolRunner } from ${JSON.stringify(archive)};
    import { LuaCompiler } from ${JSON.stringify(lua)};
    const output = process.stdout.write.bind(process.stdout);
    console.log = (...args) => console.error(...args);
    let body = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { body += chunk; if (body.length > 2097152) process.exit(2); });
    process.stdin.on('end', async () => {
      try {
        const { operation, workspace, args } = JSON.parse(body);
        const updates = [];
        const context = { directory: workspace, worktree: workspace, abort: new AbortController().signal, update: x => updates.push(x) };
        let result;
        if (operation === 'inspect') {
          const inspector = new WorldplayGlbModelInspector();
          if (${inspectionV2}) {
            const paths = args.query === 'nodes' ? (args.nodePaths || ['']) : [''];
            if (!paths.length || paths.length > 20) throw new Error('Inspect requires 1 to 20 node paths');
            const results = [];
            for (const nodePath of paths) results.push(JSON.parse(await inspector.execute({resourceId:args.resourceId,nodePath,maxDepth:args.query === 'nodes' ? 0 : (args.maxDepth ?? 3),showDetails:args.query === 'nodes'}, context)));
            result = args.query === 'nodes' ? { ...results[0], nodes: results.map(r => r.tree) } : results[0];
          } else result = JSON.parse(await inspector.execute(args, context));
        }
        else if (operation === 'archive') {
          const summary = await WorldplayModuleArchiveToolRunner.run({ context, input: args });
          result = { status: summary.startsWith('worldplay module archive completed:') ? 'completed' : 'failed', summary };
        }
        else if (operation === 'lua') result = LuaCompiler.compile(args.source, 'mcp-validation.lua');
        else throw new Error('Unsupported native operation');
        output(JSON.stringify({ ok: true, result, updates }));
      } catch (e) { output(JSON.stringify({ ok: false, error: e.message })); process.exitCode = 1; }
    });
  `, resolveDir: projectRoot, loader: 'ts' },
  bundle: true, platform: 'node', target: 'node24', format: 'cjs', tsconfigRaw: {},
  define: { 'import.meta.url': JSON.stringify(pathToFileURL(path.join(projectRoot, '.local/native-worker.cjs')).href) },
  nodePaths: [path.join(installRoot, 'resources/addon/node_modules')],
  outfile: path.join(projectRoot, '.local/native-worker.cjs'), logLevel: 'warning',
});
await fs.writeFile(path.join(projectRoot, '.local/adapter-info.json'), JSON.stringify({ installRoot, builtAt: new Date().toISOString(), inspectionApi: inspectionV2 ? 2 : 1, adapterScope: 'Module inspector, Module archive, Lua compiler' }, null, 2));
console.log('Built local adapter from installed editor sources.');
