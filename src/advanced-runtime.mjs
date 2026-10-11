// Fixed renderer operations only. Serialized by LiveEditor; no arbitrary evaluation exposed.
export async function advancedOperation(operation,args={}) {
 const allowed=['component_schema','component_update','create_special','pcg_context','pcg_start','job_status','job_cancel','publish_prepare','publish_submit','publish_status','debug_capabilities'];
 if(!allowed.includes(operation))throw new Error('Unsupported advanced operation');
 const c=globalThis.Container;
 const get=name=>{const keys=[...c._bindingDictionary._map.keys()].filter(k=>(k.description||k.name)===name);if(keys.length!==1)throw new Error('Unsupported editor service: '+name);return c.get(keys[0]);};
 const store=get('StoreManager'),state=()=>store.store.getState();
 const root=()=>state().projectSettings.projectInfo.projectRoot;
 const originalRoot=root(),key=p=>p.replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
 const context={projectId:originalRoot.split(/[\\/]/).pop(),projectName:state().projectSettings.projectInfo.projectName};
 if(args.projectId!==context.projectId)throw new Error('Wrong project');
 if(args.expectedProjectRoot&&key(args.expectedProjectRoot)!==key(originalRoot))throw new Error('Wrong project path');
 if(!get('RuntimeService').initialized)throw new Error('Runtime unavailable');
 const ensure=()=>{if(key(root())!==key(originalRoot))throw new Error('Project changed; outcome uncertain');};
 const clean=v=>JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='function'?undefined:x));
 const node=id=>{const n=state().scene.gameObjectMap[id];if(!n||id===state().scene.rootId)throw new Error('Editable node not found');return n;};
 const jobs=globalThis.__worldcreatorMcpJobs??=(new Map());
 const plans=globalThis.__worldcreatorMcpPublishPlans??=(new Map());
 const jobView=j=>({jobId:j.id,requestId:j.requestId,operation:j.operation,projectId:j.projectId,workspaceId:j.workspaceId,status:j.status,startedAt:j.startedAt,finishedAt:j.finishedAt,result:j.result,error:j.error});
 const findJob=()=>{const j=jobs.get(args.jobId);if(!j||key(j.projectRoot)!==key(originalRoot))throw new Error('Job not found for project; renderer restart loses job tracking, inspect native state');return j;};
 if(operation==='job_status')return jobView(findJob());
 if(operation==='job_cancel'){
  const j=findJob();if(j.status!=='running')return jobView(j);
  if(!j.cancelService){
   const action=JSON.parse(j.fingerprint).args?.action;
   if(j.operation!=='pcg_start'||!['activate_map','activate_terrain'].includes(action))throw new Error('This operation cannot safely be cancelled; inspect native state');
   const service=get('PcgComposeMapBrowserTool'),graph=service.activationRuntime?.nodeGraph;
   const ids=graph?.activeExecutions?[...graph.activeExecutions.keys()]:[];
   if(!service.isMapActivating()||ids.length!==1||!Array.isArray(j.activationGraphBaseline)||j.activationGraphBaseline.includes(ids[0]))throw new Error('Cannot identify one active native activation graph owned by this job; inspect native state');
   j.cancelRequested=true;graph.cancel(ids[0]);ensure();return{...jobView(j),cancellationRequested:true,note:'Native graph cancellation requested; partial scene changes are retained. Inspect scene after completion.'};
  }
  j.cancelRequested=true;
  await get(j.cancelService).cancel({workspaceId:j.workspaceId});ensure();return {...jobView(j),cancellationRequested:true};
 }
 const schema=(instanceId,component)=>{
  const n=node(instanceId),id=(n.componentIds||[]).find(id=>id===`${instanceId}_${component}`);
  if(!id)throw new Error('Component not present on object');
  const descriptor=get('SchemaService').reg.getStructDescriptor(component);
  return {id,descriptor,properties:state().scene.componentMap[id]};
 };
 const supportedTypes=['bool','string','textarea','range','number','select','align','unity.color','unity.vector2','unity.vector3','unity.presetMaterial','unity.dualColor'];
 if(operation==='component_schema'){
  const n=node(args.instanceId);
  return {...context,components:(n.componentIds||[]).map(id=>{
   const component=id.slice(n.instanceId.length+1),d=get('SchemaService').reg.getStructDescriptor(component);
   return {component,componentId:id,properties:component==='Component.Asset'?{AssetID:state().scene.componentMap[id]?.AssetID}:state().scene.componentMap[id],fields:Object.entries(d||{}).map(([name,f])=>({name,type:f.type,constraints:typeof f.params==='function'?undefined:clean(f.params??{}),conditionalVisibility:!!f.isHidden,editable:component!=='Component.Asset'&&supportedTypes.includes(f.type)&&typeof f.params!=='function'}))};
  })};
 }
 const session=()=>{const s=state().pcgChatState.sessions.find(s=>s.workspaceId===args.workspaceId);if(!s)throw new Error('PCG workspace session not found; create a map session in editor first');return s;};
 if(operation==='pcg_context'){
  const s=session();return {...context,sessionId:s.id,workspaceId:s.workspaceId,artifacts:Object.values(s.artifacts).map(a=>({id:a.id,kind:a.kind,status:a.status,title:a.displayTitle,prompt:a.prompt,mapSize:a.mapSize,sourcePreviewArtifactId:a.sourcePreviewArtifactId,terrainArtifactId:a.terrainArtifactId,sprinkleArtifactId:a.sprinkleArtifactId,assetSelections:(a.assetSelections||[]).map(v=>({id:v.id,name:v.name,selectedAssetCount:v.selectedAssets?.length,missingResource:!v.selectedAssets?.some(a=>a.resourceUri)}))}))};
 }
 if(operation==='debug_capabilities'){
  const api=get('RuntimeService').unityAPI?.LogicApiMono?.Ins;
  const available=api?Object.getOwnPropertyNames(Object.getPrototypeOf(api)).filter(n=>/Script|Debug|Break|Pause|Step|Resume/.test(n)):[];
  return {...context,scriptDiagnostics:true,runtimeObjectSnapshot:true,luaBreakpoints:false,luaStepping:false,luaLocals:false,reason:'No verified Lua breakpoint/debug-adapter interface in editor 1.0.82. JavaScript CDP breakpoints do not debug Unity Lua.',observedRuntimeMethods:available};
 }
 if(operation==='publish_status'){
  const w=state().projectSettings.worldConfig;
  const remote=args.refresh&&w.worldId?await get('PublishService').queryWorldInfoByAPI(Number(w.worldId),true):undefined;ensure();
  if(!globalThis.__worldcreatorMcpBusy&&state().preview?.uploadingPhase==='remoteProcessing'&&remote?.latestPublishingState>=2){
   const r=store.dispatch(store.actions.projectSettings.setWorldConfig({worldId:w.worldId,worldState:remote.latestPublishingState,...remote.worldInfo?{worldInfo:remote.worldInfo}:{}}));
   if(!r?.effectsCompletedPromise||await r.effectsCompletedPromise===false)throw new Error('Failed to reconcile world upload state');
   ensure();get('PublishService').setUploadingPhase('idle');
  }
  return {...context,worldId:w.worldId,uploadingPhase:state().preview?.uploadingPhase,localWorldState:state().projectSettings.worldConfig.worldState,remote,publicListingVerified:false};
 }
 // Repeated submissions are idempotent for the life of this renderer.
 const {probeOnly,expectedProjectRoot,...requestArgs}=args;
 const fingerprint=JSON.stringify({operation,args:requestArgs});
 if(args.requestId){const existing=[...jobs.values()].find(j=>key(j.projectRoot)===key(originalRoot)&&j.requestId===args.requestId);if(existing){if(existing.fingerprint!==fingerprint)throw new Error('requestId reused with different arguments');return jobView(existing);}}
 if(probeOnly)return {requiresStart:true};
 if(globalThis.__worldcreatorMcpBusy)throw new Error('Another MCP operation is running; query job status');
 const editor=state().editorInfo;
 if(editor.previewInfo?.isPreview||editor.previewInfo?.isPreviewLoading||editor.loadingInfo?.showLoading||editor.disableInteraction?.disabled)throw new Error('Editor preview/loading/interaction guard active');
 if(get('SceneService').brushControl?.getTool())throw new Error('Exit brush editing first');
 const dispatch=async a=>{const r=store.dispatch(a);if(!r?.effectsCompletedPromise)throw new Error('Native completion contract unavailable');if(await r.effectsCompletedPromise===false)throw new Error('Editor rejected operation');ensure();};
 const startJob=(invoke,cancelService)=>{
  if(!args.requestId)throw new Error('requestId required for long operation');
  const j={id:crypto.randomUUID(),requestId:args.requestId,fingerprint,operation,projectRoot:originalRoot,projectId:context.projectId,workspaceId:args.workspaceId,status:'running',startedAt:new Date().toISOString(),cancelService};
  jobs.set(j.id,j);globalThis.__worldcreatorMcpBusy=true;
  Promise.resolve().then(()=>invoke(j)).then(result=>{ensure();j.result=Object.fromEntries(['status','summary','artifactId','terrainArtifactId','sprinkleArtifactId','composedMapArtifactId','worldId','needsConfirmation','cancelled','pendingStages'].filter(k=>result?.[k]!==undefined).map(k=>[k,result[k]]));j.status=result?.cancelled?'cancelled':result?.status==='completed'||result?.status==='stopped'&&!!result?.terrainArtifactId?'completed':result?.status||'failed';}).catch(e=>{j.status='failed';j.error=e.message;}).finally(()=>{j.finishedAt=new Date().toISOString();globalThis.__worldcreatorMcpBusy=false;});
  // Retain request IDs for this renderer lifetime so old retries cannot spend twice.
  return jobView(j);
 };
 if(operation==='pcg_start'){
  const s=session(),a=s.artifacts[args.artifactId];
  const kinds={terrain:'mapPreview',sprinkle:'terrain3d',compose:'sprinkle',activate_terrain:'terrain3d',activate_map:'composedMap'};
  if(!kinds[args.action]||a?.kind!==kinds[args.action]||a.status!=='completed')throw new Error('Completed artifact of the required kind not found');
  if(args.action==='terrain'&&!a.image?.remoteUri)throw new Error('Preview artifact missing remote image');
  const serviceName=args.action==='terrain'?'PcgGenerateTerrainBrowserTool':['sprinkle','compose'].includes(args.action)?'PcgGenerateSprinkleBrowserTool':'PcgComposeMapBrowserTool';
  const service=get(serviceName);
  if(args.action==='terrain'&&typeof service.resolveSelectedMapPreviewForTerrain==='function'&&!service.resolveSelectedMapPreviewForTerrain(s,a.id))throw new Error('Artifact is not the native selected preview; select it in the map session first');
  if(args.action==='sprinkle'&&typeof service.getCompletedTerrain==='function'&&!service.getCompletedTerrain(s,a.id))throw new Error('Native terrain lineage incomplete');
  if(args.action==='compose'&&(!a.assetSelections?.length||s.artifacts[a.terrainArtifactId]?.status!=='completed'))throw new Error('Composition requires selected sprinkle assets and completed parent terrain');
  if(args.action==='activate_terrain'&&!service.resolveCompletedTerrainLineage({sessionId:s.id,workspaceId:s.workspaceId,terrainArtifactId:a.id}))throw new Error('Native terrain activation lineage incomplete');
  if(args.action==='activate_map'&&!service.resolveCompletedMapLineage({sessionId:s.id,workspaceId:s.workspaceId,composedMapArtifactId:a.id}))throw new Error('Native map activation lineage incomplete');
  if(service.activeExecutions?.has(args.workspaceId)||service.isMapActivating?.())throw new Error('Native PCG operation already active');
  const activates=args.action.startsWith('activate');
  if(!activates&&['pending','running'].includes(s.turnStage))throw new Error('Native PCG session already active');
  if(args.dryRun)return {...context,ready:true,action:args.action,artifactId:a.id,modifiesCanvas:activates,mayUseCloudCredits:!activates,requiresSceneReplacementAcknowledgement:activates};
  if(activates&&args.clearSceneConfirmed!==true)throw new Error('Explicit clearSceneConfirmed required for scene activation');
  if(activates&&get('SceneSaveStateService').hasUnsavedChanges())throw new Error('Save current scene before activation');
  const payload=args.action==='terrain'?{previewArtifactId:a.id,prompt:args.prompt||a.prompt||''}:args.action==='sprinkle'?{terrainArtifactId:a.id,prompt:args.prompt||''}:args.action==='compose'?{sprinkleArtifactId:a.id,confirmed:true}:{sessionId:s.id,composedMapArtifactId:a.id,confirmed:true,clearSceneConfirmed:true,allowPlaceholders:false};
  return startJob(async job=>{
   if(activates){job.activationGraphBaseline=[...(service.activationRuntime?.nodeGraph?.activeExecutions?.keys()||[])];return args.action==='activate_terrain'?service.activateTerrain({workspaceId:s.workspaceId,sessionId:s.id,terrainArtifactId:a.id}):service.execute({workspaceId:s.workspaceId,payload});}
   // Match the editor's explicit begin/run/finish lifecycle; own the turn ID.
   const actions=store.actions.pcgChatState,turnId='mcp_'+crypto.randomUUID();let result;
   await dispatch(actions.beginSessionOperation({sessionId:s.id}));
   await dispatch(actions.updateSessionRuntime({sessionId:s.id,patch:{currentTurnId:turnId}}));
   try{
    await dispatch(actions.runSessionOperation({sessionId:s.id}));
    if(job.cancelRequested){result={status:'stopped',cancelled:true,summary:'Cancelled before cloud submission'};return result;}
    result=await service.execute({workspaceId:s.workspaceId,payload,threadId:turnId});return result;
   }finally{
    if(key(root())===key(originalRoot)&&session().currentTurnId===turnId)await dispatch(actions.finishSessionOperation({sessionId:s.id,turnStage:result&&result.status!=='failed'?'done':'failed'}));
   }
  },activates?undefined:serviceName);
 }
 const sceneStamp=()=>JSON.stringify({root:root(),scene:state().scene,world:state().projectSettings.worldConfig});
 const scriptStamp=async()=>{await get('SceneLuaScriptService').prepareLatestCatalog();const service=get('LuaProjectScriptService');const sources=await service.createRuntimeScriptMap(service.getCommittedEntries());ensure();const sorted=Object.fromEntries(Object.entries(sources).sort(([a],[b])=>a.localeCompare(b)));const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(sorted)));return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');};
 const publishChecks=()=>{
  if(state().preview?.uploadingPhase&&state().preview.uploadingPhase!=='idle')throw new Error('World upload or remote processing already active');
  if(get('SceneSaveStateService').hasUnsavedChanges())throw new Error('Save scene before preparing or uploading world');
  if(store.selectors.sceneOccupancyExceededSelector(state()))throw new Error('Scene exceeds native capacity limits');
  if(Object.values(state().luaScripting.scripts).some(s=>s.diagnostics?.length))throw new Error('Resolve Lua diagnostics before upload');
 };
 if(operation==='publish_prepare'){
  globalThis.__worldcreatorMcpBusy=true;
  try{
  const scriptsSha256=await scriptStamp();
  publishChecks();
  const w=state().projectSettings.worldConfig;
  const name=args.name??w.worldInfo?.name??context.projectName,desc=args.description??w.worldInfo?.desc??'',capacity=args.capacity??w.worldInfo?.capacity??10;
  const length=s=>[...s.trim()].reduce((n,c)=>n+(c.charCodeAt(0)>127||c==='^'?2:1),0);
  if(!/^[\u4e00-\u9ffc\u3400-\u4dbfa-zA-Z0-9_]+$/.test(name)||length(name)>24)throw new Error('Invalid world name; maximum 24 weighted characters');
  if(length(desc)>200||!Number.isInteger(capacity)||capacity<1||capacity>30)throw new Error('Invalid description length or capacity');
  const params={name,desc,capacity,imgUri:w.worldInfo?.imgUri||state().projectSettings.projectInfo.projectCover||''};
  const id=crypto.randomUUID();plans.set(id,{projectRoot:originalRoot,stamp:sceneStamp(),scriptsSha256,params,createdAt:Date.now()});
  for(const [id,p]of plans)if(Date.now()-p.createdAt>600000)plans.delete(id);
  return {...context,planId:id,expiresInSeconds:600,worldId:w.worldId,params,scriptsSha256,willUploadToWorldService:true,willAutomaticallyListPublicly:false,submitted:false};
  }finally{globalThis.__worldcreatorMcpBusy=false;}
 }
 if(operation==='publish_submit'){
  if(args.confirmed!==true)throw new Error('Explicit confirmation of reviewed upload plan required');
  globalThis.__worldcreatorMcpBusy=true;let submitted=false;
  try{
  const scriptsSha256=await scriptStamp();
  publishChecks();const p=plans.get(args.planId);
  if(!p||key(p.projectRoot)!==key(originalRoot)||Date.now()-p.createdAt>600000)throw new Error('Publish plan missing or expired');
  if(p.stamp!==sceneStamp()||p.scriptsSha256!==scriptsSha256)throw new Error('Scene, world or scripts changed since publish preparation; prepare again');
  if(!args.requestId)throw new Error('requestId required');
  plans.delete(args.planId);
  submitted=true;
  return startJob(async()=>{const worldId=await get('PublishService').handleUpload(p.params);if(!worldId)throw new Error('Native world upload failed');return {status:'completed',worldId:String(worldId),summary:'Upload accepted; remote processing/review and public listing are separate. Query publish_status.'};});
  }finally{if(!submitted)globalThis.__worldcreatorMcpBusy=false;}
 }
 globalThis.__worldcreatorMcpBusy=true;
 try{
  if(operation==='create_special'){
   const types={point_light:{type:'light',lights:[{lightType:2}]},spot_light:{type:'light',lights:[{lightType:0}]},text3d:{type:'text3D',count:1},water:{type:'waterCube',count:1}};
   if(!Object.hasOwn(types,args.kind))throw new Error('Unsupported special object kind');
   const before=new Set(Object.keys(state().scene.gameObjectMap));
   await dispatch(store.actions.scene.addGameObjects({creation:{...types[args.kind],parentInstanceId:state().scene.rootId}}));
   const nodes=Object.values(state().scene.gameObjectMap).filter(n=>!before.has(n.instanceId)&&n.parentInstanceId===state().scene.rootId);
   if(nodes.length!==1)throw new Error('Creation result uncertain; read scene');
   return {...context,nodes:clean(nodes),saved:false};
  }
  if(operation==='component_update'){
   const {id,descriptor,properties}=schema(args.instanceId,args.component);
   if(args.component==='Component.Asset')throw new Error('Asset references must use canvas_replace_asset');
   if(!descriptor)throw new Error('Component has no native editable schema');
   const patch=args.properties;if(!patch||!Object.keys(patch).length)throw new Error('Empty component patch');
   const color=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
   for(const [name,value]of Object.entries(patch)){
    const d=descriptor[name];if(!d||!supportedTypes.includes(d.type)||typeof d.params==='function')throw new Error('Unsupported component field: '+name);
    const p=d.params||{},t=d.type;
    let valid=t==='bool'?typeof value==='boolean':['string','textarea'].includes(t)?typeof value==='string'&&value.length<=10000:['range','number'].includes(t)?Number.isFinite(value):t==='unity.color'?color(value):t.startsWith('unity.vector')?Array.isArray(value)&&value.length===Number(t.slice(-1))&&value.every(Number.isFinite):t==='unity.dualColor'?typeof value==='string'&&/^#[0-9a-f]{6}_#[0-9a-f]{6}$/i.test(value):true;
    if(!valid)throw new Error('Invalid field type: '+name);
    const values=Array.isArray(value)?value:[value];if(values.some(v=>typeof v==='number'&&(p.min!==undefined&&v<p.min||p.max!==undefined&&v>p.max)))throw new Error('Field outside range: '+name);
    const options=p.map?Object.values(p.map).map(x=>typeof x==='object'?x.value:x):p.options?.map(x=>x.value);
    if(['select','align','unity.presetMaterial'].includes(t)&&(!options||!options.some(v=>Object.is(v,value))))throw new Error('Invalid field enum: '+name);
   }
   await dispatch(store.actions.scene.changeComponents({data:[{instanceId:args.instanceId,componentId:id,info:{...properties,...patch}}]}));
   return {...context,componentId:id,properties:state().scene.componentMap[id],saved:false};
  }
 }finally{globalThis.__worldcreatorMcpBusy=false;}
}

