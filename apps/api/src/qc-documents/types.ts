export type DocumentOutcome='A+'|'waste'|'underfired'|'touchup';
export const symptomNames=['เศษ','มุมเข้า','มุมออก','ฉีกข้าง','อลูมิน่า','งอ','เปิด','แอ่น','หัก','ฉีก','แร่','เศษไม้','รู','กระจก','ดิน','เหล็ก','ร้าวหลัง','ฟอง','เศษชุบ','หยด','ซิลิกอน','หด','ไม่สุก'];
export type DocumentCounts=Record<DocumentOutcome,number>;
export interface QcWorker {id:number;code:string;name:string;active:boolean}
export interface QcDocumentLoad {
 id:number;sourceId:string;orderKey:string;reference:string;name:string;clay:string;clayColor?:string|null;color:string;code:string;
 pieces?:number;parentQcId?:number;parentDocumentId?:number;parentDocumentNumber?:string;repairKind?:'underfired'|'touchup';
}
export interface QcDocumentLine {loadId:number;counts:DocumentCounts;defects:{name:string;pieces:number}[];qcId?:number}
export interface QcDocumentEntry {
 id:number;status:'draft'|'confirmed'|'cancelled';at:string;workers:QcWorker[];note:string;lines:QcDocumentLine[];
 recordedBy:string;confirmedBy?:string;confirmedAt?:string;
}
export interface QcReportOrder {orderKey:string;reference:string;loadIds:number[];input:number;counts:DocumentCounts}
export interface QcReport {
 formVersion:1;sources:QcDocumentLoad[];printSymptoms:{name:string;pieces:number}[];
 number:string;roundId:number;kiln:string;rail:number;name:string;clay:string;clayColor:string;color:string;
 startedAt:string;withdrawnAt:string;unloadedAt:string;input:number;output:number;confirmed:number;pending:number;draftPieces:number;
 counts:DocumentCounts;defects:{name:string;pieces:number}[];orders:QcReportOrder[];entries:QcDocumentEntry[];
 ready:boolean;missing:string[];officialCurrent:boolean;
}
export interface QcReportVersion {revision:number;dataVersion:number;createdAt:string;createdBy:string;content:QcReport}
export interface QcDocument {
 id:number;number:string;groupKey:string;roundId:number;createdAt:string;createdBy:string;version:number;
 loads:QcDocumentLoad[];entries:QcDocumentEntry[];reports:QcReportVersion[];
 corrections:{at:string;actor:string;reason:string}[];
}
export interface QcCandidate {groupKey:string;roundId:number;loads:QcDocumentLoad[]}
export interface QcDocumentContext {now:string;actor:string;workers:QcWorker[]}
