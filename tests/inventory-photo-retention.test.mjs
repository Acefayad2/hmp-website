import test from "node:test";
import assert from "node:assert/strict";
import {photoDeadline,photosExpired} from "../netlify/functions/_inventory-photo-retention.mts";
import {createPurgeInventoryPhotos} from "../netlify/functions/purge-inventory-photos.mts";

test("photo deadline is 24 hours after the recorded end, with a conservative date-only fallback", () => {
  assert.equal(photoDeadline({endAt:"2026-11-09T20:00:00.000Z"}),Date.parse("2026-11-10T20:00:00.000Z"));
  assert.equal(photoDeadline({date:"2026-11-09"}),Date.parse("2026-11-10T23:59:59.999Z"));
  assert.equal(photoDeadline({}),null);
  assert.equal(photosExpired({endAt:"2026-11-09T20:00:00.000Z"},Date.parse("2026-11-10T19:59:59.000Z")),false);
});

test("scheduled cleanup removes expired inventory photos and references, preserving items and future photos", async () => {
  const eventId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const itemId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const photoId="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const path=`inventory/${eventId}/${itemId}/${photoId}.jpg`;
  const eventKey=`inventory/event/${eventId}`;
  const itemKey=`inventory/${eventId}/item/${itemId}`;
  const rows=new Map([
    [eventKey,{key:eventKey,value:{id:eventId,name:"Gala",endAt:"2026-11-09T20:00:00.000Z"}}],
    [itemKey,{key:itemKey,value:{id:itemId,name:"Gift",version:photoId,photo:{path}}}],
  ]);
  const files=new Set([path]);
  const db={
    from(table){
      assert.equal(table,"hmp_seating_records");
      const filters=[];let pending;
      const query={
        select(){return query;},like(_key,pattern){filters.push(row=>row.key.startsWith(pattern.slice(0,-1)));return query;},
        filter(){filters.push(row=>!row.value.photosPurgedAt);return query;},
        order(){return query;},
        async range(start,end){return {data:[...rows.values()].filter(row=>filters.every(fn=>fn(row))).slice(start,end+1),error:null};},
        eq(key,value){filters.push(row=>key==="key"?row.key===value:row.value.version===value);return query;},
        update(value){pending=value;return query;},
        async limit(){return {data:[...rows.values()].filter(row=>filters.every(fn=>fn(row))),error:null};},
        async maybeSingle(){const row=[...rows.values()].find(row=>filters.every(fn=>fn(row)));if(!row)return {data:null,error:null};if(pending){rows.set(row.key,{...row,...pending});return {data:{key:row.key},error:null};}return {data:row,error:null};},
        then(resolve,reject){const row=[...rows.values()].find(row=>filters.every(fn=>fn(row)));if(row&&pending)rows.set(row.key,{...row,...pending});return Promise.resolve({error:null}).then(resolve,reject);},
      };return query;
    },
    storage:{from(){return {
      async list(folder){
        if(folder===`inventory/${eventId}`)return {data:[{name:itemId,id:null}],error:null};
        if(folder===`inventory/${eventId}/${itemId}`)return {data:[...files].map(file=>({name:file.split("/").at(-1),id:photoId})),error:null};
        return {data:[],error:null};
      },
      async remove(paths){for(const file of paths)files.delete(file);return {error:null};},
    };}},
  };
  const purge=createPurgeInventoryPhotos({databaseFactory:()=>db,now:()=>Date.parse("2026-11-10T20:01:00.000Z")});
  const result=await (await purge()).json();
  assert.deepEqual(result,{purged:1});
  assert.equal(files.size,0);
  assert.equal(rows.get(itemKey).value.name,"Gift");
  assert.equal(rows.get(itemKey).value.photo,undefined);
  assert.ok(rows.get(eventKey).value.photosPurgedAt);
  assert.deepEqual(await (await purge()).json(),{purged:0});
});
