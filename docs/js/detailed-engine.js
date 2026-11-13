import {pointBorders,recordPointBorder} from './point-borders.js';
// Bounded-memory exact enumeration of joint score states. A subtree is summed
// without enumeration only when interval bounds prove every pair's ordering.
export function calculateDetailed(input, onProgress = () => {}) {
  const { mode, teamIds, matches } = input;
  const borders=pointBorders();
  const dimensions = mode === 'rounds' ? 3 : 2;
  const values = [input.points, input.battleDiffs, ...(dimensions === 3 ? [input.roundDiffs] : [])].map(a => [...a]);
  if (!['battles', 'rounds'].includes(mode) || values.some(a => a.length !== 6 || a.some(n => !Number.isSafeInteger(n))) || matches.length > 30) throw new Error('詳細計算の入力が不正です。');
  const games = matches.map(m => {
    if (!Number.isInteger(m.home) || !Number.isInteger(m.away) || m.home < 0 || m.home > 5 || m.away < 0 || m.away > 5 || m.home === m.away || !m.outcomes.length) throw new Error('詳細試合の入力が不正です。');
    return { ...m, outcomes: m.outcomes.map(([h, a, w, b, r]) => {
      const weight = BigInt(w);
      if (![h,a,b,r].every(Number.isSafeInteger) || weight <= 0n) throw new Error('詳細結果の入力が不正です。');
      return { h, a, b, r, weight };
    }) };
  });
  const suffixWeights = Array(games.length + 1).fill(1n), suffixPaths = Array(games.length + 1).fill(1n);
  const minimum = Array.from({length: games.length + 1}, () => Array.from({length:dimensions}, () => Array(6).fill(0)));
  const maximum = structuredClone(minimum);
  for (let d = games.length - 1; d >= 0; d--) {
    const game = games[d];
    suffixWeights[d] = suffixWeights[d+1] * game.outcomes.reduce((s,o) => s+o.weight, 0n);
    suffixPaths[d] = suffixPaths[d+1] * BigInt(game.outcomes.length);
    for (let dim = 0; dim < dimensions; dim++) {
      minimum[d][dim] = [...minimum[d+1][dim]];
      maximum[d][dim] = [...maximum[d+1][dim]];
      for (const [id, home] of [[game.home,true],[game.away,false]]) {
        const deltas = game.outcomes.map(o => dim === 0 ? (home ? o.h : o.a) : (home ? 1 : -1) * (dim === 1 ? o.b : o.r));
        minimum[d][dim][id] += Math.min(...deltas);
        maximum[d][dim][id] += Math.max(...deltas);
      }
    }
  }
  const lo = Array(36).fill(0n), hi = Array(36).fill(0n);
  const poLo = Array(6).fill(0n), poHi = Array(6).fill(0n), unresolved = Array(6).fill(0n), border = Array(6).fill(0n);
  const greater = new Int8Array(6), ties = new Int8Array(6);
  let processed = 0n, visited = 0n, collapsed = 0n, lastReport = performance.now();
  function report(force = false) {
    if (force || performance.now() - lastReport > 250) {
      onProgress({ processed: String(processed), total: String(suffixPaths[0]), visited: String(visited), collapsed: String(collapsed) });
      lastReport = performance.now();
    }
  }
  function knownOrder(depth) {
    greater.fill(0); ties.fill(1);
    for (let i = 0; i < 6; i++) for (let j = i+1; j < 6; j++) {
      let lowSign = 0, highSign = 0;
      for (let dim = 0; dim < dimensions; dim++) {
        const diff = values[dim][i] - values[dim][j];
        const low = diff + minimum[depth][dim][i] - maximum[depth][dim][j];
        const high = diff + maximum[depth][dim][i] - minimum[depth][dim][j];
        if (!lowSign) lowSign = Math.sign(low);
        if (!highSign) highSign = Math.sign(high);
      }
      if (lowSign > 0) greater[j]++;
      else if (highSign < 0) greater[i]++;
      else if (lowSign === 0 && highSign === 0) { ties[i]++; ties[j]++; }
      else return false;
    }
    return true;
  }
  function count(weight,depth) {
    for (let i=0; i<6; i++) {
      const first = greater[i], last = first + ties[i] - 1;
      recordPointBorder(borders,first,last,values[0][i]+minimum[depth][0][i],values[0][i]+maximum[depth][0][i]);
      for (let r=first; r<=last; r++) {
        hi[i*6+r] += weight;
        if (first === last) lo[i*6+r] += weight;
      }
      if (last < 3) poLo[i] += weight;
      if (first < 3) poHi[i] += weight;
      if (ties[i] > 1) unresolved[i] += weight;
      if (first < 3 && last >= 3) border[i] += weight;
    }
  }
  function visit(depth, weight) {
    visited++;
    if (knownOrder(depth)) {
      count(weight * suffixWeights[depth],depth);
      processed += suffixPaths[depth];
      if (depth < games.length) collapsed++;
      report(); return;
    }
    const game = games[depth];
    for (const o of game.outcomes) {
      values[0][game.home] += o.h; values[0][game.away] += o.a;
      values[1][game.home] += o.b; values[1][game.away] -= o.b;
      if (dimensions === 3) { values[2][game.home] += o.r; values[2][game.away] -= o.r; }
      visit(depth+1, weight*o.weight);
      values[0][game.home] -= o.h; values[0][game.away] -= o.a;
      values[1][game.home] -= o.b; values[1][game.away] += o.b;
      if (dimensions === 3) { values[2][game.home] -= o.r; values[2][game.away] += o.r; }
    }
  }
  report(true); visit(0,1n); report(true);
  const matrix = a => Array.from({length:6}, (_,i) => a.slice(i*6,i*6+6).map(String));
  return { kind:'intervals', pointBorders:borders, mode, teamIds, denominator:String(suffixWeights[0]), processed:String(processed), visited:String(visited), collapsed:String(collapsed), lowerRanks:matrix(lo), upperRanks:matrix(hi), poLower:poLo.map(String), poUpper:poHi.map(String), unresolved:unresolved.map(String), borderTies:border.map(String) };
}
