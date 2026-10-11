// Uses the same service as the homepage's "Go edit" action, without UI automation.
export async function homepageOperation(operation,args={}){
 if(!['list','open'].includes(operation))throw new Error('Unsupported homepage operation');
 const c=globalThis.Container,key=p=>p.replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
 const get=name=>{const keys=[...c._bindingDictionary._map.keys()].filter(k=>(k.description||k.name)===name);if(keys.length!==1)throw new Error('Unsupported homepage service');return c.get(keys[0]);};
 const all=await get('ProjectFrontendService').getProjectList();
 const projects=all.filter(p=>{const id=p.projectPath?.split(/[\\/]/).pop();return /^project_[A-Za-z0-9_-]+$/.test(id)&&key(p.projectPath)===key(args.projectsRoot+'/'+id);});
 if(operation==='list')return{scope:'signed_in_homepage',projects:projects.map(p=>({projectId:p.projectPath.split(/[\\/]/).pop(),name:p.name,worldType:p.worldType}))};
 const p=projects.find(p=>p.projectPath.split(/[\\/]/).pop()===args.projectId);
 if(!p||key(p.projectPath)!==key(args.expectedProjectRoot))throw new Error('Project path not found in signed-in homepage list');
 await get('HomepageConnectionFrontendService').api.openProject({projectPath:p.projectPath});
 return{projectId:args.projectId,requested:true,ready:false,nextTool:'worldcreator_status'};
}
