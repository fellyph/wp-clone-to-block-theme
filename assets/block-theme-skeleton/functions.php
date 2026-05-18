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
	}
);
