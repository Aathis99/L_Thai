import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,mkdir,readFile,copyFile,writeFile,readdir,rename} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';

export const digest=value=>createHash('sha256').update(value).digest('hex');
export function safeRelative(path){
  if(typeof path!=='string'||!path||path.includes('\\')||path.includes(':')||path.startsWith('/')||
    path.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/[\x00-\x1f<>"|?*]/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p)))
    throw new Error('Unsafe file path');
  return path;
}
export async function checkedPath(root,path){
  safeRelative(path); let current=resolve(root);
  if((await lstat(current)).isSymbolicLink())throw new Error('Symlink path rejected');
  for(const segment of path.split('/')){
    current=join(current,segment);
    try{if((await lstat(current)).isSymbolicLink())throw new Error('Symlink path rejected');}
    catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return current;
}
export async function checksum(path){
  const hash=createHash('sha256'); for await(const chunk of createReadStream(path))hash.update(chunk); return hash.digest('hex');
}
export async function filesUnder(root,prefix=''){
  const result=[];
  for(const item of await readdir(prefix?join(root,prefix):root,{withFileTypes:true})){
    const path=prefix?`${prefix}/${item.name}`:item.name; safeRelative(path);
    if(item.isSymbolicLink())throw new Error('Symlink path rejected');
    if(item.isDirectory())result.push(...await filesUnder(root,path));
    else if(item.isFile())result.push(path);
    else throw new Error('Unsupported file path');
  }
  return result.sort();
}
export async function fingerprintFiles(root,paths){
  const result=[];
  for(const path of [...paths].sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase(),'en')))result.push([path.toLowerCase(),await checksum(await checkedPath(root,path))]);
  return digest(JSON.stringify(result));
}
export async function writeBundle(directory,metadata,payloads){
  // Exclusive creation: a completed or interrupted bundle is never reused.
  try{await mkdir(directory);}catch(e){if(e.code==='EEXIST')throw new Error('Bundle already exists');throw e;}
  const files=[]; const seen=new Set();
  for(const item of payloads){
    safeRelative(item.path); const key=item.path.toLowerCase();
    if(seen.has(key)||key==='manifest.json')throw new Error('Duplicate file path'); seen.add(key);
    const output=await checkedPath(directory,item.path); await mkdir(dirname(output),{recursive:true});
    if((await lstat(item.source)).isSymbolicLink())throw new Error('Symlink path rejected');
    await copyFile(item.source,output);
    const file={path:item.path,sha256:await checksum(output),size:(await lstat(output)).size};
    if(metadata.files){
      const expected=metadata.files.find(f=>f.path===item.path);
      if(!expected||expected.sha256!==file.sha256||expected.size!==file.size)throw new Error('Payload checksum changed during staging');
    }
    files.push(file);
  }
  const manifest={...metadata,version:1,files};
  await writeFile(join(directory,'manifest.json.partial'),JSON.stringify(manifest,null,2));
  await rename(join(directory,'manifest.json.partial'),join(directory,'manifest.json'));
  return manifest;
}
export async function validateBundle(directory,commit){
  const manifest=JSON.parse(await readFile(await checkedPath(directory,'manifest.json'),'utf8'));
  if(manifest.version!==1||!Array.isArray(manifest.files)||!manifest.files.length||!manifest.files.some(f=>f.path==='database.dump'))throw new Error('Incomplete manifest');
  if(!/^[a-f0-9]{40,64}$/.test(manifest.commit)||manifest.commit!==commit)throw new Error('Git commit mismatch');
  const seen=new Set();
  for(const file of manifest.files){
    safeRelative(file.path); const key=file.path.toLowerCase();
    if(seen.has(key)||key==='manifest.json')throw new Error('Duplicate file path');seen.add(key);
    if(!/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.size)||file.size<0)throw new Error('Invalid checksum metadata');
    const path=await checkedPath(directory,file.path);
    let info;try{info=await lstat(path);}catch(e){if(e.code==='ENOENT')throw new Error('Missing bundle file');throw e;}
    if(!info.isFile())throw new Error('Invalid file path');
    if(info.size!==file.size||await checksum(path)!==file.sha256)throw new Error('Bundle checksum mismatch');
  }
  const actual=await filesUnder(directory);
  if(actual.some(p=>p!=='manifest.json'&&!seen.has(p.toLowerCase())))throw new Error('Unexpected bundle file');
  return manifest;
}
export function assertBaseline(previous,current){
  if(!previous){if(!current.empty)throw new Error('Unknown populated destination; compare and adopt it explicitly first');return;}
  if(previous.database!==current.database||previous.privateDigest!==current.privateDigest)throw new Error('Unsent local database or private-file changes; receive stopped');
}
