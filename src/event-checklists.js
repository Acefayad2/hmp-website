const copy = value => structuredClone(value);

export const mountEventChecklists = ({root,getEventId}) => {
  const output=root.querySelector("div"),status=root.querySelector('p[role="status"]');
  let requestNumber=0,eventId="",record=null,selectedId=null,draft=null,draftBaseline="",busy=false;
  const button=(label,onClick)=>{const element=document.createElement("button");element.type="button";element.className="secondary-button";element.textContent=label;element.addEventListener("click",onClick);return element;};
  const freshDraft=(starters=[])=>({title:"",items:starters.length?starters.map(text=>({text,done:false})):[{text:"",done:false}],notes:""});
  const setDraft=value=>{draft=copy(value);draftBaseline=JSON.stringify(draft);};
  const changed=()=>Boolean(draft)&&JSON.stringify(draft)!==draftBaseline;
  const askBeforeReplacing=()=>!changed()||window.confirm("Discard unsaved checklist changes?");
  const save=async checklists=>{
    if(busy)return false;
    const savingEventId=eventId,sequence=requestNumber;
    busy=true;output.inert=true;status.textContent="Saving checklists…";
    try{
      const response=await fetch(`/api/hmp-event-checklist?id=${encodeURIComponent(eventId)}`,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({scope:record.scope,version:record.version,checklists})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Checklists could not be saved.");
      if(sequence!==requestNumber||savingEventId!==eventId)return false;
      record=data;status.textContent="Checklists saved privately. Earlier checklists remain available.";return true;
    }catch(error){if(sequence===requestNumber)status.textContent=error.message||"Checklists could not be saved.";return false;}
    finally{busy=false;output.inert=false;}
  };
  const render=()=>{
    output.replaceChildren();
    if(!record)return;
    const heading=document.createElement("h4");heading.textContent=`Saved checklists (${record.checklists.length})`;output.append(heading);
    if(!record.checklists.length){const empty=document.createElement("p");empty.textContent="No checklist has been saved yet.";output.append(empty);}
    for(const entry of record.checklists){
      const card=document.createElement("div"),details=document.createElement("details"),summary=document.createElement("summary"),content=document.createElement("div"),actions=document.createElement("div");
      card.className="hub-note-entry";details.className="hub-note-card";actions.className="hub-notes-actions";
      const done=entry.items.filter(item=>item.done).length;
      summary.textContent=`${entry.title} · ${done}/${entry.items.length} complete${entry.createdAt.startsWith("1970-")?"":" · "+new Date(entry.createdAt).toLocaleDateString()}`;
      for(const item of entry.items){const line=document.createElement("p");line.textContent=`${item.done?"☑":"☐"} ${item.text}`;content.append(line);}
      if(entry.notes){const line=document.createElement("p");line.textContent=`Additional notes: ${entry.notes}`;content.append(line);}
      details.append(summary,content);
      actions.append(button("Edit checklist",()=>{if(!askBeforeReplacing())return;selectedId=entry.id;setDraft({title:entry.title,items:entry.items,notes:entry.notes});render();output.querySelector("[data-checklist-title]")?.focus();}));
      actions.append(button("Delete checklist",async()=>{if(!window.confirm(`Delete “${entry.title}”? This cannot be undone.`))return;const remaining=record.checklists.filter(item=>item.id!==entry.id);if(await save(remaining)){if(selectedId===entry.id){selectedId=null;setDraft(freshDraft());}render();}}));
      card.append(details,actions);output.append(card);
    }
    output.append(button("Add another checklist",()=>{if(!askBeforeReplacing())return;selectedId=null;setDraft(freshDraft());render();output.querySelector("[data-checklist-title]")?.focus();}));
    const editor=document.createElement("section"),editorHeading=document.createElement("h4"),titleLabel=document.createElement("label"),title=document.createElement("input"),itemsHeading=document.createElement("h5"),items=document.createElement("div"),notesLabel=document.createElement("label"),notes=document.createElement("textarea"),saveButton=button(selectedId?"Save checklist changes":"Save new checklist",async()=>{
      const titleText=draft.title.trim();
      if(!titleText){status.textContent="Enter a checklist name before saving.";title.focus();return;}
      const blank=draft.items.findIndex(item=>!item.text.trim());
      if(blank>=0){status.textContent=`Checklist item ${blank+1} is blank. Enter text or remove it.`;items.querySelectorAll('[data-checklist-item]')[blank]?.focus();return;}
      if(!draft.items.length){status.textContent="Add at least one checklist item.";return;}
      if(!selectedId && record.checklists.length>=30){status.textContent="This event already has 30 checklists.";return;}
      const previous=record.checklists.find(item=>item.id===selectedId);
      const entry={id:previous?.id||crypto.randomUUID(),title:titleText,items:copy(draft.items),notes:draft.notes,createdAt:previous?.createdAt||new Date().toISOString()};
      const next=previous?record.checklists.map(item=>item.id===selectedId?entry:item):[...record.checklists,entry];
      if(await save(next)){selectedId=entry.id;setDraft({title:entry.title,items:entry.items,notes:entry.notes});render();}
    });
    editor.className="hub-checklist-editor";editorHeading.textContent=selectedId?"Edit saved checklist":"New checklist";
    titleLabel.textContent="Checklist name";title.dataset.checklistTitle="";title.maxLength=120;title.value=draft.title;title.placeholder="For example, Event setup";title.addEventListener("input",()=>draft.title=title.value);titleLabel.append(title);
    itemsHeading.textContent="Items";
    const drawItems=()=>{items.replaceChildren();draft.items.forEach((item,index)=>{
      const row=document.createElement("div"),checkbox=document.createElement("input"),name=document.createElement("input");
      row.className="hub-checklist-item";checkbox.type="checkbox";checkbox.checked=item.done;checkbox.setAttribute("aria-label",`Completed: ${item.text||`item ${index+1}`}`);checkbox.addEventListener("change",()=>item.done=checkbox.checked);
      name.dataset.checklistItem="";name.value=item.text;name.maxLength=160;name.setAttribute("aria-label",`Checklist item ${index+1}`);name.addEventListener("input",()=>item.text=name.value);
      row.append(checkbox,name,button("Remove",()=>{draft.items.splice(index,1);drawItems();}));items.append(row);
    });};drawItems();
    notesLabel.textContent="Additional notes";notes.value=draft.notes;notes.maxLength=2000;notes.rows=4;notes.addEventListener("input",()=>draft.notes=notes.value);notesLabel.append(notes);
    editor.append(editorHeading,titleLabel,itemsHeading,items,button("Add item",()=>{draft.items.push({text:"",done:false});drawItems();items.querySelectorAll('[data-checklist-item]')[draft.items.length-1]?.focus();}),notesLabel,saveButton);
    output.append(editor);
  };
  const load=async()=>{
    const id=getEventId(),sequence=++requestNumber;
    eventId=id;record=null;draft=null;draftBaseline="";selectedId=null;output.replaceChildren();status.textContent=id?"Loading checklists…":"Choose an event to view its checklists.";
    if(!root.open||!id)return;
    try{
      const response=await fetch(`/api/hmp-event-checklist?id=${encodeURIComponent(id)}`,{credentials:"same-origin",cache:"no-store"});
      const data=await response.json();
      if(sequence!==requestNumber||id!==getEventId())return;
      if(!response.ok)throw new Error(data.error||"Checklists could not be loaded.");
      record=data;setDraft(freshDraft(data.checklists.length?[]:data.starterItems));status.textContent="";render();
    }catch(error){if(sequence===requestNumber)status.textContent=error.message||"Checklists could not be loaded.";}
  };
  root.addEventListener("toggle",load);
  return {load};
};
