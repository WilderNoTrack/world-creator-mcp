import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { editorOperation } from '../src/editor-runtime.mjs';
import { LiveEditor, validateEndpoint, readGlb } from '../src/live.mjs';

test('configured project directory is enforced by transport for every handler family',async()=>{
 const f=fixture(),allowed=path.resolve('allowed-projects'),outside=path.resolve('outside-projects/project_test');
 f.state.projectSettings.projectInfo.projectRoot=outside;
 const live=new LiveEditor({projectsRoot:allowed});
 live.target=async()=>({});
 live.request=async(t,m,p)=>({result:{value:await (0,eval)(p.expression)}});
 for(const [op,args]of [['update',{instanceId:'1',position:[9,0,0]}],['component_update',{}],['runtime_object',{name:'test'}],['scene',{}]]) {
  await assert.rejects(live.call(op,{projectId:'project_test',...args}),/project/i);
 }
 await assert.rejects(live.call('scene'),/project.*path|project.*root/i);
 await assert.rejects(live.importGlb({projectId:'project_test',filePath:path.resolve('missing.glb')}),/project.*path|project.*root/i);
 await assert.rejects(live.call('update',{projectId:'../outside',instanceId:'1'}),/project/i);
 assert.equal(f.writes(),0);
 f.state.projectSettings.projectInfo.projectRoot=path.join(allowed,'project_test');
 assert.equal((await live.call('scene')).projectId,'project_test');
 await live.call('update',{projectId:'project_test',instanceId:'1',position:[7,0,0]});
 assert.equal(f.writes(),1);
 await assert.rejects(live.call('update',{projectId:'project_test',expectedProjectRoot:outside,instanceId:'1'}),/project.*path|project.*root/i);
});

function fixture() {
  const node={instanceId:'1',name:'park',parentInstanceId:'root',childrenInstanceId:[],transform:{localPosition:[1,0,0],localEulerAngles:[0,0,0],localScale:[1,1,1]}};
  const state={projectSettings:{projectInfo:{projectName:'Test',projectRoot:'C:\\projects\\project_test'}},scene:{rootId:'root',gameObjectMap:{'1':node},pickedIds:[]},assets:{entities:{}},editorInfo:{previewInfo:{isPreview:false},loadingInfo:{showLoading:false}}};
  let writes=0;
  const store={store:{getState:()=>state},actions:{scene:{changeGameObjects:p=>({type:'edit',payload:p})}},dispatch:a=>({effectsCompletedPromise:new Promise(resolve=>setTimeout(()=>{writes++;Object.assign(node,a.payload.data[0].info);resolve(true);},15))})};
  const services={StoreManager:store,RuntimeService:{initialized:true},SceneSaveStateService:{hasUnsavedChanges:()=>false}};
  const entries=new Map(Object.entries(services).map(([n,s])=>[Symbol(n),s]));
  globalThis.Container={_bindingDictionary:{_map:entries},get:k=>entries.get(k)};
  return {state,node,store,entries,writes:()=>writes};
}
test('save pins full project root before and after native effects',async()=>{
  const f=fixture();let saves=0;
  f.entries.set(Symbol('SceneService'),{saveScene:async()=>{saves++;f.state.projectSettings.projectInfo.projectRoot='D:\\copy\\project_test';}});
  await assert.rejects(editorOperation('save',{projectId:'project_test',expectedProjectRoot:'D:\\copy\\project_test'}),/project.*path/i);
  assert.equal(saves,0);
  await assert.rejects(editorOperation('save',{projectId:'project_test',expectedProjectRoot:'C:\\projects\\project_test'}),/project changed/i);
  assert.equal(saves,1);
});
test('focus an already selected object without dispatching a rejected no-op selection',async()=>{
  const f=fixture();f.state.scene.pickedIds=['1'];
  const calls=[];
  f.store.actions.scene.setPickedIds=p=>({type:'select',payload:p});
  f.store.actions.scene.focusGameObject=p=>({type:'focus',payload:p});
  f.store.dispatch=a=>{calls.push(a.type);return {effectsCompletedPromise:Promise.resolve(a.type!=='select')};};
  const result=await editorOperation('focus',{projectId:'project_test',instanceId:'1'});
  assert.equal(result.focusedInstanceId,'1');assert.deepEqual(calls,['focus']);
});
test('wrong project and stale transform are rejected without mutation',async()=>{
  const f=fixture();
  await assert.rejects(editorOperation('update',{projectId:'wrong',instanceId:'1',position:[3,0,0]}),/project/i);
  await assert.rejects(editorOperation('update',{projectId:'project_test',instanceId:'1',position:[3,0,0],expectedTransform:{localPosition:[9,0,0]}}),/stale/i);
  assert.equal(f.writes(),0);
});
test('edit awaits native effects and returns updated scene data',async()=>{
  const f=fixture();
  const r=await editorOperation('update',{projectId:'project_test',instanceId:'1',position:[3,0,0]});
  assert.equal(f.writes(),1);assert.deepEqual(r.node.transform.localPosition,[3,0,0]);
});
test('preview and missing asset cannot mutate the canvas',async()=>{
  const f=fixture();f.state.editorInfo.previewInfo.isPreview=true;
  await assert.rejects(editorOperation('update',{projectId:'project_test',instanceId:'1',position:[3,0,0]}),/preview|loading/i);
  f.state.editorInfo.previewInfo.isPreview=false;
  await assert.rejects(editorOperation('add',{projectId:'project_test',assetId:'missing'}),/asset/i);
  assert.equal(f.writes(),0);
});
test('replace validates asset first, awaits native replacement and returns new ID',async()=>{
  const f=fixture();
  await assert.rejects(editorOperation('replace',{projectId:'project_test',instanceId:'1',assetId:'missing'}),/asset/i);
  f.state.assets.entities.a={id:'a'};
  f.store.actions.scene.replaceGameObjects=p=>({payload:p});
  f.store.dispatch=a=>({effectsCompletedPromise:new Promise(resolve=>setTimeout(()=>{
    assert.deepEqual(a.payload.assetToReplace.originInstanceIds,['1']);
    delete f.state.scene.gameObjectMap['1'];f.state.scene.gameObjectMap['2']={...f.node,instanceId:'2'};resolve(true);
  },10))});
  const r=await editorOperation('replace',{projectId:'project_test',instanceId:'1',assetId:'a'});
  assert.equal(r.nodes[0].instanceId,'2');assert.equal(r.replacedInstanceId,'1');
});
test('live transport rejects non-loopback and credential-bearing endpoints',()=>{
  assert.equal(validateEndpoint('http://127.0.0.1:49221'),'http://127.0.0.1:49221');
  for(const u of ['https://example.com','http://127.0.0.1.evil:49221','http://user:pass@127.0.0.1:49221','http://127.0.0.1:49221/path']) assert.throws(()=>validateEndpoint(u));
});
test('invalid GLB rejected before upload',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'worldcreator-test-'));
  try {const p=path.join(dir,'bad.glb');await fs.writeFile(p,'not a model');await assert.rejects(readGlb(p),/GLB/);} finally {await fs.rm(dir,{recursive:true});}
});

test('delete validates every target before mutation and removes complete subtrees',async()=>{
 const f=fixture(); f.node.childrenInstanceId=['child']; f.state.scene.gameObjectMap.child={...f.node,instanceId:'child',parentInstanceId:'1',childrenInstanceId:[]};
 f.store.actions.scene.removeGameObjects=p=>({payload:p});
 f.store.dispatch=a=>({effectsCompletedPromise:Promise.resolve().then(()=>{for(const n of a.payload.gameObjects){delete f.state.scene.gameObjectMap[n.instanceId];delete f.state.scene.gameObjectMap.child;}return true;})});
 await assert.rejects(editorOperation('delete',{projectId:'project_test',instanceIds:['1','missing']}),/not found/);
 assert.ok(f.state.scene.gameObjectMap['1']);
 const r=await editorOperation('delete',{projectId:'project_test',instanceIds:['1']});assert.deepEqual(r.deletedInstanceIds,['1','child']);
});
test('physics rejects unknown fields and reads native normalized result',async()=>{
 const f=fixture();f.node.componentIds=['1_Component.PhysicsCollider'];f.state.scene.componentMap={'1_Component.PhysicsCollider':{Mass:1,EnableCollision:true}};
 f.store.actions.scene.changeComponents=p=>({payload:p});f.store.dispatch=a=>({effectsCompletedPromise:Promise.resolve().then(()=>{Object.assign(f.state.scene.componentMap[a.payload.data[0].componentId],a.payload.data[0].info);return true;})});
 await assert.rejects(editorOperation('physics',{projectId:'project_test',instanceId:'1',properties:{Mass:-1}}),/Mass/);
 await assert.rejects(editorOperation('physics',{projectId:'project_test',instanceId:'1',properties:{Uri:'bad'}}),/field/);
 const r=await editorOperation('physics',{projectId:'project_test',instanceId:'1',properties:{Mass:4}});assert.equal(r.properties.Mass,4);assert.equal(r.properties.EnableCollision,true);
});
test('script parameter patches preserve other values and validate schema',async()=>{
 const f=fixture();f.node.scriptBindingIds=['1_s'];f.state.scene.scriptMap={'1_s':{scriptId:'s',params:{Heat:3,Hits:6}}};
 f.state.luaScripting={scripts:{s:{params:[{name:'Heat',type:'number',defaultValue:3,range:{min:1,max:10}},{name:'Hits',type:'int',defaultValue:6}],diagnostics:[]}}};
 f.store.actions.scene.changeGameObjectScriptParams=p=>({payload:p});f.store.dispatch=a=>({effectsCompletedPromise:Promise.resolve().then(()=>{f.state.scene.scriptMap['1_s'].params=a.payload.data[0].params;return true;})});
 await assert.rejects(editorOperation('script_params',{projectId:'project_test',instanceId:'1',scriptId:'s',params:{Heat:20}}),/range/);
 await assert.rejects(editorOperation('script_params',{projectId:'project_test',instanceId:'1',scriptId:'s',params:{Typo:2}}),/Unknown/);
 const r=await editorOperation('script_params',{projectId:'project_test',instanceId:'1',scriptId:'s',params:{Heat:4}});assert.deepEqual(r.binding.params,{Heat:4,Hits:6});
});
test('preview stop is allowed while previewing and swallowed native failure is detected',async()=>{
 const f=fixture();f.state.editorInfo.previewInfo.isPreview=true;
 f.entries.set(Symbol('EditorPreviewService'),{stopPreview:async()=>{f.state.editorInfo.previewInfo.isPreview=false;},startPreview:async()=>{}});
 const r=await editorOperation('preview',{projectId:'project_test',action:'stop'});assert.equal(r.isPreview,false);
 await assert.rejects(editorOperation('preview',{projectId:'project_test',action:'start'}),/preview.*failed/i);
});
test('group rejects ancestor and descendant selections before native action',async()=>{
 const f=fixture();f.node.childrenInstanceId=['child'];f.state.scene.gameObjectMap.child={...f.node,instanceId:'child',parentInstanceId:'1',childrenInstanceId:[]};
 await assert.rejects(editorOperation('group',{projectId:'project_test',instanceIds:['1','child']}),/ancestor|parent|siblings/i);assert.equal(f.writes(),0);
});
test('script binding uses native opaque-white color default and rejects nonmember enums',async()=>{
 const f=fixture();f.node.scriptBindingIds=[];f.state.scene.scriptMap={};f.state.luaScripting={scripts:{s:{params:[{name:'Tint',type:'color'},{name:'Mode',type:'string',defaultValue:'walk',enumMap:{Walk:'walk',Run:'run'}}],diagnostics:[]}}};
 f.store.actions.scene.addGameObjectScripts=p=>({payload:p});f.store.dispatch=a=>({effectsCompletedPromise:Promise.resolve().then(()=>{f.node.scriptBindingIds=['1_s'];f.state.scene.scriptMap['1_s']=a.payload.data[0].scripts[0];return true;})});
 await assert.rejects(editorOperation('script_bind',{projectId:'project_test',instanceId:'1',scriptId:'s',params:{Mode:'invalid'}}),/enum/i);
 const r=await editorOperation('script_bind',{projectId:'project_test',instanceId:'1',scriptId:'s'});assert.deepEqual(r.binding.params,{Tint:[1,1,1,1],Mode:'walk'});
});

test('capture writes native image only after project checks and rejects a switched project',async()=>{const {LiveEditor}=await import('../src/live.mjs');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wc-capture-'));try{const live=new LiveEditor({backupRoot:path.join(dir,'backups'),projectsRoot:path.join(dir,'projects')}),png=Buffer.from('89504e470d0a1a0a','hex'),checks=[];live.call=async(op,a)=>{assert.equal(op,'scene');assert.equal(a.expectedProjectRoot,path.join(dir,'projects','project_test'));checks.push(a);};live.target=async()=>({});live.request=async(t,m)=>{assert.equal(m,'Page.captureScreenshot');return{data:png.toString('base64')};};const r=await live.capture({projectId:'project_test'});assert.equal(checks.length,2);assert.deepEqual(await fs.readFile(r.filePath),png);let count=0;live.call=async()=>{if(++count===2)throw new Error('Wrong project');};await assert.rejects(live.capture({projectId:'project_test'}),/project/i);assert.equal((await fs.readdir(path.join(dir,'captures'))).length,1);}finally{await fs.rm(dir,{recursive:true,force:true});}});
