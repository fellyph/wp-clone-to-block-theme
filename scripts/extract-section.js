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
    'opacity', 'transform',
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

    if (ownText) node.text = ownText;

    if (el.tagName === 'IMG') {
      node.image = {
        src: (el.currentSrc || el.src || '').slice(0, 400),
        alt: el.alt || '',
        naturalWidth: el.naturalWidth,
        naturalHeight: el.naturalHeight,
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
  const flatText = [];
  const flatButtons = [];

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
    tree,
    flat: {
      text: flatText.slice(0, 30),
      images: flatImages.slice(0, 30),
      buttons: flatButtons.slice(0, 20),
    },
  };
};
