import test from "node:test";
import assert from "node:assert/strict";
import { reviewSubmission, reviewConsent, reviewServices } from "../review-request-schema.mjs";
import { createReviewRequestHandler, reviewToken, reviewHash } from "../netlify/functions/hmp-review-requests.mts";
import { createReviewHandler } from "../netlify/functions/hmp-reviews.mts";

const env={SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"test-secret",HMP_ADMIN_EMAILS:"admin@example.test",RESEND_API_KEY:"test-resend",HMP_INVOICE_FROM_EMAIL:"hmp@example.test"};
globalThis.Netlify={env:{get:name=>env[name]}};
const id="11111111-1111-4111-8111-111111111111";
const token=reviewToken(id,env.SUPABASE_SERVICE_ROLE_KEY);
const submission={reviewerName:"Example Client",reviewerRole:"Host",rating:5,reviewText:"A lovely experience.\nThank you!",services:["Guest Seating Experience"],consent:true};
const invitation=()=>({id,client_name:"Example Client",client_email:"client@example.test",created_by:"admin@example.test",token_hash:reviewHash(token),expires_at:"2099-01-01T00:00:00Z",email_delivered_at:null,submitted_at:null});
function database(requests=[], reviews=[]) {
  return {from(table) {
    const rows=table==="hmp_review_requests" ? requests : reviews;
    let filters=[],operation="read",payload,ignore=false;
    const q={
      select(){return this;},order(){return this;},limit(){return this;},
      eq(k,v){filters.push(row=>row[k]===v);return this;},
      insert(v){operation="insert";payload=v;return this;},
      upsert(v,opts){operation="insert";payload=v;ignore=opts?.ignoreDuplicates;return this;},
      update(v){operation="update";payload=v;return this;},
      execute(single=false){
        let found=rows.filter(row=>filters.every(f=>f(row)));
        if(operation==="insert"){
          const existing=rows.find(row=>row.id===payload.id);
          if(!existing || !ignore){const row={id:"22222222-2222-4222-8222-222222222222",expires_at:"2099-01-01T00:00:00Z",...payload};rows.push(row);found=[row];}
        }
        if(operation==="update")found.forEach(row=>Object.assign(row,payload));
        return {data:single ? found[0] || null : found,error:null};
      },single(){return Promise.resolve(this.execute(true));},maybeSingle(){return Promise.resolve(this.execute(true));},
      then(resolve,reject){return Promise.resolve(this.execute()).then(resolve,reject);},
    };return q;
  },async rpc(name,args){
    assert.equal(name,"hmp_submit_requested_review");assert.equal(args.p_consent,reviewConsent);
    const row=requests.find(r=>r.token_hash===args.p_token_hash);
    if(!row.submitted_at){reviews.push({id:"22222222-2222-4222-8222-222222222222",...args.p_review,published:false,is_placeholder:false,source_request_id:row.id});row.submitted_at=new Date().toISOString();}
    return {data:reviews[0]?.id,error:null};
  }};
}
const request=(route,method="GET",body,authToken)=>new Request(`https://hmpeds.com/api/${route}`,{method,headers:{Origin:"https://hmpeds.com",...(authToken ? {Authorization:`Bearer ${authToken}`} : {})},...(body ? {body:JSON.stringify(body)} : {})});
const user=async()=>({email:"admin@example.test"});

test("review validation requires consent, real services, length bounds, and an unbiased 1–5 rating",()=>{
  for(const rating of [1,2,3,4,5])assert.equal(reviewSubmission({...submission,rating}).rating,rating);
  for(const body of [{...submission,consent:false},{...submission,rating:6},{...submission,services:[]},{...submission,services:["fake"]},{...submission,reviewText:"x".repeat(1201)}])assert.throws(()=>reviewSubmission(body));
  const clean=reviewSubmission({...submission,published:true,id:"fake",services:reviewServices});
  assert.equal(clean.published,undefined);assert.equal(clean.id,undefined);assert.ok(clean.service.length<=160);
});
test("only admins can email clients; private client links and same-origin writes are enforced",async()=>{
  const h=createReviewRequestHandler({getUserFn:async()=>null,databaseFactory:()=>database([invitation()])});
  assert.equal((await h(request("hmp-review-requests"))).status,401);
  assert.equal((await h(request("hmp-client-review"))).status,401);
  assert.equal((await h(request("hmp-client-review","GET",null,"x".repeat(43)))).status,410);
  assert.equal((await h(new Request("https://hmpeds.com/api/hmp-review-requests",{method:"POST",headers:{Origin:"https://evil.test"}}))).status,403);
  const expired={...invitation(),expires_at:"2000-01-01T00:00:00Z"};
  const e=createReviewRequestHandler({databaseFactory:()=>database([expired])});
  assert.equal((await e(request("hmp-client-review","POST",submission,token))).status,410);
});
test("client submission stays unpublished even when spoofing approval; retry inserts once and reveals no email",async()=>{
  const rows=[invitation()],reviews=[],db=database(rows,reviews);
  const h=createReviewRequestHandler({databaseFactory:()=>db});
  const info=await (await h(request("hmp-client-review","GET",null,token))).json();
  assert.deepEqual(info,{clientName:"Example Client",submitted:false});
  assert.equal((await h(request("hmp-client-review","POST",{...submission,published:true,source_request_id:"other"},token))).status,201);
  assert.equal(reviews[0].published,false);
  assert.equal((await h(request("hmp-client-review","POST",submission,token))).status,200);
  assert.equal(reviews.length,1);
});
test("landing-page API excludes pending reviews, admin approval publishes, and unpublishing hides them again",async()=>{
  const reviews=[{id,...reviewSubmission(submission),published:false,is_placeholder:false,source_request_id:id}];
  const db=database([],reviews),h=createReviewHandler({getUserFn:user,databaseFactory:()=>db});
  assert.equal((await (await h(request("hmp-reviews"))).json()).reviews.length,0);
  assert.equal((await (await h(request("hmp-reviews?admin=1"))).json()).reviews[0].clientSubmitted,true);
  const body={id,reviewerName:submission.reviewerName,reviewText:submission.reviewText,service:submission.services.join(", "),rating:5,published:true};
  const unauthorized=createReviewHandler({getUserFn:async()=>null,databaseFactory:()=>db});
  assert.equal((await unauthorized(request("hmp-reviews","PATCH",body))).status,401);
  assert.equal((await h(request("hmp-reviews","PATCH",body))).status,200);
  assert.equal((await (await h(request("hmp-reviews"))).json()).reviews.length,1);
  await h(request("hmp-reviews","PATCH",{...body,published:false}));
  assert.equal((await (await h(request("hmp-reviews"))).json()).reviews.length,0);
});
test("request retries keep one invitation and stable email key; successful delivery is not sent twice",async()=>{
  const rows=[],db=database(rows),emails=[];let fail=true;
  const h=createReviewRequestHandler({getUserFn:user,databaseFactory:()=>db,fetchFn:async(_,options)=>{emails.push(options);return new Response("{}",{status:fail ? 500 : 200});}});
  const body={id,clientName:"<Example>",clientEmail:"client@example.test"};
  assert.equal((await h(request("hmp-review-requests","POST",body))).status,502);
  fail=false;
  assert.equal((await h(request("hmp-review-requests","POST",body))).status,200);
  assert.equal((await h(request("hmp-review-requests","POST",body))).status,200);
  assert.equal(rows.length,1);assert.equal(emails.length,2);
  assert.equal(emails[0].headers["Idempotency-Key"],emails[1].headers["Idempotency-Key"]);
  const mail=JSON.parse(emails[0].body);
  assert.match(mail.html,/&lt;Example&gt;/);assert.match(mail.html,/review#token=/);assert.match(mail.html,/administrator/);
  assert.equal((await h(request("hmp-review-requests","POST",{...body,clientEmail:"other@example.test"}))).status,409);
});
