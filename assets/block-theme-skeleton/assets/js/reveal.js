/**
 * One-shot scroll reveals. Elements carrying the `reveal` class start hidden
 * (CSS gates the hidden state on `html.js` so content stays visible without
 * JavaScript) and gain `is-revealed` when they enter the viewport, once.
 *
 * Variants are pure CSS: reveal-fade (opacity only), reveal-slide-up
 * (opacity + translateY), reveal-rise (opacity + clip reveal). See style.css.
 *
 * The first statement disarms the watchdog in functions.php, which otherwise
 * strips `html.js` after 2.5s and un-hides everything. It must run before any
 * early return, so that a page with zero `.reveal` elements still checks in.
 */
(function () {
	document.documentElement.classList.add('reveal-ready');

	var els = document.querySelectorAll('.reveal');
	if (!els.length) return;

	if (
		!('IntersectionObserver' in window) ||
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	) {
		els.forEach(function (el) { el.classList.add('is-revealed'); });
		return;
	}

	var io = new IntersectionObserver(
		function (entries) {
			entries.forEach(function (entry) {
				if (entry.isIntersecting) {
					entry.target.classList.add('is-revealed');
					io.unobserve(entry.target);
				}
			});
		},
		{ threshold: 0.15, rootMargin: '0px 0px -10% 0px' }
	);
	els.forEach(function (el) { io.observe(el); });
})();
