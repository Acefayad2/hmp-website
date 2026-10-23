import { escape } from "../agreement-ui.mjs";
const $ = selector => document.querySelector(selector);
const dialog=$("#review-request-dialog"), form=$("#review-request-form"), message=$("#review-request-message");
const panel=document.createElement("section");
panel.className="agreement-templates";
panel.innerHTML='<h3>Review requests and shared-link submissions</h3><p id="review-requests-status" class="agreement-status" role="status"></p><div id="review-requests-list" class="agreement-list"></div>';
$("#reviews-workspace").insertBefore(panel, $("#archived-reviews"));
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
    status.textContent=requests.length ? "" : "No review requests or submissions yet.";
    $("#review-requests-list").innerHTML=requests.map(row => {
      const expired=Date.parse(row.expires_at)<=Date.now();
      const shared=row.created_by==="Universal review link";
      const label=shared ? "Submitted through shared link" : row.submitted_at ? "Review received" : expired ? "Expired" : row.email_delivered_at ? "Email sent · awaiting review" : "Email not confirmed";
      return `<div class="agreement-row"><span><strong>${escape(row.client_name)}</strong><small>${escape(row.client_email)}</small></span><span>${label}</span>${row.clientUrl ? `<button type="button" class="agreement-button secondary" data-copy-review="${escape(row.id)}">Copy link</button>` : ""}${!shared && !row.submitted_at && !expired && !row.email_delivered_at ? `<button type="button" class="agreement-button secondary" data-retry-review="${escape(row.id)}">Send email</button>` : ""}</div>`;
    }).join("");
  } catch(error) {status.classList.remove("neutral");status.textContent=error.message;}
}
$("#copy-universal-review-url").addEventListener("click",async()=>{
  const input=$("#universal-review-url"), status=$("#review-share-status");
  try {await navigator.clipboard.writeText(input.value);status.textContent="Reusable review link copied. Share it with clients by email, text, or the portal.";}
  catch {input.select();status.textContent="Copy the selected link to share it with clients.";}
});
function open(row) {
  requestId=row?.id || crypto.randomUUID(); form.reset();
  form.elements.clientName.value=row?.client_name || "";
  form.elements.clientEmail.value=row?.client_email || "";
  form.querySelectorAll("input,button").forEach(el=>el.disabled=false);
  // An existing request's contact is immutable, so retries cannot go to another person.
  form.querySelectorAll("input").forEach(el => { el.readOnly = Boolean(row) && el.name !== "clientPhone"; });
  message.textContent=""; dialog.showModal();
}
$("#request-review-button").addEventListener("click",()=>open());
$("#close-review-request").addEventListener("click",()=>{if(!busy)dialog.close();});
dialog.addEventListener("cancel",event=>{if(busy)event.preventDefault();});
$("#review-requests-list").addEventListener("click",event=>{
  const copy=event.target.closest("[data-copy-review]");
  if(copy) {
    const row=requests.find(item=>item.id===copy.dataset.copyReview);
    if(row?.clientUrl) navigator.clipboard.writeText(row.clientUrl)
      .then(()=>{ $("#review-requests-status").textContent="Private review link copied. Text it only to this client."; })
      .catch(()=>{ $("#review-requests-status").textContent="Copying was blocked by your browser."; });
    return;
  }
  const button=event.target.closest("[data-retry-review]");
  if(button) open(requests.find(row=>row.id===button.dataset.retryReview));
});
form.addEventListener("submit",async event=>{
  event.preventDefault(); if(busy || !form.reportValidity())return;
  const values=Object.fromEntries(new FormData(form));
  const shareOnly=event.submitter?.dataset.reviewRequestAction==="share";
  const textOnly=event.submitter?.dataset.reviewRequestAction==="text";
  if (textOnly && !String(values.clientPhone || "").trim()) {
    message.textContent = "Enter a mobile number to text this review link.";
    return;
  }
  if (textOnly && !window.confirm(`Text the review link to ${values.clientName} at ${values.clientPhone}? No email will be sent.`)) return;
  busy=true; form.querySelectorAll("input,button").forEach(el=>el.disabled=true);
  message.textContent=textOnly ? "Creating the private link and sending the text…" : shareOnly ? "Creating private link…" : "Sending review request…";
  let sent=false;
  try {
    const data=await request({id:requestId,...values,...(shareOnly || textOnly ? {action:"share"} : {})});
    if (textOnly) {
      if (!data.clientUrl) throw new Error("The review link was created, but it could not be read for texting.");
      const smsResponse = await fetch("/api/hmp-sms", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: values.clientPhone,
          contactName: values.clientName,
          content: `Hello ${String(values.clientName).trim()}, HMP would love your feedback. This private link is only for you: ${data.clientUrl}`,
          requestId: crypto.randomUUID(),
        }),
      });
      const sms = await smsResponse.json().catch(() => ({}));
      if (!smsResponse.ok) throw new Error(sms.error || "The review link was created, but the text could not be sent. Use Copy link in the list below.");
      sent = true;
      message.textContent = `Review link texted to ${sms.to || values.clientPhone}. No email was sent.`;
    } else if(shareOnly) {
      sent=true;
      try {await navigator.clipboard.writeText(data.clientUrl); message.textContent="Private link copied. Text it only to this client. No email was sent.";}
      catch {message.textContent="Link created. Use Copy link in the review request list below.";}
    } else {
      sent=true;
      message.textContent=data.warning || (data.alreadySent ? "This review request was already sent." : "Review request emailed. The client’s submission will need your approval before publication.");
    }
    await loadReviewRequests();
  } catch(error) {message.textContent=error.message;}
  finally {
    busy=false;
    if(!sent) {
      form.querySelectorAll("input,button").forEach(el=>el.disabled=false);
      // Preserve ID and original contact for safe retry after uncertain delivery.
      form.querySelectorAll("input").forEach(el => { el.readOnly = el.name !== "clientPhone"; });
    }
  }
});
