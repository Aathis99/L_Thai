import type {Db} from '../database.js';
export const rawClayPermissions={'raw_clay.read':'ดูรับดินและวัตถุดิบ','raw_clay.record':'บันทึกรับดินและเบิกเข้าโม่','raw_clay.confirm':'ยืนยันรับดินและเบิกเข้าโม่','raw_clay.correct':'แก้ไขและยกเลิกวัตถุดิบ','raw_clay.adjust':'ปรับยอดตรวจนับวัตถุดิบ'};
export async function migrateRawClay(db:Db):Promise<void>{await db.query(`
 CREATE TABLE IF NOT EXISTS raw_clay_state(id integer PRIMARY KEY CHECK(id=1),revision integer NOT NULL DEFAULT 0);
 INSERT INTO raw_clay_state(id) VALUES(1) ON CONFLICT DO NOTHING;
 CREATE TABLE IF NOT EXISTS raw_clay_documents(id serial PRIMARY KEY,document jsonb NOT NULL);
 CREATE TABLE IF NOT EXISTS raw_clay_images(id serial PRIMARY KEY,document_id integer NOT NULL REFERENCES raw_clay_documents(id),bytes bytea NOT NULL CHECK(octet_length(bytes)<=1048576),created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS raw_clay_revisions(id serial PRIMARY KEY,document_id integer NOT NULL REFERENCES raw_clay_documents(id),version integer NOT NULL,document jsonb NOT NULL,actor text NOT NULL,reason text NOT NULL,at timestamptz NOT NULL DEFAULT now(),movements jsonb NOT NULL,UNIQUE(document_id,version));
 CREATE TABLE IF NOT EXISTS raw_clay_requests(request_id uuid PRIMARY KEY,actor_id integer NOT NULL REFERENCES users(id),fingerprint text NOT NULL,response jsonb NOT NULL);
 CREATE INDEX IF NOT EXISTS raw_clay_history_document ON raw_clay_revisions(document_id,version);
 `);}
