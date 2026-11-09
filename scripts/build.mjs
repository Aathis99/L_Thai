import {loadEnvFile} from 'node:process';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(existsSync(resolve(root,'.env')))loadEnvFile(resolve(root,'.env'));
process.env.NEXT_TELEMETRY_DISABLED='1';
for(const [entry,args,cwd]of [
  ['typescript/bin/tsc',[],resolve(root,'apps/api')],
  ['next/dist/bin/next',['build'],resolve(root,'apps/web')]
]){
  const {createRequire}=await import('node:module');
  const require=createRequire(resolve(cwd,'package.json'));
  const code=await new Promise((done,reject)=>{const child=spawn(process.execPath,[require.resolve(entry),...args],{cwd,stdio:'inherit',env:process.env});child.on('error',reject);child.on('exit',done);});
  if(code!==0)process.exit(code||1);
}
