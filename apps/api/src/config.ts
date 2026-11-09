import dotenv from 'dotenv';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const workspaceRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
dotenv.config({path:resolve(workspaceRoot,'.env'),quiet:true});
export function databaseUrl(){if(!process.env.DATABASE_URL)throw new Error('กรุณาตั้ง DATABASE_URL ใน .env ก่อนเปิดระบบ');return process.env.DATABASE_URL;}
