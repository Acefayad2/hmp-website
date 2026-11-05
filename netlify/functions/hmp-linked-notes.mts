import {createClient} from '@supabase/supabase-js';
import {getUser} from './_admin-verification.mts';
export default async function handler(request:Request) {
  const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
  const email=(await getUser(request))?.email?.toLowerCase();
  const allowed=(Netlify.env.get('HMP_ADMIN_EMAILS')||'').toLowerCase().split(',').map(v=>v.trim());
  if(!email || !allowed.includes(email))return reply({error:'Admin sign-in required.'},401);
  if(request.method!=='GET')return reply({error:'Use GET.'},405);
  const id=new URL(request.url).searchParams.get('id');
  if(!id || !/^[\da-f-]{36}$/i.test(id))return reply({error:'Choose a Client Hub event.'},400);
  const db=createClient(Netlify.env.get('SUPABASE_URL')!,Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {data,error}=await db.rpc('hmp_linked_staff_notes',{p_source:'hub',p_id:id});
  return error?reply({error:'Linked staff notes could not be loaded. Reopen to try again.'},503):reply({notes:data||[]});
}
export const config={path:'/api/hmp-linked-notes'};
