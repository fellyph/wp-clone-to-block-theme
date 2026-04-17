<?php
/**
 * Title: Hero (starter)
 * Slug: theme-slug/hero
 * Categories: featured
 *
 * Starter — replace with a generated section-<n>.php pattern in step 5 of SKILL.md.
 * Do not ship as-is.
 */
?>
<!-- wp:cover {"dimRatio":40,"minHeight":80,"minHeightUnit":"vh","align":"full"} -->
<div class="wp-block-cover alignfull" style="min-height:80vh">
  <span aria-hidden="true" class="wp-block-cover__background has-background-dim"></span>
  <div class="wp-block-cover__inner-container">
    <!-- wp:heading {"level":1,"textAlign":"center","fontSize":"xx-large"} -->
    <h1 class="wp-block-heading has-text-align-center has-xx-large-font-size"><?php esc_html_e( 'Your headline here', 'theme-slug' ); ?></h1>
    <!-- /wp:heading -->
    <!-- wp:paragraph {"align":"center","fontSize":"large"} -->
    <p class="has-text-align-center has-large-font-size"><?php esc_html_e( 'Short supporting sentence that explains what this page is about.', 'theme-slug' ); ?></p>
    <!-- /wp:paragraph -->
    <!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
    <div class="wp-block-buttons">
      <!-- wp:button -->
      <div class="wp-block-button"><a class="wp-block-button__link wp-element-button"><?php esc_html_e( 'Get started', 'theme-slug' ); ?></a></div>
      <!-- /wp:button -->
    </div>
    <!-- /wp:buttons -->
  </div>
</div>
<!-- /wp:cover -->
