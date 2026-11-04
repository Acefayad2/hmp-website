import {clientConversationUrl} from './_conversation-security.mts';
export const tables:Record<string,string>={invoice:'hmp_admin_invoices',contract:'hmp_admin_contracts',form:'hmp_client_agreements'};
export const validId=(id:unknown)=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
export class Ineligible extends Error {}
export function scheduleDates(first:unknown,count:unknown,days:unknown,now=Date.now()) {
 const start=typeof first==='string'?Date.parse(first):NaN;
 if(!Number.isInteger(count)||Number(count)<1||Number(count)>12||!Number.isInteger(days)||Number(days)<1||Number(days)>90)throw new Ineligible('Choose 1–12 reminders and a repeat interval of 1–90 days.');
 const dates=Array.from({length:Number(count)},(_,i)=>start+i*Number(days)*86400000);
 if(!Number.isFinite(start)||start<now+60000||dates.at(-1)!>now+366*86400000)throw new Ineligible('Choose a first reminder at least one minute from now; all reminders must be within the next year.');
 return dates.map(n=>new Date(n).toISOString());
}
export function documentEligible(kind:string,doc:any,now=Date.now()) {
 if(!doc||doc.deleted_at||doc.archived_at||!(kind==='invoice'?['Sent','Partially paid']:['Sent']).includes(doc.status))return false;
 return !doc.expires_at||Date.parse(doc.expires_at)>now;
}
async function result(query:any){const {data,error}=await query;if(error)throw new Error('Reminder data could not be checked. Please try again.');return data;}
export async function reminderContext(db:any,kind:string,id:string,conversationId?:string) {
 if(!tables[kind]||!validId(id))throw new Ineligible('Invalid document.');
 const doc=await result(db.from(tables[kind]).select('*').eq('id',id).maybeSingle());
 if(!documentEligible(kind,doc))throw new Ineligible('Reminders require a sent, unfinished agreement or unpaid invoice with active access.');
 const versions=await result(db.from(tables[kind]).select('id,status,created_at').eq('revision_root_id',doc.revision_root_id||id).neq('status','Draft').gt('created_at',doc.created_at));
 if(versions.length)throw new Ineligible('A newer issued revision exists. Schedule reminders on that version.');
 const shares=await result(db.from('hmp_client_messages').select('conversation_id,document,deleted_at').eq('document->>kind',kind).eq('document->>id',id).order('created_at',{ascending:false}).limit(100));
 // The latest share governs access; never revive an older deleted/expired share.
 const share=conversationId?shares.find((s:any)=>s.conversation_id===conversationId):shares[0];
 if(!share||share.deleted_at||(share.document?.expiresAt&&Date.parse(share.document.expiresAt)<=Date.now()))throw new Ineligible('Share this document in an active Client Hub before scheduling reminders.');
 const hub=await result(db.from('hmp_client_conversations').select('*').eq('id',share.conversation_id).maybeSingle());
 if(!hub||hub.revoked_at||hub.archived_at||hub.deleted_at||!(Date.parse(hub.token_expires_at)>Date.now()))throw new Ineligible('The Client Hub link is inactive or expired. Restore access before scheduling reminders.');
 const inquiry=await result(db.from('hmp_admin_inquiries').select('email').eq('submission_id',hub.inquiry_id).maybeSingle());
 const email=String(doc.client_email||'').trim().toLowerCase();
 if(!email||email!==String(inquiry?.email||'').trim().toLowerCase())throw new Ineligible('The document email must match the Client Hub email.');
 const title=String(doc.snapshot?.title||doc.invoice_number||doc.contract_number||'your agreement');
 return {hub,email,title,url:clientConversationUrl(hub.id,hub.token_nonce),body:`Reminder: Please ${kind==='invoice'?'review and pay':'review and complete'} ${title} in your Client Hub. If you have already completed this, no further action is needed.`};
}
