import {createClient} from '@supabase/supabase-js';
import {getUser} from './_admin-verification.mts';
import {isSameOriginMutation} from './_conversation-security.mts';
import {tables,validId,Ineligible,reminderContext,scheduleDates} from './_document-reminders.mts';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export function createRemindersHandler({getUserFn=getUser,databaseFactory=createClient}={}) {return async(request:Request)=>{
 const email=(await getUserFn(request))?.email?.toLowerCase();
 if(!email||!(Netlify.env.get('HMP_ADMIN_EMAILS')||'').split(',').map(s=>s.trim().toLowerCase()).includes(email))return json({error:'Unauthorized'},401);
 if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed'},405);
 if(request.method==='POST'&&!isSameOriginMutation(request))return json({error:'Invalid request origin'},403);
 try {
 const body=request.method==='GET'?Object.fromEntries(new URL(request.url).searchParams):await request.json();
 const {kind,id}=body;
 if(!Object.hasOwn(tables,kind)||!validId(id))return json({error:'Invalid reminder target'},400);
 const db=databaseFactory(Netlify.env.get('SUPABASE_URL')!,Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 if(request.method==='POST') {
  if(body.action==='cancel') {
   if(!validId(body.reminderId))return json({error:'Invalid reminder'},400);
   const {data,error}=await db.from('hmp_document_reminders').update({status:'cancelled',detail:'Cancelled by Admin.'}).eq('id',body.reminderId).eq('kind',kind).eq('document_id',id).eq('status','pending').is('claimed_at',null).select('id');
   if(error)throw error;
   if(!data?.length)return json({error:'This reminder is already processing or finished. Refresh to see its status.'},409);
  } else if(body.action==='schedule') {
   const dates=scheduleDates(body.first,body.count,body.days);
   const ctx=await reminderContext(db,kind,id);
   if(dates.some(date=>Date.parse(date)>=ctx.deadline))throw new Ineligible('All reminder dates must be before the document or Client Hub expires.');
   const {error}=await db.from('hmp_document_reminders').upsert(dates.map(due_at=>({kind,document_id:id,conversation_id:ctx.hub.id,due_at,created_by:email})),{onConflict:'kind,document_id,due_at',ignoreDuplicates:true});
   if(error)throw error;
  } else return json({error:'Invalid action'},400);
 }
 const {data,error}=await db.from('hmp_document_reminders').select('id,due_at,status,attempts,claimed_at,accepted_at,portal_notice_at,detail').eq('kind',kind).eq('document_id',id).order('due_at',{ascending:false}).limit(100);
 if(error)throw error;
 return json({reminders:data});
 }catch(error){return json({error:error instanceof Ineligible?error.message:'Reminders could not be saved or loaded. Please try again.'},error instanceof Ineligible?400:502);}
};}
export default createRemindersHandler();
export const config={path:'/api/hmp-document-reminders'};
