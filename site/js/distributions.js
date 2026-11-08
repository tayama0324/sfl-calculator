// Exact joint team-match distributions. Scores, battle differences and round
// differences are derived together; they are never sampled independently.
export const MODEL_VERSION = 'fair-independent-v1';
const cache = new Map();
export function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
function choose(n, k) {
  let result = 1n;
  for (let i = 1; i <= k; i++) result = result * BigInt(n - i + 1) / BigInt(i);
  return result;
}
export function playerDistribution(target, mode) {
  const maxBattles = 2 * target - 1;
  const denominator = 1n << BigInt(maxBattles * (mode === 'rounds' ? 2 : 1));
  const outcomes = [];
  for (let lost = 0; lost < target; lost++) for (const homeWins of [true, false]) {
    const h = homeWins ? target : lost, a = homeWins ? lost : target;
    const battles = h + a;
    const sequences = choose(battles - 1, lost);
    if (mode === 'rounds') {
      for (let extra = 0; extra <= battles; extra++) outcomes.push({
        homeWins, battleDiff: h - a, roundDiff: h - 2 * a + extra,
        weight: sequences * choose(battles, extra) * (1n << BigInt(2 * (maxBattles - battles))),
      });
    } else outcomes.push({ homeWins, battleDiff: h - a, roundDiff: 0, weight: sequences * (1n << BigInt(maxBattles - battles)) });
  }
  return { denominator, outcomes };
}
function add(map, hp, ap, b, r, weight, example, player=null) {
  const key = `${hp},${ap},${b},${r}`;
  const old = map.get(key);
  if (old) old.weight += weight;
  else map.set(key, { homePoints: hp, awayPoints: ap, battleDiff: b, roundDiff: r, weight, example:player?[...example,player]:example });
}
export function matchDistribution(mode) {
  if (!['battles', 'rounds'].includes(mode)) throw new Error('詳細探索モードが不正です。');
  if (cache.has(mode)) return cache.get(mode);
  const ft2 = playerDistribution(2, mode), ft3 = playerDistribution(3, mode);
  let states = new Map([['0,0,0,0', { homePoints: 0, awayPoints: 0, battleDiff: 0, roundDiff: 0, weight: 1n,example:[] }]]);
  for (let position = 0; position < 4; position++) {
    const player = position === 2 ? ft3 : ft2;
    const points = position === 2 ? 20 : 10;
    const next = new Map();
    for (const s of states.values()) {
      if (position === 3 && s.homePoints !== s.awayPoints) {
        add(next, s.homePoints, s.awayPoints, s.battleDiff, s.roundDiff, s.weight * player.denominator,s.example);
        continue;
      }
      for (const o of player.outcomes) add(next,
        s.homePoints + (o.homeWins ? points : 0), s.awayPoints + (o.homeWins ? 0 : points),
        s.battleDiff + o.battleDiff, s.roundDiff + o.roundDiff, s.weight * o.weight,s.example,{target:position===2?3:2,homeBattles:o.homeWins?(position===2?3:2):(position===2?3:2)+o.battleDiff,awayBattles:o.homeWins?(position===2?3:2)-o.battleDiff:(position===2?3:2),roundDiff:mode==='rounds'?o.roundDiff:null});
    }
    states = next;
  }
  const result = { denominator: ft2.denominator ** 3n * ft3.denominator, outcomes: [...states.values()] };
  cache.set(mode, result);
  return result;
}
export function playerExample(p){
  const {homeBattles:h,awayBattles:a}=p;
  if(p.roundDiff===null)return {...p,roundScores:null};
  const winners=h>a?[...Array(a).fill(false),...Array(h).fill(true)]:[...Array(h).fill(true),...Array(a).fill(false)];
  let extra=p.roundDiff-(h-2*a);
  const roundScores=winners.map(home=>{const bit=extra>0?1:0;extra-=bit;return home?(bit?[2,0]:[2,1]):(bit?[1,2]:[0,2]);});
  if(extra!==0)throw new Error('ラウンドの代表例が成立しません。');
  return {...p,roundScores};
}
export function conditionedOutcomes(mode, allowed) {
  const set = new Set(allowed);
  const rows = matchDistribution(mode).outcomes.filter(o => set.has(`${o.homePoints}-${o.awayPoints}`));
  const divisor = rows.reduce((g, o) => gcd(g, o.weight), 0n);
  if (!rows.length) throw new Error('許容スコアがありません。');
  // Dividing all weights by their GCD preserves the conditional distribution.
  return rows.map(o => [o.homePoints, o.awayPoints, String(o.weight / divisor), o.battleDiff, o.roundDiff]);
}
