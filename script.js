/* ---------------------------------------------------------
   Liquid glass portfolio — vanilla JS, no dependencies
   --------------------------------------------------------- */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* 1. Reveal sections as they enter the viewport. */
const revealTargets = document.querySelectorAll(
  '.section, .stat, .tl-item, .card, .skill-block'
);

if (!reduceMotion && 'IntersectionObserver' in window) {
  revealTargets.forEach((el) => el.classList.add('reveal'));

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -60px 0px' }
  );

  revealTargets.forEach((el) => io.observe(el));
}

/* 3. Nav gains weight once you scroll past the hero. */
const nav = document.querySelector('.nav');

const onScroll = () => {
  nav.classList.toggle('is-lifted', window.scrollY > 40);
};
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* 4. Highlight the nav link for the section you're reading. */
const sections = document.querySelectorAll('main section[id]');
const navLinks = document.querySelectorAll('.nav-links a');

if ('IntersectionObserver' in window) {
  const spy = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((link) => {
          link.classList.toggle(
            'is-active',
            link.getAttribute('href') === `#${entry.target.id}`
          );
        });
      });
    },
    { rootMargin: '-45% 0px -50% 0px' }
  );

  sections.forEach((section) => spy.observe(section));
}

/* 5. Footer year. */
document.getElementById('year').textContent = new Date().getFullYear();
