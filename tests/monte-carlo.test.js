import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Worker} from 'node:worker_threads';
import {chachaBlock,seedKey,trialRandom,makeSampler} from '../docs/js/random.js';
import {createMonteCarlo,validateCheckpoint,checkpointResults,emptyCheckpoint,confidenceInterval,simulationFingerprint} from '../docs/js/monte-carlo.js';
import {migrateData,remaining,prepare,BASE_CASE,verifyFractions,boundsOf,validate} from '../docs/js/model.js';
import {calculate} from '../docs/js/engine.js';
import {renderComparison} from '../docs/js/comparison-ui.js';
import {estimateText} from '../docs/js/monte-carlo-ui.js';
const raw=JSON.parse(await readFile(new URL('../docs/data/default.json',import.meta.url)));
function division(mode='points'){
  const d=migrateData(raw).divisions[0];d.calculationMethod='monteCarlo';d.explorationMode=mode;d.simulation.seed='再現テスト-0001';
  d.cases=[{id:'win',name:'A全勝',conditions:[{targetTeamId:d.teams[0].id,mode:'win'}]},{id:'same',name:'基準と同一',conditions:[]}];
  return d;
}
function closeOut(d,count=1){
  for(const m of remaining(d).slice(0,-count))d.results[m.id]={homePoints:40,awayPoints:0,homeBattleDiffDelta:7,homeRoundDiffDelta:14};
  return d;
}
test('ChaCha20 matches RFC 8439 block-function test vector',()=>{
  const key=Uint32Array.from({length:8},(_,i)=>(i*4)|((i*4+1)<<8)|((i*4+2)<<16)|((i*4+3)<<24));
  const block=chachaBlock(key,1,[0x09000000,0x4a000000,0]);
  const bytes=new Uint8Array(64),view=new DataView(bytes.buffer);
  block.forEach((n,i)=>view.setUint32(i*4,n,true));
  assert.equal(Buffer.from(bytes).toString('hex'),'10f1e7e4d13b5915500fdd1fa32071c4c7d1f4c733c068030422aa9ac3d46c4ed2826446079faa0914c2d705d98b02a2b5129cd1de164eb9cbd083e8a2503c4e');
});
test('counter streams reproduce seed, trial and match addressing without order-dependent consumption',async()=>{
  const key=await seedKey('0001','S'),a=trialRandom(key,0),b=trialRandom(key,0);
  assert.equal(a(9),b(9));a(9,3);assert.equal(a(4),b(4));
  assert.equal(a(5,2),b(5,2));
  assert.notEqual(a(0),trialRandom(key,4294967296)(0));
  assert.notEqual(a(0),trialRandom(await seedKey('1','S'),0)(0));
  assert.notEqual(a(0),trialRandom(await seedKey('0001','F'),0)(0));
  assert.throws(()=>a(32),/位置/);
});
test('exact weighted inverse-CDF sampling refines shared bits at non-dyadic boundaries',()=>{
  const rows=[[40,0,1],[30,10,1],[0,40,1]],sample=makeSampler(rows);
  assert.deepEqual(sample(()=>0),rows[0]);assert.deepEqual(sample(()=>0xffffffff),rows[2]);
  let calls=0;
  assert.deepEqual(sample(i=>{calls++;return i===0?0x55555555:0;}),rows[0]);assert.equal(calls,2);
  assert.deepEqual(sample(i=>i===0?0x55555555:0xffffffff),rows[1]);
  const dyadic=makeSampler([[40,0,1],[30,10,2],[0,40,1]]);
  assert.equal(dyadic(()=>0)[0],40);assert.equal(dyadic(()=>0x40000000)[0],30);assert.equal(dyadic(()=>0xc0000000)[0],0);
  assert.throws(()=>makeSampler([[40,0,0]]),/重み/);
});
test('single run equals split steps and JSON checkpoint resume in every ranking mode',async()=>{
  for(const mode of ['points','battles','rounds']){
    const d=division(mode),whole=await createMonteCarlo(d),split=await createMonteCarlo(d);
    whole.step(521);split.step(17);split.step(83);
    const cp=JSON.parse(JSON.stringify(split.checkpoint()));assert(validateCheckpoint(cp));
    const resumed=await createMonteCarlo(d,cp);resumed.step(421);
    assert.deepEqual(resumed.checkpoint(),whole.checkpoint());
    assert(checkpointResults(whole.checkpoint()).every(r=>verifyFractions(r).ok));
    assert.deepEqual(whole.checkpoint().records[0].lowerRanks,whole.checkpoint().records[2].lowerRanks);
  }
});
test('BigInt buffer flush across 8192 trials preserves replay and paired differences',async()=>{
  const d=division('rounds'),whole=await createMonteCarlo(d),split=await createMonteCarlo(d);
  whole.step(8301);split.step(4000);split.checkpoint();split.step(4301);
  assert.deepEqual(whole.checkpoint(),split.checkpoint());
  const cp=whole.checkpoint();assert(validateCheckpoint(cp));
  for(const r of cp.records)for(let i=0;i<6;i++)assert.equal(BigInt(r.deltaLower[i]),BigInt(r.poLower[i])-BigInt(cp.records[0].poUpper[i]));
});
test('case and fixture iteration order do not shift common random draws',async()=>{
  const d=division('rounds'),other=structuredClone(d);other.cases.reverse();other.fixtures.reverse();
  const a=await createMonteCarlo(d),b=await createMonteCarlo(other);a.step(300);b.step(300);
  for(const r of a.checkpoint().records)assert.deepEqual(r,b.checkpoint().records.find(x=>x.id===r.id));
});
test('trial-count-only changes permit continuation; input, seed, condition and mode changes reject',async()=>{
  const d=division(),session=await createMonteCarlo(d);session.step(10);const cp=session.checkpoint();
  const counts=structuredClone(d);counts.simulation.trials=12;assert.equal(simulationFingerprint(d),simulationFingerprint(counts));assert(await createMonteCarlo(counts,cp));
  for(const mutate of [d=>d.simulation.seed+='x',d=>d.cases.reverse(),d=>d.cases[0].conditions[0].mode='lose',d=>d.explorationMode='battles',d=>d.baseline.asOf='2026-11-08']){
    const changed=structuredClone(d);mutate(changed);await assert.rejects(()=>createMonteCarlo(changed,cp),/追加試行/);
  }
  assert.throws(()=>session.step(-1),/試行数/);assert.throws(()=>session.step(1.5),/試行数/);
});
test('empty checkpoints are resumable and render no numerical estimates; corrupt checkpoints rejected',async()=>{
  const d=division(),empty=emptyCheckpoint(d);assert(validateCheckpoint(empty));assert.deepEqual(checkpointResults(empty),[]);
  const session=await createMonteCarlo(d,empty);session.step(100);const cp=session.checkpoint();
  for(const mutate of [x=>x.rngVersion='old',x=>x.ciVersion='unknown',x=>x.nextTrial++,x=>x.completed=NaN,x=>x.fingerprint='invalid',x=>x.records.pop(),x=>x.records[0].lowerRanks[0]='-1',x=>x.records[0].lowerRanks[0]='1',x=>x.records[0].deltaLower[0]='1',x=>x.division.simulation.seed='other',x=>x.records[0].upperRanks=[],x=>x.records[0].poLower[0]='6001']){
    const invalid=structuredClone(cp);mutate(invalid);assert.throws(()=>validateCheckpoint(invalid),/再開データ/);
  }
  const bad=structuredClone(empty);bad.records[0].unresolved[0]='1';assert.throws(()=>validateCheckpoint(bad),/再開データ/);
});
test('same no-match input equals exact ranking/tie contributions in all modes',async()=>{
  for(const mode of ['points','battles','rounds']){
    const d=closeOut(division(mode),1),m=remaining(d)[0];d.results[m.id]={homePoints:40,awayPoints:0,homeBattleDiffDelta:7,homeRoundDiffDelta:14};
    const session=await createMonteCarlo(d);session.step(23);const cp=session.checkpoint(),estimates=checkpointResults(cp);
    for(let index=0;index<estimates.length;index++){
      const exact=calculate(prepare(d,[BASE_CASE,...d.cases][index])),a=boundsOf(exact),b=boundsOf(estimates[index]);
      for(const field of ['lower','upper'])for(let i=0;i<6;i++)for(let j=0;j<6;j++)assert.equal(BigInt(a[field][i][j])*BigInt(estimates[index].denominator),BigInt(b[field][i][j])*BigInt(exact.denominator));
    }
    assert(validateCheckpoint(cp));
  }
});
test('small exact cases agree with seeded Monte Carlo estimates; conditions remain directly sampled',async()=>{
  for(const mode of ['points','battles','rounds']){
    const d=closeOut(division(mode),2),session=await createMonteCarlo(d);session.step(12000);
    const results=checkpointResults(session.checkpoint());
    for(let c=0;c<results.length;c++){
      const exact=calculate(prepare(d,[BASE_CASE,...d.cases][c])),a=boundsOf(exact),b=boundsOf(results[c]);
      for(const f of ['poLower','poUpper'])for(let i=0;i<6;i++){
        const truth=Number(BigInt(a[f][i]))/Number(BigInt(exact.denominator)),estimate=Number(BigInt(b[f][i]))/Number(BigInt(results[c].denominator));
        assert(Math.abs(estimate-truth)<.04,`${mode}/${c}/${i}/${f}`);
      }
    }
  }
});
test('time-uniform Hoeffding formula covers fractional contributions, zero observations and paired [-1,1] differences',()=>{
  assert.equal(confidenceInterval('0',0),null);
  const N=100000,c=confidenceInterval('0',N),one=confidenceInterval(String(BigInt(N)*60n),N);
  assert.equal(c.lower,0);assert(c.upper>0);assert(one.lower<1);assert.equal(one.upper,1);
  const expected=Math.sqrt(Math.log(40*N*(N+1))/(2*N));assert(Math.abs(c.radius-expected)<1e-15);
  const paired=confidenceInterval('0',N,{difference:true});assert.equal(paired.radius,2*c.radius);assert(paired.lower<0&&paired.upper>0);
  assert(confidenceInterval('20',1).upper<=1);assert.equal(confidenceInterval('20',1).mean,1/3);
  assert(confidenceInterval('0',N).radius<confidenceInterval('0',1000).radius);
  assert.deepEqual([confidenceInterval('0',1,{difference:true}).lower,confidenceInterval('0',1,{difference:true}).upper],[-1,1]);
});
test('Monte Carlo UI distinguishes no observations, certainty, tie bounds and statistical error; seed is escaped',async()=>{
  const d=division('rounds');d.simulation.seed='<img src=x onerror=alert(1)>';
  let cp=emptyCheckpoint(d),saved={method:'monteCarlo',input:d,checkpoint:cp,status:'running'};
  assert(renderComparison(saved,d).includes('完了した試行はまだありません'));
  const session=await createMonteCarlo(d);session.step(20);cp=session.checkpoint();saved.checkpoint=cp;
  const html=renderComparison(saved,d);assert(html.includes('個別95%区間'));assert(html.includes('統計的'));assert(html.includes('&lt;img'));assert(!html.includes('<img'));
  assert(estimateText('0',10).includes('観測なし'));assert(!estimateText('0',10).includes('0%'));assert(!estimateText('600',10).includes('100%'));
  const changed=structuredClone(d);changed.simulation.trials++;assert(!renderComparison(saved,changed).includes('変更前の入力'));
  changed.simulation.seed+='x';assert(renderComparison(saved,changed).includes('変更前の入力'));
});
test('settings migrate v1/v2 to v4 with exact default and reject invalid Monte Carlo options',()=>{
  const current=migrateData(raw);assert.equal(current.schemaVersion,4);assert.equal(current.divisions[0].calculationMethod,'exact');assert.equal(current.divisions[0].simulation.trials,100000);
  const v2=structuredClone(current);v2.schemaVersion=2;for(const d of v2.divisions){delete d.calculationMethod;delete d.simulation;}assert.equal(migrateData(v2).schemaVersion,4);
  for(const mutate of [d=>d.calculationMethod='oops',d=>d.simulation.trials=0,d=>d.simulation.trials=.5,d=>d.simulation.trials=Number.MAX_SAFE_INTEGER+1,d=>d.simulation.seed=123,d=>d.simulation.seed='x'.repeat(257)]){const x=structuredClone(current);mutate(x.divisions[0]);assert(validate(x).length);}
});
test('worker cancels only at full paired-trial boundaries and checkpoint resumes identically',async()=>{
  for(const mode of ['points','rounds']){
    const d=division(mode),worker=new Worker(new URL('./helpers/worker-harness.js',import.meta.url));
    try{
      const stopped=await new Promise((resolve,reject)=>{
        let sent=false;const timeout=setTimeout(()=>reject(new Error('worker timeout')),10000);
        worker.on('error',e=>{clearTimeout(timeout);reject(e);});
        worker.on('message',m=>{
          if(m.type==='error'){clearTimeout(timeout);reject(new Error(m.message));}
          if(m.type==='mc-progress'&&!sent){sent=true;worker.postMessage({type:'mc-cancel'});}
          if(m.type==='mc-done'){clearTimeout(timeout);resolve(m);}
        });worker.postMessage({type:'mc-start',division:d,trials:1000000,batchSize:16});
      });
      assert(stopped.stopped);assert(stopped.checkpoint.completed<1000000);assert(validateCheckpoint(stopped.checkpoint));
      const resumed=await createMonteCarlo(d,stopped.checkpoint),direct=await createMonteCarlo(d);resumed.step(37);direct.step(stopped.checkpoint.completed+37);assert.deepEqual(resumed.checkpoint(),direct.checkpoint());
    }finally{await worker.terminate();}
  }
});
test('worker completes exact requested counts and resumes a checkpoint through its real protocol',async()=>{
  const d=division('battles'),worker=new Worker(new URL('./helpers/worker-harness.js',import.meta.url));
  async function send(request){return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{cleanup();reject(new Error('worker timeout'));},10000);
    const error=e=>{cleanup();reject(e);};
    const message=m=>{if(m.type==='error'){cleanup();reject(new Error(m.message));}if(m.type==='mc-done'){cleanup();resolve(m);}};
    function cleanup(){clearTimeout(timeout);worker.off('message',message);worker.off('error',error);}
    worker.on('message',message);worker.on('error',error);worker.postMessage(request);
  });}
  try{
    const first=await send({type:'mc-start',division:d,trials:257,batchSize:101});assert.equal(first.checkpoint.completed,257);assert.equal(first.stopped,false);assert(validateCheckpoint(first.checkpoint));
    const next=await send({type:'mc-start',division:d,trials:311,batchSize:33,checkpoint:first.checkpoint});assert.equal(next.checkpoint.completed,568);
    const direct=await createMonteCarlo(d);direct.step(568);assert.deepEqual(next.checkpoint,direct.checkpoint());
  }finally{await worker.terminate();}
});
