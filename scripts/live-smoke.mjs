// Explicit integration test: uploads a supplied GLB, temporarily places it, then
// removes only the created scene root. Uploaded library assets remain remotely.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const [projectId,filePath,confirmation]=process.argv.slice(2);
if(!/^project_[A-Za-z0-9_-]+$/.test(projectId||'')||!filePath||!path.isAbsolute(filePath)||confirmation!=='--confirm-upload')throw new Error('Usage: node scripts/live-smoke.mjs project_ID ABSOLUTE_MODEL.glb --confirm-upload (uploads an asset and modifies the specified saved test scene)');
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
await fs.mkdir(path.join(root,'.local'),{recursive:true});
const reportPath=path.join(root,'.local/live-smoke-report.json'),report={projectId,steps:[]};
const c=new Client({name:'worldcreator-live-smoke',version:'1'});
const checkpoint=()=>fs.writeFile(reportPath,JSON.stringify(report,null,2));
async function call(name,args={}){
 const r=await c.callTool({name:'worldcreator_'+name,arguments:{projectId,...args}},undefined,{timeout:180000});
 const v=JSON.parse(r.content.find(c=>c.type==='text').text);report.steps.push({tool:name,value:v,isError:!!r.isError});await checkpoint();
 assert.ok(!r.isError,JSON.stringify(v));return v;
}
let created,initial;
try{
 await c.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'src/server.mjs')],stderr:'pipe'}));
 initial=await call('canvas_scene');assert.equal(initial.unsavedChanges,false,'Save the test project first');
 const preview=await call('canvas_preview',{action:'status'});assert.ok(!preview.isPreview&&!preview.isPreviewLoading,'Stop preview first');
 const asset=await call('canvas_import_glb',{filePath,name:'MCP导入验收',description:'Explicitly requested MCP import integration test.'});
 const added=await call('canvas_add_asset',{assetId:asset.assetId});assert.equal(added.nodes.length,1);created=added.nodes[0].instanceId;
 const moved=await call('canvas_update',{instanceId:created,position:[20,0,-18],rotation:[0,25,0]});
 assert.deepEqual(moved.node.transform.localPosition,[20,0,-18]);
 await call('canvas_focus',{instanceId:created});report.checksPassed=true;
}catch(e){report.error=e.message;process.exitCode=1;}
finally{
 try{
  if(created){await call('canvas_delete',{instanceIds:[created]});const after=await call('canvas_scene');assert.equal(after.totalNodes,initial.totalNodes);assert.deepEqual(after.nodes,initial.nodes);await call('canvas_save');}
  report.passed=!!report.checksPassed;
 }catch(e){report.cleanupError=e.message;process.exitCode=1;}
 await checkpoint();await c.close();console.log(JSON.stringify({passed:report.passed||false,error:report.error,cleanupError:report.cleanupError,reportPath}));
}
