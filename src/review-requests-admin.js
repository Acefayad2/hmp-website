import { escape } from "../agreement-ui.mjs";
const $ = selector => document.querySelector(selector);
const dialog=$("#review-request-dialog"), form=$("#review-request-form"), message=$("#review-request-message");
const panel=document.createElement("section");
panel.className="agreement-templates";
panel.innerHTML='<h3>Email review requests</h3><p id="review-requests-status" class="agreement-status" role="status"></p><div id="review-requests-list" class="agreement-list"></div>';
$("#reviews-workspace").append(panel);
let requests=[], requestId="", busy=false;
const request = async (body) => {
  const response=await fetch("/api/hmp-review-requests",{method:body ? "POST" : "GET",credentials:"same-origin",cache:"no-store",...(body ? {headers:{"Content-Type":"application/json"},body:JSON.stringify(body)} : {})});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error || "Review request failed.");
  return data;
};
export async function loadReviewRequests() {
  const status=$("#review-requests-status");
  try {
    const data=await request(); requests=data.requests || [];
    status.classList.add("neutral");
    status.textContent=requests.length ? "" : "No review requests sent yet.";
    $("#review-requests-list").innerHTML=requests.map(row => {
      const expired=Date.parse(row.expires_at)<=Date.now();
      const label=row.submitted_at ? "Review received" : expired ? "Expired" : row.email_delivered_at ? "Email sent · awaiting review" : "Email not confirmed";
      return `<div class="agreement-row"><span><strong>${escape(row.client_name)}</strong><small>${escape(row.client_email)}</small></span><span>${label}</span>${!row.submitted_at && !expired && !row.email_delivered_at ? `<button type="button" class="agreement-button secondary" data-retry-review="${escape(row.id)}">Retry email</button>` : ""}</div>`;
    }).join("");
  } catch(error) {status.classList.remove("neutral");status.textContent=error.message;}
}
function open(row) {
  requestId=row?.id || crypto.randomUUID(); form.reset();
  form.elements.clientName.value=row?.client_name || "";
  form.elements.clientEmail.value=row?.client_email || "";
  form.querySelectorAll("input,button").forEach(el=>el.disabled=false);
  // An existing request's contact is immutable, so retries cannot go to another person.
  form.querySelectorAll("input").forEach(el=>el.readOnly=Boolean(row));
  message.textContent=""; dialog.showModal();
}
$("#request-review-button").addEventListener("click",()=>open());
$("#close-review-request").addEventListener("click",()=>{if(!busy)dialog.close();});
dialog.addEventListener("cancel",event=>{if(busy)event.preventDefault();});
$("#review-requests-list").addEventListener("click",event=>{
  const button=event.target.closest("[data-retry-review]");
  if(button) open(requests.find(row=>row.id===button.dataset.retryReview));
});
form.addEventListener("submit",async event=>{
  event.preventDefault(); if(busy || !form.reportValidity())return;
  const values=Object.fromEntries(new FormData(form));
  busy=true; form.querySelectorAll("input,button").forEach(el=>el.disabled=true);
  message.textContent="Sending review request…";
  let sent=false;
  try {
    const data=await request({id:requestId,...values}); sent=true;
    message.textContent=data.warning || (data.alreadySent ? "This review request was already sent." : "Review request emailed. The client’s submission will need your approval before publication.");
    await loadReviewRequests();
  } catch(error) {message.textContent=error.message;}
  finally {
    busy=false;
    if(!sent) {
      form.querySelectorAll("input,button").forEach(el=>el.disabled=false);
      // Preserve ID and original contact for safe retry after uncertain delivery.
      form.querySelectorAll("input").forEach(el=>el.readOnly=true);
    }
  }
});
