# Section mapping — interaction models → WP block templates

This file has one block markup template per interaction model. The pattern generator in step 5 of `SKILL.md` picks the template matching the spec file's `Interaction model` field, fills the `{{placeholders}}` from the spec's `Generation instructions` section, and writes the result to `theme/patterns/section-<n>.php`.

**Every template assumes the `theme/patterns/` directory exists and the theme's `style.css` is present.** Image paths use `<?php echo esc_url( get_theme_file_uri('assets/img-XX.ext') ); ?>` so the deployed theme serves them from `wp-content/themes/<slug>/assets/`.

## The brightness rule (applies to every template)

Before picking a template, check `analysis.tokens.body.bg` brightness:

```
brightness = (0.299 * R + 0.587 * G + 0.114 * B)
```

- If brightness **≥ 200** (light/near-white base): **do not use `core/cover` as the top-level container.** The cover block forces inner text to white on an overlay, which produces invisible headings on light backgrounds. Use `core/group` with explicit `textColor="contrast"` instead. All templates below marked "⚠ cover-variant" have a paired "light-variant" — pick the right one.
- If brightness **< 200** (dark base): `core/cover` is fine and the cover's default white text reads correctly.

## Template catalog

Each template below takes placeholder variables and emits valid WP block markup. After filling placeholders, wrap the result in the pattern file header:

```php
<?php
/**
 * Title: <human-readable title>
 * Slug: <theme-slug>/section-<n>
 * Categories: featured
 */
?>
<!-- block markup here -->
```

---

### `cover-with-headline` ⚠ cover-variant

A hero with a background image, centered headline, optional subheading, optional CTA button.

**Placeholders:** `{{BG_IMAGE}}` (path or omit for flat color), `{{BG_COLOR}}`, `{{HEADING}}`, `{{SUBHEADING}}`, `{{BUTTON_LABEL}}`, `{{BUTTON_HREF}}`, `{{MIN_HEIGHT_VH}}`.

**Dark-base variant (brightness < 200):**

```html
<!-- wp:cover {"url":"<?php echo esc_url( get_theme_file_uri('{{BG_IMAGE}}') ); ?>","dimRatio":30,"minHeight":{{MIN_HEIGHT_VH}},"minHeightUnit":"vh","align":"full","overlayColor":"contrast"} -->
<div class="wp-block-cover alignfull" style="min-height:{{MIN_HEIGHT_VH}}vh">
  <span aria-hidden="true" class="wp-block-cover__background has-contrast-background-color has-background-dim"></span>
  <img class="wp-block-cover__image-background" src="<?php echo esc_url( get_theme_file_uri('{{BG_IMAGE}}') ); ?>" alt="" />
  <div class="wp-block-cover__inner-container">
    <!-- wp:heading {"level":1,"textAlign":"center","fontSize":"xx-large"} -->
    <h1 class="wp-block-heading has-text-align-center has-xx-large-font-size">{{HEADING}}</h1>
    <!-- /wp:heading -->
    <!-- wp:paragraph {"align":"center","fontSize":"large"} -->
    <p class="has-text-align-center has-large-font-size">{{SUBHEADING}}</p>
    <!-- /wp:paragraph -->
    <!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
    <div class="wp-block-buttons">
      <!-- wp:button -->
      <div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="{{BUTTON_HREF}}">{{BUTTON_LABEL}}</a></div>
      <!-- /wp:button -->
    </div>
    <!-- /wp:buttons -->
  </div>
</div>
<!-- /wp:cover -->
```

**Light-base variant (brightness ≥ 200):** do not use `core/cover`. Use `core/group` with an inline background image via `style.background`:

```html
<!-- wp:group {"align":"full","style":{"background":{"backgroundImage":{"url":"<?php echo esc_url( get_theme_file_uri('{{BG_IMAGE}}') ); ?>","source":"file"},"backgroundSize":"cover","backgroundPosition":"center"},"spacing":{"padding":{"top":"var:preset|spacing|80","bottom":"var:preset|spacing|80"}},"minHeight":"{{MIN_HEIGHT_VH}}vh"},"textColor":"contrast","layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull has-contrast-color has-text-color" style="min-height:{{MIN_HEIGHT_VH}}vh">
  <!-- wp:heading {"level":1,"textAlign":"center","fontSize":"xx-large","textColor":"contrast"} -->
  <h1 class="wp-block-heading has-text-align-center has-contrast-color has-text-color has-xx-large-font-size">{{HEADING}}</h1>
  <!-- /wp:heading -->
  <!-- wp:paragraph {"align":"center","fontSize":"large","textColor":"contrast"} -->
  <p class="has-text-align-center has-contrast-color has-text-color has-large-font-size">{{SUBHEADING}}</p>
  <!-- /wp:paragraph -->
  <!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
  <div class="wp-block-buttons">
    <!-- wp:button -->
    <div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="{{BUTTON_HREF}}">{{BUTTON_LABEL}}</a></div>
    <!-- /wp:button -->
  </div>
  <!-- /wp:buttons -->
</div>
<!-- /wp:group -->
```

If `{{BG_IMAGE}}` is empty (flat color hero), omit the `backgroundImage` style entirely and set `backgroundColor` to `{{BG_COLOR}}`.

---

### `media-text`

An image beside a headline + paragraph + optional button. Used for "feature" sections that pair one image with copy.

**Placeholders:** `{{IMAGE_PATH}}`, `{{IMAGE_ALT}}`, `{{MEDIA_POSITION}}` (`left` or `right`), `{{HEADING}}`, `{{BODY}}`, `{{BUTTON_LABEL}}`, `{{BUTTON_HREF}}`.

```html
<!-- wp:media-text {"align":"wide","mediaPosition":"{{MEDIA_POSITION}}","mediaLink":"<?php echo esc_url( get_theme_file_uri('{{IMAGE_PATH}}') ); ?>","mediaType":"image"} -->
<div class="wp-block-media-text alignwide is-stacked-on-mobile {{IF_RIGHT}}has-media-on-the-right{{/IF_RIGHT}}">
  <figure class="wp-block-media-text__media"><img src="<?php echo esc_url( get_theme_file_uri('{{IMAGE_PATH}}') ); ?>" alt="{{IMAGE_ALT}}" /></figure>
  <div class="wp-block-media-text__content">
    <!-- wp:heading {"level":2} --><h2 class="wp-block-heading">{{HEADING}}</h2><!-- /wp:heading -->
    <!-- wp:paragraph --><p>{{BODY}}</p><!-- /wp:paragraph -->
    <!-- wp:buttons -->
    <div class="wp-block-buttons"><!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="{{BUTTON_HREF}}">{{BUTTON_LABEL}}</a></div><!-- /wp:button --></div>
    <!-- /wp:buttons -->
  </div>
</div>
<!-- /wp:media-text -->
```

Remove the `<!-- wp:buttons -->` block if the spec file says `{{BUTTON_LABEL}} = n/a`. Replace `{{IF_RIGHT}}...{{/IF_RIGHT}}` with the class only when `mediaPosition=right`.

---

### `columns`

A row of N cards, each with a heading and a paragraph (and optionally an icon/image). Used for feature grids.

**Placeholders:** `{{COLUMN_COUNT}}`, `{{HEADING}}` (section headline above the row), `{{COLUMNS}}` (array of `{ heading, body, image_path?, image_alt? }`), `{{BG_COLOR}}`.

Emit one `<!-- wp:column -->` block per entry in `{{COLUMNS}}`. Pattern:

```html
<!-- wp:group {"align":"wide","backgroundColor":"{{BG_COLOR_SLUG}}","style":{"spacing":{"padding":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|70"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignwide has-{{BG_COLOR_SLUG}}-background-color has-background">
  <!-- wp:heading {"textAlign":"center","level":2} --><h2 class="wp-block-heading has-text-align-center">{{HEADING}}</h2><!-- /wp:heading -->
  <!-- wp:columns -->
  <div class="wp-block-columns">
    <!-- FOREACH column in {{COLUMNS}}: -->
    <!-- wp:column -->
    <div class="wp-block-column">
      <!-- IF column.image_path: -->
      <!-- wp:image {"sizeSlug":"full"} -->
      <figure class="wp-block-image size-full"><img src="<?php echo esc_url( get_theme_file_uri('{{column.image_path}}') ); ?>" alt="{{column.image_alt}}" /></figure>
      <!-- /wp:image -->
      <!-- END IF -->
      <!-- wp:heading {"level":3} --><h3 class="wp-block-heading">{{column.heading}}</h3><!-- /wp:heading -->
      <!-- wp:paragraph --><p>{{column.body}}</p><!-- /wp:paragraph -->
    </div>
    <!-- /wp:column -->
    <!-- END FOREACH -->
  </div>
  <!-- /wp:columns -->
</div>
<!-- /wp:group -->
```

---

### `gallery`

A multi-image grid. Use for any section whose spec lists 4+ images and minimal text.

**Placeholders:** `{{IMAGES}}` (array of `{ path, alt }`), `{{COLUMNS}}` (computed via gallery heuristic below), `{{HEADING}}` (optional section headline).

**Column count heuristic:**

```
columns = clamp(round(sqrt(imageCount)), 2, 6)
```

If images are clearly portrait-oriented (avg h > avg w), reduce by 1.

```html
<!-- wp:group {"align":"wide","style":{"spacing":{"padding":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|70"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignwide">
  <!-- IF {{HEADING}} -->
  <!-- wp:heading {"textAlign":"center","level":2} --><h2 class="wp-block-heading has-text-align-center">{{HEADING}}</h2><!-- /wp:heading -->
  <!-- END IF -->
  <!-- wp:gallery {"columns":{{COLUMNS}},"linkTo":"none","align":"wide"} -->
  <figure class="wp-block-gallery has-nested-images columns-{{COLUMNS}} is-cropped alignwide">
    <!-- FOREACH img in {{IMAGES}}: -->
    <!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->
    <figure class="wp-block-image size-large"><img src="<?php echo esc_url( get_theme_file_uri('{{img.path}}') ); ?>" alt="{{img.alt}}" /></figure>
    <!-- /wp:image -->
    <!-- END FOREACH -->
  </figure>
  <!-- /wp:gallery -->
</div>
<!-- /wp:group -->
```

---

### `logo-strip`

A horizontal row of small uniform logos. Used for "as seen in" press callouts and partner lists.

**Placeholders:** `{{LABEL}}` (e.g. "AS SEEN IN"), `{{LOGOS}}` (array of `{ path, alt }`).

Logo strips are different from galleries — logos are small, uniform, and should have equal column widths. Use `core/columns` with fixed small widths, not `core/gallery`:

```html
<!-- wp:group {"align":"wide","style":{"spacing":{"padding":{"top":"var:preset|spacing|60","bottom":"var:preset|spacing|60"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignwide">
  <!-- wp:heading {"textAlign":"center","level":3,"fontSize":"medium"} --><h3 class="wp-block-heading has-text-align-center has-medium-font-size" style="letter-spacing:0.15em;text-transform:uppercase">{{LABEL}}</h3><!-- /wp:heading -->
  <!-- wp:columns {"verticalAlignment":"center"} -->
  <div class="wp-block-columns are-vertically-aligned-center">
    <!-- FOREACH logo in {{LOGOS}}: -->
    <!-- wp:column {"verticalAlignment":"center"} -->
    <div class="wp-block-column is-vertically-aligned-center">
      <!-- wp:image {"sizeSlug":"medium","align":"center"} -->
      <figure class="wp-block-image aligncenter size-medium"><img src="<?php echo esc_url( get_theme_file_uri('{{logo.path}}') ); ?>" alt="{{logo.alt}}" /></figure>
      <!-- /wp:image -->
    </div>
    <!-- /wp:column -->
    <!-- END FOREACH -->
  </div>
  <!-- /wp:columns -->
</div>
<!-- /wp:group -->
```

---

### `testimonial`

A pull quote with attribution.

**Placeholders:** `{{QUOTE}}`, `{{ATTRIBUTION}}`, `{{BG_COLOR_SLUG}}`.

```html
<!-- wp:group {"align":"full","backgroundColor":"{{BG_COLOR_SLUG}}","style":{"spacing":{"padding":{"top":"var:preset|spacing|80","bottom":"var:preset|spacing|80"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull has-{{BG_COLOR_SLUG}}-background-color has-background">
  <!-- wp:quote {"align":"center","fontSize":"x-large"} -->
  <blockquote class="wp-block-quote has-text-align-center has-x-large-font-size">
    <p>{{QUOTE}}</p>
    <cite>{{ATTRIBUTION}}</cite>
  </blockquote>
  <!-- /wp:quote -->
</div>
<!-- /wp:group -->
```

---

### `cta`

A single centered call-to-action block — headline + button, no images.

**Placeholders:** `{{HEADING}}`, `{{BODY}}`, `{{BUTTON_LABEL}}`, `{{BUTTON_HREF}}`, `{{BG_COLOR_SLUG}}`.

```html
<!-- wp:group {"align":"full","backgroundColor":"{{BG_COLOR_SLUG}}","style":{"spacing":{"padding":{"top":"var:preset|spacing|80","bottom":"var:preset|spacing|80"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull has-{{BG_COLOR_SLUG}}-background-color has-background">
  <!-- wp:heading {"textAlign":"center","level":2,"fontSize":"xx-large"} --><h2 class="wp-block-heading has-text-align-center has-xx-large-font-size">{{HEADING}}</h2><!-- /wp:heading -->
  <!-- wp:paragraph {"align":"center"} --><p class="has-text-align-center">{{BODY}}</p><!-- /wp:paragraph -->
  <!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
  <div class="wp-block-buttons">
    <!-- wp:button -->
    <div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="{{BUTTON_HREF}}">{{BUTTON_LABEL}}</a></div>
    <!-- /wp:button -->
  </div>
  <!-- /wp:buttons -->
</div>
<!-- /wp:group -->
```

---

### `color-block-grid`

A grid where each cell has its own distinct background color (common on bright e-commerce sites). Different from `columns` because each column's background is part of the composition.

**Placeholders:** `{{TILES}}` (array of `{ bg_hex, image_path, image_alt, label? }`).

Emit one `core/cover` per tile inside a `core/columns`:

```html
<!-- wp:columns {"align":"full"} -->
<div class="wp-block-columns alignfull" style="gap:0">
  <!-- FOREACH tile in {{TILES}}: -->
  <!-- wp:column -->
  <div class="wp-block-column">
    <!-- wp:cover {"url":"<?php echo esc_url( get_theme_file_uri('{{tile.image_path}}') ); ?>","customOverlayColor":"{{tile.bg_hex}}","dimRatio":0,"minHeight":400,"minHeightUnit":"px"} -->
    <div class="wp-block-cover" style="min-height:400px">
      <span aria-hidden="true" class="wp-block-cover__background has-background-dim-0 has-background-dim" style="background-color:{{tile.bg_hex}}"></span>
      <img class="wp-block-cover__image-background" src="<?php echo esc_url( get_theme_file_uri('{{tile.image_path}}') ); ?>" alt="{{tile.image_alt}}" />
      <div class="wp-block-cover__inner-container">
        <!-- IF {{tile.label}} -->
        <!-- wp:heading {"level":3,"textAlign":"center"} --><h3 class="wp-block-heading has-text-align-center">{{tile.label}}</h3><!-- /wp:heading -->
        <!-- END IF -->
      </div>
    </div>
    <!-- /wp:cover -->
  </div>
  <!-- /wp:column -->
  <!-- END FOREACH -->
</div>
<!-- /wp:columns -->
```

---

### `footer`

Not a pattern — always a template part. Emit to `parts/footer.html`, not `patterns/`.

The footer spec drives the template-part contents. Typical fields: site title, copyright line, contact info, social links. Use `core/group` + `core/site-title` + `core/paragraph` + `core/social-links` as needed.

---

### `nav`

Not a pattern — part of `parts/header.html`. Walk `analysis.nav[]` and emit one `core/navigation-link` per item inside a `core/navigation` block. Do NOT hardcode nav items inside patterns.

---

## Framework-specific widgets → stub with explicit comment

For each of these, emit an **explicit HTML comment** in the generated pattern rather than silently dropping the feature. A human reading the theme later must know what was removed. Add rows here as new frameworks are encountered; the existing rows cover the frameworks seen so far.

| Source widget | Action | Comment to emit |
| --- | --- | --- |
| Wix Stores (shop, product, cart) | stub + WooCommerce note | `<!-- Wix Stores removed — install WooCommerce and replace this group with product blocks -->` |
| Wix Bookings | stub + link to `#booking` | `<!-- Wix Bookings removed — install a booking plugin and wire up the CTA -->` |
| Wix Forms / contact form | placeholder paragraph | `<!-- Wix Forms removed — install Contact Form 7, WPForms, or Gravity Forms -->` |
| Wix Members area | stub | `<!-- Wix Members area removed — consider BuddyPress or a membership plugin -->` |
| Wix Chat popup | drop | `<!-- Wix Chat removed — add a live-chat plugin if needed -->` |
| Squarespace Commerce product block | stub + WooCommerce note | `<!-- Squarespace product block removed — install WooCommerce and replace with product blocks -->` |
| Squarespace Events / Calendar | stub | `<!-- Squarespace Events removed — install The Events Calendar or a calendar plugin -->` |
| Webflow CMS Collection list | stub | `<!-- Webflow CMS Collection removed — register a WP custom post type and a Query Loop block to replace -->` |
| Webflow Ecommerce block | stub + WooCommerce note | `<!-- Webflow Ecommerce block removed — install WooCommerce and replace with product blocks -->` |
| Cargo gallery widget | keep image list, drop effects | `<!-- Cargo gallery effects dropped — images preserved in core/gallery -->` |
| Shopify embed (buy button, product card) | stub + WooCommerce note | `<!-- Shopify embed removed — install WooCommerce or use the Shopify Buy Button WP plugin -->` |
| Marquee / scrolling text strip | static paragraph | `<!-- Marquee dropped — scrolling animation not reproduced -->` |
| Parallax background | static bg image | `<!-- Parallax dropped — static bg retained -->` |
| Lottie / scroll-triggered animations | drop | `<!-- Animation dropped — WP core has no equivalent -->` |
| Video background on cover | `core/cover` with poster image | `<!-- Video background reduced to poster image -->` |

---

## What NOT to do

- **Do not emit a pattern without real content from the spec file.** If `{{HEADING}}` is missing in the spec, stop and re-read `.capture/sections/<n>.json` to find what heading text was captured. Do not write "Your headline here" or "Placeholder heading" as a fallback.
- **Do not use `core/cover` on light-background sections.** Use the `core/group` variant. The brightness rule above is not optional.
- **Do not inline CDN URLs.** Always `get_theme_file_uri('assets/img-XX.ext')` so the theme ships its own assets.
- **Do not reuse one template for every section.** The spec file's `Interaction model` dictates the template. A logo strip is not a columns block. A media-text is not a gallery.
