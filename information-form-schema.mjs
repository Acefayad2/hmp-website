// Retired templates remain available for saved records and existing private links.
const text = (id, label, help = "", required = true) => ({id, label, help, type:"textarea", required});
const contact = text("responsibleContact", "Responsible point of contact(s)", "Provide each person’s name and phone number. Choose someone other than the client(s) for HMP to contact about incidentals. Let your loved ones know HMP will handle money-table services at your event.");
const bank = text("changeBank", "Confirm the change-bank amount", "The change bank must contain only $1 bills. Please request batches of 100 or 50 from your bank and include any additional bank instructions. Do not provide bank account numbers.");
const delivery = text("bankDelivery", "Person(s) delivering the bank", "Provide names and phone numbers. Delivery to the service location is preferably one hour before service starts.");
const payment = text("digitalPayments", "Digital payment information for signs", "Provide the names and public payment handles for at least two digital transfer platforms. Send QR-code screenshots through your HMP message thread or email info@hmpeds.com. Never provide passwords or login codes. In Cash App, open your profile and choose QR Code or Scan. In Venmo, open the menu and choose Scan Code or Scan.");
const release = text("fundRelease", "Who should receive the collected money at the end of the event?", "Provide the recipient’s name, relationship to the client(s), and phone number, including when funds should be released to someone other than the couple.");
const notes = text("additionalInformation", "Additional information", "Anything else you would like HMP to know?", false);
const representative = [
  {id:"representativeName",label:"Client designated representative name",type:"text",required:true},
  {id:"representativeRelationship",label:"Relationship to client(s)",type:"text",required:true},
  {id:"representativePhone",label:"Representative phone number",type:"tel",required:true},
];
const alternateRecipient = [
  {id:"alternateRecipientName",label:"Other authorized recipient name",type:"text",required:false,help:"Complete if funds will be released to someone other than the clients or designated representative."},
  {id:"alternateRecipientRelationship",label:"Relationship to client(s)",type:"text",required:false},
  {id:"alternateRecipientPhone",label:"Other recipient phone number",type:"tel",required:false},
];
const digitalTransfer = [
  {id:"paymentPlatformOne",label:"Digital transfer platform 1 and public payment handle",type:"text",required:true},
  {id:"paymentPlatformTwo",label:"Digital transfer platform 2 and public payment handle",type:"text",required:true},
];
const eventDetailsIntro = title => `Hey There 🎉!\nWe’re beyond excited to offer our Money Table Services for your upcoming event!\n\nWhen you have a moment, please fill out our ${title}—this helps us get all the important details we need to make our service seamless and fabulous from start to finish.\n\nPlease make sure to inform your loved ones that you’ve booked a money table service that will be handling all things associated with money being sprayed and/or collected at your event.\n\nThanks again for choosing us!\nWe’re truly honored to be a part of your celebration 🥂!`;
const pdfForm = (id, title, sourceFile, sourceSha256, fields) => ({
  id, title, kind:"information", version:"2026-10-12.1", sourceFile, sourceSha256,
  pages:[], description:eventDetailsIntro(title),
  adminFields:[{id:"eventName",label:"Event name / reference",type:"text",required:false}],
  clientFields:[{id:"email",label:"Email address",type:"email",required:true}, ...fields],
});
const make = (id, title, sourceUrl, fields) => ({
  id, title, kind:"information", retired:true, version:"2026-09-30.1", sourceUrl, pages:[],
  description:"Thank you for choosing HMP. Complete these event details so our team can prepare your Money Table service. Your answers are saved privately for HMP when you submit.",
  adminFields:[{id:"eventName",label:"Event name / reference",type:"text",required:false}],
  clientFields:[{id:"email",label:"Email address",type:"email",required:true}, ...fields],
});
export const informationTemplates = [
  make("money-event-information", "Money Table Service — Event Information", "https://forms.gle/97eLqmLSMDEJLdGbA", [contact,bank,delivery,payment,release,notes]),
  make("money-collection-contacts", "Money Table Service — Collection Contacts", "https://forms.gle/SAA8R6KxTfwtijct5", [contact,release,notes]),
  make("money-bank-payment", "Money Table Service — Bank & Payment Details", "https://forms.gle/zcJ5KvacooVQPRBi9", [contact,bank,delivery,payment,release,notes]),
  {...pdfForm("money-collecting-details", "Money Table Intake Form", "Money Collecting Event Details Form.pdf", "4b2ca243ac936a5093a6767e30963fd21ee1da999655f95fd066a0a8ccac21d3", [
    ...representative, ...alternateRecipient, notes,
  ]), subtitle:"For Collecting", version:"2026-10-13.1"},
  {...pdfForm("money-changing-details", "Money Table Intake Form", "Money Changing Event Details Form.pdf", "d1290c04ffd21864ec5fdad400c8daa5db7f8449c0faa4c0a7d451b0ff23df5c", [
    {id:"bankAmount",label:"Confirmation of the money bank amount being provided",type:"money",required:true},
    ...representative, ...alternateRecipient, ...digitalTransfer,
    text("qrCodeInstructions", "QR-code delivery details", "Send QR-code screenshots through your HMP message thread or by text to 301-471-0990. Never provide passwords or login codes.", false), notes,
  ]), subtitle:"For Changing", version:"2026-10-13.1"},
  {...pdfForm("money-collecting-changing-details", "Money Collecting & Changing Event Details Form", "Money Collecting & Changing Event Detail Form.pdf", "df2ccc32b994b3435f4a217651b1bbf0f2fbf4b634897f00427f571c9f5426be", [
    {id:"bankAmount",label:"Confirmation of the money bank amount being provided",type:"money",required:true},
    ...representative, ...alternateRecipient, ...digitalTransfer,
    text("qrCodeInstructions", "QR-code delivery details", "Send QR-code screenshots through your HMP message thread or by text to 301-471-0990. Never provide passwords or login codes.", false), notes,
  ]), retired:true},
];
export const activeInformationTemplates = informationTemplates.filter(template => !template.retired);
export const isInformationForm = snapshot => snapshot?.kind === "information";
