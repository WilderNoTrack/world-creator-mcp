// Fixed, serializable native editor operations. Never expose arbitrary renderer code.
export async function workflowOperation(operation,args={}) {
 const allowed=['runtime_object','terrain_info','asset_search','pcg_selections','pcg_select','settings_read','settings_update','script_begin','script_finish','script_refresh'];
 if(!allowed.includes(operation))throw new Error('Unsupported workflow operation');
 const c=globalThis.Container;
 const get=name=>{const keys=[...c._bindingDictionary._map.keys()].filter(k=>(k.description||k.name)===name);if(keys.length!==1)throw new Error('Unsupported service: '+name);return c.get(keys[0]);};
 const store=get('StoreManager'),state=()=>store.store.getState(),root=()=>state().projectSettings.projectInfo.projectRoot;
 const originalRoot=root(),key=p=>p.replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
 const context={projectId:originalRoot.split(/[\\/]/).pop()};
 const checkProject=()=>{if(args.projectId!==context.projectId||args.expectedProjectRoot&&key(args.expectedProjectRoot)!==key(originalRoot))throw new Error('Wrong project');};
 if(operation!=='script_finish')checkProject();
 const ensure=()=>{if(key(root())!==key(originalRoot))throw new Error('Project changed; inspect outcome');};
 if(operation==='runtime_object'){
  const g=get('RuntimeService').unityAPI?.UnityEngine.GameObject.Find(args.name);
  if(!g)return{...context,name:args.name,available:false};
  const t=g.transform,children=[];for(let i=0;i<Math.min(t.childCount,50);i++)children.push(String(t.GetChild(i).name).slice(0,512));
  ensure();return{...context,name:String(g.name),available:true,activeInHierarchy:!!g.activeInHierarchy,worldPosition:[t.position.x,t.position.y,t.position.z],children};
 }
 if(operation==='terrain_info'){
  const u=get('RuntimeService').unityAPI,t=u?.UnityEngine.Terrain.activeTerrain;
  if(!t?.terrainData)return{...context,available:false};
  const o=t.transform.position,s=t.terrainData.size;
  const points=(args.points||[]).map(([x,z])=>({x,z,inside:x>=o.x&&x<=o.x+s.x&&z>=o.z&&z<=o.z+s.z,height:t.SampleHeight(new u.UnityEngine.Vector3(x,0,z))+o.y}));
  ensure();return{...context,available:true,origin:[o.x,o.y,o.z],size:[s.x,s.y,s.z],points};
 }
 const clone=v=>JSON.parse(JSON.stringify(v));
 const hash=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v)))),b=>b.toString(16).padStart(2,'0')).join('');
 const guard=()=>{ensure();const e=state().editorInfo;if(!get('RuntimeService').initialized||e.previewInfo?.isPreview||e.previewInfo?.isPreviewLoading||e.loadingInfo?.showLoading||e.disableInteraction?.disabled)throw new Error('Editor runtime/preview/loading guard active');if(get('SceneService').brushControl?.getTool())throw new Error('Exit brush editing first');};
 const dispatch=async action=>{const r=store.dispatch(action);if(!r?.effectsCompletedPromise||await r.effectsCompletedPromise===false)throw new Error('Native operation rejected');ensure();};
 const assetView=a=>({assetId:String(a.id),name:a.name,description:a.desc,dataType:a.dataType,module:a.module,resourceType:a.resourceType,shapeType:a.shapeType,groupTypes:a.groupTypes,hasResource:!!a.resource?.uri});
 const artifact=()=>{const s=state().pcgChatState.sessions.find(s=>s.workspaceId===args.workspaceId),a=s?.artifacts[args.artifactId];if(!s||a?.kind!=='sprinkle'||a.status!=='completed')throw new Error('Completed sprinkle artifact not found');return{s,a};};
 const selectionView=async()=>{const{s,a}=artifact();const snap=clone(a.assetSelections||[]);return{...context,workspaceId:s.workspaceId,artifactId:a.id,revision:await hash(snap),selections:snap.map(v=>({overlayId:v.overlayId,assetType:v.assetType,description:v.description,placementClass:v.placementClass,selectedAssets:(v.selectedAssets||[]).map(x=>({assetId:x.resourceId||x.id,name:x.name,isAIPlaceholder:!!x.isAIPlaceholder,hasResource:!!(x.resourceUri||x.resourceUrl)}))}))};};
 const groups=['MainLight','Skybox','Ambient','CharLight','Reflection','Fog','Weather','PostProcess'];
 const supported=['bool','float','range','number','select','imageSelect','unity.color','unity.envSunHeight'];
 const descriptors=()=>({global:get('SchemaService').reg.getStructDescriptor('Settings.Global')||{},environment:Object.assign({},...groups.map(g=>get('SchemaService').reg.getStructDescriptor('Settings.EnvParam.'+g)||{}))});
 const settings=()=>state().projectSettings.projectSettings;
 const templates=()=>[...(store.selectors.envParamTemplatesSelector(state())||[]).map(t=>({id:t.template_id,name:t.name,scope:'official',json:t.param_json})),...(state().envParamUserTemplates?.list||[]).map(t=>({id:t.id,name:t.name,scope:'user',json:t.param_json}))];
 const settingsView=async()=>{const snap=clone(settings()),d=descriptors();return{...context,revision:await hash(snap),global:snap.global,environment:snap.env,templates:templates().map(({json,...t})=>t),fields:Object.fromEntries(Object.entries(d).map(([group,fields])=>[group,Object.entries(fields).map(([name,f])=>({name,type:f.type,editable:supported.includes(f.type)&&typeof f.params!=='function',constraints:typeof f.params==='function'?undefined:JSON.parse(JSON.stringify(f.params||{},(k,v)=>k==='iconUrl'?undefined:v))}))]))};};
 if(operation==='pcg_selections')return selectionView();
 if(operation==='settings_read')return settingsView();
 if(operation==='script_finish'){
  const lease=globalThis.__worldcreatorScriptLease;
  if(!lease||lease.token!==args.token)throw new Error('Invalid script lease');
  try{checkProject();if(key(lease.projectRoot)!==key(originalRoot))throw new Error('Project changed');guard();if(args.refresh!==false)await get('SceneLuaScriptService').prepareLatestCatalog();ensure();return{...context,scripts:clone(state().luaScripting.scripts)};}
  finally{delete globalThis.__worldcreatorScriptLease;globalThis.__worldcreatorMcpBusy=false;}
 }
 if(globalThis.__worldcreatorMcpBusy)throw new Error('Another MCP operation is running');
 guard();globalThis.__worldcreatorMcpBusy=true;let keepLease=false;
 try {
  if(operation==='asset_search'){
   const page=await get('AssetDataService').searchAssets({scope:args.scope||'public',keyword:args.query,module:args.staticOnly?1:undefined,resourceTypes:[1]}, {pageNo:args.page??0,pageSize:args.limit??20,cursor:args.cursor});ensure();
   return{...context,assets:(page.assets||[]).map(assetView),hasMore:!!page.hasMore,cursor:page.cursor??page.nextCursor,nextPage:(args.page??0)+1};
  }
  if(operation==='pcg_select'){
   const{s,a}=artifact();if(['pending','running'].includes(s.turnStage))throw new Error('Native PCG session active');
   const old=clone(a.assetSelections||[]),stamp=await hash(old);ensure();
   if(args.expectedRevision!==stamp)throw new Error('Selections changed; read again');
   if(!args.selections?.length||new Set(args.selections.map(v=>v.overlayId)).size!==args.selections.length)throw new Error('Empty or duplicate overlay selections');
   const next=clone(old);
   for(const patch of args.selections){
    const entry=next.find(v=>v.overlayId===patch.overlayId);if(!entry)throw new Error('Unknown overlay');
    const asset=await get('AssetDataService').getAssetById(patch.assetId);ensure();
    if(!asset||String(asset.id)!==patch.assetId||asset.module!==1||![1,2,3].includes(asset.dataType)||!asset.resource?.uri)throw new Error('Selection requires a static model library asset with a usable resource URI');
    const compatible=asset.resourceType===1&&(entry.placementClass==='insert'?asset.dataType===2:asset.dataType===3||asset.dataType===1&&asset.shapeType===1);
    if(!compatible)throw new Error('Asset is not compatible with native overlay placement filter');
    const plantType=asset.groupTypes?.[0];
    entry.placementClass=asset.dataType===2?'insert':'scatter';
    entry.selectedAssets=[{id:entry.selectedAssets?.[0]?.id,resourceId:String(asset.id),name:asset.name,previewUri:asset.preview?.uri,previewUrl:asset.preview?.url,resourceUri:asset.resource?.uri,resourceUrl:asset.resource?.url,dataType:asset.dataType,style:asset.style,isAIPlaceholder:false,...Number.isInteger(plantType)&&plantType>=1&&plantType<=4?{plantType}:{}}];
   }
   guard();const latest=artifact();if(['pending','running'].includes(latest.s.turnStage)||JSON.stringify(latest.a.assetSelections||[])!==JSON.stringify(old))throw new Error('Selections changed during lookup');
   await dispatch(store.actions.pcgChatState.updateSprinkleAssetSelections({sessionId:s.id,sprinkleArtifactId:a.id,assetSelections:next}));
   return{...await selectionView(),generationStarted:false};
  }
  if(operation==='settings_update'){
   if(!['environment','global'].includes(args.group))throw new Error('Unknown settings group');
   const snap=clone(settings());if(await hash(snap)!==args.expectedRevision)throw new Error('Settings changed; read again');
   const patch=args.properties||{},d=descriptors()[args.group];
   if(!Object.keys(patch).length&&!args.templateId)throw new Error('Empty settings patch');
   if(args.templateId&&args.group!=='environment')throw new Error('Template requires environment group');
   for(const[n,v]of Object.entries(patch)){
    const f=d[n];if(!f||!supported.includes(f.type)||typeof f.params==='function')throw new Error('Unsupported settings field: '+n);
    const p=f.params||{},t=f.type;let valid=t==='bool'?typeof v==='boolean':t==='unity.color'?typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v):Number.isFinite(v);
    if(!valid)throw new Error('Invalid field type: '+n);
    if(typeof v==='number'&&(p.min!==undefined&&v<p.min||p.max!==undefined&&v>p.max||t==='unity.envSunHeight'&&(v< -180||v>180)))throw new Error('Field outside range: '+n);
    if(['select','imageSelect'].includes(t)&&!Object.values(p.map||{}).some(x=>Object.is(typeof x==='object'?x.value:x,v)))throw new Error('Invalid enum: '+n);
   }
   let env=clone(snap.env||{});
   if(args.templateId){const t=templates().find(t=>t.id===args.templateId&&t.scope===(args.templateScope||'official'));if(!t)throw new Error('Template not loaded');const params=state().envParamOverrides?.data?.overrides?.[t.scope]?.[t.id]?.params??JSON.parse(t.json||'{}');if(!params||Array.isArray(params)||typeof params!=='object')throw new Error('Invalid template');env={templateId:t.id,templateScope:t.scope,params};}
   if(args.group==='environment'){
    if(!env.templateId||!env.templateScope)throw new Error('Select an environment template first');
    env.params={...env.params,...patch};if(Number.isFinite(env.params.startFog)&&Number.isFinite(env.params.endFog)&&env.params.startFog>env.params.endFog)throw new Error('Fog start must not exceed fog end');
   }
   guard();if(JSON.stringify(settings())!==JSON.stringify(snap))throw new Error('Settings changed; read again');
   await dispatch(args.group==='global'?store.actions.projectSettings.setGlobalSetting(patch):store.actions.projectSettings.setEnvSetting(env));
   return{...await settingsView(),saved:false};
  }
  if(operation==='script_begin'){
   const token=args.token||crypto.randomUUID();globalThis.__worldcreatorScriptLease={token,projectRoot:originalRoot};keepLease=true;return{...context,projectRoot:originalRoot,token};
  }
  if(operation==='script_refresh'){await get('SceneLuaScriptService').prepareLatestCatalog();ensure();return{...context,scripts:clone(state().luaScripting.scripts)};}
 }finally{if(!keepLease)globalThis.__worldcreatorMcpBusy=false;}
}
