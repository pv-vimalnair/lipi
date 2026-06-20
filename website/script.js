/* =========================================================================
   Lipi Website — script.js
   Phase 1 support: nav scroll-state + mobile menu toggle.
   -------------------------------------------------------------------------
   Keep it minimal. No framework. Defer-loaded.
   ========================================================================= */

(function () {
  'use strict';

  // ----- Nav scroll-state -----
  const nav = document.getElementById('nav');
  const SCROLL_THRESHOLD = 8;

  function updateNavScroll() {
    if (!nav) return;
    if (window.scrollY > SCROLL_THRESHOLD) {
      nav.classList.add('is-scrolled');
    } else {
      nav.classList.remove('is-scrolled');
    }
  }

  // rAF-throttled scroll listener
  let ticking = false;
  window.addEventListener('scroll', function () {
    if (!ticking) {
      window.requestAnimationFrame(function () {
        updateNavScroll();
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });

  // Run once on load (in case of reload mid-scroll)
  updateNavScroll();

  // ----- Mobile menu toggle -----
  const toggle = document.getElementById('navToggle');
  const links = document.querySelector('.nav__links');

  if (toggle && links) {
    toggle.addEventListener('click', function () {
      const isOpen = links.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
      // Minimal inline visibility (the mobile CSS hides .nav__links by default;
      // adding .is-open makes it visible as a stacked overlay).
      if (isOpen) {
        links.style.display = 'flex';
        links.style.position = 'absolute';
        links.style.top = 'var(--nav-height)';
        links.style.left = '0';
        links.style.right = '0';
        links.style.flexDirection = 'column';
        links.style.alignItems = 'flex-start';
        links.style.padding = 'var(--space-4) var(--container-pad-x)';
        links.style.background = 'var(--color-bg)';
        links.style.borderBottom = '1px solid var(--color-line-soft)';
        links.style.gap = 'var(--space-3)';
      } else {
        links.removeAttribute('style');
      }
    });
  }
})();