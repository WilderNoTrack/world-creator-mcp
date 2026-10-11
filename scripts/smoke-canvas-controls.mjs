import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const projectId=process.argv[2];if(!/^project_[a-zA-Z0-9_-]+$/.test(projectId||''))throw new Error('Usage: node scripts/smoke-canvas-controls.mjs project_ID (creates then deletes temporary objects in the open project)');
const client=new Client({name:'canvas-controls-verifier',version:'0.3.0'});
await client.connect(new StdioClientTransport({command:process.execPath,args:['src/server.mjs'],stderr:'pipe'}));
const report={projectId,startedAt:new Date().toISOString(),steps:[]};const temporary=new Set();
async function call(tool,args={}){const r=await client.callTool({name:'worldcreator_'+tool,arguments:{projectId,...args}},undefined,{timeout:180000});const result=JSON.parse(r.content.find(c=>c.type==='text').text);report.steps.push({tool,args,result,isError:!!r.isError});await fs.writeFile('.local/canvas-controls-report.json',JSON.stringify(report,null,2));if(r.isError)throw new Error(JSON.stringify(result));console.log(tool+' OK');return result;}
try {
 const initial=await call('canvas_scene');assert.equal(initial.unsavedChanges,false,'Save user changes before running integration test');
 const status=await call('canvas_preview',{action:'status'});assert.equal(status.isPreview,false,'Stop user preview before running integration test');
 await call('canvas_save');
 const a=(await call('canvas_create_primitive',{shape:'cube'})).nodes[0].instanceId;temporary.add(a);
 const b=(await call('canvas_create_primitive',{shape:'sphere'})).nodes[0].instanceId;temporary.add(b);
 await call('canvas_update',{instanceId:a,name:'MCP接口验证临时方块',position:[60,5,60]});
 await call('canvas_update',{instanceId:b,name:'MCP接口验证临时球体',position:[63,5,60]});
 const physics=await call('canvas_physics',{instanceId:a,properties:{EnableRigidBody:true,UseGravity:false,Mass:4}});assert.equal(physics.properties.Mass,4);
 await call('canvas_history',{action:'undo'});assert.equal((await call('canvas_node',{instanceId:a})).components.find(c=>c.componentId.endsWith('Component.PhysicsCollider')).properties.EnableRigidBody,false);
 await call('canvas_history',{action:'redo'});assert.equal((await call('canvas_node',{instanceId:a})).components.find(c=>c.componentId.endsWith('Component.PhysicsCollider')).properties.Mass,4);
 const catalog=await call('canvas_scripts');const scriptId=catalog.scripts.find(s=>s.localPath.endsWith('/ms-rotate.lua')).scriptId;
 const bound=await call('canvas_script_bind',{instanceId:a,scriptId,params:{RotationSpeed:12}});assert.equal(bound.binding.params.RotationSpeed,12);
 const edited=await call('canvas_script_params',{instanceId:a,scriptId,params:{RotationSpeed:18}});assert.equal(edited.binding.params.RotationSpeed,18);
 await call('canvas_script_unbind',{instanceId:a,scriptId});assert.equal((await call('canvas_node',{instanceId:a})).scripts.length,0);
 const g=(await call('canvas_group',{instanceIds:[a,b]})).node.instanceId;temporary.add(g);
 assert.equal((await call('canvas_node',{instanceId:a})).node.parentInstanceId,g);
 await call('canvas_ungroup',{instanceId:g});temporary.delete(g);
 assert.deepEqual((await call('canvas_node',{instanceId:a})).node.transform.localPosition,[60,5,60]);
 await call('canvas_preview',{action:'start'});
 const debug=await call('canvas_debug',{instanceId:a});assert.equal(debug.isPreview,true);assert.equal(debug.available,true);
 await call('canvas_preview',{action:'stop'});
 await call('canvas_delete',{instanceIds:[a,b]});temporary.clear();
 await call('canvas_history',{action:'undo'});temporary.add(a);temporary.add(b);assert.ok((await call('canvas_node',{instanceId:a})).node);
 await call('canvas_history',{action:'redo'});temporary.clear();
 const final=await call('canvas_scene');assert.equal(final.totalNodes,initial.totalNodes);assert.deepEqual(final.nodes,initial.nodes);
 await call('canvas_focus',{instanceId:initial.selectedIds[0]||initial.nodes[0].instanceId});
 await call('canvas_save');report.passed=true;console.log('All native canvas checks passed; original scene roots preserved');
} catch(e){report.error=e.message;process.exitCode=1;console.error(e);}finally{
 if(temporary.size){try{const p=await call('canvas_preview',{action:'status'});if(p.isPreview)await call('canvas_preview',{action:'stop'});const s=await call('canvas_scene',{allNodes:true});const ids=[...temporary].filter(id=>s.nodes.some(n=>n.instanceId===id));if(ids.length)await call('canvas_delete',{instanceIds:ids});}catch(e){report.cleanupError=e.message;}}
 await fs.writeFile('.local/canvas-controls-report.json',JSON.stringify(report,null,2));await client.close();
}
