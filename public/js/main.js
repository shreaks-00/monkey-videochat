/**
 * main.js — Landing Page Entry Point
 *
 * Handles:
 *  - GSAP entrance animations
 *  - Navbar scroll effect
 *  - Simulated live user counter
 */





// ── Navbar scroll effect ──────────────────────────────────────────────────────

(function initNavbar() {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;

  function onScroll() {
    navbar.classList.toggle('scrolled', window.scrollY > 20);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
})();

// ── Simulated live user counter ───────────────────────────────────────────────

(function initCounter() {
  const el = document.getElementById('stat-online');
  if (!el) return;

  let base = 12847;

  setInterval(() => {
    // Randomly drift the number up or down slightly
    const delta = Math.floor(Math.random() * 11) - 5;
    base = Math.max(9000, Math.min(25000, base + delta));
    el.textContent = base.toLocaleString();
  }, 3000);
})();
