import {loadEnvFile} from 'node:process';
import {createHash} from 'node:crypto';
import pg from 'pg';
loadEnvFile(new URL('../.env',import.meta.url));
const native=new pg.Pool({connectionString:process.env.DATABASE_URL});
const url=new URL(process.env.DATABASE_URL);url.port='5434';
const docker=new pg.Pool({connectionString:url.toString()});
try{
  const result={};
  for(const table of ['employees','users','roles','positions','audit']){
    const left=(await native.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    const right=(await docker.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    const hash=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    if(hash(left)!==hash(right))throw new Error(`Docker snapshot differs: ${table} (values withheld)`);
    result[table]=left.length;
  }
  console.log(JSON.stringify({snapshotMatchesNative:true,counts:result}));
}finally{await native.end();await docker.end();}
