import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const root=fileURLToPath(new URL('..',import.meta.url));
test('integration smoke commands refuse implicit private fixtures before connecting',()=>{
 const env={...process.env};delete env.WORLD_CREATOR_SMOKE_MODULE;delete env.WORLD_CREATOR_SMOKE_FIND;delete env.WORLD_CREATOR_SMOKE_REPLACE;
 for(const file of ['scripts/smoke.mjs','scripts/live-smoke.mjs']){
  const r=spawnSync(process.execPath,[file],{cwd:root,env,encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(r.status,1);assert.match(r.stderr,/Usage:|Explicit WORLD_CREATOR_SMOKE_MODULE/);
 }
});
test('stdio discovery advertises actual network and executable-code tool boundaries',async()=>{
 const client=new Client({name:'release-check',version:'1'});
 try{
  await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/server.mjs',import.meta.url))],stderr:'pipe'}));
  const {tools}=await client.listTools();assert.equal(tools.length,56);assert.equal(new Set(tools.map(t=>t.name)).size,56);
  for(const name of ['canvas_preview','inspect_model','archive_module','canvas_import_glb','publish_submit']){
   const tool=tools.find(t=>t.name==='worldcreator_'+name);assert.equal(tool.annotations.openWorldHint,true,name);assert.equal(tool.annotations.readOnlyHint,false,name);
  }
  const invalid=await client.callTool({name:'worldcreator_canvas_update',arguments:{projectId:'../escape',instanceId:'1'}});assert.equal(invalid.isError,true);
 }finally{await client.close();}
});
