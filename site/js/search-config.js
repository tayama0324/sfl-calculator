export const SEARCH_GOALS={po:'PO進出（3位以内）',first:'1位通過（本節1位）'};
export function defaultSearchConfig(d){return {targetTeamId:d.teams[0].id,goal:'po',mode:'rounds',caseId:'@normal'};}
export function searchConfigErrors(d,c){
  if(!c||!d.teams.some(t=>t.id===c.targetTeamId)||!Object.hasOwn(SEARCH_GOALS,c.goal)||!['points','battles','rounds'].includes(c.mode)||c.caseId!=='@normal'&&!d.cases?.some(x=>x.id===c.caseId))return ['条件探索のチーム・目標・順位判定・前提が不正です。'];
  return [];
}
