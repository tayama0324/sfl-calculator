// Organize the existing controls without duplicating fields or their handlers.
export function compactLayout(root,{feature,assumptions,baseline,remaining,method}){
  const query=s=>root.querySelector(s),body=query('.condition-body'),panel=query('.condition-panel');
  query('.stats').remove();
  panel.querySelector('.kicker')?.remove();
  panel.querySelector('h2').textContent=feature==='conditions'?'進出条件を調べる':'順位確率を見る';
  panel.querySelector('.section-intro').textContent=feature==='conditions'?'1位・2位以内・PO進出に必要なポイントと試合結果を調べます。':'各チームの1位通過・PO進出・1〜6位の確率を調べます。';
  const fields=document.createElement('div');fields.className='primary-fields';
  fields.append(query('.division-nav'));
  for(const id of ['calculation-method','search-team','search-mode','exploration-mode'])if(query('#'+id))fields.append(query('#'+id).closest('label'));
  body.prepend(fields);
  const premises=document.createElement('details');premises.id='calculation-premises';premises.className='calculation-premises';
  const summary=document.createElement('summary');summary.textContent=`現在の成績・将来の仮定 — 基準日 ${baseline} · 残り${remaining}試合 · ${assumptions?`仮定${assumptions}試合`:'仮定なし'}`;premises.append(summary,query('.team-status-panel'));fields.after(premises);
  if(assumptions){const alert=document.createElement('div');alert.className='active-assumptions';const text=document.createElement('strong');text.textContent=`将来の仮定を${assumptions}試合に適用中`;
    const edit=document.createElement('button');edit.type='button';edit.className='tiny-button';edit.textContent='確認・変更';edit.onclick=()=>{premises.open=true;query('#schedule').open=true;query('#schedule').scrollIntoView({block:'nearest'});};
    const clear=document.createElement('button');clear.type='button';clear.className='tiny-button';clear.textContent='解除';clear.onclick=()=>query('#clear-fixed').click();alert.append(text,edit,clear);premises.before(alert);
  }
  const simulation=query('.simulation-settings');
  if(simulation)fields.append(simulation);
  query('.condition-note')?.remove();
  const cost=query('.cost-estimate');if(cost)fields.after(cost);
  const featureButtons=query('.feature-nav').querySelectorAll('button');
  featureButtons[0].innerHTML='<b>順位確率を見る</b><small>各チームは何位になる？</small>';
  featureButtons[1].innerHTML='<b>進出条件を調べる</b><small>あと何点・どの試合結果が必要？</small>';
  query('.result-panel .kicker')?.remove();
}
