import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const c=new Client({name:'worldcreator-catalog',version:'1'});
try{
 await c.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/server.mjs',import.meta.url))],stderr:'pipe'}));
 const {tools}=await c.listTools();
 const catalog=tools.map(({name,description,annotations,inputSchema})=>({name,description,annotations,inputSchema})).sort((a,b)=>a.name.localeCompare(b.name));
 await fs.mkdir(new URL('../docs/',import.meta.url),{recursive:true});
 await fs.writeFile(new URL('../docs/tools.json',import.meta.url),JSON.stringify(catalog,null,2)+'\n');
 console.log(`Wrote ${catalog.length} tools`);
}finally{await c.close();}
