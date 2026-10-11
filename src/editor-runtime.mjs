// Serialized into the editor renderer by the fixed CDP adapter. Keep self-contained.
export async function editorOperation(operation, args = {}) {
  if (!['scene','assets','update','add','replace','import','focus','save','node','scripts','delete','group','ungroup','physics','script_bind','script_unbind','script_params','primitive','preview','debug','history','pcg_status'].includes(operation)) throw new Error('Unsupported canvas operation');
  const container = globalThis.Container;
  if (!container?._bindingDictionary?._map) throw new Error('Editor service container unavailable');
  const get = name => {
    const keys = [...container._bindingDictionary._map.keys()].filter(k => (k.description || k.name) === name);
    if (keys.length !== 1) throw new Error(`Unsupported editor service: ${name}`);
    return container.get(keys[0]);
  };
  const store = get('StoreManager');
  const state = () => store.store.getState();
  const info = () => {
    const p = state().projectSettings.projectInfo;
    return { projectId:p.projectRoot.split(/[\\/]/).filter(Boolean).pop(), projectName:p.projectName, projectRoot:p.projectRoot };
  };
  const context = info();
  const rootKey = p => p.replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
  if(args.expectedProjectsRoot&&(!/^project_[A-Za-z0-9_-]+$/.test(context.projectId)||rootKey(context.projectRoot)!==rootKey(args.expectedProjectsRoot)+'/'+context.projectId.toLowerCase()))throw new Error('Open project path outside configured projects root');
  if (args.projectId && args.projectId !== context.projectId) throw new Error(`Wrong project: expected ${args.projectId}, open ${context.projectId}`);
  if (args.expectedProjectRoot && rootKey(args.expectedProjectRoot)!==rootKey(context.projectRoot)) throw new Error('Open project path changed before operation');
  if (!get('RuntimeService').initialized) throw new Error('Editor runtime is not ready');
  const summarize = n => ({instanceId:n.instanceId,name:n.name,parentInstanceId:n.parentInstanceId,childrenInstanceId:n.childrenInstanceId,active:n.active,transform:n.transform});
  const node = id => {
    const n=state().scene.gameObjectMap[id];
    if (!n || id === state().scene.rootId) throw new Error(`Editable scene node not found: ${id}`);
    return n;
  };
  const bindings = n => (n.scriptBindingIds || []).map(id=>state().scene.scriptMap[id]).filter(Boolean);
  const previewState = () => ({...state().editorInfo.previewInfo});
  if (operation === 'node') {
    const n=node(args.instanceId);
    return {...context,node:summarize(n),editorOnly:n.editorOnly,scripts:bindings(n),components:(n.componentIds||[]).map(id=>({componentId:id,properties:id.endsWith('Component.Asset')?{AssetID:state().scene.componentMap[id]?.AssetID}:state().scene.componentMap[id]}))};
  }
  if (operation === 'scripts') return {...context,scripts:Object.entries(state().luaScripting.scripts).map(([scriptId,s])=>({scriptId,...s}))};
  if (operation === 'pcg_status') return {...context,activeSessionId:state().pcgChatState.activeSessionId,sessions:state().pcgChatState.sessions.map(s=>({id:s.id,workspaceId:s.workspaceId,title:s.title,currentTurnId:s.currentTurnId})),generationExposed:true,nextTools:['pcg_context','pcg_start','job_status'],requirements:['existing idle map session','completed input artifact; see pcg_context'],paidGenerationEndToEndVerified:false};
  if (operation === 'debug') {
    const n=node(args.instanceId), snapshot=get('RuntimeNodeDebugService').getSnapshot(n.instanceId);
    const g=snapshot.gameObject;
    const vector=v=>v?[v.x,v.y,v.z]:null;
    return {...context,...previewState(),instanceId:n.instanceId,available:!!g,activeInHierarchy:g?.activeInHierarchy,worldPosition:vector(g?.transform?.position),componentTypes:snapshot.components.map(c=>String(c.GetType?.()?.FullName||c.constructor?.name)),runtimeScriptCount:snapshot.scripts.length,editorBindings:bindings(n),componentError:snapshot.componentError?.message,scriptError:snapshot.scriptError?.message};
  }
  if (operation === 'preview' && args.action === 'status') return {...context,...previewState()};
  if (operation === 'scene') {
    const scene=state().scene;
    const nodes=Object.values(scene.gameObjectMap).filter(n=>args.allNodes || n.parentInstanceId===scene.rootId);
    return {...context,rootId:scene.rootId,selectedIds:scene.pickedIds,totalNodes:Object.keys(scene.gameObjectMap).length,nodes:nodes.slice(0,1000).map(summarize),truncated:nodes.length>1000,unsavedChanges:get('SceneSaveStateService').hasUnsavedChanges()};
  }
  if (operation === 'assets') {
    const assets=Object.values(state().assets.entities).filter(a=>!args.search || a.name?.toLowerCase().includes(args.search.toLowerCase()));
    return {...context,scope:'currently loaded asset library entries',total:assets.length,assets:assets.slice(0,200).map(a=>({assetId:String(a.id),name:a.name,resourceType:a.resourceType,dataType:a.dataType})),truncated:assets.length>200};
  }
  if (!args.projectId) throw new Error('projectId is required for canvas mutation');
  if ((operation!=='preview' && state().editorInfo.previewInfo?.isPreview) || state().editorInfo.previewInfo?.isPreviewLoading || state().editorInfo.loadingInfo?.showLoading) throw new Error('Editor is in preview or loading mode');
  if (globalThis.__worldcreatorMcpBusy) throw new Error('Another MCP canvas operation is still running; read back before retrying');
  const ensureProject = () => { if (rootKey(info().projectRoot) !== rootKey(context.projectRoot)) throw new Error('Open project changed during operation; outcome uncertain'); };
  const dispatch = async action => {
    const result=store.dispatch(action);
    if (!result?.effectsCompletedPromise) throw new Error('Unsupported editor dispatch completion contract; outcome uncertain');
    if (await result.effectsCompletedPromise === false) throw new Error('Editor rejected operation');
    ensureProject();
  };
  globalThis.__worldcreatorMcpBusy = true;
  try {
    if (operation === 'preview') {
      if (!['start','stop'].includes(args.action)) throw new Error('Invalid preview action');
      const expected=args.action==='start';
      if (!!previewState().isPreview!==expected) await get('EditorPreviewService')[expected?'startPreview':'stopPreview']();
      ensureProject();
      if (!!previewState().isPreview!==expected || previewState().isPreviewLoading) throw new Error('Preview transition failed; inspect status before retrying');
      return {...context,...previewState()};
    }
    if (operation === 'history') {
      const h=get('HistoryService');
      if (!['undo','redo'].includes(args.action)) throw new Error('Invalid history action');
      const backward=args.action==='undo';
      const winner=h.pickWinner(t=>backward?h.pickBackwardCandidate(t):h.pickForwardCandidate(t),backward?'max':'min');
      if (!winner) return {...context,changed:false,canUndo:h.canUndo(),canRedo:h.canRedo()};
      await dispatch(backward?winner.timeTravelBackward:winner.timeTravelForward);
      return {...context,changed:true,canUndo:h.canUndo(),canRedo:h.canRedo(),saved:false};
    }
    if (operation === 'primitive') {
      const types={sphere:0,capsule:1,cylinder:2,cube:3,plane:4};
      if (!Object.hasOwn(types,args.shape)) throw new Error('Unsupported primitive');
      const before=new Set(Object.keys(state().scene.gameObjectMap));
      await dispatch(store.actions.scene.addGameObjects({creation:{type:'primitive',primitives:[types[args.shape]],parentInstanceId:state().scene.rootId}}));
      const added=Object.values(state().scene.gameObjectMap).filter(n=>!before.has(n.instanceId)&&n.parentInstanceId===state().scene.rootId);
      if (added.length!==1) throw new Error('Primitive result uncertain; read scene before retrying');
      return {...context,nodes:added.map(summarize),saved:false};
    }
    if (operation === 'delete' || operation === 'group') {
      if (!Array.isArray(args.instanceIds)||!args.instanceIds.length||args.instanceIds.length>100||new Set(args.instanceIds).size!==args.instanceIds.length) throw new Error('Provide 1-100 distinct node IDs');
      const nodes=args.instanceIds.map(node);
      if(nodes.some(n=>n.editorOnly?.lock)) throw new Error('Selection contains locked nodes');
      if(operation==='group') {
        if(nodes.length<2 || nodes.some(n=>n.parentInstanceId!==nodes[0].parentInstanceId)) throw new Error('Group requires at least two siblings with the same parent');
        const before=new Set(Object.keys(state().scene.gameObjectMap));
        await dispatch(store.actions.scene.groupGameObjects({instanceIds:args.instanceIds}));
        const added=Object.values(state().scene.gameObjectMap).filter(n=>!before.has(n.instanceId)&&args.instanceIds.every(id=>state().scene.gameObjectMap[id]?.parentInstanceId===n.instanceId));
        if(added.length!==1) throw new Error('Group result uncertain; read scene before retrying');
        return {...context,node:summarize(added[0]),saved:false};
      }
      const ids=new Set();const visit=n=>{if(ids.has(n.instanceId))return;ids.add(n.instanceId);for(const id of n.childrenInstanceId||[])visit(node(id));};nodes.forEach(visit);
      // Do not submit a child separately if its ancestor is already selected.
      const roots=nodes.filter(n=>{let p=n.parentInstanceId;while(p&&p!==state().scene.rootId){if(args.instanceIds.includes(p))return false;p=node(p).parentInstanceId;}return true;});
      await dispatch(store.actions.scene.removeGameObjects({gameObjects:roots}));
      if([...ids].some(id=>state().scene.gameObjectMap[id])) throw new Error('Deletion incomplete; read scene before retrying');
      return {...context,deletedInstanceIds:[...ids],saved:false};
    }
    if (operation === 'ungroup') {
      const n=node(args.instanceId),children=[...n.childrenInstanceId];
      if(!n.editorOnly?.groupRoot || n.editorOnly?.lock) throw new Error('Node is not an unlocked group');
      await dispatch(store.actions.scene.ungroupGameObject({instanceId:n.instanceId}));
      if(state().scene.gameObjectMap[n.instanceId] || children.some(id=>node(id).parentInstanceId!==n.parentInstanceId)) throw new Error('Ungroup result uncertain; read scene before retrying');
      return {...context,nodes:children.map(id=>summarize(node(id))),saved:false};
    }
    if (operation === 'physics') {
      const n=node(args.instanceId),id=(n.componentIds||[]).find(id=>id.endsWith('_Component.PhysicsCollider'));
      if(!id) throw new Error('Node has no editable PhysicsCollider component');
      const limits={DynamicFriction:1,StaticFriction:1,Bounciness:1,Mass:100,Drag:50,AngularDrag:50};
      const bools=['EnableCollision','EnableRigidBody','UseGravity'];
      if(!args.properties||!Object.keys(args.properties).length)throw new Error('Provide physics properties');
      for(const [k,v] of Object.entries(args.properties)) {
        if(bools.includes(k)){if(typeof v!=='boolean')throw new Error(`Invalid ${k}`);}
        else if(Object.hasOwn(limits,k)){if(!Number.isFinite(v)||v<0||v>limits[k])throw new Error(`Invalid ${k} range`);}
        else throw new Error(`Unsupported physics field: ${k}`);
      }
      await dispatch(store.actions.scene.changeComponents({data:[{instanceId:n.instanceId,componentId:id,info:args.properties}]}));
      return {...context,componentId:id,properties:state().scene.componentMap[id],saved:false};
    }
    if (['script_bind','script_unbind','script_params'].includes(operation)) {
      const n=node(args.instanceId),binding=bindings(n).find(b=>b.scriptId===args.scriptId);
      if(operation==='script_unbind') {
        if(!binding)throw new Error('Script is not bound to node');
        await dispatch(store.actions.scene.removeGameObjectScripts({data:[{instanceId:n.instanceId,scriptIds:[args.scriptId]}]}));
        if(bindings(node(n.instanceId)).some(b=>b.scriptId===args.scriptId))throw new Error('Script removal failed');
        return {...context,instanceId:n.instanceId,removedScriptId:args.scriptId,saved:false};
      }
      if(operation==='script_bind' && binding)throw new Error('Script already bound; use script_params');
      if(operation==='script_params' && !binding)throw new Error('Script is not bound to node');
      const script=state().luaScripting.scripts[args.scriptId];
      if(!script || script.diagnostics?.length)throw new Error('Script missing or has diagnostics; inspect canvas_scripts');
      const defs=script.params,patch=args.params||{};
      const primitive=(v,t)=>t==='int'?Number.isSafeInteger(v):t==='number'?Number.isFinite(v):t==='string'||t==='boolean'?typeof v===t:['vector2','vector3','vector4','color'].includes(t)?Array.isArray(v)&&v.length===(t==='color'?4:Number(t.slice(-1)))&&v.every(Number.isFinite):false;
      const valid=(v,d)=>d.type==='list'?Array.isArray(v)&&v.every(x=>primitive(x,d.itemType)):d.type==='dictionary'?v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.entries(v).every(([k,x])=>(d.keyType==='string'||Number.isSafeInteger(Number(k))&&String(Number(k))===k)&&primitive(x,d.valueType)):primitive(v,d.type);
      const equal=(a,b)=>Object.is(a,b)||(a!==null&&b!==null&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k])));
      for(const [k,v] of Object.entries(patch)) {
        const d=defs.find(d=>d.name===k);if(!d)throw new Error(`Unknown script parameter: ${k}`);
        if(!valid(v,d))throw new Error(`Invalid script parameter type: ${k}`);
        if(d.enumMap&&!Object.values(d.enumMap).some(option=>equal(option,v)))throw new Error(`Invalid enum parameter: ${k}`);
        if(typeof v==='number'&&d.range&&(v<d.range.min||v>d.range.max))throw new Error(`Parameter outside range: ${k}`);
      }
      const defaultValue=d=>d.defaultValue??(d.type==='string'?'':d.type==='boolean'?false:d.type==='dictionary'?{}:d.type==='list'?[]:d.type==='color'?[1,1,1,1]:['vector2','vector3','vector4'].includes(d.type)?Array(Number(d.type.slice(-1))).fill(0):0);
      const params={...Object.fromEntries(defs.map(d=>[d.name,defaultValue(d)])),...binding?.params,...patch};
      const payload=operation==='script_bind'?{data:[{instanceId:n.instanceId,scripts:[{scriptId:args.scriptId,params}]}]}:{data:[{instanceId:n.instanceId,scriptId:args.scriptId,params}]};
      await dispatch(store.actions.scene[operation==='script_bind'?'addGameObjectScripts':'changeGameObjectScriptParams'](payload));
      const result=bindings(node(n.instanceId)).find(b=>b.scriptId===args.scriptId);
      if(!result || !equal(result.params,params))throw new Error('Script read-back differs; inspect node before retrying');
      return {...context,instanceId:n.instanceId,binding:result,saved:false};
    }
    if (operation === 'update') {
      const current=node(args.instanceId);
      if (args.expectedTransform && JSON.stringify(args.expectedTransform)!==JSON.stringify(current.transform)) throw new Error('Stale transform: read the node again');
      const change={};
      if(args.name!==undefined) change.name=args.name;
      const transform={...current.transform};
      for (const [input,key] of [['position','localPosition'],['rotation','localEulerAngles'],['scale','localScale']]) {
        if(args[input]!==undefined) {
          if(!Array.isArray(args[input]) || args[input].length!==3 || !args[input].every(Number.isFinite)) throw new Error('Transform requires three finite numbers');
          transform[key]=args[input];
        }
      }
      change.transform=transform;
      await dispatch(store.actions.scene.changeGameObjects({data:[{instanceId:args.instanceId,info:change}]}));
      return {...context,node:summarize(node(args.instanceId)),saved:false};
    }
    if(operation === 'add') {
      const asset=state().assets.entities[args.assetId];
      if(!asset) throw new Error('Asset not loaded: call canvas_assets and use a returned assetId');
      const before=new Set(Object.keys(state().scene.gameObjectMap));
      await dispatch(store.actions.scene.addGameObjects({creation:{type:'asset',assetInfos:[asset],parentInstanceId:state().scene.rootId},selectAfterAdd:true,focusAfterAdd:true}));
      const added=Object.values(state().scene.gameObjectMap).filter(n=>!before.has(n.instanceId) && n.parentInstanceId===state().scene.rootId);
      if(!added.length) throw new Error('No added scene root was observed; read scene before retrying');
      return {...context,nodes:added.map(summarize),saved:false};
    }
    if(operation === 'replace') {
      const current=node(args.instanceId),asset=state().assets.entities[args.assetId];
      if(!asset) throw new Error('Asset not loaded: call canvas_assets and use a returned assetId');
      const before=new Set(Object.keys(state().scene.gameObjectMap));
      await dispatch(store.actions.scene.replaceGameObjects({assetToReplace:{assetInfo:asset,originInstanceIds:[current.instanceId],parentInstanceId:current.parentInstanceId}}));
      const added=Object.values(state().scene.gameObjectMap).filter(n=>!before.has(n.instanceId) && n.parentInstanceId===current.parentInstanceId);
      if(added.length!==1 || state().scene.gameObjectMap[current.instanceId]) throw new Error('Replacement result uncertain; read scene before retrying');
      return {...context,replacedInstanceId:current.instanceId,nodes:added.map(summarize),saved:false};
    }
    if(operation === 'import') {
      const bytes=Uint8Array.from(atob(args.base64), c=>c.charCodeAt(0));
      const file=new File([bytes],args.fileName,{type:'model/gltf-binary'});
      const resolved=await get('ImportSourceResolver').resolve([{name:args.fileName,file}]);
      if(resolved.items?.length!==1) throw new Error('Editor did not recognize the GLB');
      ensureProject();
      const result=await get('AssetImportService').importSource({...resolved.items[0],overrides:{name:args.name,description:args.description}});
      ensureProject();
      const asset=result?.asset;
      if(!asset?.id) throw new Error('Import completed without an asset ID; inspect asset library before retrying');
      return {...context,assetId:String(asset.id),name:asset.name,uploadedToEditorAssetLibrary:true,placedInScene:false};
    }
    if(operation === 'focus') {
      node(args.instanceId);
      const picked=state().scene.pickedIds;
      // Native 1.0.82 explicitly rejects an identical selection as a no-op.
      if(picked.length!==1 || picked[0]!==args.instanceId) await dispatch(store.actions.scene.setPickedIds({pickedIds:[args.instanceId]}));
      await dispatch(store.actions.scene.focusGameObject({instanceId:args.instanceId}));
      return {...context,focusedInstanceId:args.instanceId};
    }
    if(operation === 'save') {
      const scene=get('SceneService');
      if(scene.brushControl?.getTool()) throw new Error('Exit brush editing before saving');
      await scene.saveScene();ensureProject();
      if(get('SceneSaveStateService').hasUnsavedChanges()) throw new Error('Scene still has unsaved changes after save');
      return {...context,saved:true};
    }
  } finally { globalThis.__worldcreatorMcpBusy=false; }
}
