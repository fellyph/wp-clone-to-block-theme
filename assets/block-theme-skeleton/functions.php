<?php
/**
 * Theme setup.
 *
 * Block themes can render most styles from theme.json, but generated clones
 * also carry capture-specific CSS fallbacks that must be enqueued explicitly.
 */

add_action(
	'wp_enqueue_scripts',
	static function () {
		wp_enqueue_style(
			'clone-theme-style',
			get_stylesheet_uri(),
			array(),
			wp_get_theme()->get( 'Version' )
		);
		if ( file_exists( get_theme_file_path( 'assets/js/reveal.js' ) ) ) {
			wp_enqueue_script(
				'clone-theme-reveal',
				get_theme_file_uri( 'assets/js/reveal.js' ),
				array(),
				wp_get_theme()->get( 'Version' ),
				array( 'in_footer' => true )
			);
		}
	}
);

/**
 * Arm the reveal system, with a watchdog.
 *
 * The reveal CSS hides `.reveal` elements only under `html.js`, so content
 * stays fully visible when JavaScript is unavailable. That covers JS being
 * *disabled*, but not reveal.js failing to run — a 404, a parse error, a CSP
 * block or any runtime throw would leave every revealed block permanently
 * invisible. So: only arm when the file is actually shipped, and drop `js`
 * again after 2.5s unless reveal.js checked in by setting `reveal-ready`.
 */
add_action(
	'wp_head',
	static function () {
		if ( ! file_exists( get_theme_file_path( 'assets/js/reveal.js' ) ) ) {
			return;
		}
		echo "<script>(function(d){d.documentElement.classList.add('js');" .
			"setTimeout(function(){var e=d.documentElement;" .
			"if(!e.classList.contains('reveal-ready')){e.classList.remove('js');}},2500);})(document);</script>\n";
	},
	0
);
