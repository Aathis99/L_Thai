import assert from 'node:assert/strict';
import {test} from 'node:test';
import {availableClays,affectedProducts} from '../src/lib/clay-registry.ts';
test('all four clays remain visible when production and pigments are absent',()=>{
 const clay_types=['WHITE','COLORED','RED','LATERITE'].map((code,i)=>({id:i+1,code,name:code,active:true,description:null,base_clay_type_id:null}));
 const choices=availableClays({clay_types,clay_colors:[]},[],{id:1,body_id:null,active:true} as any);
 assert.equal(choices.length,4);assert.equal(choices.some(x=>x.ready),false);
 assert.equal(affectedProducts(2,[{id:1,body_id:2},{id:2,body_id:3},{id:3,body_id:2}] as any).length,2);
});
