import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {privateFiles,checkLineage,obsoleteFiles} from '../scripts/handoff/workflow.mjs';

test('source file selection includes Excel and staging but never raw databases or secrets',async t=>{
  const root=await mkdtemp(join(tmpdir(),'lthai-files-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const path of ['data/staging/source.json','data/postgres/PG_VERSION','data/backups/old.dump','.env','source.xls','data/factory.sqlite']){
    await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),'test');
  }
  assert.deepEqual(await privateFiles(root),['data/factory.sqlite','data/staging/source.json','source.xls']);
});
test('a stale or unrelated handoff cannot replace the current machine state',()=>{
  const state={lastBundle:'sent-home'};
  assert.doesNotThrow(()=>checkLineage(state,{id:'return-work',parent:'sent-home'}));
  assert.throws(()=>checkLineage(state,{id:'old',parent:'earlier'}),/lineage/i);
  assert.throws(()=>checkLineage(state,{id:'sent-home',parent:'sent-home'}),/already/i);
});
test('case-only Windows renames never classify the restored file as obsolete',()=>{
  assert.deepEqual(obsoleteFiles(['Source.xls','data/staging/Source.json','removed.xls'],['source.xls','data/staging/source.json']),['removed.xls']);
});
