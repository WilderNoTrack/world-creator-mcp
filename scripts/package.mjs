import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {validateReleaseEntries} from './release-policy.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true}).trim();
if(git('status','--porcelain','--untracked-files=normal'))throw new Error('Release requires a clean committed worktree');
const commit=git('rev-parse','HEAD');
const files=git('ls-files','-z').split('\0').filter(Boolean),entries=[];
for(const file of files){
 let current=root;
 for(const part of file.split('/')){current=path.join(current,part);if((await fs.lstat(current)).isSymbolicLink())throw new Error('Linked release path: '+file);}
 const bytes=await fs.readFile(current);const content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);entries.push({path:file,content});
}
validateReleaseEntries(entries);
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
if(!/^\d+\.\d+\.\d+$/.test(pkg.version))throw new Error('Invalid release version');
const dir=path.join(root,'dist');await fs.mkdir(dir,{recursive:true});
const name=`world-creator-mcp-v${pkg.version}-source.zip`,output=path.join(dir,name);
git('archive','--format=zip','--prefix=world-creator-mcp/','--output',output,commit);
const sha256=crypto.createHash('sha256').update(await fs.readFile(output)).digest('hex');
await fs.writeFile(path.join(dir,'SHA256SUMS.txt'),`${sha256}  ${name}\n`);
await fs.writeFile(path.join(dir,'release-manifest.json'),JSON.stringify({version:pkg.version,commit,files,archive:name,sha256},null,2)+'\n');
console.log(JSON.stringify({version:pkg.version,commit,archive:output,sha256,fileCount:files.length},null,2));
