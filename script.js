document.getElementById('year').textContent = new Date().getFullYear();

// Sticky header shadow/border on scroll
const header = document.getElementById('siteHeader');
const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

// Mobile nav
const navToggle = document.getElementById('navToggle');
const mobileNav = document.getElementById('mobileNav');
navToggle.addEventListener('click', () => {
  const isOpen = mobileNav.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(isOpen));
});
mobileNav.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    mobileNav.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  });
});

// FAQ accordion (single-open)
const accItems = document.querySelectorAll('.acc-item');
accItems.forEach((item) => {
  const trigger = item.querySelector('.acc-trigger');
  trigger.addEventListener('click', () => {
    const wasOpen = item.classList.contains('open');
    accItems.forEach((i) => i.classList.remove('open'));
    if (!wasOpen) item.classList.add('open');
  });
});

// Contact form -> Google Apps Script web app (appends a row to the HMP Access Requests sheet)
const SHEET_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxGs8pzM5KmBDptRWvC2_zdggZCnrL4fIBlSG__EEOhTiIHmbVrLU1OACR2sBsvZgdg/exec';

const form = document.getElementById('contactForm');
const formNote = document.getElementById('formNote');
const submitBtn = document.getElementById('submitBtn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = form.name.value.trim();
  const email = form.email.value.trim();
  const organization = form.organization.value.trim();
  const reason = form.reason.value;
  const message = form.message.value.trim();

  submitBtn.disabled = true;
  formNote.textContent = 'Sending…';
  formNote.classList.remove('error');

  try {
    await fetch(SHEET_ENDPOINT, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ name, email, organization, reason, message }),
    });
    formNote.textContent = 'Thanks — someone from the HMP team will follow up by email shortly.';
    form.reset();
  } catch (err) {
    formNote.textContent = 'Something went wrong sending that — please try again.';
    formNote.classList.add('error');
  } finally {
    submitBtn.disabled = false;
  }
});
