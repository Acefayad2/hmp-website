import test from "node:test";
import assert from "node:assert/strict";
import {checklistRequest} from "../netlify/functions/_event-checklist.ts";

const scope="hub/11111111-1111-4111-8111-111111111111";
const key=`staff-checklist/${scope}`;
const legacy={items:[{text:"Client’s packages",done:false}],notes:"Bring two carts",version:"old-version"};
const url="https://hmpeds.com/api/hmp-event-checklist";

function fixture(value=structuredClone(legacy)){
  const row={key,value};
  const db={from(name){
    assert.equal(name,"hmp_seating_records");
    let operation="select",patch,filters=[];
    const chain={
      select(){return chain;},
      eq(field,expected){filters.push(record=>(field==="value->>version"?record.value?.version:record[field])===expected);return chain;},
      insert(data){operation="insert";patch=data;return chain;},
      update(data){operation="update";patch=data;return chain;},
      async maybeSingle(){
        if(operation==="insert"){if(row.value)return {data:null,error:{message:"Duplicate key"}};Object.assign(row,patch);return {data:{key}};}
        if(!filters.every(match=>match(row)))return {data:null,error:null};
        if(operation==="update")Object.assign(row,patch);
        return {data:{...row},error:null};
      },
    };
    return chain;
  }};
  return {db,row};
}
const request=(method,body)=>new Request(url,{method,headers:method==="POST"?{Origin:"https://hmpeds.com","Content-Type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined});

test("a second saved checklist keeps the earlier checklist and its notes",async()=>{
  const {db,row}=fixture();
  const first=await (await checklistRequest(db,scope,request("GET"))).json();
  assert.equal(first.checklists.length,1);
  assert.equal(first.checklists[0].notes,"Bring two carts");
  const second={id:crypto.randomUUID(),title:"Packing",items:[{text:"Signage",done:false}],notes:"Print labels",createdAt:new Date().toISOString()};
  const saved=await checklistRequest(db,scope,request("POST",{scope,version:first.version,checklists:[...first.checklists,second]}));
  assert.equal(saved.status,200);
  assert.equal(row.value.checklists.length,2);
  assert.deepEqual(row.value.checklists[0].items,legacy.items);
  assert.equal(row.value.checklists[0].notes,legacy.notes);
  assert.equal(row.value.checklists[1].title,"Packing");
  assert.equal((await checklistRequest(db,scope,request("POST",{scope,version:first.version,checklists:[second]}))).status,409);
});

test("bad checklist data and cross-origin writes do not change saved entries",async()=>{
  const {db,row}=fixture();
  const before=structuredClone(row.value);
  const invalid={scope,version:"old-version",checklists:[{id:crypto.randomUUID(),title:"",items:[{text:"",done:false}],notes:"",createdAt:new Date().toISOString()}]};
  assert.equal((await checklistRequest(db,scope,request("POST",invalid))).status,400);
  const crossOrigin=new Request(url,{method:"POST",headers:{Origin:"https://other.example"},body:JSON.stringify(invalid)});
  assert.equal((await checklistRequest(db,scope,crossOrigin)).status,403);
  assert.deepEqual(row.value,before);
});
