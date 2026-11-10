import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Database} from '../scripts/handoff/database.mjs';
import {sendBundle,receiveBundle} from '../scripts/handoff/workflow.mjs';

test('Docker dump restores identical data and sequences; failed restore rolls back',
  {skip:process.env.LTHAI_HANDOFF_TEST!=='1'},async t=>{
  const sourceName=`handoff_test_source_${process.pid}`,targetName=`handoff_test_target_${process.pid}`;
  const admin=new Database(resolve('.'),'postgres');
  const temp=await mkdtemp(join(tmpdir(),'lthai-db-test-'));
  const source=new Database(resolve('.'),sourceName),target=new Database(resolve('.'),targetName);
  t.after(async()=>{
    await source.close();await target.close();
    await admin.query(`DROP DATABASE IF EXISTS ${sourceName}`);
    await admin.query(`DROP DATABASE IF EXISTS ${targetName}`);
    await admin.close(); await rm(temp,{recursive:true,force:true});
  });
  await admin.query(`CREATE DATABASE ${sourceName}`);await admin.query(`CREATE DATABASE ${targetName}`);
  await source.query("CREATE TABLE sample(id SERIAL PRIMARY KEY,value text); INSERT INTO sample(value) VALUES('ทดสอบ'),('home'); SELECT nextval('sample_id_seq')");
  const initial=await source.fingerprint();
  await source.query('ALTER SEQUENCE sample_id_seq INCREMENT BY 2');
  assert.notEqual((await source.fingerprint()).digest,initial.digest,'sequence configuration edits are unsent data');
  await source.query('ALTER SEQUENCE sample_id_seq INCREMENT BY 1');
  await source.query("CREATE FUNCTION public.handoff_example() RETURNS integer LANGUAGE sql AS 'SELECT 1'");
  assert.notEqual((await source.fingerprint()).digest,initial.digest,'function edits must be part of baseline');
  await source.query('DROP FUNCTION public.handoff_example()');
  await source.query('CREATE SCHEMA pgdata');
  await assert.rejects(source.fingerprint(),/unsupported database/i);
  await source.query('DROP SCHEMA pgdata');
  const dump=join(temp,'database.dump');await source.backup(dump);await target.restore(dump);
  assert.deepEqual(await target.fingerprint(),initial);
  await target.query("UPDATE sample SET value='unsent' WHERE id=1");
  assert.notEqual((await target.fingerprint()).digest,initial.digest);
  const before=await target.fingerprint();
  const bytes=await readFile(dump);const broken=join(temp,'broken.dump');await writeFile(broken,bytes.subarray(0,Math.floor(bytes.length*.7)));
  await assert.rejects(target.restore(broken));
  assert.deepEqual(await target.fingerprint(),before);
  await target.query('CREATE TABLE obsolete(value text)');
  await target.restore(dump);
  assert.deepEqual(await target.fingerprint(),initial,'replacement must remove tables absent from incoming dump');

  // Full workflow uses independent local roots and real isolated databases.
  const work=join(temp,'work'),home=join(temp,'home'),cloud=join(temp,'cloud');
  for(const root of [work,home]){await mkdir(root);await writeFile(join(root,'.env'),'POSTGRES_PASSWORD=test-only-settings');}
  await writeFile(join(work,'employees.xls'),'source bytes');
  await target.query('DROP TABLE sample');
  const commit='c'.repeat(40),pause=async()=>{},resume=async()=>{};
  const sent=await sendBundle({root:work,cloud,commit,db:source,pause});
  const retriedSend=await sendBundle({root:work,cloud,commit,db:source,pause});
  assert.equal(retriedSend.id,sent.id,'retry must reuse outgoing package rather than advance lineage');
  const manifestPath=join(sent.bundle,'manifest.json'),manifestBytes=await readFile(manifestPath,'utf8');
  const altered=JSON.parse(manifestBytes);altered.database.digest='f'.repeat(64);await writeFile(manifestPath,JSON.stringify(altered));
  const emptyBefore=await target.fingerprint();
  await assert.rejects(receiveBundle({root:home,bundle:sent.bundle,commit,db:target,pause,resume}),/original data restored/i);
  assert.deepEqual(await target.fingerprint(),emptyBefore,'verification failure must recover the destination, including an empty schema');
  await writeFile(manifestPath,manifestBytes);
  let appStopped=false;
  await assert.rejects(receiveBundle({root:home,bundle:sent.bundle,commit,db:target,pause:async()=>{appStopped=true;},resume:async()=>{appStopped=false;throw new Error('simulated startup failure');}}),/startup failure/);
  assert.equal(appStopped,true,'failed startup must stop the app again');
  const received=await receiveBundle({root:home,bundle:sent.bundle,commit,db:target,pause,resume});
  assert.equal(received.id,sent.id);
  assert.equal(await readFile(join(home,'employees.xls'),'utf8'),'source bytes');
  assert.deepEqual(await target.fingerprint(),await source.fingerprint());
  const receivedAgain=await receiveBundle({root:home,bundle:sent.bundle,commit,db:target,pause,resume});
  assert.equal(receivedAgain.alreadyReceived,true,'retry must only start the app, not restore again');
  await target.query("UPDATE sample SET value='unsent home edit' WHERE id=1");
  const unsent=await target.fingerprint();
  // Return home work to source so source can start the next valid sending round.
  await target.query("UPDATE sample SET value='ทดสอบ' WHERE id=1");
  const returnTrip=await sendBundle({root:home,cloud,commit,db:target,pause});
  await receiveBundle({root:work,bundle:returnTrip.bundle,commit,db:source,pause,resume});
  const again=await sendBundle({root:work,cloud,commit,db:source,pause});
  await target.query("UPDATE sample SET value='unsent home edit' WHERE id=1");
  await assert.rejects(receiveBundle({root:home,bundle:again.bundle,commit,db:target,pause,resume}),/unsent/i);
  assert.deepEqual(await target.fingerprint(),unsent);
  await target.query("UPDATE sample SET value='ทดสอบ' WHERE id=1");
  await writeFile(join(home,'employees.xls'),'unsent file edit');
  await assert.rejects(receiveBundle({root:home,bundle:again.bundle,commit,db:target,pause,resume}),/unsent/i);
});
