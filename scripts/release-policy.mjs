const top=new Set(['README.md','SECURITY.md','CHANGELOG.md','LICENSE','package.json','package-lock.json','mcp.example.json','.gitignore','.gitattributes']);
const allowed=p=>top.has(p)||/^(src|test)\/[a-zA-Z0-9_-]+\.(mjs|test\.mjs)$/.test(p)||/^scripts\/[a-zA-Z0-9_-]+\.(mjs|ps1)$/.test(p)||p==='docs/tools.json'||p==='.github/workflows/ci.yml';
export function validateReleaseEntries(entries){
 if(!entries.length)throw new Error('Empty release');
 for(const {path,content}of entries){
  if(!allowed(path))throw new Error('Path not allowed in release: '+path);
  if(content.includes('\0'))throw new Error('Binary content in release: '+path);
  // Report only the filename, never the matched secret.
  if(/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-[A-Za-z0-9_-]{32,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(content))throw new Error('Possible secret in release: '+path);
  if(/[A-Z]:[\\/]+Users[\\/]+[^<>\s/\\]+[\\/]/i.test(content))throw new Error('Private home path in release: '+path);
 }
}
