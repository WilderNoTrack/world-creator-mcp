import fs from 'node:fs/promises';import assert from 'node:assert/strict';
import {Client}from'@modelcontextprotocol/sdk/client/index.js';import{StdioClientTransport}from'@modelcontextprotocol/sdk/client/stdio.js';
const projectId=process.argv[2];if(!/^project_[a-zA-Z0-9_-]+$/.test(projectId||''))throw new Error('Supply open project ID; test creates and cleans temporary objects');
const c=new Client({name:'advanced-mcp-check',version:'0.4.0'});await c.connect(new StdioClientTransport({command:process.execPath,args:['src/server.mjs'],stderr:'pipe'}));
const report={projectId,steps:[]},ids=[];
async function call(tool,args={}){const r=await c.callTool({name:'worldcreator_'+tool,arguments:{projectId,...args}},undefined,{timeout:180000});const value=JSON.parse(r.content.find(c=>c.type==='text').text);report.steps.push({tool,args,value,isError:r.isError||false});await fs.writeFile('.local/advanced-canvas-report.json',JSON.stringify(report,null,2));if(r.isError)throw new Error(JSON.stringify(value));console.log(tool+' OK');return value;}
try{
 const initial=await call('canvas_scene');assert.equal(initial.unsavedChanges,false);
 const cube=(await call('canvas_create_primitive',{shape:'cube'})).nodes[0].instanceId;ids.push(cube);
 await call('canvas_update',{instanceId:cube,name:'MCP材质验证临时对象',position:[60,5,60]});
 await call('canvas_component_schema',{instanceId:cube});
 await call('canvas_component_update',{instanceId:cube,component:'Component.Appearance',properties:{PresetName:'Standard'}});
 const material=await call('canvas_component_update',{instanceId:cube,component:'Component.Appearance',properties:{Color:'#ee4400',Metallic:0.4,Roughness:0.7}});assert.equal(material.properties.Color,'#ee4400');
 const light=(await call('canvas_create_special',{kind:'point_light'})).nodes[0].instanceId;ids.push(light);
 await call('canvas_component_schema',{instanceId:light});
 const lit=await call('canvas_component_update',{instanceId:light,component:'Component.CustomLight',properties:{Color:'#ffaa22',Intensity:80,Range:15}});assert.equal(lit.properties.Intensity,80);
 const text=(await call('canvas_create_special',{kind:'text3d'})).nodes[0].instanceId;ids.push(text);
 await call('canvas_component_schema',{instanceId:text});
 const label=await call('canvas_component_update',{instanceId:text,component:'Component.Text3DUI',properties:{Content:'MCP接口验证',FontColor:'#33ccff',FaceCamera:true}});assert.equal(label.properties.Content,'MCP接口验证');
 const water=(await call('canvas_create_special',{kind:'water'})).nodes[0].instanceId;ids.push(water);
 await call('canvas_component_schema',{instanceId:water});await call('canvas_component_update',{instanceId:cube,component:'Component.Appearance',properties:{PresetName:'Water'}});const component='Component.Appearance';
 const wet=await call('canvas_component_update',{instanceId:cube,component,properties:{WaterDuelColor:'#112233_#445566',WaveSpeed:2}});assert.equal(wet.properties.WaterDuelColor,'#112233_#445566');
 await call('canvas_delete',{instanceIds:[...ids]});ids.length=0;
 const final=await call('canvas_scene');assert.equal(final.totalNodes,initial.totalNodes);assert.deepEqual(final.nodes,initial.nodes);
 if(initial.selectedIds[0])await call('canvas_focus',{instanceId:initial.selectedIds[0]});
 await call('canvas_save');report.passed=true;
}catch(e){report.error=e.message;process.exitCode=1;console.error(e);}finally{if(ids.length){try{await call('canvas_delete',{instanceIds:ids});}catch(e){report.cleanupError=e.message;}}await fs.writeFile('.local/advanced-canvas-report.json',JSON.stringify(report,null,2));await c.close();}
