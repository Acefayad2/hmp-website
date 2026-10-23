import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createAdminVerificationHandler} from '../netlify/functions/hmp-admin-verification.mts';
import {issueVerification,hasAdminVerification,cookieHeader} from '../netlify/functions/_admin-verification.mts';

const user={id:'synthetic-admin',email:'admin@example.com'};
const env={HMP_ADMIN_EMAILS:user.email,SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-only-secret',RESEND_API_KEY:'test-only-mail',HMP_COMMUNICATION_EMAIL:'eventsconcierge@hmpeds.com'};
globalThis.Netlify={env:{get:key=>env[key]}};
const request=(body, cookie='', method='POST',origin='https://hmpeds.com')=>new Request('https://hmpeds.com/api/hmp-admin-verification',{
  method,headers:{origin,cookie,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});
function fixture(options={}){
  const rows=new Map(),mail=[],limits=new Map();let time=Date.now();
  const db={
    async rpc(_,args){
      if(options.rateError)return {error:new Error('offline')};
      let entry=limits.get(args.p_key);
      if(!entry||entry.ends<=time){entry={count:0,ends:time+args.p_window_ms};limits.set(args.p_key,entry);}
      return {data:++entry.count>args.p_limit?Math.ceil((entry.ends-time)/1000):0};
    },
    from(table){
      assert.equal(table,'hmp_seating_records');
      const filters=[];
      const chain={
        async upsert(row){if(options.storageError)return {error:new Error('offline')};rows.set(row.key,row);return {error:null};},
        delete(){return chain;},eq(key,value){filters.push(row=>(key==='key'?row.key:row.value.codeHash)===value);return chain;},
        gt(key,value){assert.equal(key,'value->expires');filters.push(row=>row.value.expires>value);return chain;},
        select(){return chain;},
        then(resolve,reject){
          if(options.storageError)return Promise.resolve({error:new Error('offline')}).then(resolve,reject);
          const data=[];
          for(const [key,row] of rows)if(filters.every(fn=>fn(row))){rows.delete(key);data.push({key});}
          return Promise.resolve({data,error:null}).then(resolve,reject);
        },
      };return chain;
    },
  };
  const handler=createAdminVerificationHandler({getUserFn:async()=>options.user===undefined?user:options.user,databaseFactory:()=>db,now:()=>time,
    randomCode:()=> '234567',fetchFn:async(url,init)=>{assert.equal(url,'https://api.resend.com/emails');mail.push(JSON.parse(init.body));return Response.json({}, {status:options.mailError?500:200});}});
  const send=async(cookie='')=>{
    const response=await handler(request({action:'send',email:'attacker@example.com'},cookie));
    return {response,cookie:response.headers.getSetCookie()[0]?.split(';')[0]||cookie};
  };
  return {handler,rows,mail,limits,send,advance:ms=>{time+=ms;}};
}
test('email step requires an allowlisted Identity account and same-origin requests',async()=>{
  for(const identity of [null,{id:'other',email:'other@example.com'}]){
    const f=fixture({user:identity});assert.equal((await f.handler(request({action:'send'}))).status,401);assert.equal(f.mail.length,0);assert.equal(f.rows.size,0);
  }
  const f=fixture();
  assert.equal((await f.handler(request({},'','GET'))).status,200);
  assert.deepEqual(await (await f.handler(request({},'','GET'))).json(),{verified:false,email:user.email});
  for(const origin of ['https://evil.example','null',''])assert.equal((await f.handler(request({action:'send'},'','POST',origin))).status,403);
  assert.equal(f.mail.length,0);
});
test('code goes only to account email, is hashed at rest, and is atomically single-use',async()=>{
  const f=fixture(),{response,cookie}=await f.send();
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
  assert.deepEqual(f.mail[0].to,[user.email]);assert.match(f.mail[0].text,/234567/);
  assert.doesNotMatch(await response.text(),/234567/);assert.doesNotMatch(JSON.stringify([...f.rows.values()]),/234567/);
  assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax; Max-Age=600/);
  assert.equal((await f.handler(request({action:'verify',code:'000000'},cookie))).status,401);
  const results=await Promise.all([f.handler(request({action:'verify',code:'234567'},cookie)),f.handler(request({action:'verify',code:'234567'},cookie))]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);assert.equal(f.rows.size,0);
  const proofCookie=results.find(r=>r.status===200).headers.getSetCookie().find(c=>c.startsWith('hmp_admin_verified=')).split(';')[0];
  assert.equal(hasAdminVerification(request({},proofCookie,'GET'),user),true);
  assert.equal((await f.handler(request({action:'verify',code:'234567'},cookie))).status,401);
});
test('expired and cross-browser challenges fail; resend invalidates the previous challenge',async()=>{
  const f=fixture(),{cookie}=await f.send();
  assert.equal((await f.handler(request({action:'verify',code:'234567'}))).status,401);
  f.advance(600001);
  assert.equal((await f.handler(request({action:'verify',code:'234567'},cookie))).status,401);
  const resent=await f.send(cookie);assert.equal(resent.response.status,200);assert.equal(f.rows.size,1);
  assert.equal((await f.handler(request({action:'verify',code:'234567'},cookie))).status,200);
});
test('code requests and guesses are rate limited, including malformed codes',async()=>{
  const f=fixture(),{cookie}=await f.send();
  const limited=await f.send(cookie);assert.equal(limited.response.status,429);assert.equal(limited.response.headers.get('retry-after'),'60');
  for(let i=0;i<5;i++)assert.equal((await f.handler(request({action:'verify',code:'bad'},cookie))).status,400);
  assert.equal((await f.handler(request({action:'verify',code:'234567'},cookie))).status,429);
  for(let i=0;i<4;i++){f.advance(60001);assert.equal((await f.send(cookie)).response.status,200);}
  f.advance(60001);assert.equal((await f.send(cookie)).response.status,429);assert.equal(f.mail.length,5);
});
test('storage, rate-limit and mail failures fail closed',async()=>{
  for(const options of [{rateError:true},{storageError:true},{mailError:true}]){
    const f=fixture(options),{response}=await f.send();assert.ok(response.status>=500);assert.equal(f.rows.size,0);
    assert.equal(response.headers.getSetCookie().length,0);
  }
});
test('proofs are signed, time limited and bound to the exact account',()=>{
  const now=Date.now(),token=issueVerification(user,env.SUPABASE_SERVICE_ROLE_KEY,now);
  const req=request({},`hmp_admin_verified=${token}`,'GET');
  assert.equal(hasAdminVerification(req,user,env.SUPABASE_SERVICE_ROLE_KEY,now),true);
  for(const identity of [{...user,id:'another'},{...user,email:'other@example.com'}])assert.equal(hasAdminVerification(req,identity),false);
  assert.equal(hasAdminVerification(req,user,'wrong-secret'),false);
  assert.equal(hasAdminVerification(req,user,env.SUPABASE_SERVICE_ROLE_KEY,now+3600000),false);
  assert.equal(hasAdminVerification(request({},`hmp_admin_verified=${token}a`,'GET'),user),false);
  assert.doesNotMatch(cookieHeader(new Request('https://preview.netlify.app'),'proof','value',60),/Domain=/);
});
test('sign-out clears verification, challenge and shared-login cookies',async()=>{
  const response=await fixture().handler(request({},'','DELETE'));
  assert.equal(response.status,200);assert.equal(response.headers.getSetCookie().length,3);
  for(const cookie of response.headers.getSetCookie())assert.match(cookie,/Max-Age=0/);
});
test('all website Admin endpoints use the server verification guard',()=>{
  const endpoints=['dashboard','messages','invoices','contracts','reviews','sms','notifications','agreement-forms','document-versions','message-signature','proposal-drafts','receipt-drafts','review-requests','send-contract','send-invoice','share-document','sso'];
  for(const endpoint of endpoints){
    const source=readFileSync(new URL(`../netlify/functions/hmp-${endpoint}.mts`,import.meta.url),'utf8');
    assert.match(source,/from ["']\.\/_admin-verification\.mts["']/);assert.match(source,/getUser(?:Fn)?\(request\)/);
  }
  for(const file of readdirSync(new URL('../netlify/functions/',import.meta.url)).filter(f=>f.endsWith('.mts')&&!['_admin-verification.mts','hmp-admin-verification.mts'].includes(f))){
    assert.doesNotMatch(readFileSync(new URL(`../netlify/functions/${file}`,import.meta.url),'utf8'),/from ["']@netlify\/identity["']/);
  }
});
