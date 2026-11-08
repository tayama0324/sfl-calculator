import { BASE_CASE, prepare, validate, verifyFractions } from './model.js';
import { MODEL_VERSION } from './distributions.js';
import { seedKey, trialRandom, makeSampler, RNG_VERSION, SAMPLER_VERSION } from './random.js';
import {compareTeams} from './ranking.js';
export const CHECKPOINT_VERSION=1;
export const CI_VERSION='hoeffding-anytime-alpha-spending-v1';
export const FIELDS={lowerRanks:36,upperRanks:36,poLower:6,poUpper:6,unresolved:6,borderTies:6};
const sum=a=>a.reduce((s,n)=>s+BigInt(n),0n);
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function simulationFingerprint(division) {
  const copy=structuredClone(division);delete copy.simulation.trials;return canonical(copy);
}
function checkDivision(d) {
  const errors=validate({schemaVersion:3,title:'Checkpoint',divisions:[d]},true);
  if(errors.length)throw new Error(errors.join('\n'));
  if(d.calculationMethod!=='monteCarlo'||!d.simulation.seed.length)throw new Error('モンテカルロ方式と空でないシードが必要です。');
}
export function emptyCheckpoint(division) {
  checkDivision(division);
  return {kind:'sfl-monte-carlo-checkpoint',version:CHECKPOINT_VERSION,modelVersion:MODEL_VERSION,rngVersion:RNG_VERSION,samplerVersion:SAMPLER_VERSION,ciVersion:CI_VERSION,division:structuredClone(division),fingerprint:simulationFingerprint(division),completed:0,nextTrial:0,records:[BASE_CASE,...division.cases].map(c=>({id:c.id,...Object.fromEntries(Object.entries(FIELDS).map(([f,size])=>[f,Array(size).fill('0')])),deltaLower:Array(6).fill('0'),deltaUpper:Array(6).fill('0')}))};
}
function resultFromRecord(cp,record) {
  const matrix=a=>Array.from({length:6},(_,i)=>a.slice(i*6,i*6+6));
  const result={method:'monteCarlo',mode:cp.division.explorationMode,teamIds:cp.division.baseline.standings.map(t=>t.teamId),denominator:String(BigInt(cp.completed)*60n),processed:String(cp.completed)};
  if(result.mode==='points')return {...result,kind:'allocated',ranks:matrix(record.lowerRanks)};
  return {...result,kind:'intervals',lowerRanks:matrix(record.lowerRanks),upperRanks:matrix(record.upperRanks),poLower:record.poLower,poUpper:record.poUpper,unresolved:record.unresolved,borderTies:record.borderTies};
}
export function checkpointResults(cp) { return cp.completed ? cp.records.map(r=>resultFromRecord(cp,r)) : []; }
export function validateCheckpoint(cp) {
  try {
    if(cp.kind!=='sfl-monte-carlo-checkpoint'||cp.version!==CHECKPOINT_VERSION||cp.modelVersion!==MODEL_VERSION||cp.rngVersion!==RNG_VERSION||cp.samplerVersion!==SAMPLER_VERSION||cp.ciVersion!==CI_VERSION)throw new Error('チェックポイントの種類またはバージョンが対応していません。');
    checkDivision(cp.division);
    if(cp.fingerprint!==simulationFingerprint(cp.division))throw new Error('入力スナップショットと識別情報が一致しません。');
    if(!Number.isSafeInteger(cp.completed)||cp.completed<0||cp.nextTrial!==cp.completed)throw new Error('完了試行数または次の試行番号が不正です。');
    const definitions=[BASE_CASE,...cp.division.cases],limit=BigInt(cp.completed)*60n;
    if(!Array.isArray(cp.records)||cp.records.length!==definitions.length)throw new Error('ケースの集計構成が不正です。');
    const read=(value,signed=false)=>{
      if(typeof value!=='string'||!(/^(0|[1-9]\d*|-[1-9]\d*)$/).test(value)||value.length>32)throw new Error('集計カウントが不正です。');
      const n=BigInt(value);if(n>(limit)||n<(signed?-limit:0n))throw new Error('集計カウントが試行数と整合しません。');return n;
    };
    cp.records.forEach((r,i)=>{
      if(r.id!==definitions[i].id)throw new Error('比較ケースの順序・IDが一致しません。');
      for(const [field,size]of Object.entries(FIELDS)){
        if(!Array.isArray(r[field])||r[field].length!==size)throw new Error('集計配列の長さが不正です。');
        r[field].forEach(n=>read(n));
      }
      for(const field of ['deltaLower','deltaUpper']){
        if(!Array.isArray(r[field])||r[field].length!==6)throw new Error('対応差の配列が不正です。');
        r[field].forEach(n=>read(n,true));
      }
      for(let j=0;j<6;j++){
        if(read(r.deltaLower[j],true)!==read(r.poLower[j])-read(cp.records[0].poUpper[j])||read(r.deltaUpper[j],true)!==read(r.poUpper[j])-read(cp.records[0].poLower[j]))throw new Error('対応する基準差が集計と一致しません。');
      }
      if(cp.division.explorationMode==='points'){
        if(r.lowerRanks.some((n,j)=>n!==r.upperRanks[j])||r.unresolved.some(n=>n!=='0')||r.borderTies.some(n=>n!=='0'))throw new Error('ポイントモードの集計が不正です。');
        for(let j=0;j<6;j++)if(sum(r.lowerRanks.slice(j*6,j*6+3))!==read(r.poLower[j])||r.poLower[j]!==r.poUpper[j])throw new Error('POの集計が一致しません。');
      }
      if(cp.completed&&!verifyFractions(resultFromRecord(cp,r)).ok)throw new Error('確率の保存則検算に失敗しました。');
    });
    // Reject missing historical differences before accepting an imported run.
    for(const definition of definitions)prepare(cp.division,definition);
    return true;
  } catch(error) { throw new Error(`再開データを読み込めません：${error.message}`); }
}
export function confidenceInterval(numerator,completed,{difference=false}={}) {
  if(!Number.isSafeInteger(completed)||completed<1)return null;
  const lower=difference?-1:0,upper=1,mean=Number(BigInt(numerator))/Number(BigInt(completed)*60n);
  // alpha_N = .05/[N(N+1)]; sum_N alpha_N = .05. The union bound
  // makes this valid across repeated inspection/stopping for each indicator.
  const log=Math.log(40)+Math.log(completed)+Math.log(completed+1);
  const radius=(difference?2:1)*Math.sqrt(log/(2*completed));
  return {mean,lower:Math.max(lower,mean-radius-2e-15),upper:Math.min(upper,mean+radius+2e-15),radius};
}
function metricsFor(prepared,working,metrics) {
  for(const field of Object.keys(FIELDS))metrics[field].fill(0);
  const order=[0,1,2,3,4,5],mode=prepared.mode;
  const compare=(i,j)=>-compareTeams(working,mode,i,j);
  order.sort(compare);
  for(let first=0;first<6;){
    let end=first+1;while(end<6&&compare(order[first],order[end])===0)end++;
    for(let at=first;at<end;at++){
      const i=order[at],tied=end-first>1;
      if(mode==='points'){
        const share=60/(end-first);
        for(let rank=first;rank<end;rank++){metrics.lowerRanks[i*6+rank]=share;metrics.upperRanks[i*6+rank]=share;}
        const po=share*Math.max(0,Math.min(3,end)-first);metrics.poLower[i]=po;metrics.poUpper[i]=po;
      }else{
        for(let rank=first;rank<end;rank++){metrics.upperRanks[i*6+rank]=60;if(!tied)metrics.lowerRanks[i*6+rank]=60;}
        metrics.poLower[i]=end<=3?60:0;metrics.poUpper[i]=first<3?60:0;
        metrics.unresolved[i]=tied?60:0;metrics.borderTies[i]=first<3&&end>3?60:0;
      }
    }
    first=end;
  }
}
export async function createMonteCarlo(division,checkpoint=null) {
  checkDivision(division);
  if(checkpoint){validateCheckpoint(checkpoint);if(checkpoint.fingerprint!==simulationFingerprint(division))throw new Error('入力・条件・シードが変わっているため、追加試行できません。');}
  const snapshot=structuredClone(division),definitions=[BASE_CASE,...snapshot.cases];
  const inputs=definitions.map(c=>prepare(snapshot,c));
  const slots=new Map([...inputs[0].matches.map(m=>m.id)].sort().map((id,i)=>[id,i]));
  const key=await seedKey(snapshot.simulation.seed,snapshot.id);
  const records=definitions.map((c,i)=>({id:c.id,...Object.fromEntries(Object.entries(FIELDS).map(([f,size])=>[f,checkpoint?checkpoint.records[i][f].map(BigInt):Array(size).fill(0n)]))}));
  const groups=new Map();
  inputs.forEach((prepared,index)=>{
    const id=JSON.stringify(prepared.matches);
    if(groups.has(id)){groups.get(id).recordIndices.push(index);return;}
    groups.set(id,{prepared,recordIndices:[index],games:prepared.matches.map(m=>({...m,sample:makeSampler(m.outcomes),slot:slots.get(m.id)})),working:{points:new Int32Array(6),battles:new Int32Array(6),rounds:new Int32Array(6)},metrics:Object.fromEntries(Object.entries(FIELDS).map(([f,size])=>[f,new Float64Array(size)])),buffer:Object.fromEntries(Object.entries(FIELDS).map(([f,size])=>[f,new Float64Array(size)]))});
  });
  let completed=checkpoint?.completed??0,buffered=0;
  function flush(){
    if(!buffered)return;
    for(const g of groups.values())for(const [f,size]of Object.entries(FIELDS))for(let j=0;j<size;j++){
      const n=BigInt(g.buffer[f][j]);for(const i of g.recordIndices)records[i][f][j]+=n;g.buffer[f][j]=0;
    }
    buffered=0;
  }
  function step(count){
    if(!Number.isSafeInteger(count)||count<0||!Number.isSafeInteger(completed+count))throw new Error('追加試行数が不正または上限を超えています。');
    const target=completed+count;
    for(;completed<target;completed++){
      const random=trialRandom(key,completed);
      for(const g of groups.values()){
        g.working.points.set(g.prepared.points);g.working.battles.set(g.prepared.battleDiffs);g.working.rounds.set(g.prepared.roundDiffs);
        for(const m of g.games){
          const [h,a,,b=0,r=0]=m.sample(draw=>random(m.slot,draw));
          g.working.points[m.home]+=h;g.working.points[m.away]+=a;
          g.working.battles[m.home]+=b;g.working.battles[m.away]-=b;g.working.rounds[m.home]+=r;g.working.rounds[m.away]-=r;
        }
        metricsFor(g.prepared,g.working,g.metrics);
        for(const [f,size]of Object.entries(FIELDS))for(let j=0;j<size;j++)g.buffer[f][j]+=g.metrics[f][j];
      }
      // Every case for a trial is committed atomically, never half of a pair.
      if(++buffered===8192)flush();
    }
    return completed;
  }
  function checkpointSnapshot(){
    flush();
    return {kind:'sfl-monte-carlo-checkpoint',version:CHECKPOINT_VERSION,modelVersion:MODEL_VERSION,rngVersion:RNG_VERSION,samplerVersion:SAMPLER_VERSION,ciVersion:CI_VERSION,division:structuredClone(snapshot),fingerprint:simulationFingerprint(snapshot),completed,nextTrial:completed,records:records.map(r=>({id:r.id,...Object.fromEntries(Object.keys(FIELDS).map(f=>[f,r[f].map(String)])),deltaLower:r.poLower.map((n,i)=>String(n-records[0].poUpper[i])),deltaUpper:r.poUpper.map((n,i)=>String(n-records[0].poLower[i]))}))};
  }
  return {step,checkpoint:checkpointSnapshot,get completed(){return completed;},definitions,inputs};
}
