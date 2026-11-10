import {readdir,readFile,mkdir,writeFile,copyFile,rename,unlink,lstat} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {parseEnv} from 'node:util';
import {writeBundle,validateBundle,assertBaseline,filesUnder,fingerprintFiles,checkedPath,safeRelative} from './core.mjs';

export async function privateFiles(root){
  const result=[];
  for(const entry of await readdir(root,{withFileTypes:true})){
    if(/\.xlsx?$/i.test(entry.name)){
      if(!entry.isFile()||entry.isSymbolicLink())throw new Error('Unsupported source file path');result.push(entry.name);
    }
  }
  for(const path of ['data/staging','data/factory.sqlite']){
    try{
      const full=await checkedPath(root,path),info=await lstat(full);
      if(info.isDirectory())result.push(...(await filesUnder(full)).map(p=>`${path}/${p}`));
      else if(info.isFile())result.push(path);
    }catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return result.sort();
}
export function allowedPrivate(path){
  safeRelative(path);
  return path==='data/factory.sqlite'||path.startsWith('data/staging/')||(!path.includes('/')&&/\.xlsx?$/i.test(path));
}
export function checkLineage(previous,manifest){
  if(!previous)return;
  if(previous.lastBundle===manifest.id)throw new Error('Bundle already handled');
  if(previous.lastBundle!==manifest.parent)throw new Error('Handoff lineage mismatch: stale or divergent package');
}
export function obsoleteFiles(previous,incoming){
  const kept=new Set(incoming.map(p=>p.toLowerCase()));return previous.filter(p=>!kept.has(p.toLowerCase()));
}
async function resumeSafely(pause,resume){
  try{await resume();}catch(e){await pause();throw e;}
}
const statePath=root=>join(root,'data','handoff-state.json');
export async function readState(root){try{return JSON.parse(await readFile(statePath(root),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function saveState(root,state){
  const path=statePath(root);await mkdir(dirname(path),{recursive:true});
  await writeFile(`${path}.partial`,JSON.stringify(state,null,2));await rename(`${path}.partial`,path);
}
export async function currentState(root,db){
  const database=await db.fingerprint(),paths=await privateFiles(root);
  return {database:database.digest,privateDigest:await fingerprintFiles(root,paths),empty:database.empty&&paths.length===0};
}
export async function sendBundle({root,cloud,commit,db,pause}){
  await pause(); // Intentionally stays stopped until receive on the next machine.
  const previous=await readState(root),before=await currentState(root,db);
  if(previous?.direction==='sent'){
    assertBaseline(previous,before);
    if(previous.commit!==commit)throw new Error('Previous send is pending on another commit; receive its return before sending new work');
    const published=join(cloud,previous.lastBundle);
    const manifest=await validateBundle(published,commit);
    return {bundle:published,id:manifest.id,counts:manifest.database.counts,reused:true};
  }
  const id=new Date().toISOString().replaceAll(/[:.]/g,'-')+'-'+randomUUID();
  const staging=join(root,'data','handoff-staging',id);await mkdir(staging,{recursive:true});
  const dump=join(staging,'database.dump');await db.backup(dump);
  const payloads=[{source:dump,path:'database.dump'},{source:join(root,'.env'),path:'docker.env'}];
  for(const path of await privateFiles(root))payloads.push({source:await checkedPath(root,path),path:`private/${path}`});
  const local=join(staging,'bundle');
  const database=await db.fingerprint();
  if(database.digest!==before.database)throw new Error('Database changed during export; send stopped');
  const manifest=await writeBundle(local,{id,commit,parent:previous?.lastBundle??null,createdAt:new Date().toISOString(),machine:hostname(),database,privateDigest:before.privateDigest},payloads);
  const sourcePaths=manifest.files.filter(f=>f.path.startsWith('private/')).map(f=>f.path.slice(8));
  if(await fingerprintFiles(join(local,'private'),sourcePaths)!==before.privateDigest)
    throw new Error('Private files changed during export; send stopped');
  if((await currentState(root,db)).privateDigest!==before.privateDigest)throw new Error('Private files changed during export; send stopped');
  await mkdir(cloud,{recursive:true});
  const published=join(cloud,id);
  await writeBundle(published,{...manifest},manifest.files.map(f=>({source:join(local,...f.path.split('/')),path:f.path})));
  await validateBundle(published,commit);
  await saveState(root,{...before,lastBundle:id,commit,direction:'sent'});
  return {bundle:published,id,counts:database.counts};
}
export async function receiveBundle({root,bundle,commit,db,pause,resume}){
  const manifest=await validateBundle(bundle,commit);
  if(typeof manifest.id!=='string'||!manifest.database?.digest||!manifest.privateDigest)throw new Error('Invalid handoff metadata');
  const incoming=[];
  for(const file of manifest.files){
    if(file.path==='database.dump'||file.path==='docker.env')continue;
    if(!file.path.startsWith('private/')||!allowedPrivate(file.path.slice(8)))throw new Error('Unsupported private file path');
    incoming.push(file.path.slice(8));await checkedPath(root,file.path.slice(8));
  }
  if(!manifest.files.some(f=>f.path==='docker.env'))throw new Error('Missing Docker settings');
  const localSettings=parseEnv(await readFile(join(root,'.env'),'utf8'));
  const sourceSettings=parseEnv(await readFile(join(bundle,'docker.env'),'utf8'));
  if(!sourceSettings.POSTGRES_PASSWORD||localSettings.POSTGRES_PASSWORD!==sourceSettings.POSTGRES_PASSWORD)throw new Error('Docker password settings differ; resolve configuration before receive');
  const previous=await readState(root);
  if(previous?.direction==='received'&&previous.lastBundle===manifest.id){
    await pause();assertBaseline(previous,await currentState(root,db));
    await resumeSafely(pause,resume);return {id:manifest.id,backup:previous.backup,counts:manifest.database.counts,alreadyReceived:true};
  }
  checkLineage(previous,manifest);
  await pause();
  const before=await currentState(root,db);assertBaseline(previous,before);
  // Validate into a local immutable copy before touching destination contents.
  const backup=join(root,'data','handoff-backups',new Date().toISOString().replaceAll(/[:.]/g,'-')+'-'+randomUUID());
  await mkdir(backup,{recursive:true});
  const staged=join(backup,'incoming');
  await writeBundle(staged,manifest,manifest.files.map(f=>({source:join(bundle,...f.path.split('/')),path:f.path})));
  await validateBundle(staged,commit);
  await db.backup(join(backup,'before.dump'));
  const oldPaths=await privateFiles(root);
  for(const path of oldPaths){const output=join(backup,'private',...path.split('/'));await mkdir(dirname(output),{recursive:true});await copyFile(await checkedPath(root,path),output);}
  await writeFile(join(backup,'before.json'),JSON.stringify({state:previous,baseline:before,privateFiles:oldPaths},null,2));
  try{
    await db.restore(join(staged,'database.dump'));
    if((await db.fingerprint()).digest!==manifest.database.digest)throw new Error('Restored database does not match manifest');
    for(const path of incoming){
      const destination=await checkedPath(root,path);await mkdir(dirname(destination),{recursive:true});
      const temporary=`${destination}.${randomUUID()}.handoff-partial`;
      await copyFile(join(staged,'private',...path.split('/')),temporary);
      await rename(temporary,destination);
    }
    for(const path of obsoleteFiles(oldPaths,incoming))await unlink(await checkedPath(root,path));
    const after=await currentState(root,db);
    if(after.privateDigest!==manifest.privateDigest)throw new Error('Restored private files do not match manifest');
    await saveState(root,{...after,lastBundle:manifest.id,commit,direction:'received',backup});
  }catch{
    try{
      await db.restore(join(backup,'before.dump'));
      const changedPaths=await privateFiles(root);
      for(const path of oldPaths){
        const destination=await checkedPath(root,path);await mkdir(dirname(destination),{recursive:true});
        const temporary=`${destination}.${randomUUID()}.handoff-partial`;
        await copyFile(join(backup,'private',...path.split('/')),temporary);await rename(temporary,destination);
      }
      for(const path of obsoleteFiles(changedPaths,oldPaths))await unlink(await checkedPath(root,path));
      const restored=await currentState(root,db);
      if(restored.database!==before.database||restored.privateDigest!==before.privateDigest)throw new Error('Rollback verification failed');
    }catch{throw new Error(`Receive and rollback failed; app stopped. Recover from backup: ${backup}`);}
    throw new Error(`Receive failed; original data restored; app stopped. Backup: ${backup}`);
  }
  await resumeSafely(pause,resume);return {id:manifest.id,backup,counts:manifest.database.counts};
}
