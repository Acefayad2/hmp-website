import type {Config} from '@netlify/functions';
import {createClient} from '@supabase/supabase-js';
import {getUser} from './_admin-verification.mts';
import {isSameOriginMutation} from './_conversation-security.mts';
import {toE164} from './_quo.mts';
import {normalizeMessageFormatting} from '../../message-formatting.mjs';

const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowed=()=>new Set((Netlify.env.get('HMP_ADMIN_EMAILS')||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean));
const database=()=>{const url=Netlify.env.get('SUPABASE_URL'),key=Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY');return url&&key?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}):null};

export const createScheduledMessagesHandler=({getUserFn=getUser,databaseFactory=database}={})=>async(request:Request)=>{
  const user=await getUserFn(request),actor=user?.email?.toLowerCase();
  if(!actor||!allowed().has(actor))return json({error:'Unauthorized'},401);
  if(request.method==='POST'&&!isSameOriginMutation(request))return json({error:'Invalid request origin.'},403);
  const db=databaseFactory();if(!db)return json({error:'Scheduling is unavailable.'},503);
  const conversationId=new URL(request.url).searchParams.get('conversationId')||'';
  if(request.method==='GET'){
    if(!uuid.test(conversationId))return json({error:'Choose a conversation.'},400);
    const {data,error}=await db.from('hmp_scheduled_client_messages').select('id,channel,body,recipient,scheduled_at,status,created_at,completed_at,detail').eq('conversation_id',conversationId).order('created_at',{ascending:false}).limit(50);
    return error?json({error:'Scheduled messages could not be loaded.'},502):json({entries:data||[]});
  }
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  let body:any;try{const raw=await request.text();if(raw.length>12000)return json({error:'Request is too large.'},413);body=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}
  if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'Invalid request.'},400);
  if(body.action==='cancel'){
    if(!uuid.test(body.id||'')||!uuid.test(body.conversationId||''))return json({error:'Choose a scheduled message.'},400);
    const {data,error}=await db.from('hmp_scheduled_client_messages').update({status:'cancelled',completed_at:new Date().toISOString(),detail:'Cancelled by Admin.'}).eq('id',body.id).eq('conversation_id',body.conversationId).eq('status','pending').select('id').maybeSingle();
    return error?json({error:'Cancellation could not be saved.'},502):data?json({ok:true}):json({error:'This message is already being processed or was sent. Refresh the schedule.'},409);
  }
  if(body.action!=='schedule'||!uuid.test(body.conversationId||''))return json({error:'Choose a conversation.'},400);
  const channel=body.channel==='email'?'email':body.channel==='text'?'text':'';
  if(!channel)return json({error:'Choose email or text.'},400);
  const message=typeof body.message==='string'?body.message.trim():'';
  if(!message||message.length>(channel==='text'?1600:4000))return json({error:`Enter a ${channel==='text'?'text of 1,600':'reply of 4,000'} characters or fewer.`},400);
  const scheduled=Date.parse(body.scheduledAt||'');
  if(!Number.isFinite(scheduled)||scheduled<Date.now()+60_000||scheduled>Date.now()+366*86400_000)return json({error:'Choose a send time at least one minute from now and within one year.'},400);
  const {data:hub,error:hubError}=await db.from('hmp_client_conversations').select('id,inquiry_id,revoked_at,archived_at,deleted_at,token_expires_at').eq('id',body.conversationId).maybeSingle();
  if(hubError||!hub)return json({error:'Client Hub could not be found.'},404);
  if(hub.revoked_at||hub.archived_at||hub.deleted_at||scheduled>=Date.parse(hub.token_expires_at))return json({error:'The Client Hub link must remain active through the scheduled send time. Extend its expiration or restore it first.'},409);
  const {data:inquiry}=await db.from('hmp_admin_inquiries').select('email,phone,status').eq('submission_id',hub.inquiry_id).maybeSingle();
  if(!inquiry||inquiry.status==='deleted')return json({error:'This client is unavailable.'},409);
  const recipient=channel==='email'?String(inquiry.email||'').trim().toLowerCase():toE164(inquiry.phone);
  if(channel==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)||channel==='text'&&!recipient)return json({error:`The client needs a valid ${channel==='email'?'email address':'mobile number'} before scheduling.`},400);
  let formatting=[];
  try{if(channel==='email')formatting=normalizeMessageFormatting(body.message,message,body.formatting)}catch{return json({error:'Message formatting is invalid.'},400)}
  const id=uuid.test(body.requestId||'')?body.requestId:crypto.randomUUID();
  const {error}=await db.from('hmp_scheduled_client_messages').insert({id,conversation_id:hub.id,channel,body:message,text_formatting:formatting,recipient,scheduled_at:new Date(scheduled).toISOString(),created_by:actor});
  if(error?.code==='23505')return json({ok:true,id,duplicate:true});
  return error?json({error:'Scheduled send could not be saved. Please retry.'},502):json({ok:true,id});
};

export default createScheduledMessagesHandler();
export const config:Config={path:'/api/hmp-scheduled-messages'};
