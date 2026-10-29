import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { getAgreementTemplate, newAgreementSnapshot } from '../../agreement-schema.mjs';
const terms = JSON.parse(readFileSync(new URL('../../data/agreement-terms.json', import.meta.url), 'utf8'));
const template = getAgreementTemplate('money-bank-verification');
const snapshot = newAgreementSnapshot(template, terms[template.id]);
const token = 'q'.repeat(43);
const prefix = 'hmp-money-bank-draft-v1:';
const consent = 'Synthetic QA consent only. No real agreement is signed.';
const original = { id:'00000000-0000-4000-8000-000000000057', updatedAt:'2026-01-01T00:00:00Z', status:'Sent', clientName:'Synthetic QA Client', clientEmail:'qa@example.test', expiresAt:'2099-01-01T00:00:00Z', snapshot, adminAnswers:{} };

test('expired Admin verification preserves typed Forms input and never replays the mutation', async ({page}) => {
  await page.goto('/agreement.html');
  await page.setContent('<dialog id="information-editor"><label>Client name<input id="typed-client" value="Typed Client"></label></dialog><form id="synthetic-verification"><label>Verification code<input id="verification-code"></label></form>');
  const result = await page.evaluate(async () => {
    let requests = 0, authenticationEvents = 0;
    const dialog = document.querySelector('#information-editor');
    dialog.showModal();
    window.fetch = async () => {
      requests++;
      return Response.json({error:'Unauthorized'}, {status:401});
    };
    const {agreementRequest,createAdminFormDialogSuspension} = await import('/agreement-ui.mjs?admin-auth-interruption');
    const suspension = createAdminFormDialogSuspension(document);
    window.syntheticAdminDialogSuspension = suspension;
    window.addEventListener('hmp-admin-auth-required', () => { authenticationEvents++; suspension.suspend(); });
    let status = 0, message = '';
    try {
      await agreementRequest('/api/hmp-agreement-forms', {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'share'})});
    } catch (error) {
      status = error.status;
      message = error.message;
    }
    const suspended = !dialog.open;
    return {requests, authenticationEvents, status, message, suspended, typed:document.querySelector('#typed-client').value};
  });
  expect(result).toEqual({
    requests:1,
    authenticationEvents:1,
    status:401,
    message:'Your Admin verification has expired or access is unavailable. Verify your sign-in, then try again.',
    suspended:true,
    typed:'Typed Client',
  });
  await page.locator('#verification-code').click();
  await expect(page.locator('#verification-code')).toBeFocused();
  const restored = await page.evaluate(() => {
    window.syntheticAdminDialogSuspension.restore();
    return {open:document.querySelector('#information-editor').open,typed:document.querySelector('#typed-client').value};
  });
  expect(restored).toEqual({open:true,typed:'Typed Client'});
});
const input = (page, name) => page.locator(`[name="${name}"]`);
async function fixture(page) {
  let agreement = structuredClone(original), failGet = false, failPost = false, gets = 0, posts = 0, saves = 0;
  await page.route('**/api/**', async route => {
    const request = route.request();
    if (new URL(request.url()).pathname !== '/api/hmp-agreement') return route.abort();
    if (request.headers().authorization !== `Bearer ${token}` || Date.parse(agreement.expiresAt) <= Date.now()) return route.fulfill({status:410,json:{error:'This link has expired or is no longer available.'}});
    if (request.method() === 'GET') {
      gets++;
      return route.fulfill({status:failGet?503:200,json:failGet?{error:'Synthetic unavailable'}:{agreement,signingConsent:consent}});
    }
    if (request.method() === 'POST') {
      const body=request.postDataJSON();
      if (body.action === 'save-progress') {
        saves++;
        if (failPost) return route.fulfill({status:503,json:{error:'Synthetic storage unavailable'}});
        if (body.updatedAt !== agreement.updatedAt || body.agreementId !== agreement.id) return route.fulfill({status:409,json:{error:'This draft changed on another device. Reopen the link.'}});
        const updatedAt=new Date(Date.parse(agreement.updatedAt)+1000).toISOString();
        agreement={...agreement,updatedAt,bankProgress:{values:body.answers,updatedAt}};
        return route.fulfill({status:200,json:{agreement}});
      }
      posts++;
      if (failPost) return route.fulfill({status:503,json:{error:'Synthetic submission unavailable'}});
      agreement={...agreement,status:'Completed',bankProgress:undefined,clientAnswers:body.answers,signature:{name:body.signatureName,consent,drawings:body.signatureDrawings},completedAt:new Date().toISOString(),recordHash:'synthetic-only'};
      return route.fulfill({status:200,json:{agreement}});
    }
    return route.abort();
  });
  page.on('dialog', d => d.accept());
  await page.goto(`/agreement.html#token=${token}`);
  await expect(page.getByRole('button',{name:'Save draft',exact:true})).toBeVisible();
  return {get posts(){return posts},get saves(){return saves},get agreement(){return structuredClone(agreement)},get gets(){return gets},setAgreement:value=>{agreement=value},setFailGet:value=>{failGet=value},setFailPost:value=>{failPost=value}};
}
const save = async page => {
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect(page.locator('#draft-status')).toContainText('Details and initials saved');
};
const draftEntries = page => page.evaluate(prefix=>Object.entries(localStorage).filter(([key])=>key.startsWith(prefix)),prefix);
const fillRequired = async page => {
  const values={clientName:'Synthetic QA Client',eventDate:'2026-12-01',eventType:'Synthetic event',recommendedBank:'500',actualBank:'450',receivedInitials:'QR',reconciledBank:'450',reconciledInitials:'QR',representativeOneName:'QA Representative',representativeOneSignature:'QA Representative',representativeOneDate:'2026-12-01',attendantName:'QA Attendant',attendantDate:'2026-12-01',signatureName:'QA Attendant'};
  for(const [name,value] of Object.entries(values)) await input(page,name).fill(value);
  await input(page,'representativeOneConsent').check();
  await input(page,'consent').check();
};

test('each signer starts a fresh row and stays with their own signature or date',async({page},testInfo)=>{
  const f=await fixture(page);
  for (const [title,names] of [
    ['First designated representative',['representativeOneName','representativeOneSignature','representativeOneDate']],
    ['Second designated representative',['representativeTwoName','representativeTwoSignature','representativeTwoDate']],
    ['HMP money attendant',['attendantName','attendantDate','signatureName']]
  ]) {
    const group=page.getByRole('group',{name:title,exact:true});
    await expect(group).toBeVisible();
    for(const name of names) await expect(group.locator(`[name="${name}"]`)).toHaveCount(1);
    await expect(group.locator('.signature-pad')).toHaveCount(1);
  }
  const box=async name=>input(page,name).locator('..').boundingBox();
  const firstDate=await box('representativeOneDate');
  const secondName=await box('representativeTwoName');
  const secondSignature=await box('representativeTwoSignature');
  const secondDate=await box('representativeTwoDate');
  const attendantName=await box('attendantName');
  const attendantDate=await box('attendantDate');
  expect(secondName.y).toBeGreaterThanOrEqual(firstDate.y+firstDate.height);
  expect(attendantName.y).toBeGreaterThanOrEqual(secondDate.y+secondDate.height);
  if(page.viewportSize().width>600){
    expect(Math.abs(secondName.y-secondSignature.y)).toBeLessThan(1);
    expect(secondSignature.x).toBeGreaterThan(secondName.x);
    expect(Math.abs(attendantName.y-attendantDate.y)).toBeLessThan(1);
    expect(attendantDate.x).toBeGreaterThan(attendantName.x);
  }else{
    expect(secondSignature.y).toBeGreaterThanOrEqual(secondName.y+secondName.height);
    expect(attendantDate.y).toBeGreaterThanOrEqual(attendantName.y+attendantName.height);
  }
  await input(page,'representativeTwoName').fill('Second Test Signer');
  await input(page,'representativeTwoSignature').fill('Second Test Signer');
  const pad=page.locator('.signature-pad').filter({has:page.getByText('Second representative signature',{exact:true})});
  await expect(pad.locator('.agreement-signature')).toHaveText('Second Test Signer');
  await expect(input(page,'representativeTwoDate')).toHaveAttribute('required','');
  await pad.getByRole('button',{name:'Draw',exact:true}).click();
  await expect(pad.locator('canvas')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(f.posts).toBe(0);
  await page.screenshot({path:testInfo.outputPath('signer-layout.png'),fullPage:true});
});

test('incomplete draft resumes without signing evidence; compact terms and responsive layout',async({page},testInfo)=>{
  const f=await fixture(page);
  await expect(page.getByText('Money bank verification text',{exact:true})).toHaveCount(0);
  const details=page.locator('details').filter({has:page.getByText('Review original form terms before signing',{exact:true})});
  await expect(details).not.toHaveAttribute('open','');
  await details.locator('summary').click();
  await expect(details).toHaveAttribute('open','');
  await details.locator('summary').click();
  await input(page,'actualBank').fill('125');
  await input(page,'representativeOneName').fill('QA Representative');
  for(const name of ['receivedInitials','representativeOneSignature','signatureName']) await input(page,name).fill('QA');
  await input(page,'representativeOneDate').fill('2026-12-01');
  await input(page,'representativeOneConsent').check(); await input(page,'consent').check();
  await save(page); expect(f.posts).toBe(0);
  expect(await draftEntries(page)).toHaveLength(0);
  expect(f.agreement.bankProgress.values.receivedInitials).toBe('QA');
  expect(f.agreement.bankProgress.values.representativeOneSignature).toBeUndefined();
  await page.evaluate(()=>localStorage.clear());
  await page.reload();
  await expect(page.locator('#draft-status')).toContainText('Shared draft restored');
  await expect(input(page,'actualBank')).toHaveValue('125');
  await expect(input(page,'representativeOneName')).toHaveValue('QA Representative');
  await expect(input(page,'receivedInitials')).toHaveValue('QA');
  for(const name of ['representativeOneSignature','representativeOneDate','signatureName']) await expect(input(page,name)).toHaveValue('');
  await expect(input(page,'representativeOneConsent')).not.toBeChecked();await expect(input(page,'consent')).not.toBeChecked();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByRole('button',{name:'Save draft',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath('draft-restored.png'),fullPage:true});
});

test('empty and partial Draw do not block saving and are not restored',async({page})=>{
  const f=await fixture(page);
  await input(page,'actualBank').fill('123');
  const pad=page.locator('.signature-pad').filter({has:page.getByText('First representative signature',{exact:true})});
  await pad.getByRole('button',{name:'Draw',exact:true}).click();
  await save(page);expect(f.posts).toBe(0);
  const canvas=pad.locator('canvas'); await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
  await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();await page.mouse.move(box.x+90,box.y+45,{steps:8});await page.mouse.up();
  await save(page);await page.reload();
  await expect(pad.getByRole('button',{name:'Type',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(canvas).toBeHidden();expect(f.posts).toBe(0);
});

test('failed save and stale agreement keep current inputs and previous draft',async({page})=>{
  const f=await fixture(page);await input(page,'actualBank').fill('125');await save(page);const before=f.agreement.bankProgress;
  await input(page,'actualBank').fill('999');f.setFailPost(true);
  await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.locator('#draft-status')).toContainText('Draft was not saved');
  await expect(input(page,'actualBank')).toHaveValue('999');expect(f.agreement.bankProgress).toEqual(before);
  f.setFailPost(false);f.setAgreement({...f.agreement,updatedAt:'2026-10-29T00:00:00Z'});
  await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.locator('#draft-status')).toContainText('changed on another device');
  expect(f.agreement.bankProgress).toEqual(before);expect(f.posts).toBe(0);
});

test('denied browser storage does not prevent a shared save',async({page})=>{
  await page.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('Synthetic storage denied','QuotaExceededError')}});
  const f=await fixture(page);await input(page,'actualBank').fill('123');await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect(page.locator('#draft-status')).toContainText('Details and initials saved');await expect(input(page,'actualBank')).toHaveValue('123');expect(f.posts).toBe(0);expect(f.agreement.bankProgress.values.actualBank).toBe('123');
});

test('repeated save clicks do not submit and keep a single draft',async({page})=>{
  const f=await fixture(page);await input(page,'actualBank').fill('123');
  await page.locator('#save-agreement-draft').evaluate(button=>{button.click();button.click();});
  await expect(page.locator('#draft-status')).toContainText('Details and initials saved');
  expect(f.gets).toBe(1);expect(f.posts).toBe(0);expect(f.saves).toBe(1);expect(await draftEntries(page)).toHaveLength(0);
});

test('expired link and changed agreement cannot restore old answers',async({page})=>{
  const f=await fixture(page);await input(page,'actualBank').fill('123');await save(page);
  f.setAgreement({...f.agreement,expiresAt:'2000-01-01T00:00:00Z'});
  await page.reload();await expect(page.locator('#agreement-message')).toContainText('expired');await expect(input(page,'actualBank')).toHaveCount(0);
  f.setAgreement({...original,snapshot:{...snapshot,version:'synthetic-changed'}});
  await page.reload();await expect(input(page,'actualBank')).toHaveValue('');expect(f.posts).toBe(0);
});

test('another token and another agreement cannot inherit this draft',async({page})=>{
  const f=await fixture(page);await input(page,'actualBank').fill('123');await save(page);
  await page.goto(`/agreement.html#token=${'r'.repeat(43)}`);await page.reload();await expect(input(page,'actualBank')).toHaveCount(0);
  f.setAgreement({...original,id:'00000000-0000-4000-8000-000000000058'});await page.goto(`/agreement.html#token=${token}`);await page.reload();await expect(input(page,'actualBank')).toHaveValue('');expect(f.posts).toBe(0);
});

test('final validation and failed submission preserve draft; confirmed synthetic completion clears it',async({page},testInfo)=>{
  const f=await fixture(page);await input(page,'actualBank').fill('123');await save(page);
  await page.getByRole('button',{name:'Sign & submit form',exact:true}).click();await expect(page.locator('[data-validation-summary]')).toBeVisible();expect(f.posts).toBe(0);
  await fillRequired(page);f.setFailPost(true);await page.getByRole('button',{name:'Sign & submit form',exact:true}).click();await expect(page.locator('#signature-status')).toContainText('Synthetic submission unavailable');expect(f.agreement.bankProgress.values.actualBank).toBe('123');
  f.setFailPost(false);await page.getByRole('button',{name:'Sign & submit form',exact:true}).click();await expect(page.getByRole('heading',{name:'Completed client details'})).toBeVisible();expect(await draftEntries(page)).toHaveLength(0);expect(f.posts).toBe(2);
  expect(f.agreement.bankProgress).toBeUndefined();await page.reload();await expect(page.getByRole('heading',{name:'Completed client details'})).toBeVisible();await expect(page.getByRole('button',{name:'Save draft',exact:true})).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('synthetic-completed.png'),fullPage:true});
});
