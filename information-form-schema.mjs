// Native versions of the three client-supplied Money Table information forms.
const text = (id, label, help = "", required = true) => ({id, label, help, type:"textarea", required});
const contact = text("responsibleContact", "Responsible point of contact(s)", "Provide each person’s name and phone number. Choose someone other than the client(s) for HMP to contact about incidentals. Let your loved ones know HMP will handle money-table services at your event.");
const bank = text("changeBank", "Confirm the change-bank amount", "The change bank must contain only $1 bills. Please request batches of 100 or 50 from your bank and include any additional bank instructions. Do not provide bank account numbers.");
const delivery = text("bankDelivery", "Person(s) delivering the bank", "Provide names and phone numbers. Delivery to the service location is preferably one hour before service starts.");
const payment = text("digitalPayments", "Digital payment information for signs", "Provide the names and public payment handles for at least two digital transfer platforms. Send QR-code screenshots through your HMP message thread or email info@hmpeds.com. Never provide passwords or login codes. In Cash App, open your profile and choose QR Code or Scan. In Venmo, open the menu and choose Scan Code or Scan.");
const release = text("fundRelease", "Who should receive the collected money at the end of the event?", "Provide the recipient’s name, relationship to the client(s), and phone number, including when funds should be released to someone other than the couple.");
const notes = text("additionalInformation", "Additional information", "Anything else you would like HMP to know?", false);
const make = (id, title, sourceUrl, fields) => ({
  id, title, kind:"information", version:"2026-09-30.1", sourceUrl, pages:[],
  description:"Thank you for choosing HMP. Complete these event details so our team can prepare your Money Table service. Your answers are saved privately for HMP when you submit.",
  adminFields:[{id:"eventName",label:"Event name / reference",type:"text",required:false}],
  clientFields:[{id:"email",label:"Email address",type:"email",required:true}, ...fields],
});
export const informationTemplates = [
  make("money-event-information", "Money Table Service — Event Information", "https://forms.gle/97eLqmLSMDEJLdGbA", [contact,bank,delivery,payment,release,notes]),
  make("money-collection-contacts", "Money Table Service — Collection Contacts", "https://forms.gle/SAA8R6KxTfwtijct5", [contact,release,notes]),
  make("money-bank-payment", "Money Table Service — Bank & Payment Details", "https://forms.gle/zcJ5KvacooVQPRBi9", [contact,bank,delivery,payment,release,notes]),
];
export const isInformationForm = snapshot => snapshot?.kind === "information";
