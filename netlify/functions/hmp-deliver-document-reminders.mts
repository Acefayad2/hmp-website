import {createClient} from '@supabase/supabase-js';
import {hmpSender,hmpReplyTo} from './_email-contact.mts';
import {Ineligible,reminderContext} from './_document-reminders.mts';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function deliverDocumentReminders(db:any,fetchFn=fetch,contextFn=reminderContext) {
 const key=Netlify.env.get('RESEND_API_KEY'),from=hmpSender();
 if(!key||!from)throw new Error('Reminder email is not configured');
 const {data:rows,error}=await db.rpc('hmp_claim_document_reminders');if(error)throw new Error('Unable to claim reminders');
 let accepted=0;
 for(const row of rows||[]) {
  const save=async(values:any)=>{const {error}=await db.from('hmp_document_reminders').update(values).eq('id',row.id).eq('attempts',row.attempts).eq('status','pending');if(error)throw new Error('Unable to save reminder delivery');};
  try {
   const ctx=await contextFn(db,row.kind,row.document_id,row.conversation_id);
   const payload=row.email_payload||{from,to:[ctx.email],reply_to:hmpReplyTo(),subject:row.kind==='hub'?'HMP Client Hub access reminder':'HMP document reminder',html:`<p>${escape(ctx.body)}</p><p><a href="${escape(ctx.url)}">Open Client Hub</a></p>`};
   if(payload.to?.[0]!==ctx.email)throw new Ineligible('Client email changed; schedule a new reminder.');
   if(!row.email_payload)await save({email_payload:payload});
   const {error:noticeError}=await db.from('hmp_client_messages').upsert({id:row.id,conversation_id:ctx.hub.id,sender:'admin',sender_name:'HMP Event Concierge',body:ctx.body},{onConflict:'id',ignoreDuplicates:true});
   if(noticeError)throw new Error('Client Hub notice could not be saved');
   await save({portal_notice_at:new Date().toISOString()});
   if(!row.portal_notice_at) {
    const stamp=new Date().toISOString();
    const {error}=await db.from('hmp_client_conversations').update({last_message_at:stamp,last_sender:'admin',updated_at:stamp}).eq('id',ctx.hub.id).lt('last_message_at',stamp);
    if(error)throw new Error('Client Hub activity could not be updated');
   }
   // Recheck after writing the notice, immediately before sending externally.
   await contextFn(db,row.kind,row.document_id,row.conversation_id);
   const response=await fetchFn('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(4000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`hmp-document-reminder/${row.id}`},body:JSON.stringify(payload)});
   if(!response.ok)throw new Error('Email provider did not accept the reminder');
   const {error:markError}=await db.from('hmp_client_messages').update({email_notified_at:new Date().toISOString(),email_notification_error:null}).eq('id',row.id);
   if(markError)throw new Error('Unable to record email acceptance');
   await save({status:'sent',accepted_at:new Date().toISOString(),detail:'Email accepted by provider and notice saved in Client Hub.'});accepted++;
  }catch(error){await save(error instanceof Ineligible?{status:'cancelled',detail:error.message}:{detail:'Delivery could not be confirmed; automatic retry pending.'});}
 }
 return {processed:rows?.length||0,accepted};
}
export default async()=>Response.json(await deliverDocumentReminders(createClient(Netlify.env.get('SUPABASE_URL')!,Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})));
export const config={schedule:'* * * * *'};
