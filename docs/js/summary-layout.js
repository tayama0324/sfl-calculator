import {escape} from './comparison-ui.js';
export function divisionSelection(data){
  return `<section class="division-selection" aria-label="Divisionを選択">${data.divisions.map(d=>`<a class="division-card" href="#division/${d.id}"><h1>Division ${escape(d.id)}</h1><ul>${d.teams.map(t=>`<li>${escape(t.name)}</li>`).join('')}</ul><span>順位確率を見る →</span></a>`).join('')}</section>`;
}
export function summaryLayout(root,{page,d,targetId}){
  root.querySelector('.feature-nav').remove();root.querySelector('.division-nav').remove();
  const panel=root.querySelector('.condition-panel'),result=root.querySelector('.result-panel'),layout=root.querySelector('.layout');
  const target=d.teams.find(t=>t.id===targetId);
  const header=document.createElement('header');header.className='summary-heading';header.innerHTML=`<nav aria-label="階層"><a href="#">Division選択</a>${page==='team'?`<span>›</span><a href="#division/${d.id}">Division ${escape(d.id)}</a>`:''}</nav><h1>${page==='team'?escape(target.name):`Division ${escape(d.id)}`}</h1><p>${page==='team'?'1位・2位以内・PO進出に必要な成績':`各チームの順位確率 · 基準日 ${escape(d.baseline.asOf)}`}</p>`;root.prepend(header);
  if(page==='team'){root.querySelector('#search-team').closest('label').remove();header.querySelector('p').remove();}
  panel.querySelector('h2').textContent='計算条件・将来の仮定';
  panel.querySelector('.section-intro')?.remove();
  const run=panel.querySelector('.run-area');run.classList.add('summary-run');if(page==='team')result.querySelector('.section-heading').after(run);
  layout.prepend(result);
  const settingsLink=document.createElement('a');settingsLink.href='#calculation-controls';settingsLink.className='settings-shortcut';settingsLink.textContent='計算条件・将来の仮定を変更 ↓';settingsLink.onclick=e=>{e.preventDefault();panel.scrollIntoView({behavior:'smooth',block:'start'});};
  panel.id='calculation-controls';result.querySelector('.section-heading').append(settingsLink);
  if(page==='division'){
    const picker=document.createElement('section');picker.className='summary-team-picker';picker.innerHTML=`<h2>チームの進出条件を調べる</h2><div>${d.teams.map(t=>`<a href="#division/${d.id}/team/${t.id}"><b>${escape(t.shortName)}</b><span>進出条件を見る →</span></a>`).join('')}</div>`;result.after(picker);
  }
}
// Link names inside all chart/table variants without changing numerical markup.
export function linkSummaryTeams(root,d){
  for(const el of root.querySelectorAll('.chart-row>b,.chart-rank-team>b,td.team-name')){
    const t=d.teams.find(t=>t.shortName===el.textContent.trim()||t.name===el.textContent.trim());
    if(!t||el.querySelector('a'))continue;
    const a=document.createElement('a');a.href=`#division/${d.id}/team/${t.id}`;a.className='team-summary-link';a.textContent=el.textContent;a.title=`${t.name}の進出条件を見る`;a.setAttribute('aria-label',`${t.name}の進出条件を見る`);const arrow=document.createElement('span');arrow.className='team-link-arrow';arrow.textContent=' →';arrow.setAttribute('aria-hidden','true');a.append(arrow);el.replaceChildren(a);
  }
}

// Apply after every result update, including worker progress renders.
export function simplifyResultPresentation(root){
  const content=root.querySelector('#result-content');
  root.querySelector('#export-result')?.setAttribute('hidden','');
  content.querySelectorAll('.tag.stale').forEach(el=>el.remove());
  root.querySelector('.result-panel>.section-heading .mc-method')?.remove();
  const marker=content.querySelector('.mc-method');
  if(marker)root.querySelector('.result-panel>.section-heading h2').append(marker);
  for(const selector of ['.simulation-details','.chart-help']){
    const detail=content.querySelector(selector);
    if(detail)content.append(detail);
  }
}
