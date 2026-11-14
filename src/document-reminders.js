import {agreementRequest} from '../agreement-ui.mjs';
export function mountDocumentReminders(container,{kind,id,status}) {
 const existing=container.querySelector('[data-document-reminders]');
 if(existing?.dataset.kind===kind && existing.dataset.id===id && existing.dataset.status===status)return;
 container.querySelector('[data-document-reminders]')?.remove();
 if(!id || status==='Draft'){
  if(kind==='form'){
   const hint=document.createElement('p');hint.dataset.documentReminders='';
   hint.textContent='To schedule reminders, share this form in the Client Hub, then open its saved record.';
   container.querySelector('form')?.before(hint);
  }
  return;
 }
 const panel=document.createElement(kind==='hub'?'section':'details');panel.className='agreement-panel';panel.dataset.documentReminders='';
 panel.dataset.kind=kind;panel.dataset.id=id;panel.dataset.status=status;
 panel.innerHTML=kind==='hub'
  ? '<h3>Client Hub expiration reminders</h3><p>Each reminder sends an email and a notice in this Client Hub. Reminders stop if the link is archived, revoked, deleted, or expired. Scheduling reminders does not change the link expiration.</p>'
  : '<summary>Reminders</summary><p>Send an email and a Client Hub notice. Reminders stop when the document is completed, paid, replaced, or access expires. Share the document in the Client Hub first.</p>';
 const feedback=document.createElement('p');feedback.setAttribute('role','status');
 const list=document.createElement('div');
 const request=async(body)=>agreementRequest(`/api/hmp-document-reminders?kind=${kind}&id=${id}`,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,id,...body})}:{});
 const render=(rows)=>{
  list.replaceChildren();
  if(!rows.length)list.textContent='No reminders scheduled.';
  for(const row of rows){
   const state=row.status==='pending'?(row.claimed_at?'Processing or retrying':'Scheduled — waiting for this time'):row.status;
   const item=document.createElement('p');item.textContent=`${new Date(row.due_at).toLocaleString()} · ${state}${row.detail?` — ${row.detail}`:''}`;
   if(row.status==='pending'&&!row.claimed_at){const cancel=document.createElement('button');cancel.type='button';cancel.className='agreement-button secondary';cancel.textContent='Cancel reminder';cancel.onclick=async()=>{cancel.disabled=true;try{render((await request({action:'cancel',reminderId:row.id})).reminders);feedback.textContent='Reminder cancelled.';}catch(e){feedback.textContent=e.message;cancel.disabled=false;}};item.append(' ',cancel);}
   list.append(item);
  }
 };
 if(['Sent','Partially paid'].includes(status)){
  const form=document.createElement('form');form.className='agreement-grid';
  form.innerHTML='<label class="agreement-field">First reminder date and time <input name="first" type="datetime-local" required></label><label class="agreement-field">Number of reminders <input name="count" type="number" min="1" max="12" value="1" required></label><label class="agreement-field">Repeat every (days, for multiple reminders) <input name="days" type="number" min="1" max="90" value="7" required></label><button class="agreement-button" type="submit">Schedule reminders</button>';
  const zone=document.createElement('p');zone.textContent=`Dates use your device timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone}). Schedule 1–12 reminders within the next year and before the link expires. Reminders run shortly after the chosen time.`;
  form.onsubmit=async e=>{e.preventDefault();e.stopPropagation();const button=form.querySelector('button');button.disabled=true;feedback.textContent='Saving reminder schedule…';try{const values=new FormData(form);const data=await request({action:'schedule',first:new Date(values.get('first')).toISOString(),count:Number(values.get('count')),days:Number(values.get('days'))});render(data.reminders);feedback.textContent='Reminders scheduled. Nothing was sent now.';}catch(error){feedback.textContent=error.message;}finally{button.disabled=false;}};
  panel.append(zone,form);
 }
 const refresh=document.createElement('button');refresh.type='button';refresh.className='agreement-button secondary';refresh.textContent='Refresh reminders';
 const load=async()=>{try{render((await request()).reminders);}catch(e){feedback.textContent=e.message;}};refresh.onclick=load;
 panel.append(refresh,feedback,list);
 const form=container.querySelector('form');if(form)form.before(panel);else container.append(panel);
 load();
}
