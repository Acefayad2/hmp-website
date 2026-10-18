import {parseProposal} from "./proposal-ui.js";

export function latestDocumentRows(rows=[]) {
  const families=new Map();
  for(const row of rows){
    const key=row.revisionRootId||row.revision_root_id||row.id;
    const previous=families.get(key);
    if(!previous||String(row.createdAt||row.created_at||"")>String(previous.createdAt||previous.created_at||""))families.set(key,row);
  }
  return rows.filter(row=>families.get(row.revisionRootId||row.revision_root_id||row.id)===row);
}

// Only admin-authored, actually shared messages participate. No draft rows enter
// this collection. Keep old copies in Admin; send the current copy to clients.
export function latestPublishedDocuments(messages=[]) {
  const selected=new Map();
  const keyFor=message=>{
    if(message.sender!=="admin")return null;
    const copy=message.document;
    if(["invoice","contract","form"].includes(copy?.kind)&&copy.id)return `${copy.kind}/${copy.revisionRootId||copy.id}`;
    if(parseProposal(message.body))return `proposal/${message.revisionRootId||message.revision_root_id||message.id}`;
    return null;
  };
  for(const message of messages){
    const key=keyFor(message);if(!key)continue;
    const previous=selected.get(key);
    if(!previous||String(message.createdAt||message.created_at||"")>=String(previous.createdAt||previous.created_at||""))selected.set(key,message);
  }
  return messages.filter(message=>{const key=keyFor(message);return !key||selected.get(key)===message;});
}
