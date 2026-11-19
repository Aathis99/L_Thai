import {createHash} from 'node:crypto';

function ordered(value){
  if(Array.isArray(value))return value.map(ordered);
  if(value!==null&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])]));
  return value;
}

/** Compare named JSON values, independent of SELECT * column/property order. */
export function hashRows(rows){
  return createHash('sha256').update(JSON.stringify(ordered(JSON.parse(JSON.stringify(rows))))).digest('hex');
}
