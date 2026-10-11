import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { editorOperation } from './editor-runtime.mjs';
import { advancedOperation } from './advanced-runtime.mjs';
import { workflowOperation } from './workflow-runtime.mjs';
import { homepageOperation } from './homepage-runtime.mjs';

export function validateEndpoint(value) {
  const u=new URL(value);
  if(u.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(u.hostname) || u.username || u.password || u.pathname!=='/' || u.search || u.hash) throw new Error('CDP endpoint must be a plain loopback HTTP origin');
  return u.origin;
}
export async function readGlb(filePath) {
  if(!path.isAbsolute(filePath) || path.extname(filePath).toLowerCase()!=='.glb') throw new Error('Absolute GLB path required');
  const stat=await fs.stat(filePath);
  if(!stat.isFile() || stat.size<20 || stat.size>20*1024*1024) throw new Error('GLB must be a regular file between 20 bytes and 20 MiB');
  const b=await fs.readFile(filePath);
  if(b.toString('ascii',0,4)!=='glTF' || b.readUInt32LE(4)!==2 || b.readUInt32LE(8)!==b.length) throw new Error('Invalid GLB header, version or length');
  return {fileName:path.basename(filePath),base64:b.toString('base64'),sha256:crypto.createHash('sha256').update(b).digest('hex')};
}
export class LiveEditor {
  constructor({endpoint=process.env.WORLD_CREATOR_CDP_URL || 'http://127.0.0.1:49221',backupRoot,projectsRoot}={}) {
    this.endpoint=validateEndpoint(endpoint);this.backupRoot=backupRoot;this.projectsRoot=projectsRoot&&path.resolve(projectsRoot);
  }
  async target(page='editor') {
    if(!['editor','homepage'].includes(page))throw new Error('Invalid editor page');
    let targets;
    try {const r=await fetch(`${this.endpoint}/json/list`,{signal:AbortSignal.timeout(3000),redirect:'error'});if(!r.ok)throw new Error();targets=await r.json();}
    catch {throw new Error('Editor connection unavailable. Start editor with scripts/start-editor.ps1 and open a project.');}
    const matches=targets.filter(t=>{try{const u=new URL(t.url);return t.type==='page' && u.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(u.hostname) && u.pathname===`/${page}/index.html`;}catch{return false;}});
    if(matches.length!==1) throw new Error(`Expected one open ${page==='editor'?'editor canvas':'homepage'}, found ${matches.length}`);
    const ws=new URL(matches[0].webSocketDebuggerUrl);
    const endpoint=new URL(this.endpoint);
    if(ws.protocol!=='ws:' || ws.hostname!==endpoint.hostname || ws.port!==endpoint.port || ws.username || ws.password)throw new Error('Invalid editor websocket target');
    return matches[0];
  }
  async homepage(operation,args={},signal){
    if(operation==='open'){
      let current;
      try{current=await this.target();}catch(e){if(e.message!=='Expected one open editor canvas, found 0')throw e;}
      if(current){const s=await this.call('scene',{projectId:args.projectId,expectedProjectRoot:path.join(this.projectsRoot,args.projectId)},signal);return{projectId:s.projectId,ready:true,alreadyOpen:true};}
    }
    let target;
    try{target=await this.target('homepage');}catch(e){
      if(operation!=='list'||e.message!=='Expected one open homepage, found 0')throw e;
      const s=await this.call('scene',{},signal);
      if(path.resolve(s.projectRoot).toLowerCase()!==path.resolve(this.projectsRoot,s.projectId).toLowerCase())throw new Error('Open project outside configured root');
      return{scope:'open_project_only',projects:[{projectId:s.projectId,name:s.projectName}],note:'Homepage is closed; full signed-in project list is available on the homepage.'};
    }
    const payload={...args,projectsRoot:this.projectsRoot,...args.projectId?{expectedProjectRoot:path.join(this.projectsRoot,args.projectId)}:{}};
    const expression=`(${homepageOperation.toString()})(${JSON.stringify(operation)},${JSON.stringify(payload)})`;
    const r=await this.request(target,'Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},signal);
    if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0]||r.exceptionDetails.text);
    if(r.result?.value===undefined)throw new Error('Homepage returned no result');return r.result.value;
  }
  async call(operation,args={},signal) {
    if(!this.projectsRoot)throw new Error('Configured projects root required');
    if(args.projectId!==undefined){
      if(!/^project_[A-Za-z0-9_-]+$/.test(args.projectId))throw new Error('Invalid project identifier');
      const expected=path.join(this.projectsRoot,args.projectId);
      const key=p=>path.resolve(p).toLowerCase();
      if(args.expectedProjectRoot&&key(args.expectedProjectRoot)!==key(expected))throw new Error('Project path conflicts with configured projects root');
      args={...args,expectedProjectRoot:expected};
    }else{
      if(!['scene','assets'].includes(operation))throw new Error('projectId required');
      args={...args,expectedProjectsRoot:this.projectsRoot};
    }
    const target=await this.target();
    const advanced=['component_schema','component_update','create_special','pcg_context','pcg_start','job_status','job_cancel','publish_prepare','publish_submit','publish_status','debug_capabilities'];
    const workflow=['runtime_object','terrain_info','asset_search','pcg_selections','pcg_select','settings_read','settings_update','script_begin','script_finish','script_refresh'];
    const handler=workflow.includes(operation)?workflowOperation:advanced.includes(operation)?advancedOperation:editorOperation;
    const expression=`(${handler.toString()})(${JSON.stringify(operation)},${JSON.stringify(args)})`;
    return this.request(target,'Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},signal).then(r=>{
      if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || r.exceptionDetails.text);
      if(!r.result || r.result.type==='undefined')throw new Error('Editor returned no result');
      return r.result.value;
    });
  }
  async request(target,method,params,signal) {
    if(signal?.aborted)throw new Error('Cancelled before editor request');
    return new Promise((resolve,reject)=>{
      const ws=new WebSocket(target.webSocketDebuggerUrl);
      let sent=false,done=false;
      const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);ws.close();error?reject(error):resolve(result);};
      const uncertain=()=>new Error(sent?'Editor request interrupted; outcome unknown. Read back before retrying.':'Editor connection interrupted before request');
      const abort=()=>finish(uncertain());
      const timer=setTimeout(abort,120000);
      signal?.addEventListener('abort',abort,{once:true});
      ws.onopen=()=>{sent=true;ws.send(JSON.stringify({id:1,method,params}));};
      ws.onerror=()=>finish(uncertain());ws.onclose=()=>{if(!done)finish(uncertain());};
      ws.onmessage=e=>{try {const m=JSON.parse(e.data);if(m.id===1)finish(m.error?new Error(m.error.message):null,m.result);}catch(err){finish(err);}};
    });
  }
  async status() {try {const s=await this.call('scene');return {connected:true,endpoint:this.endpoint,projectId:s.projectId,projectName:s.projectName,totalNodes:s.totalNodes};}catch(e){return {connected:false,endpoint:this.endpoint,error:e.message};}}
  async capture(args,signal){
    const expectedProjectRoot=path.join(this.projectsRoot,args.projectId);
    await this.call('scene',{...args,expectedProjectRoot},signal);
    const r=await this.request(await this.target(),'Page.captureScreenshot',{format:'png',captureBeyondViewport:false},signal);
    await this.call('scene',{...args,expectedProjectRoot},signal);
    const buffer=Buffer.from(r.data,'base64');if(!buffer.length||buffer.length>20*1024*1024)throw new Error('Screenshot size invalid');
    const dir=path.join(this.backupRoot,'..','captures');await fs.mkdir(dir,{recursive:true});const filePath=path.join(dir,`${args.projectId}-${crypto.randomUUID()}.png`);await fs.writeFile(filePath,buffer,{flag:'wx'});return{projectId:args.projectId,filePath,bytes:buffer.length};
  }
  async importGlb(args,signal) {
    // Verify the target first, before reading the selected file.
    const current=await this.call('scene',{projectId:args.projectId},signal);
    const glb=await readGlb(args.filePath);
    const result=await this.call('import',{projectId:args.projectId,expectedProjectRoot:current.projectRoot,name:args.name,description:args.description,...glb},signal);
    return {...result,sourceSha256:glb.sha256};
  }
  async save(args,signal) {
    const current=await this.call('scene',{projectId:args.projectId},signal);
    const expected=path.resolve(this.projectsRoot,args.projectId);
    if(path.resolve(current.projectRoot).toLowerCase()!==expected.toLowerCase())throw new Error('Open project path does not match configured project root');
    const scenePath=path.join(expected,'scene.data');
    const backupPath=path.join(this.backupRoot,`scene-${args.projectId}-${crypto.randomUUID()}.data`);
    await fs.mkdir(this.backupRoot,{recursive:true});await fs.copyFile(scenePath,backupPath);
    try {
      const result=await this.call('save',{...args,expectedProjectRoot:current.projectRoot},signal);
      const b=await fs.readFile(scenePath);
      return {...result,backupPath,scenePath,sceneBytes:b.length,sceneSha256:crypto.createHash('sha256').update(b).digest('hex')};
    }catch(e){e.backupPath=backupPath;throw e;}
  }
}
