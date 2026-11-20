import assert from 'node:assert/strict';
import {test} from 'node:test';
import {demoState, transition, sourceInfo, summarize} from '../src/kiln-prototype/model.js';
const at='2026-11-19T08:00:00+07:00';
const act=(s:any,command:any)=>transition(s,command);
function prepare(s:any,rail=1,pieces=700,sourceId='demo-od') {
 s=act(s,{op:'plan',sourceId,kilnId:2,rail,date:'2026-11-19',pieces,unit:'pieces',input:pieces,temperature:1150});
 s=act(s,{op:'reserve',planId:s.plans.at(-1).id,pieces});
 return act(s,{op:'rail-ready',kilnId:2,rail});
}
function fired() {
 let s=prepare(demoState());
 s=act(s,{op:'start',kilnId:2,rail:1,at,temperature:1150});
 s=act(s,{op:'stop',roundId:s.rounds[0].id,at:'2026-11-19T18:00:00+07:00'});
 s=act(s,{op:'withdraw',roundId:s.rounds[0].id,at:'2026-11-20T07:00:00+07:00'});
 return act(s,{op:'unload',roundId:s.rounds[0].id,at:'2026-11-20T08:00:00+07:00'});
}
test('reserving and moving uses each ready piece once; plans can exceed readiness',()=>{
 let s=prepare(demoState());
 assert.equal(sourceInfo(s,'demo-od').available,300);
 s=act(s,{op:'plan',sourceId:'demo-od',kilnId:2,rail:2,date:'2026-11-19',pieces:500,unit:'pieces',input:500,temperature:1150});
 assert.throws(()=>act(s,{op:'reserve',planId:s.plans.at(-1).id,pieces:301}),/พร้อม|เหลือ/);
 s=act(s,{op:'move',reservationId:s.reservations[0].id,kilnId:2,rail:2,pieces:200});
 assert.equal(sourceInfo(s,'demo-od').available,300);
 s=act(s,{op:'cancel',reservationId:s.reservations[0].id});
 assert.equal(sourceInfo(s,'demo-od').available,800);
});
test('shape range vetoes despite matching clay/color; only one rail fires in an oven',()=>{
 let s=prepare(demoState());
 s.items[0].shapeRange=[1000,1100];
 assert.throws(()=>act(s,{op:'start',kilnId:2,rail:1,at,temperature:1150}),/รูปแบบ|อุณหภูมิ/);
 s=prepare(demoState());s=prepare(s,2,100);
 s=act(s,{op:'start',kilnId:2,rail:1,at,temperature:1150});
 assert.throws(()=>act(s,{op:'start',kilnId:2,rail:2,at,temperature:1150}),/อยู่ในเตา|ใช้งาน/);
});
test('rail reuse does not wait for QC; partial grades and partial repair conserve pieces',()=>{
 let s=fired();
 assert.equal(summarize(s).waitingQc,700);
 s=prepare(s,1,100,'demo-os');
 s=act(s,{op:'qc',loadId:s.rounds[0].loads[0].id,at:'2026-11-20T09:00:00+07:00',counts:{'A+':500,'A-':20,B:10,waste:20,underfired:30,touchup:20},defects:[{name:'ร้าว',pieces:20}]});
 assert.equal(summarize(s).waitingQc,100);
 assert.throws(()=>act(s,{op:'repair-ready',qcId:s.qcs[0].id,kind:'underfired',pieces:31}),/ซ่อม|จำนวน/);
 s=act(s,{op:'repair-ready',qcId:s.qcs[0].id,kind:'underfired',pieces:25});
 assert.equal(sourceInfo(s,`repair:${s.qcs[0].id}:underfired`).available,25);
 assert.equal(sourceInfo(s,'demo-od').available,300);
 s=prepare(s,2,25,`repair:${s.qcs[0].id}:underfired`);
 assert.equal(sourceInfo(s,`repair:${s.qcs[0].id}:underfired`).available,0);
 assert.throws(()=>act(s,{op:'repair-ready',qcId:s.qcs[0].id,kind:'underfired',pieces:6}),/ซ่อม|จำนวน/);
});
test('grade policy is explicit and corrections cannot invalidate downstream quantities',()=>{
 let s=fired();
 s=act(s,{op:'qc',loadId:s.rounds[0].loads[0].id,at:'2026-11-20T09:00:00+07:00',counts:{'A+':650,'A-':20,B:0,waste:30,underfired:0,touchup:0},defects:[{name:'ร้าว',pieces:30}]});
 assert.throws(()=>act(s,{op:'allocate',qcId:s.qcs[0].id,grade:'A-',pieces:10,destination:'order',at:'2026-11-20T10:00:00+07:00'}),/เกรด/);
 s=act(s,{op:'allocate',qcId:s.qcs[0].id,grade:'A+',pieces:650,destination:'order',at:'2026-11-20T10:00:00+07:00'});
 assert.throws(()=>act(s,{op:'correct',loadId:s.rounds[0].loads[0].id,pieces:690}),/คัด|ยอด/);
 s=act(s,{op:'correct',loadId:s.rounds[0].loads[0].id,pieces:690,qcs:[{id:s.qcs[0].id,counts:{'A+':640,'A-':20,B:0,waste:30,underfired:0,touchup:0},defects:[{name:'ร้าว',pieces:30}]}],allocations:[{id:s.allocations[0].id,pieces:640}]});
 assert.equal(s.rounds[0].loads[0].pieces,690);
 assert.equal(s.allocations[0].pieces,640);
});
test('invalid dates, nonintegers and duplicate primary symptom counts fail without mutating input',()=>{
 const s=demoState(),before=JSON.stringify(s);
 assert.throws(()=>prepare(s,1,0.5),/จำนวน|เต็ม/);
 assert.equal(JSON.stringify(s),before);
 let q=fired();
 assert.throws(()=>act(q,{op:'qc',loadId:q.rounds[0].loads[0].id,at:'2026-11-18T09:00:00+07:00',counts:{'A+':690,'A-':0,B:0,waste:10,underfired:0,touchup:0},defects:[{name:'ร้าว',pieces:11}]}));
 assert.throws(()=>act(q,{op:'log',roundId:q.rounds[0].id,at:'not-a-date',temperature:100}));
});

test('ready stage and thermal snapshots survive catalog edits without changing history',()=>{
 let s=prepare(demoState());
 s=act(s,{op:'rail-ready',kilnId:2,rail:1});
 assert.equal(s.railsReady.length,1);
 s=act(s,{op:'start',kilnId:2,rail:1,at,temperature:1150});
 assert.deepEqual(s.rounds[0].loads[0].criteria.shapeRange,[1100,1200]);
 s=act(s,{op:'settings',sourceId:'demo-od',shapeRange:[1000,1100]});
 assert.deepEqual(s.rounds[0].loads[0].criteria.shapeRange,[1100,1200]);
 assert.throws(()=>act(s,{op:'allocate',qcId:999,grade:'A+',pieces:1,destination:'order',at:'2026-11-18T08:00:00+07:00'}));
});

test('correction cannot erase repair source already reserved or loaded',()=>{
 let s=fired();const loadId=s.rounds[0].loads[0].id;
 s=act(s,{op:'qc',loadId,at:'2026-11-20T09:00:00+07:00',counts:{'A+':600,'A-':0,B:0,waste:0,underfired:100,touchup:0},defects:[]});
 const qcId=s.qcs[0].id;
 s=act(s,{op:'repair-ready',qcId,kind:'underfired',pieces:100});
 s=act(s,{op:'plan',sourceId:`repair:${qcId}:underfired`,kilnId:2,rail:2,date:'2026-11-20',pieces:100,unit:'pieces',input:100,temperature:1150});
 s=act(s,{op:'reserve',planId:s.plans.at(-1).id,pieces:100});
 assert.throws(()=>act(s,{op:'correct',qcs:[{id:qcId,counts:{'A+':700,'A-':0,B:0,waste:0,underfired:0,touchup:0},defects:[]}],repairReady:[{qcId,kind:'underfired',pieces:0}]}),/พร้อม|ซ่อม|ยอด/);
});
test('historical oven overlap and closing before an existing temperature reading are rejected',()=>{
 let s=fired();s=prepare(s,2,100,'demo-os');
 assert.throws(()=>act(s,{op:'start',kilnId:2,rail:2,at:'2026-11-19T12:00:00+07:00',temperature:1150}),/เวลา|เตา/);
 let r=prepare(demoState());r=act(r,{op:'start',kilnId:2,rail:1,at,temperature:1150});
 const roundId=r.rounds[0].id;
 r=act(r,{op:'log',roundId,at:'2026-11-19T10:00:00+07:00',temperature:600});
 assert.throws(()=>act(r,{op:'stop',roundId,at:'2026-11-19T09:00:00+07:00'}),/เวลา|อุณหภูมิ/);
});

test('cancelling a plan releases prepared pieces but cannot erase fired work',()=>{
 let s=prepare(demoState());
 s=act(s,{op:'plan-edit',planId:s.plans[0].id,date:'2026-11-20',pieces:800,temperature:1150});
 assert.equal(s.plans[0].pieces,800);
 s=act(s,{op:'plan-cancel',planId:s.plans[0].id});
 assert.equal(sourceInfo(s,'demo-od').available,1000);assert.equal(summarize(s).planned,0);
 const firedState=fired();assert.throws(()=>act(firedState,{op:'plan-cancel',planId:firedState.plans[0].id}),/เข้าเผา/);
});

test('missing area rate cannot be silently treated as one piece per sqm',()=>{
 const s=demoState();s.items[0].rate=0;
 assert.throws(()=>act(s,{op:'plan',sourceId:'demo-od',kilnId:2,rail:1,date:'2026-11-19',pieces:1,unit:'sqm',input:1,temperature:1150}),/อัตรา/);
 const planned=act(s,{op:'plan',sourceId:'demo-od',kilnId:2,rail:1,date:'2026-11-19',pieces:10,unit:'pieces',input:10,temperature:1150});
 assert.equal(planned.plans[0].pieces,10);
});
