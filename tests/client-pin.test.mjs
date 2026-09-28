import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { portalPinId, requireClientPin } from "../netlify/functions/_client-pin.mts";

export function pinDatabase() {
  const rows = new Map();
  return { rows,
    async rpc(name, { p_id }) {
      assert.equal(name, "hmp_client_pin_attempt");
      if (!rows.has(p_id)) rows.set(p_id, { id: p_id, pin_hash: null, version: randomUUID(), attempts: 0 });
      const row = rows.get(p_id);
      row.attempts++;
      return { data: row.attempts <= 10, error: null };
    },
    from(name) {
      assert.equal(name, "hmp_client_portal_pins");
      const filters = []; let patch;
      return {
        select() { return this; },
        eq(k, v) { filters.push(r => r[k] === v); return this; },
        is(k, v) { filters.push(r => r[k] === v); return this; },
        update(value) { patch = value; return this; },
        async maybeSingle() { const row = [...rows.values()].find(r => filters.every(f => f(r))); if (row && patch) Object.assign(row, patch); return { data: row ? {...row} : null, error: null }; },
        single() { return this.maybeSingle(); },
      };
    },
  };
}
const id = portalPinId("message:test-client", "private-link");
const secret = "isolated-test-secret";
const request = (method = "GET", body, cookie = "", origin = "https://example.test") =>
  new Request("https://example.test/api/client", { method, headers: { Origin: origin, Cookie: cookie }, ...(body ? { body: JSON.stringify(body) } : {}) });
const cookieOf = response => response.headers.get("set-cookie")?.split(";")[0] || "";
const pinBody = {pin:"065432",confirmPin:"065432"};

test("client chooses PIN once, hash is salted, cookie is HttpOnly, and PIN is required for reads and writes", async () => {
  const db = pinDatabase();
  for(const method of ["GET","POST","PUT","DELETE"]) {
    const r=await requireClientPin(request(method),db,id,secret);
    assert.equal(r.status,401);
    assert.equal((await r.json()).code,"CLIENT_PIN_SETUP");
  }
  const r = await requireClientPin(request("POST",pinBody),db,id,secret,"setup");
  assert.equal(r.status,200);
  const row = db.rows.get(id);
  assert.match(row.pin_hash,/^[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.ok(!row.pin_hash.includes(pinBody.pin));
  const cookies=r.headers.get("set-cookie");
  assert.match(cookies,/__Host-/);assert.match(cookies,/HttpOnly/);assert.match(cookies,/SameSite=Strict/);assert.match(cookies,/; Secure/);
  assert.equal(await requireClientPin(request("GET",null,cookieOf(r)),db,id,secret),null);
  assert.equal(await requireClientPin(request("POST",{},cookieOf(r)),db,id,secret),null);
  assert.equal((await requireClientPin(request("POST",pinBody),db,id,secret,"setup")).status,409);
  assert.equal((await requireClientPin(request("POST",{pin:"111111"}),db,id,secret,"login")).status,401);
  assert.equal((await requireClientPin(request("POST",{pin:pinBody.pin}),db,id,secret,"login")).status,200);
});

test("PIN validation, origin checks, attempt limits and database failure all fail closed",async()=>{
  const db=pinDatabase();
  for(const body of [{pin:"1234"},{pin:123456},{pin:"1234567"},{pin:"abcdef"},{pin:"123456",confirmPin:"654321"}])
    assert.equal((await requireClientPin(request("POST",body),db,id,secret,"setup")).status,400);
  assert.equal(db.rows.size,0);
  assert.equal((await requireClientPin(request("POST",pinBody,"","https://evil.test"),db,id,secret,"setup")).status,403);
  assert.equal((await requireClientPin(request("POST",pinBody,"",""),db,id,secret,"setup")).status,403);
  await requireClientPin(request("POST",pinBody),db,id,secret,"setup");
  for(let i=0;i<9;i++) assert.equal((await requireClientPin(request("POST",{pin:"111111"}),db,id,secret,"login")).status,401);
  assert.equal((await requireClientPin(request("POST",{pin:pinBody.pin}),db,id,secret,"login")).status,429);
  assert.equal((await requireClientPin(request(),null,id,secret)).status,503);
  assert.equal((await requireClientPin(request(),db,id,"")).status,503);
  assert.equal((await requireClientPin(request(),{from(){throw new Error("offline");}},id,secret)).status,503);
});

test("sessions cannot cross private links, survive reset versions, be forged, or outlive expiry",async()=>{
  const db=pinDatabase();
  const r=await requireClientPin(request("POST",pinBody),db,id,secret,"setup");
  const cookie=cookieOf(r);
  assert.equal((await requireClientPin(request("GET",null,cookie+"x"),db,id,secret)).status,401);
  assert.equal((await requireClientPin(request("GET",null,cookie),db,portalPinId("message:test-client","reset-link"),secret)).status,401);
  assert.equal((await requireClientPin(request("GET",null,cookie),db,portalPinId("seating:test-client","private-link"),secret)).status,401);
  const now=Date.now;
  try { Date.now=()=>now()+9*60*60*1000; assert.equal((await requireClientPin(request("GET",null,cookie),db,id,secret)).status,401); }
  finally { Date.now=now; }
  db.rows.get(id).version=randomUUID();
  assert.equal((await requireClientPin(request("GET",null,cookie),db,id,secret)).status,401);
  const logout=await requireClientPin(request("POST"),db,id,secret,"logout");
  assert.match(logout.headers.get("set-cookie"),/Max-Age=0/);
  assert.equal((await requireClientPin(request("POST"),db,id,secret,"reset")).status,400);
});

test("simultaneous PIN creation cannot overwrite another successful enrollment",async()=>{
  const db=pinDatabase();
  const results=await Promise.all([
    requireClientPin(request("POST",pinBody),db,id,secret,"setup"),
    requireClientPin(request("POST",{pin:"789012",confirmPin:"789012"}),db,id,secret,"setup"),
  ]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
});

