import {exhaustiveCost} from './exhaustive-cost.js';
export const AUTO_LIMIT=100000n;
export const withinAutoLimit=total=>BigInt(total)<=AUTO_LIMIT;
export const MC_PRESETS=[[100000,'高速（10万回）'],[1000000,'標準（100万回）'],[3000000,'高精度（300万回）']];
export const normalizedTrials=n=>MC_PRESETS.some(([count])=>count===n)?n:100000;
export function divisionAutoPlan(d){
  return {explorationMode:'points',calculationMethod:withinAutoLimit(exhaustiveCost(d,'points',1).total)?'exact':'monteCarlo',trials:100000};
}
export function shouldAutoSearch(d,config,saved,fingerprint){
  return !(saved?.status==='done'&&saved.fingerprint===fingerprint)&&withinAutoLimit(exhaustiveCost(d,config.mode,1).total);
}
export function parseSummaryRoute(hash,data){
  const parts=hash.replace(/^#/,'').split('/');
  const d=data.divisions.find(d=>d.id===parts[1]);
  if(parts[0]!=='division'||!d)return {page:'home'};
  if(parts.length===2)return {page:'division',divisionId:d.id};
  if(parts.length===4&&parts[2]==='team'&&d.teams.some(t=>t.id===parts[3]))return {page:'team',divisionId:d.id,teamId:parts[3]};
  return {page:'home'};
}
