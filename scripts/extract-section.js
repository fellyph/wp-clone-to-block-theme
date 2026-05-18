// Per-section deep extractor. Pass this function body to
// mcp__chrome-devtools__evaluate_script as the `function` argument, and an
// argument array of [sectionTop, sectionHeight] where both are absolute document
// Y coordinates (as returned by scripts/extract.js's `sections[].top` and `height`).
//
// Returns a full DOM tree for every element whose bounding box intersects the
// section's Y band, with computed styles, verbatim text, image URLs, and a
// classification hint (heading / paragraph / button / image / container).
//
// The output is one of the inputs to references/spec-files.md — it contains
// everything the pattern generator needs to write real block markup for this
// section without re-running capture.
//
// Usage from the chrome-devtools MCP:
//   mcp__chrome-devtools__evaluate_script({
//     function: "<contents of this file>",
//     args: ["1187", "628"]   // top, height
//   })

(sectionTop, sectionHeight) => {
  const top = parseFloat(sectionTop);
  const height = parseFloat(sectionHeight);
  const bottom = top + height;

  const PROPS = [
    'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing', 'color',
    'textTransform', 'textAlign',
    'backgroundColor', 'backgroundImage', 'backgroundPosition', 'backgroundSize',
    'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
    'width', 'height', 'maxWidth',
    'display', 'flexDirection', 'justifyContent', 'alignItems', 'gap', 'flexWrap',
    'gridTemplateColumns', 'gridTemplateRows',
    'borderRadius', 'border', 'boxShadow',
    'position', 'top', 'left', 'zIndex',
    'opacity', 'transform', 'overflow',
    'transitionProperty', 'transitionDuration', 'transitionTimingFunction', 'transitionDelay',
    'animationName', 'animationDuration', 'animationTimingFunction', 'animationDelay',
    'animationIterationCount', 'animationDirection', 'willChange',
    'filter', 'backdropFilter', 'clipPath', 'mixBlendMode',
    'objectFit', 'objectPosition', 'aspectRatio',
  ];

  const extractStyles = (el) => {
    const cs = getComputedStyle(el);
    const out = {};
    for (const p of PROPS) {
      const v = cs[p];
      if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)') {
        out[p] = v;
      }
    }
    return out;
  };

  const extractCssUrls = (value) => {
    if (!value || value === 'none') return [];
    return Array.from(String(value).matchAll(/url\((['"]?)(.*?)\1\)/g))
      .map((match) => match[2])
      .filter(Boolean)
      .map((url) => {
        try {
          return new URL(url, document.baseURI).href;
        } catch (e) {
          return url;
        }
      });
  };

  const parseTimeMs = (value) => {
    return String(value || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const n = parseFloat(part);
        if (!Number.isFinite(n)) return 0;
        return part.endsWith('ms') ? n : n * 1000;
      })
      .reduce((max, n) => Math.max(max, n), 0);
  };

  const extractMotion = (el) => {
    const cs = getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    const className = typeof el.className === 'string' ? el.className.toLowerCase() : '';
    const data = Array.from(el.attributes || [])
      .map((attr) => `${attr.name}=${attr.value}`)
      .join(' ')
      .toLowerCase();
    const combined = `${className} ${data}`;
    const signals = [];
    const animationDurationMs = parseTimeMs(cs.animationDuration);
    const transitionDurationMs = parseTimeMs(cs.transitionDuration);

    if (cs.animationName && cs.animationName !== 'none' && animationDurationMs > 0) signals.push('css-animation');
    if (cs.transitionProperty && cs.transitionProperty !== 'none' && transitionDurationMs > 0) signals.push('transition');
    if (cs.transform && cs.transform !== 'none' && cs.transform !== 'matrix(1, 0, 0, 1, 0, 0)') signals.push('transform');
    if (cs.position === 'sticky' || cs.position === 'fixed') signals.push(`position-${cs.position}`);
    if (cs.willChange && cs.willChange !== 'auto') signals.push('will-change');
    if (cs.filter && cs.filter !== 'none') signals.push('filter');
    if (cs.backdropFilter && cs.backdropFilter !== 'none') signals.push('backdrop-filter');
    if (cs.clipPath && cs.clipPath !== 'none') signals.push('clip-path');
    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') signals.push('blend-mode');
    if (tag === 'video') signals.push('video');
    if (tag === 'canvas') signals.push('canvas');
    if (tag === 'svg') signals.push('svg');
    if (/marquee|ticker|crawl|scrolling-text/.test(combined)) signals.push('marquee-like');
    if (/slider|carousel|swiper|splide|slideshow/.test(combined)) signals.push('carousel-like');
    if (/parallax|sticky|pin-spacer|scrolltrigger/.test(combined)) signals.push('scroll-effect');
    if (/lottie|bodymovin/.test(combined)) signals.push('lottie-like');

    if (signals.length === 0) return null;
    return {
      signals: Array.from(new Set(signals)),
      animationName: cs.animationName !== 'none' ? cs.animationName : null,
      animationDurationMs,
      transitionProperty: cs.transitionProperty !== 'none' ? cs.transitionProperty : null,
      transitionDurationMs,
    };
  };

  const isVisible = (el) => {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // Collect every visible element whose bounding box overlaps the section Y band
  const inBand = Array.from(document.body.querySelectorAll('*')).filter((el) => {
    if (!isVisible(el)) return false;
    const r = el.getBoundingClientRect();
    const elTop = r.top + window.scrollY;
    const elBot = elTop + r.height;
    return elBot > top + 10 && elTop < bottom - 10;
  });

  if (inBand.length === 0) {
    return { error: 'no visible elements in band', top, height };
  }

  // Find the tightest wrapper: the smallest-area element that contains every inBand element
  const tightest = (() => {
    const candidates = inBand.filter((el) => {
      const r = el.getBoundingClientRect();
      const elTop = r.top + window.scrollY;
      const elBot = elTop + r.height;
      // must contain the band vertically
      return elTop <= top + 5 && elBot >= bottom - 5 && r.width > 200;
    });
    candidates.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return ra.width * ra.height - rb.width * rb.height;
    });
    return candidates[0] || inBand[0];
  })();

  // Classify an element by role
  const classify = (el) => {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'img') return 'image';
    if (tag === 'video') return 'video';
    if (tag === 'a' || tag === 'button') return 'button';
    if (tag === 'p') return 'paragraph';
    if (tag === 'ul' || tag === 'ol') return 'list';
    if (tag === 'svg') return 'svg';
    // Largest text node with size >= 18px → heading candidate
    const size = parseFloat(getComputedStyle(el).fontSize) || 0;
    const hasOwnText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.nodeValue.trim().length > 2);
    if (hasOwnText) {
      if (size >= 32) return 'heading';
      if (size >= 20) return 'subheading';
      return 'text';
    }
    return 'container';
  };

  // Walk the tree, but cap depth and children to keep the payload reasonable
  const walk = (el, depth) => {
    if (depth > 5) return null;
    const r = el.getBoundingClientRect();
    const role = classify(el);
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3 && n.nodeValue.trim().length > 0)
      .map((n) => n.nodeValue.trim())
      .join(' ')
      .slice(0, 300);

    const node = {
      tag: el.tagName.toLowerCase(),
      role,
      rect: {
        top: Math.round(r.top + window.scrollY),
        left: Math.round(r.left),
        width: Math.round(r.width),
        height: Math.round(r.height),
      },
      styles: extractStyles(el),
    };

    const motion = extractMotion(el);
    if (motion) node.motion = motion;

    if (ownText) node.text = ownText;

    if (el.tagName === 'IMG') {
      node.image = {
        src: (el.currentSrc || el.src || '').slice(0, 400),
        alt: el.alt || '',
        naturalWidth: el.naturalWidth,
        naturalHeight: el.naturalHeight,
      };
    }

    if (el.tagName === 'VIDEO') {
      node.video = {
        src: (el.currentSrc || el.src || '').slice(0, 400),
        poster: (el.poster || '').slice(0, 400),
        videoWidth: el.videoWidth,
        videoHeight: el.videoHeight,
        autoplay: el.autoplay,
        loop: el.loop,
        muted: el.muted,
        playsInline: el.playsInline,
      };
    }

    if (el.tagName === 'SVG') {
      node.svg = {
        label:
          el.getAttribute('aria-label') ||
          el.getAttribute('title') ||
          el.querySelector('title')?.textContent?.trim() ||
          '',
        viewBox: el.getAttribute('viewBox') || '',
        paths: el.querySelectorAll('path, circle, rect, polygon, polyline, line').length,
        markup: el.outerHTML.replace(/\s+/g, ' ').slice(0, 1200),
      };
    }

    if (el.tagName === 'A') {
      node.href = el.href || '';
      const label = (el.textContent || '').trim().slice(0, 100);
      if (label) node.label = label;
    }

    // Only descend into visible children that actually contain content
    const children = Array.from(el.children)
      .filter((c) => {
        if (!isVisible(c)) return false;
        const cr = c.getBoundingClientRect();
        return cr.width > 10 && cr.height > 10;
      })
      .slice(0, 30);

    if (children.length > 0) {
      node.children = children.map((c) => walk(c, depth + 1)).filter(Boolean);
    }

    return node;
  };

  const tree = walk(tightest, 0);

  // Also produce a flat summary that's easier to consume in spec files
  const flatImages = [];
  const flatBackgroundImages = [];
  const flatText = [];
  const flatButtons = [];
  const flatVideos = [];
  const flatSvgs = [];

  const collect = (node) => {
    if (!node) return;
    if (node.image && node.image.src) {
      flatImages.push({
        src: node.image.src,
        alt: node.image.alt,
        w: node.image.naturalWidth,
        h: node.image.naturalHeight,
        rect: node.rect,
      });
    }
    if (node.styles && node.styles.backgroundImage) {
      for (const src of extractCssUrls(node.styles.backgroundImage)) {
        flatBackgroundImages.push({
          src,
          alt: '',
          w: node.rect.width,
          h: node.rect.height,
          rect: node.rect,
          kind: 'background',
        });
      }
    }
    if (node.video) {
      flatVideos.push({
        src: node.video.src,
        poster: node.video.poster,
        w: node.video.videoWidth,
        h: node.video.videoHeight,
        rect: node.rect,
        autoplay: node.video.autoplay,
        loop: node.video.loop,
        muted: node.video.muted,
      });
    }
    if (node.svg) {
      flatSvgs.push({
        label: node.svg.label,
        viewBox: node.svg.viewBox,
        paths: node.svg.paths,
        rect: node.rect,
        markup: node.svg.markup,
      });
    }
    if (node.role === 'heading' || node.role === 'subheading') {
      if (node.text) flatText.push({ role: node.role, text: node.text, size: node.styles.fontSize });
    } else if (node.role === 'paragraph' || node.role === 'text') {
      if (node.text && node.text.length > 4) flatText.push({ role: node.role, text: node.text, size: node.styles.fontSize });
    }
    if ((node.role === 'button' || node.tag === 'a') && node.label) {
      flatButtons.push({ label: node.label, href: node.href || null });
    }
    if (node.children) node.children.forEach(collect);
  };
  collect(tree);

  // Section-level style (the wrapper)
  const wrapperStyles = extractStyles(tightest);
  const wrapperRect = tightest.getBoundingClientRect();

  // Effective background: the tightest wrapper is often transparent and the
  // gradient/image lives on an ancestor or an absolutely-positioned sibling
  // that spans the same Y band. Recover what a human actually sees.
  const isGradient = (v) => typeof v === 'string' && /gradient\(/.test(v);
  const isTransparentColor = (v) => !v || v === 'rgba(0, 0, 0, 0)' || v === 'transparent';
  const effectiveBg = (() => {
    const out = { color: null, image: null, source: null };
    const ownCs = getComputedStyle(tightest);
    if (!isTransparentColor(ownCs.backgroundColor)) { out.color = ownCs.backgroundColor; out.source = 'wrapper'; }
    if (ownCs.backgroundImage && ownCs.backgroundImage !== 'none') { out.image = ownCs.backgroundImage.slice(0, 400); out.source = 'wrapper'; }
    let p = tightest.parentElement;
    let depth = 0;
    while (p && p !== document.body && depth < 4) {
      const pcs = getComputedStyle(p);
      if (!out.image && pcs.backgroundImage && pcs.backgroundImage !== 'none') { out.image = pcs.backgroundImage.slice(0, 400); out.source = 'ancestor'; }
      if (!out.color && !isTransparentColor(pcs.backgroundColor)) { out.color = pcs.backgroundColor; if (!out.source) out.source = 'ancestor'; }
      if (out.image && isGradient(out.image)) break;
      p = p.parentElement;
      depth++;
    }
    if (!out.image || !isGradient(out.image)) {
      const sectionH = bottom - top;
      const candidates = Array.from(document.body.querySelectorAll('*')).filter((c) => {
        if (c === tightest || tightest.contains(c) || c.contains(tightest)) return false;
        if (!isVisible(c)) return false;
        const cr = c.getBoundingClientRect();
        const cTop = cr.top + window.scrollY;
        const cBot = cTop + cr.height;
        const overlap = Math.max(0, Math.min(cBot, bottom) - Math.max(cTop, top));
        return overlap >= sectionH * 0.8 && cr.width >= 600;
      });
      for (const c of candidates) {
        const ccs = getComputedStyle(c);
        if (ccs.backgroundImage && ccs.backgroundImage !== 'none' && isGradient(ccs.backgroundImage)) {
          out.image = ccs.backgroundImage.slice(0, 400);
          out.source = 'sibling';
          break;
        }
      }
    }
    return (out.color || out.image) ? out : null;
  })();

  // Dividers bracketing this section — same heuristic as extract.js, scoped
  // to elements within 40 px of the section's top or bottom edge.
  const dividers = Array.from(document.body.querySelectorAll('*')).reduce((acc, el) => {
    if (!isVisible(el)) return acc;
    const r = el.getBoundingClientRect();
    if (r.height < 1 || r.height > 4) return acc;
    if (r.width < window.innerWidth * 0.6) return acc;
    const parent = el.parentElement;
    if (parent && (parent.textContent || '').trim().length > 50) return acc;
    const elTop = r.top + window.scrollY;
    if (!(Math.abs(elTop - top) <= 40 || Math.abs(elTop - bottom) <= 40)) return acc;
    const cs = getComputedStyle(el);
    let color = null;
    if (!isTransparentColor(cs.backgroundColor)) color = cs.backgroundColor;
    else if (!isTransparentColor(cs.borderTopColor) && parseFloat(cs.borderTopWidth) >= 1) color = cs.borderTopColor;
    if (!color) return acc;
    acc.push({ top: Math.round(elTop), width: Math.round(r.width), height: Math.round(r.height), color });
    return acc;
  }, []);
  const dividerAbove = dividers.find((d) => d.top <= top + 5) || null;
  const dividerBelow = dividers.find((d) => d.top >= bottom - 5) || null;

  return {
    band: { top, height, bottom },
    wrapper: {
      tag: tightest.tagName.toLowerCase(),
      rect: {
        top: Math.round(wrapperRect.top + window.scrollY),
        width: Math.round(wrapperRect.width),
        height: Math.round(wrapperRect.height),
      },
      styles: wrapperStyles,
    },
    effectiveBg,
    dividerAbove,
    dividerBelow,
    tree,
    flat: {
      text: flatText.slice(0, 30),
      images: flatImages.slice(0, 30),
      backgroundImages: flatBackgroundImages.slice(0, 30),
      videos: flatVideos.slice(0, 20),
      svgs: flatSvgs.slice(0, 30),
      buttons: flatButtons.slice(0, 20),
    },
  };
};
