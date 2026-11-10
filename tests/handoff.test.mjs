import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeBundle,validateBundle,assertBaseline,fingerprintFiles} from '../scripts/handoff/core.mjs';

const commit='a'.repeat(40);
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'lthai-handoff-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const source=join(root,'source.dump'); await writeFile(source,'sample database');
  const bundle=join(root,'bundle');
  await writeBundle(bundle,{commit,id:'test',database:{digest:'db1'},privateDigest:'p1'},[{source,path:'database.dump'}]);
  return {root,bundle};
}
test('a complete bundle round trips without changing payload bytes',async t=>{
  const {bundle}=await fixture(t); const m=await validateBundle(bundle,commit);
  assert.equal(m.commit,commit); assert.equal(await readFile(join(bundle,'database.dump'),'utf8'),'sample database');
});
test('corrupt or incomplete downloads cannot be received',async t=>{
  const {bundle}=await fixture(t); await writeFile(join(bundle,'database.dump'),'truncated');
  await assert.rejects(validateBundle(bundle,commit),/checksum/i);
  await rm(join(bundle,'database.dump'));
  await assert.rejects(validateBundle(bundle,commit),/missing/i);
});
test('a bundle from another commit cannot be received',async t=>{
  const {bundle}=await fixture(t); await assert.rejects(validateBundle(bundle,'b'.repeat(40)),/commit/i);
});
test('manifest paths cannot escape their folder or exploit Windows case aliases',async t=>{
  const {bundle}=await fixture(t);
  const manifest=JSON.parse(await readFile(join(bundle,'manifest.json'),'utf8'));
  for(const path of ['../outside','C:/outside','private/../../outside','private\\..\\outside','private/file:stream']){
    await writeFile(join(bundle,'manifest.json'),JSON.stringify({...manifest,files:[...manifest.files,{...manifest.files[0],path}]}));
    await assert.rejects(validateBundle(bundle,commit),/path/i);
  }
  await writeFile(join(bundle,'manifest.json'),JSON.stringify({...manifest,files:[...manifest.files,{...manifest.files[0],path:'DATABASE.dump'}]}));
  await assert.rejects(validateBundle(bundle,commit),/duplicate/i);
});
test('publication never overwrites a previously completed bundle',async t=>{
  const {bundle,root}=await fixture(t); const source=join(root,'source.dump');
  await assert.rejects(writeBundle(bundle,{commit,id:'new'},[{source,path:'database.dump'}]),/exist/i);
  assert.equal((await validateBundle(bundle,commit)).id,'test');
});
test('a payload changed between validation and local staging is rejected',async t=>{
  const {bundle,root}=await fixture(t);const manifest=await validateBundle(bundle,commit);
  await writeFile(join(bundle,'database.dump'),'changed after first validation');
  await assert.rejects(writeBundle(join(root,'staged'),manifest,[{source:join(bundle,'database.dump'),path:'database.dump'}]),/checksum/i);
});
test('unknown populated targets and changed database/private files stop receive',()=>{
  assert.throws(()=>assertBaseline(null,{database:'db',privateDigest:'p',empty:false}),/unknown/i);
  assert.doesNotThrow(()=>assertBaseline(null,{database:'empty',privateDigest:'p',empty:true}));
  const previous={database:'db',privateDigest:'p'};
  assert.throws(()=>assertBaseline(previous,{database:'changed',privateDigest:'p'}),/unsent/i);
  assert.throws(()=>assertBaseline(previous,{database:'db',privateDigest:'changed'}),/unsent/i);
  assert.doesNotThrow(()=>assertBaseline(previous,{database:'db',privateDigest:'p'}));
});
test('Windows private-file baselines ignore directory casing without ignoring content edits',async t=>{
  const {root}=await fixture(t);const left=join(root,'left'),right=join(root,'right');
  await mkdir(join(left,'Batch'),{recursive:true});await mkdir(join(right,'batch'),{recursive:true});
  await writeFile(join(left,'Batch','Source.json'),'same');await writeFile(join(right,'batch','source.json'),'same');
  assert.equal(await fingerprintFiles(left,['Batch/Source.json']),await fingerprintFiles(right,['batch/source.json']));
  await writeFile(join(right,'batch','source.json'),'changed');
  assert.notEqual(await fingerprintFiles(left,['Batch/Source.json']),await fingerprintFiles(right,['batch/source.json']));
});
