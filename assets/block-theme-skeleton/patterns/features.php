<?php
/**
 * Title: Features grid (starter)
 * Slug: theme-slug/features
 * Categories: featured
 *
 * Starter — replace with a generated section-<n>.php pattern in step 5 of SKILL.md.
 * Do not ship as-is.
 */
?>
<!-- wp:group {"align":"wide","style":{"spacing":{"padding":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|70"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignwide">
  <!-- wp:heading {"textAlign":"center","level":2} -->
  <h2 class="wp-block-heading has-text-align-center"><?php esc_html_e( 'What I do', 'theme-slug' ); ?></h2>
  <!-- /wp:heading -->
  <!-- wp:columns -->
  <div class="wp-block-columns">
    <!-- wp:column -->
    <div class="wp-block-column">
      <!-- wp:heading {"level":3} --><h3 class="wp-block-heading"><?php esc_html_e( 'Feature one', 'theme-slug' ); ?></h3><!-- /wp:heading -->
      <!-- wp:paragraph --><p><?php esc_html_e( 'Short description.', 'theme-slug' ); ?></p><!-- /wp:paragraph -->
    </div>
    <!-- /wp:column -->
    <!-- wp:column -->
    <div class="wp-block-column">
      <!-- wp:heading {"level":3} --><h3 class="wp-block-heading"><?php esc_html_e( 'Feature two', 'theme-slug' ); ?></h3><!-- /wp:heading -->
      <!-- wp:paragraph --><p><?php esc_html_e( 'Short description.', 'theme-slug' ); ?></p><!-- /wp:paragraph -->
    </div>
    <!-- /wp:column -->
    <!-- wp:column -->
    <div class="wp-block-column">
      <!-- wp:heading {"level":3} --><h3 class="wp-block-heading"><?php esc_html_e( 'Feature three', 'theme-slug' ); ?></h3><!-- /wp:heading -->
      <!-- wp:paragraph --><p><?php esc_html_e( 'Short description.', 'theme-slug' ); ?></p><!-- /wp:paragraph -->
    </div>
    <!-- /wp:column -->
  </div>
  <!-- /wp:columns -->
</div>
<!-- /wp:group -->
