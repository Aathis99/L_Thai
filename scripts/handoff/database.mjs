import pg from 'pg';
import {parseEnv} from 'node:util';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pipeline} from 'node:stream/promises';
import {join,resolve,sep} from 'node:path';
import {digest} from './core.mjs';

const quote=value=>'"'+value.replaceAll('"','""')+'"';
const run=promisify(execFile);
export class Database{
  constructor(root,name='lthai'){
    if(!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw new Error('Invalid database name');
    this.root=root;this.name=name;
  }
  async client(){
    if(!this.pool){
      const env=parseEnv(await readFile(join(this.root,'.env'),'utf8'));
      if(!env.POSTGRES_PASSWORD)throw new Error('POSTGRES_PASSWORD missing from .env');
      this.pool=new pg.Pool({host:'127.0.0.1',port:5434,user:'lthai',password:env.POSTGRES_PASSWORD,database:this.name,max:1,connectionTimeoutMillis:10000});
    }
    return this.pool;
  }
  async query(sql,values=[]){return (await this.client()).query(sql,values);}
  async close(){if(this.pool)await this.pool.end();this.pool=null;}
  async fingerprint(){
    const pool=await this.client(),client=await pool.connect();
    try{
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL TIME ZONE 'UTC'");
      const unsupported=await client.query(`SELECT
        EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND left(nspname,3)<>'pg_')
        OR EXISTS(SELECT 1 FROM pg_largeobject_metadata)
        OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('m','f')) AS found`);
      if(unsupported.rows[0].found)throw new Error('Unsupported database objects: inspect non-public schemas, large objects, materialized/foreign tables before handoff');
      const snapshot=(await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
      const {stdout}=await run('docker',['compose','-f','compose.docker.yaml','exec','-T','pg','pg_dump','-U','lthai','-d',this.name,'--schema-only','--no-owner',`--snapshot=${snapshot}`],
        {cwd:this.root,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
      const schemaDump=stdout.replace(/^\\(?:un)?restrict .*\r?\n/gm,'').replace(/^-- Dumped (?:from database|by pg_dump) version.*\r?\n/gm,'').replaceAll('\r\n','\n');
      const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
      const schema=(await client.query(`SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default
        FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`)).rows;
      const constraints=(await client.query(`SELECT c.relname,k.conname,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k
        JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,k.conname`)).rows;
      const indexes=(await client.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname")).rows;
      const data=[],counts={};
      for(const {tablename} of tables){
        const rows=(await client.query(`SELECT to_jsonb(t)::text AS value FROM public.${quote(tablename)} t`)).rows.map(r=>r.value).sort();
        counts[tablename]=rows.length;data.push([tablename,digest(JSON.stringify(rows))]);
      }
      const sequences=[];
      const names=(await client.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
      for(const {sequencename} of names){
        const state=(await client.query(`SELECT last_value::text,is_called FROM public.${quote(sequencename)}`)).rows[0];sequences.push([sequencename,state]);
      }
      const objects=(await client.query(`SELECT
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')+
        (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')+
        (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public') AS count`)).rows[0].count;
      await client.query('COMMIT');
      return {digest:digest(JSON.stringify({schemaDump,schema,constraints,indexes,data,sequences})),counts,empty:Number(objects)===0};
    }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  }
  async transfer(tool,args,{input,output}){
    const child=spawn('docker',['compose','-f','compose.docker.yaml','exec','-T','pg',tool,...args],
      {cwd:this.root,windowsHide:true,stdio:['pipe','pipe','pipe']});
    // pg_restore errors may quote row values: keep stderr private, report only status.
    child.stderr.resume();
    const completed=new Promise((resolve,reject)=>{
      child.once('error',()=>reject(new Error(`Docker ${tool} could not start`)));
      child.once('close',code=>code===0?resolve():reject(new Error(`Docker ${tool} failed; app must remain stopped; backup retained`)));
    });
    const transfers=[completed];
    if(input)transfers.push(pipeline(createReadStream(input),child.stdin));else child.stdin.end();
    if(output)transfers.push(pipeline(child.stdout,createWriteStream(output,{flags:'wx'})));else child.stdout.resume();
    const results=await Promise.allSettled(transfers);
    for(const result of results)if(result.status==='rejected')throw result.reason;
  }
  async backup(path){await this.transfer('pg_dump',['-U','lthai','-d',this.name,'-Fc','--no-owner'],{output:path});}
  async restore(path){
    const base=resolve(this.root,'data','handoff-runtime');await mkdir(base,{recursive:true});
    const temp=await mkdtemp(join(base,'restore-'));
    try{
      const sqlPath=join(temp,'dump.sql');
      // Decode fully before touching the target, then replace public in ONE transaction.
      await this.transfer('pg_restore',['--no-owner','--file=-'],{input:path,output:sqlPath});
      const sql=await readFile(sqlPath,'utf8');
      const createsPublic=/^CREATE SCHEMA (?:public|"public");\r?$/m.test(sql);
      // pg_dump can omit public because initdb normally creates it. Recreate its
      // PostgreSQL 18 defaults before applying any dumped ACL/comment overrides.
      const prefix='DROP SCHEMA IF EXISTS public CASCADE;\n'+(createsPublic?'':
        "CREATE SCHEMA public AUTHORIZATION pg_database_owner;\nGRANT USAGE ON SCHEMA public TO PUBLIC;\nCOMMENT ON SCHEMA public IS 'standard public schema';\n");
      const ready=join(temp,'restore.sql');await writeFile(ready,prefix+sql);
      await this.transfer('psql',['-U','lthai','-d',this.name,'-X','--single-transaction','-v','ON_ERROR_STOP=1','-f','-'],{input:ready});
    }finally{
      if(!resolve(temp).startsWith(base+sep))throw new Error('Unsafe restore cleanup path');
      await rm(temp,{recursive:true,force:true});
    }
  }
}
