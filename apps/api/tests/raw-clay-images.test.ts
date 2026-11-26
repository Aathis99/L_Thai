import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {encodeImage} from '../src/raw-clay/images.js';
test('receipt evidence remains readable-size WebP with bounded dimensions and bytes',async()=>{const png=await sharp({create:{width:3000,height:2000,channels:3,background:'white'}}).png().toBuffer();const bytes=await encodeImage(png.toString('base64'),'image/png');const m=await sharp(bytes).metadata();assert.equal(m.format,'webp');assert.equal(m.width,2560);assert.ok(bytes.length<=1048576);await assert.rejects(encodeImage(png.toString('base64'),'image/jpeg'));await assert.rejects(encodeImage(Buffer.from('not an image').toString('base64'),'image/png'));await assert.rejects(encodeImage('a'.repeat(12*1024*1024),'image/png'));});
