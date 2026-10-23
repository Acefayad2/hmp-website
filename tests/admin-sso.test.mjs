import test from "node:test";
import assert from "node:assert/strict";
import { createSsoHandler } from "../netlify/functions/hmp-sso.mts";

test("Money Table SSO verification fails closed and only exposes an authorized identity", async () => {
  let calls = 0, ok = true, fail = false, email = "admin@example.com";
  const handle = createSsoHandler({emails:()=>["admin@example.com"], fetchFn:async(url, options)=>{
    calls++;
    assert.equal(url,"https://hmpeds.com/.netlify/identity/user");
    assert.equal(options.headers.authorization,"Bearer synthetic-token");
    assert.equal(options.cache,"no-store");
    if(fail) throw new Error("offline");
    return Response.json({id:"admin-id",email,password:"must-not-leak"},{status:ok?200:401});
  }});
  const request = cookie => new Request("https://hmpeds.com/api/hmp-sso",{headers:cookie?{cookie}: {}});
  assert.equal((await handle(request())).status,401);
  assert.equal(calls,0);
  assert.equal((await handle(request("hmp_admin_sso=%GG"))).status,401);
  const response = await handle(request("hmp_admin_sso=synthetic-token"));
  assert.equal(response.headers.get("cache-control"),"no-store");
  assert.deepEqual(await response.json(),{user:{id:"admin-id",email,name:"HMP Admin"}});
  email="not-admin@example.com";
  assert.equal((await handle(request("hmp_admin_sso=synthetic-token"))).status,401);
  ok=false;
  assert.equal((await handle(request("hmp_admin_sso=synthetic-token"))).status,401);
  fail=true;
  assert.equal((await handle(request("hmp_admin_sso=synthetic-token"))).status,503);
});
