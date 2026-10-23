export function mountAdminVerification({form,loginForm,passwordForm,authShell,dashboard,onVerified,onCancel}) {
  const message=form.querySelector('[role="status"]');
  const code=form.querySelector('[name="code"]');
  const sendButton=form.querySelector('[data-resend]');
  let pendingUser=null, sending=false;
  const request=async(action,extra={})=>{
    const response=await fetch('/api/hmp-admin-verification',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...extra})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Verification is unavailable. Please try again.');
    return result;
  };
  async function send(){
    if(sending)return;
    sending=true;sendButton.disabled=true;message.textContent='Sending your code…';
    try{await request('send');message.textContent='Code sent. Check your inbox or spam folder. It expires in 10 minutes; only the newest code works.';code.focus();}
    catch(error){message.textContent=error.message;}
    finally{sending=false;sendButton.disabled=false;}
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();const button=form.querySelector('[type="submit"]');button.disabled=true;
    try{await request('verify',{code:code.value.trim()});code.value='';form.hidden=true;const user=pendingUser;pendingUser=null;await onVerified(user);}
    catch(error){authShell.hidden=false;dashboard.hidden=true;form.hidden=false;message.textContent=error.message;code.focus();}
    finally{button.disabled=false;}
  });
  sendButton.addEventListener('click',send);
  form.querySelector('[data-cancel]').addEventListener('click',async()=>{
    try{await onCancel();}catch(error){message.textContent=error.message;}
  });
  return {
    async ensure(user){
      const response=await fetch('/api/hmp-admin-verification',{credentials:'same-origin',cache:'no-store'});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Could not verify your Admin sign-in.');
      if(result.verified){form.hidden=true;pendingUser=null;return true;}
      authShell.hidden=false;dashboard.hidden=true;loginForm.hidden=true;passwordForm.hidden=true;form.hidden=false;
      form.querySelector('[data-email]').textContent=result.email;
      if(!pendingUser){pendingUser=user;await send();}
      return false;
    },
  };
}
