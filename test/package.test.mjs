import test from 'node:test';
import assert from 'node:assert/strict';
const policy=await import('../scripts/release-policy.mjs').catch(()=>({}));
test('release allowlist rejects local state, private assets, binaries and secrets',()=>{
 assert.equal(typeof policy.validateReleaseEntries,'function');
 assert.doesNotThrow(()=>policy.validateReleaseEntries([{path:'src/server.mjs',content:'export const ok=true;'}]));
 for(const file of ['.local/native-worker.cjs','.env','node_modules/pkg/a.js','scene.data','model.glb','docs/private.png','docs/design.md','unknown.js'])assert.throws(()=>policy.validateReleaseEntries([{path:file,content:'x'}]),/release|allowed/i);
 for(const content of ['ghp_'+'A'.repeat(36),'-----BEGIN '+'RSA PRIVATE KEY-----','C:'+String.fromCharCode(92)+'Users'+String.fromCharCode(92)+'private-user'+String.fromCharCode(92)+'project','a\0b'])assert.throws(()=>policy.validateReleaseEntries([{path:'README.md',content}]),/secret|private|binary/i);
});
