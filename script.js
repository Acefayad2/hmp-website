const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('#site-nav');

if (menuButton && nav) {
  menuButton.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(open));
  });
  nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    nav.classList.remove('open');
    menuButton.setAttribute('aria-expanded', 'false');
  }));
}

document.querySelectorAll('.service-toggle:not(.service-link)').forEach((button) => {
  button.addEventListener('click', () => {
    const row = button.closest('.service-row');
    const open = row.classList.toggle('open');
    button.setAttribute('aria-expanded', String(open));
    const icon = button.querySelector('span');
    if (icon) icon.textContent = open ? '−' : '+';
  });
});

const dialog = document.querySelector('#led-dialog');
const serviceSelect = document.querySelector('#service-select');
let acknowledged = false;

if (serviceSelect) {
  const requestedService = new URLSearchParams(window.location.search).get('service');
  if (requestedService && [...serviceSelect.options].some((option) => option.value === requestedService)) serviceSelect.value = requestedService;
  const showSeatingNotice = () => {
    if (dialog && !acknowledged && serviceSelect.value.includes('Guest Seating')) dialog.showModal();
  };
  serviceSelect.addEventListener('change', showSeatingNotice);
  if (serviceSelect.value.includes('Guest Seating')) setTimeout(showSeatingNotice, 350);
  dialog?.querySelector('.dialog-close')?.addEventListener('click', () => { serviceSelect.value = ''; dialog.close(); });
  dialog?.querySelector('.dialog-confirm')?.addEventListener('click', () => { acknowledged = true; dialog.close(); serviceSelect.focus(); });
}

const form = document.querySelector('#inquiry-form');
if (form) {
  form.addEventListener('submit', async (event) => {
    if (serviceSelect?.value.includes('Guest Seating') && !acknowledged) { event.preventDefault(); dialog?.showModal(); return; }
    event.preventDefault();
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      await fetch('/', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(new FormData(form)).toString()});
      form.reset();
      document.querySelector('.toast')?.classList.add('show');
      setTimeout(() => document.querySelector('.toast')?.classList.remove('show'), 6000);
    } catch (error) { form.submit(); }
    finally { submit.disabled = false; submit.innerHTML = 'Request my personalized quote <span>↗</span>'; }
  });
}

document.querySelectorAll('#year').forEach((year) => { year.textContent = new Date().getFullYear(); });
