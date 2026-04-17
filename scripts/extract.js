// Canonical full-page extractor for the wp-clone-to-block-theme skill.
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

  const sections = deduped.slice(0, 20).map(({ el }, i) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
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
    return {
      index: i,
      tag: el.tagName.toLowerCase(),
      top: Math.round(r.top + window.scrollY),
      height: Math.round(r.height),
      bg: cs.backgroundColor,
      bgImage: cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 200) : null,
      heading: headingText,
      imgCount: el.querySelectorAll('img').length,
      btnCount: el.querySelectorAll('a[role="button"], button').length,
    };
  });

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

  const images = Array.from(document.querySelectorAll('img'))
    .filter(isVisible)
    .slice(0, 12)
    .map((img) => ({
      src: (img.currentSrc || img.src).slice(0, 300),
      alt: img.alt,
      w: img.naturalWidth,
      h: img.naturalHeight,
    }))
    .filter((i) => i.src && i.w > 100);

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
  };

  return {
    tokens,
    sections,
    palette,
    nav,
    images,
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
