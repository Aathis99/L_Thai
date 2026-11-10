import {execFileSync} from 'node:child_process';
import {readFile,copyFile,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Database} from './database.mjs';
import {validateBundle} from './core.mjs';
import {sendBundle,receiveBundle,readState,currentState} from './workflow.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const [command,...args]=process.argv.slice(2);
function option(name){const i=args.indexOf(name);if(i<0)return undefined;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Missing value for ${name}`);return args[i+1];}
function git(...args){return execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}).trim();}
function compose(...args){execFileSync('docker',['compose','-f','compose.docker.yaml',...args],{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});}
function cleanGit(){if(git('status','--porcelain'))throw new Error('Git has unsent changes. Update docs/CURRENT.md, review, commit and push before handoff.');return git('rev-parse','HEAD');}
function pushed(commit){
  const branch=git('symbolic-ref','--short','HEAD');
  let remote,remoteBranch;
  try{remote=git('config',`branch.${branch}.remote`);remoteBranch=git('config',`branch.${branch}.merge`);}catch{throw new Error('Set upstream with git push -u origin HEAD before sending');}
  if(remote==='.')throw new Error('Upstream must be a remote shared by both computers');
  let value;try{value=git('ls-remote','--exit-code',remote,remoteBranch).split(/\s/)[0];}catch{throw new Error('Cannot verify remote commit; check network and Git authentication');}
  if(value!==commit)throw new Error('Remote branch does not match HEAD; push before sending');
}
const help=`LThai cross-machine handoff (Docker port 5434)
  npm run handoff:status
  npm run handoff:send -- --context-ready [--cloud "OneDrive/LThai-handoff"]
  npm run handoff:bootstrap -- --bundle "full path to transfer folder"
  npm run handoff:receive -- --bundle "full path to transfer folder"
Send leaves web/API stopped. Check OneDrive upload completion before shutdown.
Bootstrap starts only PostgreSQL; receive backs up, restores and starts the app.
See docs/cross-machine-guide.md. Never use legacy db:backup for Docker.`;

const db=new Database(root);
try{
  const allowed=command==='send'?['--context-ready','--cloud']:['--bundle'];
  for(let i=0;i<args.length;i++){
    if(!allowed.includes(args[i]))throw new Error('Unknown argument; run npm run handoff:help');
    if(args[i]!=='--context-ready')i++;
  }
  if(command==='help'||!command){console.log(help);}
  else if(command==='status'){
    const state=await currentState(root,db),last=await readState(root);
    console.log(JSON.stringify({branch:git('branch','--show-current'),commit:git('rev-parse','HEAD'),gitClean:!git('status','--porcelain'),
      dockerDatabase:'127.0.0.1:5434/lthai',databaseCounts:(await db.fingerprint()).counts,lastBundle:last?.lastBundle??null,
      changedSinceHandoff:last?last.database!==state.database||last.privateDigest!==state.privateDigest:null},null,2));
  }else if(command==='send'){
    if(!args.includes('--context-ready'))throw new Error('Update docs/CURRENT.md before commit/push, then send with --context-ready');
    const commit=cleanGit();pushed(commit);
    await readFile(join(root,'docs','CURRENT.md'),'utf8');
    const oneDrive=process.env.OneDrive||process.env.OneDriveConsumer||process.env.OneDriveCommercial;
    const cloud=option('--cloud')||(oneDrive?join(oneDrive,'LThai-handoff'):null);
    if(!cloud)throw new Error('OneDrive folder not found; provide --cloud');
    const result=await sendBundle({root,cloud:resolve(cloud),commit,db,pause:async()=>compose('stop','web','api')});
    console.log(JSON.stringify({...result,next:'Wait until OneDrive confirms upload complete. Keep this app stopped until receiving the next handoff.'},null,2));
  }else if(command==='bootstrap'||command==='receive'){
    const value=option('--bundle');if(!value)throw new Error('--bundle is required');
    const bundle=resolve(value),commit=cleanGit();await validateBundle(bundle,commit);
    if(command==='bootstrap'){
      const env=join(root,'.env');
      try{await stat(env);throw new Error('.env already exists; keep it, start only the pg service, then run receive');}
      catch(e){if(e.code!=='ENOENT')throw e;}
      await copyFile(join(bundle,'docker.env'),env,constants.COPYFILE_EXCL);
      compose('up','-d','--wait','pg');console.log('Docker PostgreSQL ready. Run handoff:receive with the same bundle.');
    }else{
      const result=await receiveBundle({root,bundle,commit,db,pause:async()=>compose('stop','web','api'),resume:async()=>{
        compose('up','-d','--build','--wait');
        const health=await fetch('http://127.0.0.1:3001/api/health');if(!health.ok)throw new Error('Database received, but app health check failed');
      }});
      console.log(JSON.stringify({...result,next:'Open http://127.0.0.1:3001 and ask Codex to read AGENTS.md and docs/CURRENT.md.'},null,2));
    }
  }else throw new Error('Unknown command; run npm run handoff:help');
}catch(e){
  // External commands and PostgreSQL may include private values in their error text.
  const safe=e instanceof Error&&!(e.code||e.stderr||e.severity);
  console.error(safe?e.message:'Handoff failed. Check Docker/Git/configuration locally; private error details withheld.');process.exitCode=1;
}finally{await db.close();}
