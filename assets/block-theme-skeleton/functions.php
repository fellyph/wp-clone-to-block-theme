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
		wp_enqueue_script(
			'clone-theme-reveal',
			get_theme_file_uri( 'assets/js/reveal.js' ),
			array(),
			wp_get_theme()->get( 'Version' ),
			array( 'in_footer' => true )
		);
	}
);

/**
 * Mark the document as JS-capable before first paint. The reveal CSS hides
 * `.reveal` elements only under `html.js`, so content stays fully visible
 * when JavaScript is unavailable.
 */
add_action(
	'wp_head',
	static function () {
		echo "<script>document.documentElement.classList.add('js');</script>\n";
	},
	0
);
