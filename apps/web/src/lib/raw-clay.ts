export type ClayKind='receipt'|'issue'|'adjustment';
export type ClayData={clayTypeId:number;clayColorId:number|null;clayTypeName?:string;clayColorName?:string;occurredAt:string;employeeId:number;employeeName?:string;notes:string;supplier?:string;billNumber?:string;documentDate?:string;tradeName?:string;netKg?:string;weighInAt?:string|null;weighOutAt?:string|null;tareKg?:string|null;grossKg?:string|null;plateIn?:string;plateOut?:string;missingNote?:string;quantityKg?:string;countedKg?:string;reason?:string};
export type ClayDocument={id:number;number:string;kind:ClayKind;status:'draft'|'confirmed'|'cancelled';version:number;data:ClayData;imageIds:number[];createdAt:string;updatedAt:string;actor:string;createdBy?:string;confirmedBy?:string};
export type ClayStock={clayTypeId:number;clayColorId:number|null;receivedKg:string;issuedKg:string;adjustmentKg:string;balanceKg:string;openingKg:string};
export type ClayMovement={documentId:number;clayTypeId:number;clayColorId:number|null;beforeKg:string;deltaKg:string;afterKg:string};
export type ClayRevision={version:number;document:ClayDocument;actor:string;at:string;reason:string;movements:ClayMovement[]};
export type ClayState={revision:number;documents:ClayDocument[];total:number;page:number;pageSize:number;stock:ClayStock[];summary:ClayStock[];clay_types:{id:number;code:string;name:string;active:boolean}[];clay_colors:{id:number;code:string;name:string;active:boolean}[];employees:{id:number;name:string;active:boolean}[]};
export type ClayImage={id:number}|{data:string;contentType:string};
export type ClayCommand={action:'save'|'confirm'|'correct'|'cancel';payload:{id?:number;kind?:ClayKind;data?:ClayData;images?:ClayImage[];reason?:string}};
export const kindLabels:Record<ClayKind,string>={receipt:'รับเข้า',issue:'เบิกเข้าโม่',adjustment:'ปรับยอดตรวจนับ'};
export const statusLabels={draft:'ร่าง',confirmed:'ยืนยันแล้ว',cancelled:'ยกเลิกแล้ว'};
export function readKg(value:string,allowZero=false):string {
 if(!/^\d+(\.\d{1,3})?$/.test(value)||!Number.isFinite(Number(value))||(!allowZero&&Number(value)===0))throw Error('กรอกกิโลกรัมเป็นเลขบวก ทศนิยมไม่เกิน 3 ตำแหน่ง');
 return value;
}
const grams=(value:string)=>{const [whole,fraction='']=value.split('.');return BigInt(whole)*1000n+BigInt(fraction.padEnd(3,'0'));};
export function receiptWeightError(value:{netKg:string;tareKg:string|null;grossKg:string|null;missingNote:string;weighInAt:string|null;weighOutAt:string|null}):string {
 try{readKg(value.netKg);if(value.tareKg!==null)readKg(value.tareKg,true);if(value.grossKg!==null)readKg(value.grossKg,true);}catch(e){return (e as Error).message;}
 if(value.tareKg!==null&&value.grossKg!==null&&grams(value.grossKg)-grams(value.tareKg)!==grams(value.netKg))return 'น้ำหนักสุทธิต้องเท่ากับน้ำหนักรวมลบน้ำหนักรถ';
 if((value.tareKg===null||value.grossKg===null||!value.weighInAt||!value.weighOutAt)&&!value.missingNote.trim())return 'กรุณาระบุหมายเหตุข้อมูลใบชั่งที่ขาด';
 if(value.weighInAt&&value.weighOutAt&&Date.parse(value.weighOutAt)<Date.parse(value.weighInAt))return 'เวลาชั่งออกต้องไม่ก่อนเวลาชั่งเข้า';
 return '';
}
export function readClayTime(date:string,hour:string,minute:string,optional=false):string|null {
 if(optional&&!date&&!hour&&!minute)return null;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{1,2}$/.test(hour)||!/^\d{1,2}$/.test(minute)||Number(hour)>23||Number(minute)>59||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Error('กรุณาตรวจวันและเวลา 24 ชั่วโมง');
 return `${date}T${hour.padStart(2,'0')}:${minute.padStart(2,'0')}:00+07:00`;
}
export function canRawClay(permissions:readonly string[],operation:string):boolean { return permissions.includes('raw_clay.read')&&permissions.includes(`raw_clay.${operation}`); }
export function validatePhotos(photos:readonly ({id:number}|{type:string;size:number})[],confirmed:boolean):void {
 if(photos.length>3||(confirmed&&photos.length<1))throw Error('ใบรับยืนยันต้องมีภาพ 1–3 รูป (ร่างไม่เกิน 3 รูป)');
 for(const photo of photos)if(!('id'in photo)&&(!['image/jpeg','image/png','image/webp'].includes(photo.type)||photo.size>8*1024*1024))throw Error('รองรับ JPEG / PNG / WebP รูปนิ่ง ไม่เกิน 8 MiB ต่อรูป');
}
export function localClayTime(value?:string|null):string {return value?new Date(Date.parse(value)+7*3600000).toISOString().slice(0,16):'';}
export function nowClayTime():string {return new Date(Date.now()+7*3600000).toISOString().slice(0,16);}
export function displayClayTime(value:string):string {return value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok',hourCycle:'h23'}).format(new Date(value)):'—';}
export function createClayRequestId(random:{getRandomValues(bytes:Uint8Array):Uint8Array}=globalThis.crypto):string {
 const bytes=random.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function readClayForm(form:FormData,kind:ClayKind,confirmed:boolean,colored:boolean):ClayData {
 const text=(name:string)=>String(form.get(name)??'').trim();
 const weight=(name:string,allowZero=false)=>readKg(text(name+'_unit')==='t'?tonnesToKg(text(name)):text(name),allowZero);
 const clock=(name:string,optional=false)=>readClayTime(text(`${name}_date`),text(`${name}_hour`),text(`${name}_minute`),optional);
 const result:ClayData={clayTypeId:Number(text('clayTypeId')),clayColorId:colored?Number(text('clayColorId'))||null:null,employeeId:Number(text('employeeId')),occurredAt:kind==='adjustment'?`${nowClayTime()}:00+07:00`:clock('occurredAt',!confirmed)??'',notes:text('notes')};
 if(confirmed&&(!Number.isInteger(result.clayTypeId)||result.clayTypeId<=0||!Number.isInteger(result.employeeId)||result.employeeId<=0||(colored&&!result.clayColorId)))throw Error('กรุณาเลือกประเภทดิน สีดินเมื่อใช้ดินสี และผู้ทำงานจริง');
 if(kind==='receipt'){
  Object.assign(result,{supplier:text('supplier'),billNumber:text('billNumber'),documentDate:text('documentDate'),tradeName:text('tradeName'),...(text('netKg')?{netKg:weight('netKg')}:{}),tareKg:text('tareKg')?weight('tareKg',true):null,grossKg:text('grossKg')?weight('grossKg',true):null,weighInAt:clock('weighInAt',true),weighOutAt:clock('weighOutAt',true),plateIn:text('plateIn'),plateOut:text('plateOut'),missingNote:text('missingNote')});
  if(confirmed){
   if(!result.supplier||!result.billNumber||!result.documentDate||!result.tradeName||!result.netKg)throw Error('กรุณาระบุผู้ขาย เลขบิล วันที่เอกสาร ชื่อดิน และน้ำหนักสุทธิ');
   const problem=receiptWeightError(result as Required<Pick<ClayData,'netKg'|'tareKg'|'grossKg'|'weighInAt'|'weighOutAt'|'missingNote'>>);if(problem)throw Error(problem);
   if((!result.plateIn||!result.plateOut)&&!result.missingNote)throw Error('กรุณาระบุหมายเหตุทะเบียนรถที่ขาด');
  }
  if(result.weighOutAt&&result.occurredAt&&Date.parse(result.occurredAt)<Date.parse(result.weighOutAt))throw Error('เวลารับโรงงานต้องไม่ก่อนชั่งออก');
 }else if(kind==='issue'){
  if(text('quantityKg'))result.quantityKg=weight('quantityKg');else if(confirmed)throw Error('กรุณาระบุน้ำหนักเบิกเข้าโม่');
 }else{
  result.reason=text('adjustmentReason');if(text('countedKg'))result.countedKg=weight('countedKg',true);else if(confirmed)throw Error('กรุณาระบุยอดตรวจนับจริง');
  if(confirmed&&!result.reason)throw Error('กรุณาระบุเหตุผลปรับยอด');
 }
 return result;
}
export function receiptDuplicates(data:ClayData,documents:ClayDocument[],ownId?:number):ClayDocument[]{
 const normalize=(value?:string)=>String(value??'').trim().replace(/\s+/g,'').toLowerCase();
 const plate=normalize(data.plateOut||data.plateIn);
 if(!data.supplier?.trim()||!data.billNumber?.trim()||!data.documentDate||!plate)return [];
 return documents.filter(doc=>doc.id!==ownId&&doc.kind==='receipt'&&doc.status!=='cancelled'&&normalize(doc.data.supplier)===normalize(data.supplier)&&normalize(doc.data.billNumber)===normalize(data.billNumber)&&doc.data.documentDate===data.documentDate&&normalize(doc.data.plateOut||doc.data.plateIn)===plate);
}

export function tonnesToKg(value:string):string {
 if(!/^\d+(\.\d{1,6})?$/.test(value))throw Error('กรอกตันเป็นเลขบวก ทศนิยมไม่เกิน 6 ตำแหน่ง');
 const [whole,fraction='']=value.split('.');const units=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));const kg=String(units/1000n),part=String(units%1000n).padStart(3,'0').replace(/0+$/,'');return kg+(part?'.'+part:'');
}
export function displayClayWeight(value:string):string {
 if(!/^-?\d+(\.\d{1,3})?$/.test(value))return value;
 const sign=value.startsWith('-')?'-':'',absolute=value.replace(/^-/,'');const units=grams(absolute);if(units<1000000n)return value+' กก.';
 const fraction=String(units%1000000n).padStart(6,'0').replace(/0+$/,'');return value+' กก. ('+sign+units/1000000n+(fraction?'.'+fraction:'')+' ตัน)';
}
export function canRebaseClayEditor(original:ClayDocument|undefined,latest:ClayDocument|undefined):boolean {return original?original.id===latest?.id&&original.version===latest.version:!latest;}
export type ClayRequestEnvelope={requestId:string;body:{revision:number}&ClayCommand};
export function clayRequestEnvelope(pending:ClayRequestEnvelope|null,body:ClayRequestEnvelope['body']):ClayRequestEnvelope{return pending??{requestId:createClayRequestId(),body:structuredClone(body)};}
