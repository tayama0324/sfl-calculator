import {rulesFor,setMatchRules,ruleErrors,filterRuleOutcomes,ruleText} from './match-assumptions.js';
import { conditionedOutcomes, MODEL_VERSION } from './distributions.js';
import { defaultSearchConfig, searchConfigErrors } from './search-config.js';
export const EXPLORATION_MODES = { points:'ポイントのみ（簡易）', battles:'バトルまで全探索', rounds:'ラウンドまで全探索' };
export const CALCULATION_METHODS = { exact:'厳密全探索', monteCarlo:'モンテカルロ' };
export const rankingLabel = (mode,method='exact') => method === 'monteCarlo' ? EXPLORATION_MODES[mode].replace('全探索','') : EXPLORATION_MODES[mode];
export const CONDITION_MODES = { sweep:'40–0で勝利する', win:'勝利する', lose:'敗北する', swept:'0–40で敗北する' };
export const SCORES = Object.freeze([
  [40, 0, 1], [30, 10, 2], [30, 20, 1],
  [20, 30, 1], [10, 30, 2], [0, 40, 1],
]);
export const MODES = { normal: '通常', win: '残り全勝', lose: '残り全敗', sweep: '残り全40–0', swept: '残り全0–40' };
export function scoreKey(h, a) { return `${h}-${a}`; }
// Possible battle/round differences under an actual score. This is validation of
// real results, not a probability model for future rounds.
const support = new Map();
const playerScores = n => Array.from({ length: n }, (_, lost) => [[n, lost], [lost, n]]).flat();
function buildSupport(position, hp, ap, battle, roundMin, roundMax) {
  if (position === 3 && hp !== ap || position === 4) {
    const key = scoreKey(hp, ap);
    if (!support.has(key)) support.set(key, new Map());
    const battles = support.get(key);
    if (!battles.has(battle)) battles.set(battle, new Set());
    for (let r = roundMin; r <= roundMax; r++) battles.get(battle).add(r);
    return;
  }
  const target = position === 2 ? 3 : 2;
  const points = position === 2 ? 20 : 10;
  for (const [h, a] of playerScores(target)) buildSupport(position + 1, hp + (h > a ? points : 0), ap + (h < a ? points : 0), battle + h - a, roundMin + h - 2 * a, roundMax + 2 * h - a);
}
buildSupport(0, 0, 0, 0, 0, 0);
export function validDifferences(h, a, battle, round) {
  const scores = support.get(scoreKey(h, a));
  if (!scores) return false;
  return [...scores].some(([b, rounds]) => (battle === null || battle === b) && (round === null || rounds.has(round)));
}
export function remaining(division) {
  const done = new Set([...division.baseline.includedMatchIds, ...Object.keys(division.results)]);
  return division.fixtures.filter(m => !done.has(m.id));
}
export function current(division) {
  const rows = structuredClone(division.baseline.standings);
  const byId = new Map(rows.map(t => [t.teamId, t]));
  for (const [id, result] of Object.entries(division.results)) {
    const match = division.fixtures.find(m => m.id === id);
    for (const [teamId, points, sign] of [[match.homeTeamId, result.homePoints, 1], [match.awayTeamId, result.awayPoints, -1]]) {
      const row = byId.get(teamId);
      row.played++;
      row.points += points;
      for (const [field, delta] of [['battleDiff', 'homeBattleDiffDelta'], ['roundDiff', 'homeRoundDiffDelta']]) {
        row[field] = row[field] === null || result[delta] === null ? null : row[field] + sign * result[delta];
      }
    }
  }
  return rows;
}
export const fixedScores = d => d.fixedScores ?? d.scenario.fixedScores;
export function comparisonCases(d) {
  return d.cases ?? [{ id:'case-1', name:'ケース1', conditions:d.scenario.mode === 'normal' ? [] : [{targetTeamId:d.scenario.targetTeamId,mode:d.scenario.mode}] }];
}
export const BASE_CASE = { id:'baseline', name:'基準（チーム条件なし）', conditions:[] };
export function resolveMatch(match, fixed, conditions) {
  let outcomes = SCORES.filter(([h,a]) => fixed[match.id] === undefined || scoreKey(h,a) === fixed[match.id]);
  if (!outcomes.length) throw new Error('試合別固定スコアが不正です。');
  const audit = [], predecessors = fixed[match.id] === undefined ? [] : [{type:'fixed', score:fixed[match.id]}];
  for (let i=0; i<conditions.length; i++) {
    const c = conditions[i];
    if (![match.homeTeamId,match.awayTeamId].includes(c.targetTeamId)) continue;
    const accepted = outcomes.filter(([h,a]) => {
      const [us,them] = match.homeTeamId === c.targetTeamId ? [h,a] : [a,h];
      return c.mode === 'win' ? us>them : c.mode === 'lose' ? us<them : c.mode === 'sweep' ? us===40 : us===0;
    });
    const status = !accepted.length ? 'skipped' : accepted.length === outcomes.length ? 'unchanged' : 'applied';
    audit.push({ conditionIndex:i, status, prioritized:status === 'skipped' ? structuredClone(predecessors) : [] });
    if (accepted.length) { outcomes = accepted; predecessors.push({type:'condition',index:i}); }
  }
  return { outcomes, audit, allowedScores:outcomes.map(([h,a]) => scoreKey(h,a)) };
}
export function candidates(match, scenario) {
  return resolveMatch(match, scenario.fixedScores, scenario.mode === 'normal' ? [] : [scenario]).outcomes;
}
export function prepare(division, caseDefinition = comparisonCases(division)[0] ?? BASE_CASE) {
  const rows = current(division);
  const mode = division.explorationMode ?? 'points';
  const required = mode === 'rounds' ? ['battleDiff','roundDiff'] : mode === 'battles' ? ['battleDiff'] : [];
  const missing = rows.flatMap(t => required.filter(k => t[k] === null).map(k => `${division.teams.find(x => x.id === t.teamId).name}：${k === 'battleDiff' ? 'バトル差' : 'ラウンド差'}`));
  if (missing.length) throw new Error(`現在の集計値を補完してください。${missing.join('、')}`);
  const indexes = new Map(rows.map((t, i) => [t.teamId, i]));
  const resolution = [];
  const matches = remaining(division).map(m => {
    const resolved=assumedMatch(division,m,mode,caseDefinition.conditions);
    resolution.push({ matchId:m.id,round:m.round,homeTeamId:m.homeTeamId,awayTeamId:m.awayTeamId,...resolved,outcomes:undefined });
    const outcomes=resolved.outcomes;
    return { id: m.id, home: indexes.get(m.homeTeamId), away: indexes.get(m.awayTeamId), outcomes };
  });
  return { mode, modelVersion:MODEL_VERSION, teamIds: rows.map(t => t.teamId), points: rows.map(t => t.points), battleDiffs:rows.map(t => t.battleDiff), roundDiffs:rows.map(t => t.roundDiff), matches, resolution };
}
export function assumedMatch(d,m,mode=d.explorationMode,conditions=[]){
  const resolved=resolveMatch(m,fixedScores(d),conditions),rules=rulesFor(d,m.id);
  const modern=(d.matchAssumptions?.[m.id]?.length??0)>0;
  const outcomes=modern?filterRuleOutcomes(mode,resolved,rules):hypotheticalOutcomes(mode,resolved,d.fixedDetails?.[m.id]);
  return {...resolved,outcomes,allowedScores:[...new Set(outcomes.map(([h,a])=>scoreKey(h,a)))],fixedDetails:d.fixedDetails?.[m.id],rules};
}
// Difference constraints condition the joint distribution before projecting to the
// selected ranking mode. Empty optional constraints keep legacy sampling unchanged.
export function hypotheticalOutcomes(mode, resolved, details) {
  const battle = details?.battleDiff ?? null, round = details?.roundDiff ?? null;
  if (mode === 'points') return resolved.outcomes;
  if (battle === null && round === null) return conditionedOutcomes(mode, resolved.allowedScores);
  const sourceMode = round !== null ? 'rounds' : mode;
  const rows = conditionedOutcomes(sourceMode, resolved.allowedScores)
    .filter(([, , , b, r]) => (battle === null || b === battle) && (round === null || r === round));
  if (!rows.length) throw new Error('仮定スコアと得失点差の組み合わせが成立しません。');
  const combined = new Map();
  for (const [h, a, w, b, r] of rows) {
    const key = JSON.stringify([h, a, b, mode === 'rounds' ? r : 0]);
    combined.set(key, (combined.get(key) ?? 0n) + BigInt(w));
  }
  return [...combined].map(([key, weight]) => { const [h,a,b,r] = JSON.parse(key); return [h,a,String(weight),b,r]; });
}
export function migrateData(value) {
  const errors = validate(value);
  if (errors.length) throw new Error(errors.join('\n'));
  const data = structuredClone(value);
  if (data.schemaVersion === 1) {
    for (const d of data.divisions) {
      d.explorationMode = 'points';
      d.cases = comparisonCases(d);
      d.fixedScores = d.scenario.fixedScores;
      delete d.scenario;
    }
    data.schemaVersion = 2;
  }
  if (data.schemaVersion === 2) {
    for (const d of data.divisions) { d.calculationMethod='exact'; d.simulation={trials:100000,seed:''}; }
    data.schemaVersion=3;
  }
  if(data.schemaVersion===3){
    for(const d of data.divisions){
      const ids=new Set([...Object.keys(d.fixedScores),...Object.keys(d.matchAssumptions??{})]);
      for(const id of ids)setMatchRules(d,id,rulesFor(d,id));
      d.matchAssumptions??={};d.fixedScores={};delete d.fixedDetails;
    }
    data.schemaVersion=4;
  }
  if(!data.conditionSearch)data.conditionSearch=Object.fromEntries(data.divisions.map(d=>[d.id,defaultSearchConfig(d)]));
  return data;
}

const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validate(data, singleDivision=false) {
  const errors = [];
  const check = (ok, message) => { if (!ok) errors.push(message); };
  try {
    check([1,2,3,4].includes(data.schemaVersion), 'schemaVersionは1・2・3・4のいずれかが必要です。');
    check(typeof data.title === 'string' && data.title.length <= 150, '大会名が不正です。');
    check(Array.isArray(data.divisions) && data.divisions.length === (singleDivision?1:2), 'ディビジョンの構成が不正です。');
    const allTeamIds = new Set();
    const allMatchIds = new Set();
    const divIds = new Set();
    for (const d of data.divisions) {
      const label = `Division ${d.id}`;
      if(data.conditionSearch!==undefined)check(record(data.conditionSearch)&&searchConfigErrors(d,data.conditionSearch[d.id]).length===0,`${label}：条件探索の設定が不正です。`);
      if (data.schemaVersion>=3) {
        check(Object.hasOwn(CALCULATION_METHODS,d.calculationMethod), `${label}：計算方式が不正です。`);
        check(record(d.simulation) && integer(d.simulation.trials,1,Number.MAX_SAFE_INTEGER) && typeof d.simulation.seed==='string' && d.simulation.seed.length<=256, `${label}：試行回数またはシードが不正です。`);
      }
      check(record(d.results) && (data.schemaVersion === 1 ? record(d.scenario) && record(d.scenario.fixedScores) : record(d.fixedScores)), `${label}：結果・条件・固定スコアの構造が不正です。`);
      check(['S', 'F'].includes(d.id) && !divIds.has(d.id), 'ディビジョンIDはSとFで一意にしてください。');
      divIds.add(d.id);
      check(d.teams.length === 6, `${label}：6チーム必要です。`);
      check(typeof d.baseline.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.baseline.asOf), `${label}：基準日はYYYY-MM-DDで指定してください。`);
      const ids = new Set(d.teams.map(t => t.id));
      check(ids.size === 6, `${label}：チームIDが重複しています。`);
      for (const t of d.teams) {
        check(typeof t.id === 'string' && /^[a-z0-9-]{1,40}$/.test(t.id) && !allTeamIds.has(t.id), 'チームIDが不正または重複しています。');
        allTeamIds.add(t.id);
        check(typeof t.name === 'string' && t.name.length > 0 && t.name.length <= 100, 'チーム名が不正です。');
        check(typeof t.shortName === 'string' && t.shortName.length > 0 && t.shortName.length <= 15, '略称が不正です。');
      }
      check(d.fixtures.length === 30, `${label}：全30試合の日程が必要です。`);
      const matchIds = new Set(d.fixtures.map(m => m.id));
      const pairs = new Set();
      const appearances = new Map();
      const included = new Set(d.baseline.includedMatchIds);
      check(included.size === d.baseline.includedMatchIds.length, `${label}：基準内の試合が重複しています。`);
      for (const id of included) check(matchIds.has(id), `${label}：基準内に未知の試合があります。`);
      for (const m of d.fixtures) {
        check(typeof m.id === 'string' && /^[a-z0-9-]{1,80}$/.test(m.id) && !allMatchIds.has(m.id), '試合IDが不正または重複しています。');
        allMatchIds.add(m.id);
        check(ids.has(m.homeTeamId) && ids.has(m.awayTeamId) && m.homeTeamId !== m.awayTeamId, `${label}：対戦チームが不正です。`);
        check(integer(m.round, 1, 10), `${label}：節は1〜10です。`);
        const key = `${m.homeTeamId}/${m.awayTeamId}`;
        check(!pairs.has(key), `${label}：同じホーム・アウェイの対戦が重複しています。`);
        pairs.add(key);
        for (const id of [m.homeTeamId, m.awayTeamId]) {
          const k = `${m.round}/${id}`;
          check(!appearances.has(k), `${label}：同じ節に同じチームが複数回登場します。`);
          appearances.set(k, true);
        }
      }
      for (let r = 1; r <= 10; r++) check(d.fixtures.filter(m => m.round === r).length === 3, `${label}第${r}節：3試合必要です。`);
      const standings = d.baseline.standings;
      check(standings.length === 6 && new Set(standings.map(t => t.teamId)).size === 6, `${label}：基準順位表は各チーム1行にしてください。`);
      for (const row of standings) {
        check(ids.has(row.teamId), `${label}：順位表のチームが不正です。`);
        const count = d.fixtures.filter(m => included.has(m.id) && [m.homeTeamId, m.awayTeamId].includes(row.teamId)).length;
        check(integer(row.played, 0, 10) && row.played === count, `${label}：消化数と基準内日程が一致しません。`);
        check(integer(row.points, 0, row.played * 40) && row.points % 10 === 0, `${label}：ポイントは消化数に整合する非負の10の倍数にしてください。`);
        check(row.battleDiff === null || integer(row.battleDiff, -9 * row.played, 9 * row.played), `${label}：バトル差が不正です。`);
        check(row.roundDiff === null || integer(row.roundDiff, -60 * row.played, 60 * row.played), `${label}：ラウンド差が不正です。`);
      }
      for (const field of ['battleDiff', 'roundDiff']) if (standings.every(t => t[field] !== null)) check(standings.reduce((s, t) => s + t[field], 0) === 0, `${label}：${field}の合計は0にしてください。`);
      const overtime = (standings.reduce((s, t) => s + t.points, 0) - included.size * 40) / 10;
      check(integer(overtime, 0, included.size), `${label}：ポイント合計が試合数と整合しません。`);
      const resultIds = Object.keys(d.results);
      for (const id of resultIds) {
        const result = d.results[id];
        check(matchIds.has(id) && !included.has(id), `${label}：結果登録対象が不正または基準内と重複しています。`);
        check(SCORES.some(([h, a]) => result.homePoints === h && result.awayPoints === a), `${label}：実結果のスコアが不正です。`);
        check(result.homeBattleDiffDelta === null || integer(result.homeBattleDiffDelta, -9, 9), `${label}：バトル差増分が不正です。`);
        check(result.homeRoundDiffDelta === null || integer(result.homeRoundDiffDelta, -60, 60), `${label}：ラウンド差増分が不正です。`);
        check(validDifferences(result.homePoints, result.awayPoints, result.homeBattleDiffDelta, result.homeRoundDiffDelta), `${label}：スコアとバトル差・ラウンド差の組み合わせが成立しません。`);
      }
      if (data.schemaVersion === 1) {
        check(Object.hasOwn(MODES, d.scenario.mode), `${label}：計算モードが不正です。`);
        check(ids.has(d.scenario.targetTeamId), `${label}：対象チームが不正です。`);
      } else {
        check(Object.hasOwn(EXPLORATION_MODES,d.explorationMode), `${label}：探索モードが不正です。`);
        check(Array.isArray(d.cases), `${label}：比較ケースは配列にしてください。`);
        const caseIds = new Set();
        for (const c of d.cases) {
          check(typeof c.id === 'string' && /^[a-z0-9-]{1,80}$/.test(c.id) && c.id !== 'baseline' && !caseIds.has(c.id), `${label}：ケースIDが不正または重複しています。`);
          caseIds.add(c.id);
          check(typeof c.name === 'string' && c.name.trim().length > 0 && c.name.length <= 80, `${label}：ケース名は1〜80文字で指定してください。`);
          check(Array.isArray(c.conditions), `${label}：ケースの条件は配列にしてください。`);
          for (const condition of c.conditions) {
            check(ids.has(condition.targetTeamId) && Object.hasOwn(CONDITION_MODES,condition.mode), `${label}：シナリオ条件のチームまたは達成条件が不正です。`);
          }
        }
      }
      if(d.matchAssumptions!==undefined){
        check(record(d.matchAssumptions),`${label}：試合条件はオブジェクトにしてください。`);
        for(const [id,rules]of Object.entries(d.matchAssumptions)){
          check(matchIds.has(id)&&!included.has(id)&&!resultIds.includes(id),`${label}：条件は未消化試合に指定してください。`);
          const errors=ruleErrors(rules);for(const error of errors)check(false,`${label}：${id} ${error}`);
          if(!errors.length&&matchIds.has(id))try{assumedMatch(d,d.fixtures.find(m=>m.id===id),'rounds');}catch(error){check(false,`${label}：${id} ${error.message} 条件：${rules.map(r=>ruleText(r)).join(' かつ ')}`);}
        }
      }
      if (d.fixedDetails !== undefined) {
        check(record(d.fixedDetails), `${label}：仮定の得失点差の構造が不正です。`);
        for (const [id, details] of Object.entries(d.fixedDetails)) {
          check(Object.hasOwn(fixedScores(d), id), `${label}：得失点差の仮定にはスコアを指定してください。`);
          const b = details.battleDiff, r = details.roundDiff;
          check(b === null || integer(b,-9,9), `${label}：仮定のバトル差が不正です。`);
          check(r === null || integer(r,-60,60), `${label}：仮定のラウンド差が不正です。`);
          const [h,a] = String(fixedScores(d)[id]).split('-').map(Number);
          check(validDifferences(h,a,b,r), `${label}：仮定スコアとバトル差・ラウンド差の組み合わせが成立しません。`);
        }
      }
      for (const [id, score] of Object.entries(fixedScores(d))) {
        check(matchIds.has(id) && !included.has(id) && !resultIds.includes(id), `${label}：仮定は未消化試合に指定してください。`);
        check(SCORES.some(([h, a]) => scoreKey(h, a) === score), `${label}：仮定のスコアが不正です。`);
      }
    }
  } catch { errors.push('データ構造が不正です。標準JSONの形式を確認してください。'); }
  return [...new Set(errors)];
}

export function verifyFractions(result) {
  if (result.kind === 'intervals') return verifyIntervals(result);
  const denominator = BigInt(result.denominator);
  const ranks = result.ranks.map(row => row.map(BigInt));
  const sum = xs => xs.reduce((a, b) => a + b, 0n);
  const rows = ranks.every(row => sum(row) === denominator);
  const columns = Array.from({ length: 6 }, (_, r) => sum(ranks.map(row => row[r])) === denominator).every(Boolean);
  const po = sum(ranks.map(row => sum(row.slice(0, 3)))) === 3n * denominator;
  return { rows, columns, po, ok: rows && columns && po };
}
export function boundsOf(result) {
  if (result.kind === 'intervals') return { lower:result.lowerRanks, upper:result.upperRanks, poLower:result.poLower, poUpper:result.poUpper };
  const po = result.ranks.map(row => String(row.slice(0,3).reduce((s,n) => s+BigInt(n),0n)));
  return { lower:result.ranks, upper:result.ranks, poLower:po, poUpper:po };
}
function verifyIntervals(r) {
  try {
    const d = BigInt(r.denominator), sum = a => a.reduce((s,n) => s+BigInt(n),0n);
    const valid = (l,u) => BigInt(l)>=0n && BigInt(l)<=BigInt(u) && BigInt(u)<=d;
    const shape = r.lowerRanks.length===6 && r.upperRanks.length===6 && [r.poLower,r.poUpper,r.unresolved,r.borderTies].every(a=>a.length===6);
    if (!shape || d<=0n) return {ok:false};
    const rows = r.lowerRanks.every((row,i) => row.length===6 && r.upperRanks[i].length===6 && row.every((n,j)=>valid(n,r.upperRanks[i][j])) && sum(row)===d-BigInt(r.unresolved[i]) && sum(r.upperRanks[i])>=d);
    const columns = Array.from({length:6},(_,j)=>sum(r.lowerRanks.map(row=>row[j]))<=d && sum(r.upperRanks.map(row=>row[j]))>=d).every(Boolean);
    const po = r.poLower.every((n,i)=>valid(n,r.poUpper[i]) && valid(r.borderTies[i],r.unresolved[i]) && BigInt(r.unresolved[i])<=d && BigInt(r.poUpper[i])-BigInt(n)===BigInt(r.borderTies[i])) && sum(r.poLower)<=3n*d && sum(r.poUpper)>=3n*d;
    return {rows,columns,po,ok:rows&&columns&&po};
  } catch { return {ok:false}; }
}
export function formatRange(lower,upper,denominator) {
  return lower === upper || BigInt(lower) === BigInt(upper) ? formatPercent(lower,denominator) : `${formatPercent(lower,denominator)} ～ ${formatPercent(upper,denominator)}`;
}
function signedDelta(n,d) {
  if (n===0n) return '0ポイント';
  return `${n>0n?'+':'−'}${formatPercent(n<0n?-n:n,d).replace(/%$/,'')}ポイント`;
}
export function formatDifference(result,baseline,index) {
  const a=boundsOf(result), b=boundsOf(baseline), ad=BigInt(result.denominator), bd=BigInt(baseline.denominator);
  const lower=BigInt(a.poLower[index])*bd-BigInt(b.poUpper[index])*ad;
  const upper=BigInt(a.poUpper[index])*bd-BigInt(b.poLower[index])*ad;
  return lower===upper ? signedDelta(lower,ad*bd) : `${signedDelta(lower,ad*bd)} ～ ${signedDelta(upper,ad*bd)}`;
}

export function formatPercent(numerator, denominator, digits = 6) {
  const n = BigInt(numerator) * 100n;
  const d = BigInt(denominator);
  if (!n) return '0%';
  if (n === d * 100n) return '100%';
  const scale = 10n ** BigInt(digits);
  const rounded = (n * scale + d / 2n) / d;
  if (rounded > 0n) {
    // Never round a positive non-certainty to 100%.
    if (rounded === 100n * scale && n !== d * 100n) return `99.${'9'.repeat(digits)}…%`;
    return `${rounded / scale}.${String(rounded % scale).padStart(digits, '0').replace(/0+$/, '') || '0'}%`;
  }
  return formatScientific(n, d, digits);
}
function formatScientific(n, d, digits) {
  // Leading significant digits are enough for display; exact fraction is retained separately.
  const ns = n.toString(), ds = d.toString();
  const ratio = Number(ns.slice(0, 15)) / Number(ds.slice(0, 15));
  const power = ns.length - ds.length - (Math.min(ns.length, 15) - Math.min(ds.length, 15));
  return `${ratio.toExponential(digits).replace(/e([+-]?\d+)/, (_, e) => `e${Number(e) + power >= 0 ? '+' : ''}${Number(e) + power}`)}%`;
}
