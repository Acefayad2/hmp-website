(() => {
  const hero = document.querySelector('[data-hero-slideshow]');
  if (!hero) return;
  const frames = [...hero.querySelectorAll('[data-hero-frame]')];
  const playback = document.querySelector('[data-hero-playback]');
  if (frames.length < 2) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;
  let paused = reducedMotion.matches;
  let focused = false;
  let visible = true;
  let timer;
  let request = 0;

  function schedule() {
    window.clearTimeout(timer);
    const playing = !paused && !focused && visible && !document.hidden;
    hero.classList.toggle('is-slideshow-playing', playing);
    if (playback) playback.textContent = paused ? 'Play homepage slideshow' : 'Pause homepage slideshow';
    if (playing) timer = window.setTimeout(() => show((current + 1) % frames.length), 7500);
  }

  async function show(index) {
    const token = ++request;
    window.clearTimeout(timer);
    try {
      await frames[index].querySelector('img').decode();
    } catch {
      if (token === request) { paused = true; schedule(); }
      return; // Never crossfade to an unloaded or failed image.
    }
    if (token !== request) return;
    // Decoding may finish after the visitor pauses or leaves the hero.
    if (paused || focused || !visible || document.hidden) {
      schedule();
      return;
    }
    current = index;
    frames.forEach((frame, i) => {
      frame.classList.toggle('is-active', i === index);
      frame.setAttribute('aria-hidden', String(i !== index));
    });
    schedule();
  }

  if (playback) {
    playback.hidden = false;
    playback.addEventListener('click', () => { paused = !paused; schedule(); });
  }
  // Keep the scene stable while a visitor uses a hero link, then resume.
  // Mouse hover alone must not stop the full-screen desktop slideshow.
  hero.addEventListener('focusin', () => {
    focused = true;
    schedule();
  });
  hero.addEventListener('focusout', (event) => {
    focused = hero.contains(event.relatedTarget);
    schedule();
  });
  document.addEventListener('visibilitychange', schedule);
  reducedMotion.addEventListener('change', () => { paused = reducedMotion.matches; schedule(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; schedule(); }, { threshold: .1 }).observe(hero);
  }
  hero.classList.add('is-slideshow-ready');
  schedule();
})();
