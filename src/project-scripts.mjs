import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {WorkspaceService,sha256} from './workspace.mjs';

export class ProjectScripts {
 constructor({projectsRoot,backupRoot,live,validate}){this.paths=new WorkspaceService({projectsRoot,backupRoot});this.backupRoot=backupRoot;this.live=live;this.validate=validate;}
 project(args){if(!/^project_[A-Za-z0-9_-]+$/.test(args.projectId))throw new Error('Invalid project');const root=this.paths.checkedPath(this.paths.projectsRoot,args.projectId);if(!fs.statSync(root).isDirectory())throw new Error('Project missing');return root;}
 file(args){if(!/^modules\/[a-zA-Z0-9_-]+\.lua$/.test(args.file)||/\/(con|prn|aux|nul|com[0-9]|lpt[0-9])\.lua$/i.test(args.file))throw new Error('Expected modules/name.lua; official/runtime files are read-only');return this.paths.checkedPath(this.project(args),'scripts/'+args.file);}
 read(args){const file=this.file(args),s=fs.statSync(file);if(!s.isFile()||s.size>1024*1024)throw new Error('Script exceeds 1 MiB');const b=fs.readFileSync(file);return{projectId:args.projectId,file:args.file,content:b.toString('utf8'),sha256:sha256(b)};}
 list(args){const root=this.project(args),dir=this.paths.checkedPath(root,'scripts/modules');if(!fs.existsSync(dir))return{projectId:args.projectId,files:[]};const files=fs.readdirSync(dir,{withFileTypes:true}).filter(x=>x.isFile()&&!x.isSymbolicLink()&&/^[a-zA-Z0-9_-]+\.lua$/.test(x.name)).slice(0,1000).map(x=>{const r=this.read({...args,file:'modules/'+x.name});return{file:r.file,sha256:r.sha256,scriptId:r.content.match(/^\s*---@id\s+(\S+)/m)?.[1]};});return{projectId:args.projectId,files};}
 async write(args,signal){
  const root=this.project(args),file=this.file(args);if(typeof args.content!=='string'||Buffer.byteLength(args.content)>1024*1024)throw new Error('Script exceeds 1 MiB');
  const lockDir=path.join(this.backupRoot,'..','locks');fs.mkdirSync(lockDir,{recursive:true});const lock=path.join(lockDir,'scripts-'+sha256(fs.realpathSync(root).toLowerCase())+'.lock');
  let descriptor;try{descriptor=fs.openSync(lock,'wx');}catch(e){if(e.code==='EEXIST')throw new Error('Project script operation running; inspect stale lock if process crashed');throw e;}
  let lease,written=false,result,backupPath,temp,writeError;
  try{
   fs.writeFileSync(descriptor,JSON.stringify({pid:process.pid,projectId:args.projectId}));
   const old=fs.existsSync(file)?this.read(args):null;
   if((old?.sha256??null)!==args.expectedSha256)throw new Error('Script changed or already exists; read again');
   const identity=s=>s.split(/\r?\n/).filter(l=>/^\s*---@(id|referenceName|assetRef)\b/.test(l)).map(l=>l.trim()).join('\n');
   let content=args.content;
   if(old){if(identity(content)!==identity(old.content))throw new Error('Preserve script identity annotations (id/referenceName/assetRef)');}
   else{if(identity(content))throw new Error('New script identity is assigned automatically');content=`---@id ${crypto.randomUUID()}\n---@referenceName ${path.basename(file)}\n${content}`;}
   const compiled=await this.validate(content,signal);if(!compiled?.ok)throw new Error('Lua syntax rejected: '+JSON.stringify(compiled));
   lease={token:crypto.randomUUID(),projectRoot:root};
   const acknowledged=await this.live.call('script_begin',{projectId:args.projectId,expectedProjectRoot:root,token:lease.token},signal);
   if(acknowledged.token!==lease.token)throw new Error('Script lease token mismatch');
   lease=acknowledged;
   if(path.resolve(lease.projectRoot).toLowerCase()!==path.resolve(root).toLowerCase())throw new Error('Open project path mismatch');
   this.file(args);if((fs.existsSync(file)?this.read(args).sha256:null)!==args.expectedSha256)throw new Error('Script changed during validation');
   if(old){fs.mkdirSync(this.backupRoot,{recursive:true});backupPath=path.join(this.backupRoot,`script-${args.projectId}-${crypto.randomUUID()}.lua`);fs.copyFileSync(file,backupPath);}
   fs.mkdirSync(path.dirname(file),{recursive:true});
   if(old){temp=file+'.mcp-'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,content,{flag:'wx'});fs.renameSync(temp,file);temp=undefined;}
   else fs.writeFileSync(file,content,{flag:'wx'});
   written=true;result={projectId:args.projectId,file:args.file,written:true,sha256:sha256(Buffer.from(content)),backupPath};
  }catch(e){writeError=e;if(backupPath)e.backupPath=backupPath;throw e;}finally{
   try{
    if(lease){try{const refreshed=await this.live.call('script_finish',{projectId:args.projectId,expectedProjectRoot:root,token:lease.token,refresh:written});if(result){result.refreshed=true;result.scripts=refreshed.scripts;}}catch(e){if(writeError)writeError.cleanupError=e.message;else if(result){result.refreshed=false;result.refreshError=e.message;}else throw e;}}
   }finally{if(temp&&fs.existsSync(temp))fs.unlinkSync(temp);fs.closeSync(descriptor);fs.unlinkSync(lock);}
  }
  return result;
 }
}
