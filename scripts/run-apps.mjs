import {loadEnvFile} from 'node:process';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {createRequire} from 'node:module';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(existsSync(resolve(root,'.env')))loadEnvFile(resolve(root,'.env'));
process.env.NEXT_TELEMETRY_DISABLED='1';
const require=createRequire(import.meta.url),development=process.argv[2]==='dev';
const apiPath=resolve(root,'apps/api');
if(!development&&!existsSync(resolve(apiPath,'dist/server.js')))throw new Error('กรุณารัน npm run build ก่อน npm start');
// Do not start a second database instance when PostgreSQL is already serving this cluster.
if(process.platform==='win32'&&existsSync(resolve(root,'data/postgres/PG_VERSION'))){
  const code=await new Promise((done,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve(root,'scripts/database/start.ps1')],{cwd:root,stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('exit',done);});
  if(code!==0)process.exit(code||1);
}
const children=[];let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;process.exitCode=code;for(const child of children)child.kill('SIGTERM');}
function run(args,cwd){
  const child=spawn(process.execPath,args,{cwd,env:process.env,stdio:'inherit',windowsHide:true});children.push(child);
  child.on('error',error=>{console.error(error.message);stop(1);});child.on('exit',code=>{if(!stopping)stop(code||1);});return child;
}
run(development?[require.resolve('tsx/cli'),'watch','src/server.ts']:['dist/server.js'],apiPath);
run([require.resolve('next/dist/bin/next'),development?'dev':'start','--hostname',process.env.WEB_HOST||'127.0.0.1','--port',process.env.WEB_PORT||'3000'],resolve(root,'apps/web'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop());
