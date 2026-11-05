import {createClient} from '@supabase/supabase-js';
import {getUser} from './_admin-verification.mts';
import {checklistRequest} from './_event-checklist.ts';
export default async function handler(req:Request){
 const email=(await getUser(req))?.email?.toLowerCase(),allowed=(Netlify.env.get('HMP_ADMIN_EMAILS')||'').toLowerCase().split(',').map(x=>x.trim());
 const reply=(error:string,status:number)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});
 if(!email||!allowed.includes(email))return reply('Admin sign-in required.',401);
 const id=new URL(req.url).searchParams.get('id');
 if(!id||!/^[-a-f0-9]{36}$/i.test(id))return reply('Choose an event.',400);
 const db=createClient(Netlify.env.get('SUPABASE_URL')!,Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 const hub=await db.from('hmp_client_conversations').select('id').eq('id',id).is('deleted_at',null).maybeSingle();
 if(hub.error||!hub.data)return reply('Event unavailable.',404);
 return checklistRequest(db,'hub/'+id,req);
}
export const config={path:'/api/hmp-event-checklist'};
