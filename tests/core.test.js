import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SCORES, candidates, prepare, remaining, current, validate, verifyFractions, formatPercent, validDifferences } from '../docs/js/model.js';
import { calculate } from '../docs/js/engine.js';

const initial = JSON.parse(await readFile(new URL('../docs/data/default.json', import.meta.url)));
const clone = () => structuredClone(initial);
const baseInput = (points = [0,0,0,0,0,0], matches = []) => ({ points, matches, teamIds: ['a','b','c','d','e','f'] });
const match = (home, away, outcomes = SCORES) => ({ home, away, outcomes });
test('initial fixtures: 60 unique home/away matches; baseline and differences reconcile', () => {
  assert.deepEqual(validate(initial), []);
  assert.equal(remaining(initial.divisions[0]).length, 6);
  assert.equal(remaining(initial.divisions[1]).length, 9);
  for (const d of initial.divisions) for (const t of d.teams) {
    assert.equal(d.fixtures.filter(m => m.homeTeamId === t.id).length, 5);
    assert.equal(d.fixtures.filter(m => m.awayTeamId === t.id).length, 5);
  }
});
test('no remaining matches; exact deterministic ranking and all-team tie', () => {
  const deterministic = calculate(baseInput([60,50,40,30,20,10]));
  assert(verifyFractions(deterministic).ok);
  deterministic.ranks.forEach((row,i) => row.forEach((n,j) => assert.equal(BigInt(n), i === j ? 60n : 0n)));
  const tied = calculate(baseInput());
  for (const row of tied.ranks) assert.deepEqual(row, Array(6).fill('10'));
  assert(verifyFractions(tied).ok);
});
test('tie spanning second to fourth gets 1/3 per place and PO 2/3', () => {
  const r = calculate(baseInput([100,80,80,80,20,0]));
  for (let i = 1; i < 4; i++) assert.deepEqual(r.ranks[i], ['0','20','20','20','0','0']);
  assert(verifyFractions(r).ok);
});
test('one-match weights are 1,2,1,1,2,1 and both sides are coupled', () => {
  // A and B begin at 0. Anchors 35,25,15,5 make the score outcomes observable.
  const r = calculate(baseInput([0,0,35,25,15,5], [match(0,1)]));
  assert.equal(r.denominator, '480');
  assert.deepEqual(r.ranks[0], ['60','180','0','60','120','60']);
  assert.deepEqual(r.ranks[0], r.ranks[1]);
  assert(verifyFractions(r).ok);
});
test('win/lose conditions use conditional weights, home and away orientations agree', () => {
  const home = { homeTeamId: 'a', awayTeamId: 'b', id: 'm' };
  const away = { homeTeamId: 'b', awayTeamId: 'a', id: 'm' };
  for (const m of [home,away]) {
    const scenario = { mode: 'win', targetTeamId: 'a', fixedScores: {} };
    const outcomes = candidates(m,scenario);
    assert.deepEqual(outcomes.map(o => o[2]), [1,2,1]);
    assert.equal(outcomes.reduce((n,o) => n+o[2],0),4);
    assert(outcomes.every(([h,a]) => m === home ? h>a : a>h));
    const result = calculate(baseInput([0,0,35,25,15,5],[match(0,1,outcomes)]));
    assert.equal(result.denominator,'240');
    assert(verifyFractions(result).ok);
  }
});
test('conditions do not affect unrelated matches; fixed scores override conflicting conditions', () => {
  const d = clone().divisions[0];
  d.scenario.mode = 'sweep';
  const p = prepare(d);
  for (const m of p.matches) {
    const involves = [p.teamIds[m.home],p.teamIds[m.away]].includes(d.scenario.targetTeamId);
    assert.equal(m.outcomes.length, involves ? 1 : 6);
  }
  const m = remaining(d).find(m => m.homeTeamId === 'zet' || m.awayTeamId === 'zet');
  d.scenario.fixedScores[m.id] = m.homeTeamId === 'zet' ? '0-40' : '40-0';
  const resolved=prepare(d);
  assert.equal(resolved.resolution.find(x=>x.matchId===m.id).audit[0].status,'skipped');
  assert.equal(resolved.matches.find(x=>x.id===m.id).outcomes.length,1);
});
test('real results recompute without double addition; unknown differences stay unknown', () => {
  const data = clone(), d = data.divisions[0], m = remaining(d)[0];
  const old = current(d).find(t => t.teamId === m.homeTeamId);
  d.results[m.id] = { homePoints:40, awayPoints:0, homeBattleDiffDelta:null, homeRoundDiffDelta:null };
  assert.deepEqual(validate(data),[]);
  let row = current(d).find(t => t.teamId === m.homeTeamId);
  assert.equal(row.points,old.points+40); assert.equal(row.battleDiff,null);
  d.results[m.id].homePoints=30; d.results[m.id].awayPoints=10;
  row = current(d).find(t => t.teamId === m.homeTeamId);
  assert.equal(row.points,old.points+30);
  delete d.results[m.id];
  assert.deepEqual(current(d).find(t => t.teamId === m.homeTeamId),old);
});
test('invalid data rejected: schedule duplicate, inconsistent baseline, invalid score, real/fixed overlap', () => {
  for (const mutate of [
    d => d.fixtures[1] = { ...d.fixtures[0] },
    d => d.baseline.standings[0].points += 1,
    d => d.baseline.standings[0].played--,
    d => d.baseline.standings[0].battleDiff++,
    d => { const m=remaining(d)[0]; d.results[m.id]={homePoints:20,awayPoints:20,homeBattleDiffDelta:null,homeRoundDiffDelta:null}; },
    d => { const m=remaining(d)[0]; d.results[m.id]={homePoints:40,awayPoints:0,homeBattleDiffDelta:0,homeRoundDiffDelta:null}; },
    d => { const m=remaining(d)[0]; d.results[m.id]={homePoints:40,awayPoints:0,homeBattleDiffDelta:null,homeRoundDiffDelta:null}; d.scenario.fixedScores[m.id]='40-0'; },
  ]) { const data=clone(); mutate(data.divisions[0]); assert(validate(data).length>0); }
  assert(validate({}).length>0);
  assert(validate(null).length>0);
});
test('battle and round score validation includes overtime and actual feasible differences', () => {
  assert(validDifferences(40,0,3,null)); assert(validDifferences(40,0,7,14));
  assert(!validDifferences(40,0,8,null)); assert(!validDifferences(40,0,-3,null));
  assert(!validDifferences(40,0,7,-10)); assert(validDifferences(30,20,null,null));
  for (const [h,a] of SCORES) for (let b=-9;b<=9;b++) for (let r=-20;r<=20;r++) assert.equal(validDifferences(h,a,b,r),validDifferences(a,h,-b,-r));
});
test('small case agrees with independent BigInt oracle; team reversal symmetry', () => {
  const matches = [match(0,1),match(2,3),match(0,4)];
  const input=baseInput([30,20,10,20,0,40],matches);
  const out=calculate(input);
  const expected=Array.from({length:6},()=>Array(6).fill(0n));
  for(const a of SCORES) for(const b of SCORES) for(const c of SCORES) {
    const points=[...input.points]; const outcomes=[a,b,c];
    let weight=1n;
    matches.forEach((m,i)=>{points[m.home]+=outcomes[i][0];points[m.away]+=outcomes[i][1];weight*=BigInt(outcomes[i][2]);});
    const groups=[...new Set(points)].sort((a,b)=>b-a); let rank=0;
    for(const value of groups) {
      const ids=points.map((p,i)=>p===value?i:-1).filter(i=>i>=0);
      for(const i of ids) for(let k=rank;k<rank+ids.length;k++) expected[i][k]+=weight*60n/BigInt(ids.length);
      rank+=ids.length;
    }
  }
  assert.deepEqual(out.ranks,expected.map(row=>row.map(String)));
  assert(verifyFractions(out).ok);
  const reverse=calculate({...input,matches:matches.map(m=>match(m.away,m.home))});
  assert.deepEqual(out.ranks,reverse.ranks);
});
test('exact buffer flush works beyond 32768 leaves', () => {
  const r=calculate(baseInput([10,20,30,40,50,60],Array.from({length:6},(_,i)=>match(i,(i+1)%6))));
  assert.equal(r.processed,String(6**6));
  assert(verifyFractions(r).ok);
});
test('all fixed yields one path even when original outcome has weight two', () => {
  const d=clone().divisions[0];
  for(const m of remaining(d)) d.scenario.fixedScores[m.id]='30-10';
  const r=calculate(prepare(d));
  assert.equal(r.processed,'1'); assert(verifyFractions(r).ok);
});
test('format distinguishes exact zero, tiny positives and non-certain near 100%', () => {
  assert.equal(formatPercent(0n,10n),'0%');
  assert.equal(formatPercent(1n,1n),'100%');
  assert.equal(formatPercent(1n,2n),'50.0%');
  assert.equal(formatPercent(1n,10n**20n),'1.000000e-18%');
  assert.notEqual(formatPercent(10n**20n-1n,10n**20n),'100%');
});
