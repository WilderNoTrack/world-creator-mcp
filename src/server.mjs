import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { WorkspaceService } from './workspace.mjs';
import { runNative, workerPath } from './native.mjs';
import { LiveEditor } from './live.mjs';
import { ProjectScripts } from './project-scripts.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const installRoot = process.env.WORLD_CREATOR_INSTALL || 'D:/造世界编辑器';
const projectsRoot = process.env.WORLD_CREATOR_PROJECTS || path.join(process.env.APPDATA || '', 'AI World Creator/projects');
const svc = new WorkspaceService({ projectsRoot, backupRoot: path.join(root, '.local/backups') });
const live = new LiveEditor({ projectsRoot, backupRoot: path.join(root, '.local/backups') });
const scriptFiles=new ProjectScripts({projectsRoot,backupRoot:path.join(root,'.local/backups'),live,validate:async(source,signal)=>(await runNative('lua',null,{source},signal)).result});
const server = new McpServer({ name: 'world-creator-mcp', version: '0.6.0' });
const selection = { projectId: z.string(), workspaceId: z.string() };
const resourceId = z.string().regex(/^module-[a-z0-9][a-z0-9-]*$/);
const text = result => ({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });

function register(name, description, shape, readOnly, handler) {
  server.registerTool(`worldcreator_${name}`, {
    description, inputSchema: shape,
    annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: ['asset_search','pcg_select','canvas_import_glb','pcg_start','publish_submit','publish_status','job_cancel','canvas_preview','inspect_model','archive_module'].includes(name) },
  }, async (args, extra) => {
    // Canonical file locks coordinate multiple MCP processes and Windows path casing.
    try {
      const invoke = () => handler(args, extra);
      return text(await (args.projectId && args.workspaceId ? svc.withWorkspaceLock(args, invoke) : invoke()));
    }
    catch (e) { return { isError: true, ...text({ error: e.message, ...(e.backupPath ? { backupPath: e.backupPath } : {}),...(e.cleanupError?{cleanupError:e.cleanupError,recovery:'Script lease cleanup failed; inspect editor state after reconnecting. An editor restart may be needed before further mutations. Do not blindly retry the write.'}:{}) }) }; }
  });
}

register('status', 'Report adapter availability and actual live-editor connection status.', {}, true, async () => ({
  installRoot, projectsRoot, nativeAdapterBuilt: fs.existsSync(workerPath),
  liveEditor: await live.status(),
  supported: ['native homepage project list/open','model library keyword search and pagination','PCG overlay asset selection with native compatibility checks','environment/world rules and loaded templates','project Lua source create/read/update/refresh with backup and conflict checking','workspace author files', 'Module inspection/archive', 'Lua syntax', 'live canvas scene/assets/import/add/replace/transform/focus/save', 'primitive/special object creation, deletion, group/ungroup, undo/redo', 'script catalog/bind/unbind/parameter patches', 'native component schemas and supported field editing', 'local preview start/stop and runtime object diagnostics', 'PCG terrain/sprinkle/compose/activate adapters with async jobs', 'world upload preparation/submission/status'],
  limitations: ['Requires editor started with local CDP port and one open project; keep window visible for native frame-dependent operations', 'PCG selection/composition partially live verified; native activation can stall; world upload submission is not end-to-end verified', 'Components require native editable schema; no arbitrary Unity component attachment and no exposed standalone water-block fields', 'No verified Lua breakpoint/step/locals API; uploading is not public listing', 'Native inspection executes preview-module.js; use trusted local workspaces'],
}));

const project = { projectId: z.string().regex(/^project_[a-zA-Z0-9_-]+$/) };
const vec = z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
const object = {...project,instanceId:z.string().min(1)};
const script = {...object,scriptId:z.string().min(1)};
const revision=z.string().regex(/^[a-f0-9]{64}$/);
register('canvas_runtime_object','Read an active native runtime object by exact name, its position and up to 50 immediate child names. Useful for preview diagnostics; no code execution or modification.',{...project,name:z.string().min(1).max(128)},true,a=>live.call('runtime_object',a));
register('canvas_terrain','Read active native terrain origin, size and sampled world heights for [x,z] points. Does not modify terrain. Use inside flag before placement.',{...project,points:z.array(z.tuple([z.number().finite(),z.number().finite()])).max(200).default([])},true,a=>live.call('terrain_info',a));
register('canvas_capture','Capture the current editor viewport via its native renderer connection into a local PNG. Returns local filePath; does not publish or upload.',project,true,(a,e)=>live.capture(a,e.signal));
register('project_list','List signed-in homepage projects within the configured projects root. If homepage is closed, returns scope=open_project_only and just the current canvas. Editor must be started with MCP connection port.',{},true,(a,e)=>live.homepage('list',a,e.signal));
register('project_open','Open an existing registered project using the native homepage service. Returns requested before canvas finishes loading; poll status. If a canvas is already open, only accepts that same project and never replaces or closes another project.',project,false,(a,e)=>live.homepage('open',a,e.signal));
register('asset_search','Search the signed-in native model library (public/personal/favorite), hydrating results for canvas_add_asset or pcg_select. Returns IDs and pagination, without signed URLs. staticOnly restricts to static models suitable for sprinkle.',{...project,query:z.string().trim().min(1).max(100),scope:z.enum(['public','personal','favorite']).default('public'),staticOnly:z.boolean().default(false),page:z.number().int().min(0).max(1000).default(0),cursor:z.string().max(2000).optional(),limit:z.number().int().min(1).max(50).default(20)},false,(a,e)=>live.call('asset_search',a,e.signal));
register('pcg_selections','Read completed sprinkle overlay IDs, selected model IDs and a revision for safe edits. Does not start generation.',{...project,workspaceId:z.string(),artifactId:z.string()},true,a=>live.call('pcg_selections',a));
register('pcg_select','Patch selected library model for known sprinkle overlay IDs; preserve other overlays. Requires pcg_selections revision, verifies static asset resources and uses native selection action. Does not generate; call pcg_start compose separately.',{...project,workspaceId:z.string(),artifactId:z.string(),expectedRevision:revision,selections:z.array(z.object({overlayId:z.string().min(1),assetId:z.string().min(1)}).strict()).min(1).max(100)},false,(a,e)=>live.call('pcg_select',a,e.signal));
register('settings_read','Read world rules, environment values, loaded templates, editable native schemas and revision. Unsupported asset-picker fields are marked read-only.',project,true,a=>live.call('settings_read',a));
register('settings_update','Patch world rules or environment parameters through native editor actions. Read settings_read first and pass revision. Supports loaded template selection, sun/light, fog, weather and exposed scalar fields; preserve unrelated settings. Save canvas separately.',{...project,group:z.enum(['environment','global']),expectedRevision:revision,properties:z.record(z.string(),z.union([z.number().finite(),z.boolean(),z.string()])).default({}),templateId:z.string().optional(),templateScope:z.enum(['official','user']).optional()},false,(a,e)=>live.call('settings_update',a,e.signal));
register('script_files','List editable project scripts/modules Lua files with source SHA-256 and script IDs; excludes official/builtin code.',project,true,a=>scriptFiles.list(a));
register('script_read','Read project modules/name.lua source and SHA-256. Preserve identity annotations when editing.',{...project,file:z.string()},true,a=>scriptFiles.read(a));
register('script_write','Create/update project modules/name.lua. Null expectedSha256 creates only; updates require the current hash. Compiles Lua without execution, backs up prior bytes, preserves identity annotations and refreshes native catalog. New scripts receive IDs automatically. Scripts execute on next preview; inspect diagnostics before binding. No automatic preview or publishing.',{...project,file:z.string(),content:z.string().max(1024*1024),expectedSha256:revision.nullable()},false,(a,e)=>scriptFiles.write(a,e.signal));
register('script_refresh','Refresh native Lua catalog and return scripts/diagnostics after external file edits. Does not run scripts.',project,false,(a,e)=>live.call('script_refresh',a,e.signal));
const params = z.record(z.string(),z.json()).refine(v=>JSON.stringify(v).length<=65536,'Parameter patch too large');
register('canvas_component_schema','Read component properties and native editable field schemas. Asset identity is read-only; unsupported field types are explicitly marked.',object,true,a=>live.call('component_schema',a));
register('canvas_component_update','Patch an existing native component using its schema: appearance/material, physics, light, Text3DUI and other supported schema types. Read canvas_component_schema first; unknown fields/types are rejected. No arbitrary Unity AddComponent.',{...object,component:z.string().min(1),properties:params},false,(a,e)=>live.call('component_update',a,e.signal));
register('canvas_create_special','Create a native point light, spot light, 3D text or water object. Read returned object components, then edit via canvas_component_update.',{...project,kind:z.enum(['point_light','spot_light','text3d','water'])},false,(a,e)=>live.call('create_special',a,e.signal));
register('pcg_context','Read map session artifact IDs and statuses for terrain/sprinkle generation. Omits signed resource URLs.',{...project,workspaceId:z.string().min(1)},true,a=>live.call('pcg_context',a));
register('pcg_start','Start native terrain generation, sprinkle parsing, map composition, or canvas activation. Cloud stages may consume credits. Use dryRun first. compose uses the existing sprinkle asset selections. Activation can replace scene content: requires explicit clearSceneConfirmed and creates scene.data backup. Returns asynchronous jobId; poll job_status, never retry with a new requestId after an uncertain result.',{...project,workspaceId:z.string().min(1),action:z.enum(['terrain','sprinkle','compose','activate_terrain','activate_map']),artifactId:z.string().min(1),prompt:z.string().max(4000).optional(),dryRun:z.boolean().default(true),clearSceneConfirmed:z.boolean().optional(),requestId:z.string().min(1).max(100).optional()},false,async(a,e)=>{
  if(!a.dryRun&&a.action.startsWith('activate')){
    if(a.clearSceneConfirmed!==true)throw new Error('Explicit clearSceneConfirmed required for scene activation');
    const existing=await live.call('pcg_start',{...a,probeOnly:true},e.signal);
    if(existing.jobId)return existing;
    const backup=await live.save({projectId:a.projectId},e.signal);
    try{return {...await live.call('pcg_start',{...a,expectedProjectRoot:path.dirname(backup.scenePath)},e.signal),backupPath:backup.backupPath};}catch(error){error.backupPath=backup.backupPath;throw error;}
  }
  return live.call('pcg_start',a,e.signal);
});
register('job_status','Read a long-running native MCP job. Tracking survives MCP client reconnects but not renderer restarts; inspect PCG/world state after an editor restart.',{...project,jobId:z.string()},true,a=>live.call('job_status',a));
register('job_cancel','Request cancellation of a tracked PCG job. Native activation can be cancelled only when one new runtime graph is identifiable; partial scene changes remain. World uploads cannot be cancelled. Query job_status for final state.',{...project,jobId:z.string()},false,(a,e)=>live.call('job_cancel',a,e.signal));
register('publish_prepare','Prepare a reviewable world upload plan without uploading. Validates saved scene, capacity, Lua diagnostics and metadata. Returns planId valid 10 minutes; scene changes invalidate it. Upload does not automatically mean public listing.',{...project,name:z.string().optional(),description:z.string().optional(),capacity:z.number().int().min(1).max(30).optional()},false,(a,e)=>live.call('publish_prepare',a,e.signal));
register('publish_submit','Upload the exact prepared world through the editor native account pipeline. Call only when the user authorizes uploading the reviewed world. Requires confirmed=true and prepared planId; returns jobId. Does not automatically publicly list the world; remote processing/review requires publish_status.',{...project,planId:z.string(),confirmed:z.literal(true),requestId:z.string().min(1).max(100)},false,(a,e)=>live.call('publish_submit',a,e.signal));
register('publish_status','Read world upload state; refresh=true queries the official service and reconciles completed remote processing into local status. Upload acceptance, remote processing and public listing are separate.',{...project,refresh:z.boolean().default(false)},false,a=>live.call('publish_status',a));
register('debug_capabilities','Report verified runtime debugging capabilities and missing Lua breakpoint/step/local-variable support. Does not substitute JavaScript CDP debugging for Lua debugging.',project,true,a=>live.call('debug_capabilities',a));
register('canvas_node','Read one object, editable components and bound scripts. Asset resource URLs are omitted.',object,true,a=>live.call('node',a));
register('canvas_scripts','List registered project Lua scripts, parameter definitions and diagnostics.',project,true,a=>live.call('scripts',a));
register('canvas_create_primitive','Create one native basic shape at scene root. Returns its ID; use canvas_update to place it and canvas_save to persist.',{...project,shape:z.enum(['cube','sphere','capsule','cylinder','plane'])},false,(a,e)=>live.call('primitive',a,e.signal));
register('canvas_delete','Delete scene objects and all descendants through native undoable actions. Does not delete library assets. Inspect IDs first and save separately.',{...project,instanceIds:z.array(z.string().min(1)).min(1).max(100)},false,(a,e)=>live.call('delete',a,e.signal));
register('canvas_group','Combine two or more sibling objects into a native group. Returns the new group ID; save separately.',{...project,instanceIds:z.array(z.string().min(1)).min(2).max(100)},false,(a,e)=>live.call('group',a,e.signal));
register('canvas_ungroup','Dissolve a native group, preserving its children. Group root is removed. Inspect scripts on the root before dissolving.',object,false,(a,e)=>live.call('ungroup',a,e.signal));
register('canvas_physics','Patch existing PhysicsCollider fields using native component changes. Read canvas_node first. Numeric limits match editor UI.',{...object,properties:z.object({EnableCollision:z.boolean().optional(),EnableRigidBody:z.boolean().optional(),UseGravity:z.boolean().optional(),Mass:z.number().min(0).max(100).optional(),Drag:z.number().min(0).max(50).optional(),AngularDrag:z.number().min(0).max(50).optional(),DynamicFriction:z.number().min(0).max(1).optional(),StaticFriction:z.number().min(0).max(1).optional(),Bounciness:z.number().min(0).max(1).optional()}).strict()},false,(a,e)=>live.call('physics',a,e.signal));
register('canvas_script_bind','Bind an existing valid project Lua script to one object with schema defaults and optional parameter overrides. Scripts run during preview; inspect script and target compatibility first.',{...script,params:params.optional()},false,(a,e)=>live.call('script_bind',a,e.signal));
register('canvas_script_unbind','Remove one script binding from an object without deleting its Lua source.',script,false,(a,e)=>live.call('script_unbind',a,e.signal));
register('canvas_script_params','Patch named parameters on an existing script binding; preserve other values and validate against registered schema.',{...script,params},false,(a,e)=>live.call('script_params',a,e.signal));
register('canvas_preview','Read status, start or stop local runtime preview. Start may load avatar assets and executes scene scripts; no publishing. Scene mutations require stopping preview.',{...project,action:z.enum(['status','start','stop'])},false,(a,e)=>live.call('preview',a,e.signal));
register('canvas_debug','Read runtime object presence, world position, component types and script count, including during preview. Does not inspect Lua local variables or console logs.',object,true,a=>live.call('debug',a));
register('canvas_history','Undo or redo the latest native editor operation, including manual user edits. Read scene afterward. Never retry blindly.',{...project,action:z.enum(['undo','redo'])},false,(a,e)=>live.call('history',a,e.signal));
register('canvas_pcg_status','Read map-generation session IDs and prerequisites. This tool does not generate terrain or publish a world.',project,true,a=>live.call('pcg_status',a));
register('canvas_scene','Read actual open editor scene roots, IDs, transforms and save state. Set allNodes to include descendants (1000 maximum).',{projectId:project.projectId.optional(),allNodes:z.boolean().optional()},true,a=>live.call('scene',a));
register('canvas_assets','List currently loaded editor asset library entries; use returned assetId for placement. Does not expose signed resource URLs.',{projectId:project.projectId.optional(),search:z.string().max(100).optional()},true,a=>live.call('assets',a));
register('canvas_update','Edit an existing canvas object by ID through native editor actions. Rotation uses local Euler degrees. Changes are undoable and require canvas_save to persist.',{...project,instanceId:z.string().min(1),name:z.string().min(1).max(80).optional(),position:vec.optional(),rotation:vec.optional(),scale:vec.optional(),expectedTransform:z.object({localPosition:vec,localEulerAngles:vec,localScale:vec}).optional()},false,(a,e)=>live.call('update',a,e.signal));
register('canvas_add_asset','Place an already-loaded asset into the current scene root using the native editor pipeline. Returns new object IDs; use canvas_update to position and canvas_save to persist.',{...project,assetId:z.string().min(1)},false,(a,e)=>live.call('add',a,e.signal));
register('canvas_import_glb','Import the specified local GLB (20 MiB maximum) through the signed-in editor normal upload pipeline into its asset library. This uploads the file to the editor service. Returns assetId; then call canvas_add_asset.',{...project,filePath:z.string(),name:z.string().trim().min(1).max(15),description:z.string().trim().min(1).max(150)},false,(a,e)=>live.importGlb(a,e.signal));
register('canvas_focus','Select and focus a scene object in the actual editor viewport.',{...project,instanceId:z.string().min(1)},false,(a,e)=>live.call('focus',a,e.signal));
register('canvas_replace_asset','Replace one scene object with an already-loaded asset using native undoable replacement. Descendants and scripts are replaced. Returns a NEW instanceId and read-back transform; inspect it before further updates and save.',{...project,instanceId:z.string().min(1),assetId:z.string().min(1)},false,(a,e)=>live.call('replace',a,e.signal));
register('canvas_save','Back up scene.data, invoke editor native save, verify clean save state and return persisted file SHA-256.',project,false,(a,e)=>live.save(a,e.signal));

register('models', 'Read configured model IDs and agent defaults from the installed editor. Internal aliases do not identify the upstream model.', {}, true, async () => {
  const config = JSON.parse(fs.readFileSync(path.join(installRoot, 'resources/addon/agent-runtime/runtime-config.json'), 'utf8'));
  return {
    defaultModel: config.model,
    defaults: Object.fromEntries(Object.entries(config.agent || {}).map(([name, a]) => [name, { model: a.model, variant: a.variant }])),
    configuredModels: Object.fromEntries(Object.entries(config.provider || {}).map(([name, p]) => [name, Object.keys(p.models || {})])),
    evidence: 'installed runtime-config.json; configuration does not prove availability or upstream identity',
  };
});
register('list_workspaces', 'List local projects and AI workspaces, excluding log folders. Use these identifiers for all workspace tools.', {}, true, () => svc.listWorkspaces());
register('list_files', 'List up to 1000 workspace files, optionally beneath a relative directory.', { ...selection, directory: z.string().optional() }, true, a => svc.listFiles(a));
register('read_file', 'Read a UTF-8 workspace text file (1 MiB maximum) and its SHA-256 for optimistic writes.', { ...selection, file: z.string() }, true, a => svc.readFile(a));
register('write_file', 'Create/update an author text file. Pass the last read SHA-256, or null for create-only. Prior bytes are backed up. Derived package/review files cannot be written.', {
  ...selection, file: z.string(), content: z.string(), expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}, false, a => svc.writeFile(a));

register('inspect_model', 'Inspect a Module using installed native tools. Runs trusted preview-module.js when present, otherwise reads GLB. Use node-tree first, or nodes with nodePaths ["" ] for the whole-model bounds. Does not intentionally write assets; source is executable JavaScript.', {
  ...selection, resourceId, query: z.enum(['node-tree', 'nodes']), nodePaths: z.array(z.string()).min(1).optional(), maxDepth: z.number().int().min(0).max(5).optional(),
}, false, async (a, extra) => {
  const { root: workspace, moduleRoot } = svc.assertModule(a);
  svc.assertTree(moduleRoot);
  const { resourceId, query, nodePaths, maxDepth } = a;
  return (await runNative('inspect', workspace, { resourceId, query, nodePaths, maxDepth }, extra.signal)).result;
});

register('archive_module', 'Validate and archive an existing Module with the editor native implementation. Backs up the Module and top-level package first. Writes package GLB/meta and may normalize author meta. A completed archive does not confirm editor UI refresh.', {
  ...selection, resourceId,
}, false, async (a, extra) => {
  const backupPath = svc.backupModule(a);
  try {
    const result = await runNative('archive', svc.workspace(a), { resourceId: a.resourceId }, extra.signal);
    if (result.result.status !== 'completed') throw new Error(result.result.summary);
    return { ...result, backupPath, editorUiRefreshVerified: false };
  } catch (e) { e.backupPath = backupPath; throw e; }
});

register('validate_lua', 'Compile Lua 5.3 source without executing it, using the editor bundled compiler. Returns ok:false and error details for invalid syntax.', { source: z.string().max(1024 * 1024) }, true,
  async (a, extra) => (await runNative('lua', null, a, extra.signal)).result);

await server.connect(new StdioServerTransport());
