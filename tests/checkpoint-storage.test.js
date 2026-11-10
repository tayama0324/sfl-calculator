import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {migrateData,remaining} from '../docs/js/model.js';import {emptyCheckpoint} from '../docs/js/monte-carlo.js';
import {clearStoredCheckpoints,restoreMatchingCheckpoint} from '../docs/js/checkpoint-storage.js';
const data=migrateData(JSON.parse(await readFile(new URL('../docs/data/default.json',import.meta.url))));
function fixture(){const d=structuredClone(data.divisions[0]);d.cases=[];d.calculationMethod='monteCarlo';d.simulation.seed='restore-test';const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};return {d,storage};}
test('unchanged MC checkpoint restores and trial-count changes still permit continuation',()=>{
 const {d,storage}=fixture(),cp=emptyCheckpoint(d);storage.setItem('sfl-mc:last-S',JSON.stringify(cp));d.simulation.trials++;
 assert.deepEqual(restoreMatchingCheckpoint(storage,d),cp);assert(storage.getItem('sfl-mc:last-S'));
});
test('old assumptions, baseline, method and seed never revive on reload',()=>{
 for(const mutate of [d=>{d.matchAssumptions[remaining(d)[0].id]=[{id:'a',metric:'homePoints',operator:'gte',value:30,source:'manual'}];},d=>d.baseline.asOf='2026-11-10',d=>d.calculationMethod='exact',d=>d.simulation.seed+='new']){
  const {d,storage}=fixture(),old=structuredClone(d);mutate(old);
  // For method changes create the valid MC snapshot before changing current input.
  const cp=emptyCheckpoint(d);storage.setItem('sfl-mc:last-S',JSON.stringify(cp));
  assert.equal(restoreMatchingCheckpoint(storage,old),null);assert.equal(storage.getItem('sfl-mc:last-S'),null);
 }
});
test('reset removes both divisions checkpoints without clearing settings or unrelated keys',()=>{
 const {storage}=fixture();for(const k of ['sfl-mc:last-S','sfl-mc:last-F','sfl-rank-probability:v3','other'])storage.setItem(k,'saved');
 clearStoredCheckpoints(storage,['S','F']);assert.equal(storage.getItem('sfl-mc:last-S'),null);assert.equal(storage.getItem('sfl-mc:last-F'),null);assert.equal(storage.getItem('sfl-rank-probability:v3'),'saved');assert.equal(storage.getItem('other'),'saved');
});
test('invalid checkpoint is discarded and reported instead of retried on every reload',()=>{
 const {d,storage}=fixture();storage.setItem('sfl-mc:last-S','broken json');assert.throws(()=>restoreMatchingCheckpoint(storage,d));assert.equal(restoreMatchingCheckpoint(storage,d),null);
});
