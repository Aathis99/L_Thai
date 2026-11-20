import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {TestContext} from 'node:test';
import pg from 'pg';
import {migrate} from '../src/database.js';
import {createApplication} from '../src/app.js';

export async function tileFixture(t:TestContext){
 const connectionString=process.env.DATABASE_URL;
 assert.ok(connectionString,'Set a separate QA DATABASE_URL before tile tests');
 const control=new pg.Pool({connectionString});
 const target=(await control.query('SELECT current_database() name')).rows[0].name;
 if(!/^lthai_.*_qa$/.test(target)){await control.end();throw Error('Tile test writes require a separate lthai_*_qa database');}
 const schema='tile_test_'+randomUUID().replaceAll('-','');
 await control.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString,options:`-c search_path=${schema}`});
 const {server}=createApplication(pool);
 t.after(async()=>{if(server.listening)await new Promise<void>(r=>server.close(()=>r()));await pool.end();await control.query(`DROP SCHEMA ${schema} CASCADE`);await control.end();});
 await migrate(pool);
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const base=`http://127.0.0.1:${address.port}/api`;
 let cookie='';
 async function call(path:string,method='GET',body?:unknown,session=cookie){
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',cookie:session},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json() as any,cookie:response.headers.get('set-cookie')?.split(';')[0]??''};
 }
 await call('/setup','POST',{username:'tile-admin',name:'QA',password:'tile-test-password-only'});
 cookie=(await call('/login','POST',{username:'tile-admin',password:'tile-test-password-only'})).cookie;
 assert.ok(cookie);
 return {pool,call,async state(){const r=await call('/catalog/state');assert.equal(r.status,200);return r.body;}};
}

export const productInput={product_code:'QA-ONE',name:'แผ่นทดสอบ',shape:'วงกลม',size_1:3,size_2:null,size_unit:'in',thickness_mm:null,mounting_type:null,body_id:null,active:true};
export const bodyInput={name:'แผ่นพื้นทดสอบ',shape:'วงกลม',size_1:3,size_2:null,size_unit:'in',thickness_mm:null};
export const profileInput={clay:'ขาว',clay_color:null,pieces_per_rack:40,rest_days:0,destination:'color',pieces_per_sqm:90};
