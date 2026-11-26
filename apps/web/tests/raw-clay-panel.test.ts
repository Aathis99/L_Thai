import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {loadBindings,transformSync} from 'next/dist/build/swc/index.js';

// Exercise the real panel handlers across rerenders; child screens remain React elements.
let slots:any[]=[],cursor=0,effects:(()=>void)[]=[];
const hooks={
 useState(initial:any){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],(value:any)=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
 useRef(initial:any){const i=cursor++;return slots[i]??=( {current:initial});},
 useCallback(fn:any,deps:any[]){const i=cursor++;if(!slots[i]||deps.some((d,j)=>d!==slots[i].deps[j]))slots[i]={fn,deps};return slots[i].fn;},
 useEffect(fn:any,deps:any[]){const i=cursor++;if(!slots[i]||deps.some((d,j)=>d!==slots[i][j])){slots[i]=deps;effects.push(fn);}},
};
(globalThis as any).__clayPanelHooks=hooks;
await loadBindings();
registerHooks({
 resolve(specifier,context,next){
  if(specifier==='react'&&context.parentURL?.endsWith('/raw-clay/panel.tsx'))return {url:'data:text/javascript,'+encodeURIComponent('const h=globalThis.__clayPanelHooks;export const {useState,useRef,useCallback,useEffect}=h;'),shortCircuit:true};
  if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier)&&context.parentURL)for(const suffix of ['.tsx','.ts']){const url=new URL(specifier+suffix,context.parentURL);if(existsSync(url))return next(url.href,context);}
  return next(specifier,context);
 },
 load(url,context,next){if(url.endsWith('.tsx'))return {format:'module',shortCircuit:true,source:transformSync(readFileSync(fileURLToPath(url),'utf8'),{filename:fileURLToPath(url),jsc:{parser:{syntax:'typescript',tsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'es6'}}).code};return next(url,context);},
});
const {default:Panel}=await import('../src/components/raw-clay/panel.tsx');
function nodes(tree:any):any[]{return !tree?[]:Array.isArray(tree)?tree.flatMap(nodes):typeof tree==='object'?[tree,...nodes(tree.props?.children),...nodes(tree.props?.action)]:[];}
function label(tree:any):string{return !tree?'':Array.isArray(tree)?tree.map(label).join(''):typeof tree==='object'?label(tree.props?.children):String(tree);}
function button(tree:any,text:string){const found=nodes(tree).find(n=>n.type==='button'&&label(n)===text);assert.ok(found,'button '+text);return found;}
function editor(tree:any){const found=nodes(tree).find(n=>n.type?.name==='ClayForm');assert.ok(found,'editor');return found.props;}
async function setup(){
 slots=[];effects=[];
 let revision=1,doc:any={id:1,kind:'receipt',number:'RC-1',status:'draft',version:1,data:{supplier:'S',billNumber:'B',documentDate:'2026-01-01',plateOut:'A1',notes:'v1'},imageIds:[1],actor:'A'};
 const posts:any[]=[];let failure:number|undefined,malformed=false,commits=0;
 const api:any=async(path:string,method='GET',body?:any)=>{
  if(method==='POST'){
   posts.push(structuredClone(body));
   const existing=posts.slice(0,-1).find(p=>p.requestId===body.requestId);
   if(existing)return {revision,document:doc};
   if(body.revision!==revision)throw Object.assign(Error('stale'),{status:409});
   doc={...doc,data:body.payload.data??doc.data,version:doc.version+1};revision++;commits++;
   if(failure)throw Object.assign(Error('gateway'),{status:failure});
   if(malformed)return {error:'invalid success'};
   return {revision,document:doc};
  }
  if(path.startsWith('/raw-clay/duplicates'))return {documents:[]};
  if(path.startsWith('/raw-clay/documents/'))return {document:structuredClone(doc),history:[],currentMovement:null,movementHistory:[]};
  return {revision,documents:[structuredClone(doc)],total:1,page:1,pageSize:30,stock:[],summary:[],clay_types:[],clay_colors:[],employees:[]};
 };
 const user:any={permissions:['read','record','confirm','correct'].map(p=>'raw_clay.'+p)};
 const render=()=>{cursor=0;return Panel({api,user});};
 render();for(const effect of effects.splice(0))effect();await new Promise(r=>setImmediate(r));
 return {render,posts,commits:()=>commits,change(){revision++;doc={...doc,version:doc.version+1,data:{...doc.data,notes:'v2'},imageIds:[2]};},fail(status:number){failure=status;},malformed(){malformed=true;}};
}
test('reconciliation close and reopen cannot pair stale detail with fresh state revision',async()=>{
 const h=await setup();await button(h.render(),'เปิด / ประวัติ').props.onClick();button(h.render(),'แก้ร่าง').props.onClick();
 h.change();assert.equal(await editor(h.render()).onSave({action:'save',payload:{id:1,data:{notes:'mine'}}}),false);
 await editor(h.render()).onReload();editor(h.render()).onClose();
 const tree=h.render();assert.equal(nodes(tree).find(n=>n.type?.name==='DocumentFacts').props.doc.version,2);button(tree,'แก้ร่าง').props.onClick();assert.equal(await editor(h.render()).onSave({action:'save',payload:{id:1,data:{notes:'v2 edited'}}}),true);
 assert.equal(h.posts.at(-1).revision,2);
});
test('global refresh never silently rebases an already-open stale detail',async()=>{
 const h=await setup();await button(h.render(),'เปิด / ประวัติ').props.onClick();h.change();await button(h.render(),'โหลดล่าสุด').props.onClick();button(h.render(),'แก้ร่าง').props.onClick();
 assert.equal(await editor(h.render()).onSave({action:'save',payload:{id:1,data:{notes:'old overwrite'}}}),false);
 assert.equal(h.posts[0].revision,1);
});
for(const outcome of [500,504,502,408,'malformed'] as const)test(`committed ${outcome} response retains request through reload and edited retry`,async()=>{
 const h=await setup();if(outcome==='malformed')h.malformed();else h.fail(outcome);
 button(h.render(),'＋ เพิ่มรับเข้า').props.onClick();
 assert.equal(await editor(h.render()).onSave({action:'save',payload:{kind:'receipt',data:{notes:'original'}}}),false);
 await button(h.render(),'โหลดล่าสุด').props.onClick();
 assert.equal(await editor(h.render()).onSave({action:'save',payload:{kind:'receipt',data:{notes:'changed'}}}),true);
 assert.deepEqual(h.posts[1],h.posts[0]);assert.equal(h.commits(),1);
});

for(const mode of ['confirm','cancel'] as const)test('global refresh keeps captured detail revision for '+mode,async()=>{
 const h=await setup();await button(h.render(),'เปิด / ประวัติ').props.onClick();h.change();await button(h.render(),'โหลดล่าสุด').props.onClick();
 if(mode==='confirm')await button(h.render(),'ยืนยันรายการนี้').props.onClick();else {button(h.render(),'ยกเลิกรายการพร้อมเหตุผล').props.onClick();const form=nodes(h.render()).find(n=>n.type==='form');const OriginalFormData=globalThis.FormData;try{globalThis.FormData=class {get(){return 'reason';}} as any;await form.props.onSubmit({preventDefault(){},currentTarget:{}});}finally{globalThis.FormData=OriginalFormData;}}
 assert.equal(h.posts[0].revision,1);assert.equal(h.commits(),0);
});
