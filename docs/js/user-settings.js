import {migrateData,remaining,validate} from './model.js';
import {rulesFor,setMatchRules,clearMatchRules} from './match-assumptions.js';
import {searchConfigErrors,defaultSearchConfig} from './search-config.js';
const fixtureIdentity=m=>({homeTeamId:m.homeTeamId,awayTeamId:m.awayTeamId,round:m.round});
export function userSettings(data){
  return {kind:'sfl-user-settings',version:1,season:data.season,conditionSearch:structuredClone(data.conditionSearch),divisions:data.divisions.map(d=>{
    const matches=remaining(d).filter(m=>rulesFor(d,m.id).length);
    return {id:d.id,explorationMode:d.explorationMode,calculationMethod:d.calculationMethod,simulation:structuredClone(d.simulation),matchAssumptions:Object.fromEntries(matches.map(m=>[m.id,structuredClone(rulesFor(d,m.id))])),assumptionFixtures:Object.fromEntries(matches.map(m=>[m.id,fixtureIdentity(m)]))};
  })};
}
// The published teams, fixtures, baseline and recorded results always win.
// Saved JSON (including old full exports) supplies only editable preferences.
export function applyUserSettings(published,value){
  const settings=value.kind==='sfl-user-settings'?value:userSettings(migrateData(value));
  if(settings.version!==1||!Array.isArray(settings.divisions)||new Set(settings.divisions.map(d=>d.id)).size!==settings.divisions.length)throw new Error('保存設定の形式が不正です。');
  const data=structuredClone(published);let removed=0;
  if(settings.season!==undefined&&settings.season!==data.season)return {data,removed:0,seasonChanged:true};
  for(const d of data.divisions){
    const saved=settings.divisions.find(s=>s.id===d.id);if(!saved)continue;
    for(const field of ['explorationMode','calculationMethod','simulation'])if(saved[field]!==undefined)d[field]=structuredClone(saved[field]);
    clearMatchRules(d);
    if(!saved.matchAssumptions||typeof saved.matchAssumptions!=='object'||Array.isArray(saved.matchAssumptions))throw new Error('保存された仮定の形式が不正です。');
    const future=new Map(remaining(d).map(m=>[m.id,m]));
    for(const [id,rules]of Object.entries(saved.matchAssumptions)){
      const m=future.get(id),identity=saved.assumptionFixtures?.[id];
      if(!m||!identity||identity.homeTeamId!==m.homeTeamId||identity.awayTeamId!==m.awayTeamId||identity.round!==m.round){removed++;continue;}
      setMatchRules(d,id,rules);
    }
    const config=settings.conditionSearch?.[d.id];
    if(config){const normalized={...config,caseId:'@input'};data.conditionSearch[d.id]=searchConfigErrors(d,normalized).length?defaultSearchConfig(d):normalized;}
  }
  const errors=validate(data);if(errors.length)throw new Error(errors.join('\n'));
  return {data,removed,seasonChanged:false};
}
