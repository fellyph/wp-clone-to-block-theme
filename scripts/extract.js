// Canonical full-page extractor for the Liberate It skill.
// Pass this function body to mcp__chrome-devtools__evaluate_script as the
// `function` argument.
//
// Returns { tokens, sections, images, palette, nav, diagnostics }.
// All Y-coordinates are absolute (document-relative), not viewport-relative.
//
// Design notes (why each piece exists):
// - Section detection prefers semantic landmarks (<section>, <header>,
//   <footer>, <nav>, <main>, <article>, [role="region"]) filtered to visible
//   elements ≥ 200px tall. If fewer than 3 usable landmarks are found, it
//   falls back to Y-band clustering — needed for page-builder output (Wix
//   portfolios, some Webflow / Squarespace templates) that renders everything
//   as absolute-positioned divs with no semantic sections.
// - h1 sampling looks at the largest *visible* text element, not
//   document.querySelector('h1') — many sites put a 12–17px hidden <h1> in
//   the DOM for SEO while the visible headline is a styled div.
// - After clustering, near-duplicate sections (same Y-band ±40px) are collapsed
//   to handle templates that render both desktop and mobile DOM variants.
// - `FRAMEWORK_DEFAULT_BUTTONS` blacklists well-known page-builder default
//   button colors from primary-color picking. Seeded with the Wix editor
//   default (#116DFF / rgb(17, 109, 255)). Extend as new defaults are found.

() => {
  // Colors that page builders use as their stock button color when the site
  // owner hasn't customized it. Never treat these as brand colors.
  const FRAMEWORK_DEFAULT_BUTTONS = [
    'rgb(17, 109, 255)', // Wix editor default (#116DFF)
  ];

  const isVisible = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const absTop = (el) => {
    const r = el.getBoundingClientRect();
    return Math.round(r.top + window.scrollY);
  };

  // ---- Display-text sampler ----
  // Walk all text-bearing elements and pick the largest visible one as the
  // display headline source. Ignores body/html and elements with no own text.
  const allTextEls = Array.from(document.body.querySelectorAll('*')).filter((el) => {
    if (!isVisible(el)) return false;
    if (!el.childNodes || el.childNodes.length === 0) return false;
    // Must have at least one direct text node with non-whitespace content
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.nodeValue.trim().length > 2) return true;
    }
    return false;
  });

  const sized = allTextEls
    .map((el) => {
      const cs = getComputedStyle(el);
      return {
        el,
        fontSize: parseFloat(cs.fontSize) || 0,
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
        color: cs.color,
        text: (el.textContent || '').trim().slice(0, 120),
      };
    })
    .filter((s) => s.fontSize > 0 && s.text.length > 0)
    .sort((a, b) => b.fontSize - a.fontSize);

  const display = sized[0] || null;
  const body = sized.find((s) => s.fontSize >= 14 && s.fontSize <= 22) || sized[sized.length - 1] || null;

  // ---- Button color sampler (skips framework defaults) ----
  const buttons = Array.from(document.querySelectorAll('a[role="button"], button, .button, [data-testid*="button" i]'))
    .filter(isVisible);
  const buttonColor = (() => {
    for (const b of buttons) {
      const cs = getComputedStyle(b);
      const bg = cs.backgroundColor;
      if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') continue;
      if (FRAMEWORK_DEFAULT_BUTTONS.includes(bg)) continue; // page-builder default, not brand
      return { bg, fg: cs.color };
    }
    return null;
  })();
  const defaultButtonSkipped = buttons.some((b) => FRAMEWORK_DEFAULT_BUTTONS.includes(getComputedStyle(b).backgroundColor));

  // ---- Section detection ----
  // Pass 1: semantic landmarks. If the site has real <section>/<header>/etc.
  // markup, we use it — it's more accurate than any geometric clustering.
  const SEMANTIC_SELECTOR = 'main > section, main > article, section, header, footer, nav, article, aside, [role="region"], [role="banner"], [role="contentinfo"], [role="navigation"]';
  const semanticCandidates = Array.from(document.querySelectorAll(SEMANTIC_SELECTOR)).filter((el) => {
    if (!isVisible(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.height < 200 || r.width < 600) return false;
    if (el === document.body || el === document.documentElement) return false;
    return true;
  });

  // De-nest: if a candidate contains another candidate, keep only the deeper
  // (smaller-area) one so we pick the actual section rather than a wrapping <main>.
  const semanticWinners = semanticCandidates.filter((el) => {
    return !semanticCandidates.some((other) => other !== el && el.contains(other) && other.getBoundingClientRect().height >= 200);
  });

  let sectionStrategy = 'semantic';
  let bandWinners;

  if (semanticWinners.length >= 3) {
    bandWinners = semanticWinners
      .map((el) => ({ band: absTop(el), el }))
      .sort((a, b) => a.band - b.band);
  } else {
    // Pass 2: Y-band clustering (fallback for non-semantic templates).
    // Candidates: any visible block-ish element at least 200px tall that has
    // either text or images of its own (ignore pure wrapper divs).
    sectionStrategy = 'y-band';
    const candidates = Array.from(document.body.querySelectorAll('*')).filter((el) => {
      if (!isVisible(el)) return false;
      const r = el.getBoundingClientRect();
      if (r.height < 200 || r.width < 600) return false;
      if (el.querySelectorAll('img').length === 0 && (el.textContent || '').trim().length < 20) return false;
      if (el === document.body || el === document.documentElement) return false;
      return true;
    });

    // Cluster by top-Y position in 300px bands
    const bands = new Map();
    for (const el of candidates) {
      const top = absTop(el);
      const band = Math.round(top / 300) * 300;
      if (!bands.has(band)) bands.set(band, []);
      bands.get(band).push(el);
    }

    // For each band, keep the most specific (smallest-area, deepest) element
    // that still contains the band's content. Avoids picking the full-page
    // wrapper div over a real section child.
    bandWinners = [];
    for (const [band, els] of bands) {
      els.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return ra.width * ra.height - rb.width * rb.height;
      });
      bandWinners.push({ band, el: els[0] });
    }
    bandWinners.sort((a, b) => a.band - b.band);
  }

  // Near-duplicate collapse: drop any winner whose Y is within 40px of a
  // previously-kept winner (desktop/mobile variants rendered together).
  const deduped = [];
  for (const w of bandWinners) {
    if (deduped.some((d) => Math.abs(d.band - w.band) < 40)) continue;
    deduped.push(w);
  }

  // ---- Page-background detection ----
  // Builder templates sometimes paint one long gradient behind every section
  // (e.g. a full-height dark-to-bright body fade). If we attach that gradient
  // to each section pattern, WP rerenders it per-pattern and produces visible
  // stripes. Recover it once as a page-level token so pattern emission can
  // skip section bg and the theme.json `styles.background.gradient` inherits
  // it onto <body>.
  const pageBackground = (() => {
    const pageH = document.body.scrollHeight;
    const candidates = Array.from(document.body.querySelectorAll('*')).filter((el) => {
      if (!isVisible(el)) return false;
      const cs = getComputedStyle(el);
      if (!cs.backgroundImage || cs.backgroundImage === 'none') return false;
      if (!/gradient\(/.test(cs.backgroundImage)) return false;
      const r = el.getBoundingClientRect();
      return r.height >= pageH * 0.8 && r.width >= window.innerWidth * 0.6;
    });
    if (candidates.length === 0) return null;
    // Prefer the largest-area candidate (covers the most visual real estate)
    candidates.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    });
    const winner = candidates[0];
    const wcs = getComputedStyle(winner);
    return {
      gradient: wcs.backgroundImage.slice(0, 400),
      color: wcs.backgroundColor && wcs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? wcs.backgroundColor : null,
    };
  })();

  // ---- Effective-background walker ----
  // The "tightest wrapper" section element often has a transparent background
  // because page builders layer gradients and images on absolutely-positioned
  // sibling or ancestor "background" divs. To recover the *effective* bg a
  // user actually sees behind the section, walk up the ancestor chain and
  // scan in-band siblings, preferring gradients > image URLs > solid colors.
  const isGradient = (v) => typeof v === 'string' && /gradient\(/.test(v);
  const isTransparentColor = (v) => !v || v === 'rgba(0, 0, 0, 0)' || v === 'transparent';
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
  const pickEffectiveBg = (el, sectionTop, sectionBottom) => {
    const out = { color: null, image: null, source: null };
    // 1. the wrapper itself
    const ownCs = getComputedStyle(el);
    if (!isTransparentColor(ownCs.backgroundColor)) {
      out.color = ownCs.backgroundColor;
      out.source = 'wrapper';
    }
    if (ownCs.backgroundImage && ownCs.backgroundImage !== 'none') {
      out.image = ownCs.backgroundImage.slice(0, 400);
      out.source = 'wrapper';
    }
    // 2. walk up to 4 ancestors — halt at body
    let p = el.parentElement;
    let depth = 0;
    while (p && p !== document.body && depth < 4) {
      const pcs = getComputedStyle(p);
      if (!out.image && pcs.backgroundImage && pcs.backgroundImage !== 'none') {
        out.image = pcs.backgroundImage.slice(0, 400);
        out.source = 'ancestor';
      }
      if (!out.color && !isTransparentColor(pcs.backgroundColor)) {
        out.color = pcs.backgroundColor;
        if (!out.source) out.source = 'ancestor';
      }
      if (out.image && isGradient(out.image)) break; // gradient found, done
      p = p.parentElement;
      depth++;
    }
    // 3. in-band sibling/overlap scan — look for absolute-positioned bg layers
    if (!out.image || !isGradient(out.image)) {
      const sectionH = sectionBottom - sectionTop;
      const candidates = Array.from(document.body.querySelectorAll('*')).filter((c) => {
        if (c === el || el.contains(c) || c.contains(el)) return false;
        if (!isVisible(c)) return false;
        const cr = c.getBoundingClientRect();
        const cTop = cr.top + window.scrollY;
        const cBot = cTop + cr.height;
        const overlap = Math.max(0, Math.min(cBot, sectionBottom) - Math.max(cTop, sectionTop));
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
  };

  // ---- Divider detection ----
  // Thin horizontal rules — <hr>, or <div>/<span> with height 1-4px and width
  // ≥ 60% of the viewport and a non-transparent visible color. These delimit
  // sections on many portfolio/editorial sites.
  const dividers = Array.from(document.body.querySelectorAll('*')).reduce((acc, el) => {
    if (!isVisible(el)) return acc;
    const r = el.getBoundingClientRect();
    if (r.height < 1 || r.height > 4) return acc;
    if (r.width < window.innerWidth * 0.6) return acc;
    // Reject if it sits inside a text block (divider-like glyph, not a section rule)
    const parent = el.parentElement;
    if (parent && (parent.textContent || '').trim().length > 50) return acc;
    const cs = getComputedStyle(el);
    let color = null;
    if (!isTransparentColor(cs.backgroundColor)) color = cs.backgroundColor;
    else if (!isTransparentColor(cs.borderTopColor) && parseFloat(cs.borderTopWidth) >= 1) color = cs.borderTopColor;
    if (!color) return acc;
    acc.push({
      top: Math.round(r.top + window.scrollY),
      width: Math.round(r.width),
      height: Math.round(r.height),
      color,
    });
    return acc;
  }, []);

  // ---- Motion / interaction inventory ----
  // High-fidelity clones of agency and portfolio sites fail when motion is
  // silently dropped. Capture simple CSS/DOM motion signals up front so specs
  // can preserve reproducible effects and explicitly stub framework effects.
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

  const elementLabel = (el) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const className = typeof el.className === 'string' ? el.className : '';
    const classes = className
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((name) => `.${name}`)
      .join('');
    return `${tag}${id}${classes}`;
  };

  const isDefaultTransform = (value) => {
    return !value || value === 'none' || value === 'matrix(1, 0, 0, 1, 0, 0)';
  };

  const isDefaultEffect = (value) => {
    return !value || value === 'none' || value === 'normal' || value === '0px';
  };

  const motionForElement = (el) => {
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
    const animationDelayMs = parseTimeMs(cs.animationDelay);
    if (cs.animationName && cs.animationName !== 'none' && (animationDurationMs > 0 || animationDelayMs > 0)) {
      signals.push('css-animation');
    }

    const transitionDurationMs = parseTimeMs(cs.transitionDuration);
    if (cs.transitionProperty && cs.transitionProperty !== 'none' && transitionDurationMs > 0) {
      signals.push('transition');
    }

    if (!isDefaultTransform(cs.transform)) signals.push('transform');
    if (cs.position === 'sticky' || cs.position === 'fixed') signals.push(`position-${cs.position}`);
    if (cs.willChange && cs.willChange !== 'auto') signals.push('will-change');
    if (!isDefaultEffect(cs.filter)) signals.push('filter');
    if (!isDefaultEffect(cs.backdropFilter)) signals.push('backdrop-filter');
    if (!isDefaultEffect(cs.clipPath)) signals.push('clip-path');
    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') signals.push('blend-mode');
    if (tag === 'video') signals.push('video');
    if (tag === 'canvas') signals.push('canvas');
    if (tag === 'svg') signals.push('svg');
    if (/marquee|ticker|crawl|scrolling-text/.test(combined)) signals.push('marquee-like');
    if (/slider|carousel|swiper|splide|slideshow/.test(combined)) signals.push('carousel-like');
    if (/parallax|sticky|pin-spacer|scrolltrigger/.test(combined)) signals.push('scroll-effect');
    if (/lottie|bodymovin/.test(combined)) signals.push('lottie-like');

    if (signals.length === 0) return null;

    const r = el.getBoundingClientRect();
    return {
      selector: elementLabel(el),
      tag,
      top: Math.round(r.top + window.scrollY),
      left: Math.round(r.left),
      width: Math.round(r.width),
      height: Math.round(r.height),
      signals: Array.from(new Set(signals)),
      animation:
        signals.includes('css-animation')
          ? {
              name: cs.animationName,
              durationMs: animationDurationMs,
              delayMs: animationDelayMs,
              iterationCount: cs.animationIterationCount,
              timingFunction: cs.animationTimingFunction,
            }
          : null,
      transition:
        signals.includes('transition')
          ? {
              property: cs.transitionProperty,
              durationMs: transitionDurationMs,
              timingFunction: cs.transitionTimingFunction,
            }
          : null,
      transform: !isDefaultTransform(cs.transform) ? cs.transform.slice(0, 160) : null,
      position: cs.position,
    };
  };

  const motionInventory = Array.from(document.body.querySelectorAll('*'))
    .filter(isVisible)
    .map(motionForElement)
    .filter(Boolean);

  const motionSignalCounts = motionInventory.reduce((acc, item) => {
    for (const signal of item.signals) acc[signal] = (acc[signal] || 0) + 1;
    return acc;
  }, {});

  const countCssKeyframes = () => {
    let count = 0;
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch (e) {
        continue;
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (rule.type === CSSRule.KEYFRAMES_RULE || rule.type === CSSRule.WEBKIT_KEYFRAMES_RULE) count++;
      }
    }
    return count;
  };

  const motionLibraries = (() => {
    const resources = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name.toLowerCase())
      .join(' ');
    const html = document.documentElement.outerHTML.slice(0, 250000).toLowerCase();
    const haystack = `${resources} ${html}`;
    return ['gsap', 'scrolltrigger', 'lottie', 'bodymovin', 'swiper', 'splide', 'slick', 'three', 'anime', 'framer']
      .filter((name) => haystack.includes(name));
  })();

  const sectionMotion = (el) => {
    const items = [el, ...Array.from(el.querySelectorAll('*'))]
      .filter(isVisible)
      .map(motionForElement)
      .filter(Boolean);
    const signals = Array.from(new Set(items.flatMap((item) => item.signals)));
    return {
      count: items.length,
      signals,
      samples: items.slice(0, 8),
    };
  };

  const sections = deduped.slice(0, 20).map(({ el }, i) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const sectionTop = Math.round(r.top + window.scrollY);
    const sectionBottom = sectionTop + Math.round(r.height);
    const biggestText = Array.from(el.querySelectorAll('h1,h2,h3,[role="heading"]'))
      .filter(isVisible)
      .map((e) => ({ e, size: parseFloat(getComputedStyle(e).fontSize) || 0 }))
      .sort((a, b) => b.size - a.size)[0];
    // If no semantic heading, grab the largest visible text in the section
    let headingText = biggestText?.e.textContent?.trim().slice(0, 100);
    if (!headingText) {
      const inner = Array.from(el.querySelectorAll('*'))
        .filter((e) => isVisible(e) && (e.textContent || '').trim().length > 3 && e.children.length === 0)
        .map((e) => ({ e, size: parseFloat(getComputedStyle(e).fontSize) || 0 }))
        .sort((a, b) => b.size - a.size)[0];
      headingText = inner?.e.textContent?.trim().slice(0, 100) || null;
    }
    const effectiveBg = pickEffectiveBg(el, sectionTop, sectionBottom);
    // Bracketing dividers: any divider within 40px above the top or below the bottom
    const dividerAbove = dividers.find((d) => Math.abs(d.top - sectionTop) <= 40 && d.top <= sectionTop + 10) || null;
    const dividerBelow = dividers.find((d) => Math.abs(d.top - sectionBottom) <= 40 && d.top >= sectionBottom - 40) || null;
    return {
      index: i,
      tag: el.tagName.toLowerCase(),
      top: sectionTop,
      height: Math.round(r.height),
      bg: cs.backgroundColor,
      bgImage: cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 200) : null,
      effectiveBg,
      dividerAbove,
      dividerBelow,
      heading: headingText,
      imgCount: el.querySelectorAll('img').length,
      videoCount: el.querySelectorAll('video').length,
      btnCount: el.querySelectorAll('a[role="button"], button').length,
      motion: sectionMotion(el),
    };
  });

  // Gradient reassignment pass.
  // 1. If a section's effectiveBg matches the page-level gradient, clear it —
  //    the body will inherit via theme.json, and painting it again per-pattern
  //    would stripe. Record the match via source='pageBackground' so callers
  //    can still tell this section had a gradient originally.
  // 2. If two adjacent sections share the same (non-page) gradient, keep it
  //    on the topmost and inherit to prevent stripes within a local group.
  const pageGradient = pageBackground?.gradient || null;
  for (const s of sections) {
    if (pageGradient && s.effectiveBg && s.effectiveBg.image === pageGradient) {
      s.effectiveBg = { color: s.effectiveBg.color, image: null, source: 'pageBackground' };
    }
  }
  for (let i = 1; i < sections.length; i++) {
    const prev = sections[i - 1].effectiveBg;
    const curr = sections[i].effectiveBg;
    if (prev && curr && prev.image && curr.image && prev.image === curr.image) {
      sections[i].effectiveBg = {
        color: curr.color,
        image: null,
        source: 'inherited',
      };
    }
  }

  // ---- Hero-image palette sampler ----
  // Pick the largest visible <img>, draw it into a 40×40 canvas, quantize
  // colors to 5 bits per channel, and return the top 6 by pixel count.
  const palette = (() => {
    const imgs = Array.from(document.querySelectorAll('img'))
      .filter((i) => isVisible(i) && i.naturalWidth > 400)
      .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight);
    const img = imgs[0];
    if (!img) return [];
    try {
      const c = document.createElement('canvas');
      c.width = 40;
      c.height = 40;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 40, 40);
      const data = ctx.getImageData(0, 0, 40, 40).data;
      const hist = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a < 200) continue;
        const r = data[i] >> 3;
        const g = data[i + 1] >> 3;
        const b = data[i + 2] >> 3;
        const k = (r << 10) | (g << 5) | b;
        hist.set(k, (hist.get(k) || 0) + 1);
      }
      const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      return top.map(([k, count]) => {
        const r = (k >> 10) << 3;
        const g = ((k >> 5) & 31) << 3;
        const b = (k & 31) << 3;
        return { hex: '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''), count };
      });
    } catch (e) {
      return []; // canvas tainted by CORS — common with image CDNs
    }
  })();

  // ---- Navigation + image inventory ----
  const nav = Array.from(document.querySelectorAll('nav a, header a, [role="navigation"] a'))
    .filter(isVisible)
    .slice(0, 10)
    .map((a) => (a.textContent || '').trim())
    .filter(Boolean);

  const imgInventory = Array.from(document.querySelectorAll('img'))
    .filter(isVisible)
    .map((img) => ({
      src: (img.currentSrc || img.src).slice(0, 300),
      alt: img.alt,
      w: img.naturalWidth,
      h: img.naturalHeight,
      kind: 'img',
    }))
    .filter((i) => i.src && i.w > 100);

  const backgroundImageInventory = Array.from(document.body.querySelectorAll('*'))
    .filter(isVisible)
    .flatMap((el) => {
      const cs = getComputedStyle(el);
      const urls = extractCssUrls(cs.backgroundImage);
      if (urls.length === 0) return [];
      const r = el.getBoundingClientRect();
      if (r.width < 100 || r.height < 80) return [];
      return urls.map((url) => ({
        src: url.slice(0, 300),
        alt: el.getAttribute('aria-label') || el.getAttribute('title') || '',
        w: Math.round(r.width),
        h: Math.round(r.height),
        kind: 'background',
        rect: {
          top: Math.round(r.top + window.scrollY),
          left: Math.round(r.left),
          width: Math.round(r.width),
          height: Math.round(r.height),
        },
      }));
    });

  const images = (() => {
    const out = [];
    const seen = new Set();
    for (const image of [...imgInventory, ...backgroundImageInventory]) {
      const key = image.src.replace(/([?&])(w|h|q|quality|fit|crop)_[^&]+/g, '$1');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(image);
    }
    return out.slice(0, 36);
  })();

  const videos = Array.from(document.querySelectorAll('video'))
    .filter(isVisible)
    .slice(0, 12)
    .map((video) => {
      const r = video.getBoundingClientRect();
      return {
        src: (video.currentSrc || video.src || '').slice(0, 300),
        poster: (video.poster || '').slice(0, 300),
        w: video.videoWidth || Math.round(r.width),
        h: video.videoHeight || Math.round(r.height),
        rect: {
          top: Math.round(r.top + window.scrollY),
          left: Math.round(r.left),
          width: Math.round(r.width),
          height: Math.round(r.height),
        },
        autoplay: video.autoplay,
        loop: video.loop,
        muted: video.muted,
        playsInline: video.playsInline,
      };
    });

  const inlineSvgs = Array.from(document.querySelectorAll('svg'))
    .filter(isVisible)
    .slice(0, 48)
    .map((svg) => {
      const r = svg.getBoundingClientRect();
      const label =
        svg.getAttribute('aria-label') ||
        svg.getAttribute('title') ||
        svg.querySelector('title')?.textContent?.trim() ||
        '';
      return {
        selector: elementLabel(svg),
        label,
        viewBox: svg.getAttribute('viewBox') || '',
        width: Math.round(r.width),
        height: Math.round(r.height),
        top: Math.round(r.top + window.scrollY),
        left: Math.round(r.left),
        paths: svg.querySelectorAll('path, circle, rect, polygon, polyline, line').length,
        markup: svg.outerHTML.replace(/\s+/g, ' ').slice(0, 1200),
      };
    });

  // ---- h2 / h1 swap detection ----
  // If the display text is meaningfully larger than what querySelector('h1')
  // would return, report both so the caller can decide.
  const h1El = document.querySelector('h1');
  const legacyH1Size = h1El ? parseFloat(getComputedStyle(h1El).fontSize) || 0 : 0;
  const displaySize = display?.fontSize || 0;
  const h1Swapped = legacyH1Size > 0 && displaySize > legacyH1Size * 1.2;

  const tokens = {
    display: display
      ? {
          fontFamily: display.fontFamily,
          fontSize: display.fontSize,
          fontWeight: display.fontWeight,
          color: display.color,
          text: display.text,
        }
      : null,
    body: body
      ? { fontFamily: body.fontFamily, fontSize: body.fontSize, color: body.color }
      : null,
    button: buttonColor,
    contentWidth: document.querySelector('main')?.getBoundingClientRect().width || window.innerWidth,
    defaultButtonSkipped,
    h1Swapped,
    legacyH1Size,
    pageBackground,
  };

  return {
    tokens,
    sections,
    dividers,
    palette,
    nav,
    images,
    media: {
      videos,
      inlineSvgs,
    },
    motion: {
      totalElements: motionInventory.length,
      signalCounts: motionSignalCounts,
      cssKeyframes: countCssKeyframes(),
      libraries: motionLibraries,
      prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      samples: motionInventory.slice(0, 30),
    },
    diagnostics: {
      textCandidates: sized.length,
      sectionCandidates: sectionStrategy === 'semantic' ? semanticCandidates.length : undefined,
      sectionStrategy,
      afterDedupe: deduped.length,
      pageHeight: document.body.scrollHeight,
      title: document.title,
    },
  };
};
