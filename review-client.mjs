import { reviewServices, reviewConsent, reviewSubmission } from "./review-request-schema.mjs";
const form=document.querySelector("#client-review-form"), message=document.querySelector("#review-message");
const token=new URLSearchParams(location.hash.slice(1)).get("token") || "";
let busy=false, dirty=false;
const request=async body=>{
  const response=await fetch("/api/hmp-client-review",{method:body ? "POST" : "GET",cache:"no-store",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},...(body ? {body:JSON.stringify(body)} : {})});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error || "Your review could not be saved.");
  return data;
};
const complete=()=>{dirty=false;form.hidden=true;message.textContent="Thank you! Your review has been received. It will appear on our website only after admin approval.";message.classList.add("success");};
document.querySelector("#review-consent").textContent=reviewConsent;
const serviceList=document.querySelector("#client-review-services");
for(const service of reviewServices) {
  const label=document.createElement("label");label.className="agreement-checkbox";
  const input=document.createElement("input");input.type="checkbox";input.name="services";input.value=service;
  label.append(input,document.createTextNode(service));serviceList.append(label);
}
form.addEventListener("input",()=>{dirty=true;});
window.addEventListener("beforeunload",event=>{if(dirty){event.preventDefault();event.returnValue="";}});
form.addEventListener("submit",async event=>{
  event.preventDefault();if(busy || !form.reportValidity())return;
  const values=new FormData(form);
  const body={...Object.fromEntries(values),services:values.getAll("services"),rating:Number(values.get("rating")),consent:values.has("consent")};
  try {reviewSubmission(body);} catch(error) {message.textContent=error.message;message.scrollIntoView({block:"center"});return;}
  busy=true;form.querySelectorAll("input,textarea,select,button").forEach(el=>el.disabled=true);
  message.textContent="Submitting your review…";
  try {await request(body);complete();}
  catch(error){message.textContent=error.message;}
  finally{busy=false;form.querySelectorAll("input,textarea,select,button").forEach(el=>el.disabled=false);message.scrollIntoView({block:"center"});}
});
try {
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error("Please open the private review link in your HMP email.");
  const data=await request();
  if(data.submitted)complete();
  else {form.elements.reviewerName.value=data.clientName;form.hidden=false;message.textContent="";}
} catch(error){message.textContent=error.message;}
