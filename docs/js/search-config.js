export const SEARCH_GOALS={po:'PO進出（3位以内）',first:'1位通過（本節1位）',second:'2位以内',all:'1位通過・2位以内・PO進出',both:'1位通過・PO進出'};
export function defaultSearchConfig(d){return {targetTeamId:d.teams[0].id,goal:'po',mode:'rounds',caseId:'@normal'};}
export function searchConfigErrors(d,c){
  if(!c||!d.teams.some(t=>t.id===c.targetTeamId)||!Object.hasOwn(SEARCH_GOALS,c.goal)||!['points','battles','rounds'].includes(c.mode)||!['@normal','@input'].includes(c.caseId)&&!d.cases?.some(x=>x.id===c.caseId))return ['条件探索のチーム・目標・順位判定・前提が不正です。'];
  return [];
}

export const goalCutoff = goal => ({first:1,second:2,po:3})[goal] ?? 0;
export const searchGoals = goal => goal==='all'?['first','second','po']:goal==='both'?['po','first']:[goal];
