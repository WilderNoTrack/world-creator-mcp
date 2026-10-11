// Explicit real-project integration check. Creates/cleans one asset and one Lua file,
// temporarily changes two settings, then restores originals and saves.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {Client}from'@modelcontextprotocol/sdk/client/index.js';import{StdioClientTransport}from'@modelcontextprotocol/sdk/client/stdio.js';
const projectId=process.argv[2];if(!/^project_[A-Za-z0-9_-]+$/.test(projectId||''))throw new Error('Explicit open project ID required');
const c=new Client({name:'workflow-smoke',version:'0.5.0'});await c.connect(new StdioClientTransport({command:process.execPath,args:['src/server.mjs'],stderr:'pipe'}));
const report={projectId,steps:[]};let initial,settings,envChanged=false,globalChanged=false,instanceId,filePath,fileHash;
async function call(name,args={}){const r=await c.callTool({name:'worldcreator_'+name,arguments:{projectId,...args}},undefined,{timeout:180000});const value=JSON.parse(r.content[0].text);report.steps.push({name,args,value,isError:!!r.isError});await fs.writeFile('.local/workflow-smoke-report.json',JSON.stringify(report,null,2));if(r.isError)throw new Error(JSON.stringify(value));console.log(name+' OK');return value;}
try{
 initial=await call('canvas_scene');assert.equal(initial.unsavedChanges,false,'Save current project before testing');settings=await call('settings_read');
 const search=await call('asset_search',{query:'树',staticOnly:true,limit:5});assert.ok(search.assets.length);if(search.hasMore&&search.cursor){const next=await call('asset_search',{query:'树',staticOnly:true,limit:5,cursor:search.cursor});assert.notEqual(next.assets[0]?.assetId,search.assets[0].assetId);}
 const added=await call('canvas_add_asset',{assetId:search.assets[0].assetId});instanceId=added.nodes[0].instanceId;
 await call('canvas_update',{instanceId,position:[80,0,80],name:'MCP工作流临时验证'});
 let current=await call('settings_read');envChanged=true;
 current=await call('settings_update',{group:'environment',expectedRevision:current.revision,properties:{mainLightStrength:1.3}});assert.equal(current.environment.params.mainLightStrength,1.3);
 globalChanged=true;current=await call('settings_update',{group:'global',expectedRevision:current.revision,properties:{moveMaxSpeed:5}});assert.equal(current.global.moveMaxSpeed,5);
 const file='modules/ms-mcp-check-'+crypto.randomUUID()+'.lua';filePath=path.join(initial.projectRoot,'scripts',file);
 const created=await call('script_write',{file,expectedSha256:null,content:'-- MCP temporary source check\nreturn {}\n'});fileHash=created.sha256;assert.equal(created.refreshed,true);
 const read=await call('script_read',{file});const scriptId=read.content.match(/---@id (\S+)/)[1];
 const updated=await call('script_write',{file,expectedSha256:read.sha256,content:read.content+'\n-- update verified\n'});fileHash=updated.sha256;assert.equal(updated.refreshed,true);
 const catalog=await call('canvas_scripts');const entry=catalog.scripts.find(s=>s.scriptId===scriptId);assert.ok(entry,'new script registered');assert.equal(entry.diagnostics?.length||0,0);
 await call('canvas_script_bind',{instanceId,scriptId});await call('canvas_script_unbind',{instanceId,scriptId});
 report.checksPassed=true;
}catch(e){report.error=e.message;process.exitCode=1;console.error(e.message);}finally{
 try{
  if(instanceId)await call('canvas_delete',{instanceIds:[instanceId]});
  if(filePath&&fileHash){const bytes=await fs.readFile(filePath);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),fileHash,'Temporary script changed; preserve it');await fs.unlink(filePath);await call('script_refresh');}
  if(settings&&envChanged){let current=await call('settings_read');if(globalChanged)current=await call('settings_update',{group:'global',expectedRevision:current.revision,properties:{moveMaxSpeed:settings.global.moveMaxSpeed}});current=await call('settings_update',{group:'environment',expectedRevision:current.revision,properties:{mainLightStrength:settings.environment.params.mainLightStrength}});assert.deepEqual(current.environment,settings.environment);assert.deepEqual(current.global,settings.global);}
  if(initial&&!initial.unsavedChanges){const final=await call('canvas_scene');assert.equal(final.totalNodes,initial.totalNodes);assert.deepEqual(final.nodes,initial.nodes);await call('canvas_save');}
  report.cleanupPassed=true;report.passed=!!report.checksPassed;
 }catch(e){report.cleanupError=e.message;process.exitCode=1;console.error('Cleanup:',e.message);}
 await fs.writeFile('.local/workflow-smoke-report.json',JSON.stringify(report,null,2));await c.close();
}
