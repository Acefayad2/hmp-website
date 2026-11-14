import type {Config} from '@netlify/functions';
import {createClient} from '@supabase/supabase-js';
import {deliverStaffText} from './hmp-sms.mts';
import {sendReplyNotification} from './hmp-messages.mts';
import {toE164} from './_quo.mts';

export async function deliverScheduledMessages(db:any,fetchFn=fetch){
  const {data:rows,error}=await db.rpc('hmp_claim_scheduled_client_messages');
  if(error)throw new Error('Scheduled messages could not be claimed.');
  let sent=0,failed=0;
  for(const row of rows||[]){
    const finish=async(status:'sent'|'failed',detail:string)=>{
      const {error:saveError}=await db.from('hmp_scheduled_client_messages').update({status,detail,completed_at:new Date().toISOString()}).eq('id',row.id).eq('status','processing');
      if(saveError)throw new Error('Scheduled message result could not be saved.');
    };
    try{
      const {data:hub,error:hubError}=await db.from('hmp_client_conversations').select('*').eq('id',row.conversation_id).maybeSingle();
      if(hubError||!hub||hub.revoked_at||hub.archived_at||hub.deleted_at||Date.parse(hub.token_expires_at)<=Date.now())throw new Error('Client Hub access expired or was disabled before send time.');
      const {data:inquiry,error:inquiryError}=await db.from('hmp_admin_inquiries').select('submission_id,client_name,email,phone,status').eq('submission_id',hub.inquiry_id).maybeSingle();
      if(inquiryError||!inquiry||inquiry.status==='deleted')throw new Error('Client contact is unavailable.');
      const current=row.channel==='email'?String(inquiry.email||'').trim().toLowerCase():toE164(inquiry.phone);
      if(current!==row.recipient)throw new Error('Client contact changed after scheduling. Review and schedule a new message.');
      if(row.channel==='text'){
        await deliverStaffText({client:db,actor:row.created_by,senderName:'HMP Event Concierge',body:{conversationId:hub.id,content:row.body,requestId:row.id},fetchFn});
      }else{
        const {error:insertError}=await db.from('hmp_client_messages').insert({id:row.id,conversation_id:hub.id,sender:'admin',sender_name:'HMP Event Concierge',body:row.body,text_formatting:row.text_formatting||[],email_notification_error:'Email notification not yet confirmed.'});
        if(insertError&&insertError.code!=='23505')throw new Error('Client Hub message could not be saved.');
        const now=new Date().toISOString();
        await db.from('hmp_client_conversations').update({last_message_at:now,last_sender:'admin',updated_at:now}).eq('id',hub.id);
        const accepted=await sendReplyNotification(inquiry,hub,row.id,false,fetchFn);
        const {error:markError}=await db.from('hmp_client_messages').update(accepted?{email_notified_at:now,email_notification_error:null}:{email_notification_error:'Email provider did not accept this scheduled reply. Retry the email notification in Admin.'}).eq('id',row.id);
        if(markError)throw new Error('Email status could not be saved. Check the provider before retrying.');
        if(!accepted)throw new Error('Reply saved in Client Hub, but the email provider did not accept the notification. Retry in Admin.');
      }
      await finish('sent',row.channel==='email'?'Email accepted by provider and reply saved in Client Hub.':'Text accepted by provider and saved in Client Hub.');sent++;
    }catch(cause){
      const detail=cause instanceof Error?cause.message:'Delivery could not be confirmed. Check the provider and Client Hub before retrying.';
      await finish('failed',detail.slice(0,500));failed++;
    }
  }
  return {claimed:rows?.length||0,sent,failed};
}

export default async()=>{
  const url=Netlify.env.get('SUPABASE_URL'),key=Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)return Response.json({error:'Database is not configured.'},{status:503});
  return Response.json(await deliverScheduledMessages(createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})));
};
export const config:Config={schedule:'* * * * *'};
