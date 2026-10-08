// Wheel drawing and the spin → burst → table reveal. Presentation only:
// this module never decides or changes who is assigned to what.

const SVG_NS = "http://www.w3.org/2000/svg";
const SPECTRUM = 11;            // Apple system colors c0..c10 (defined in styles.css)
const WIND_MS = 240;            // the wheel pulls back before it is released
const WIND_DEG = 10;
const SPIN_MS = 3200;           // total, including the wind-up
const BURST_MS = 900;
const ROW_STAGGER_MS = 22;
const ROW_MS = 640;
const SHARDS = 64;

export function prefersReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ------------------------------------------------------------------ springs

/** Damped spring sampled into a CSS linear() easing; falls back to a cubic-bezier. */
function spring(stiffness, damping, fallback) {
  const supported = typeof CSS !== "undefined" && CSS.supports?.("transition-timing-function", "linear(0, 1)");
  if (!supported) return fallback;
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * Math.sqrt(stiffness));
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  const settle = Math.log(1000) / (zeta * w0);
  const points = [];
  for (let i = 0; i <= 40; i += 1) {
    const t = (i / 40) * settle;
    const x = 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
    points.push(i === 40 ? 1 : +x.toFixed(4));
  }
  return `linear(${points.join(", ")})`;
}

const EASE_GENTLE = spring(260, 24, "cubic-bezier(0.22, 1, 0.36, 1)");
const EASE_BOUNCY = spring(380, 20, "cubic-bezier(0.34, 1.56, 0.64, 1)");
const EASE_OUT_EXPO = "cubic-bezier(0.16, 1, 0.3, 1)";

// ------------------------------------------------------------------ wheel

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function shorten(name, max) {
  const chars = Array.from(name);
  return chars.length <= max ? name : chars.slice(0, max - 1).join("") + "…";
}

function colorIndex(i, n) {
  if (n <= SPECTRUM) return Math.round((i * SPECTRUM) / n) % SPECTRUM;
  const k = i % SPECTRUM;
  return i === n - 1 && k === 0 ? 5 : k; // never give the last segment the first one's color
}

const polar = (r, a) => `${(r * Math.cos(a)).toFixed(3)} ${(r * Math.sin(a)).toFixed(3)}`;
const HUB = 19;
const CHAR_WIDTH = 0.6; // average glyph width / font size for semibold UI text
let drawCount = 0;       // makes textPath ids unique per drawing

/**
 * Up to 8 people: the name follows the arc like a watch dial (flipped on the lower half so it
 * stays upright), which leaves room for full names. More than 8: radial labels.
 */
function segmentLabel(name, i, n, a0, a1, RB, draw) {
  const step = a1 - a0;
  if (n === 1) {
    const label = svg("text", { x: 0, y: 50, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 11, class: "wheel-label" });
    label.textContent = shorten(name, 18);
    return label;
  }
  if (n <= 8) {
    const fontSize = n <= 4 ? 10.5 : 9;
    const r = RB - 15;
    const mid = (a0 + a1) / 2;
    const lower = Math.sin(mid) > 0.0001;     // centre of the segment is below the hub
    const pad = Math.min(step * 0.08, 0.12);
    const [from, to] = lower ? [a1 - pad, a0 + pad] : [a0 + pad, a1 - pad];
    const large = Math.abs(to - from) > Math.PI ? 1 : 0;
    const group = svg("g");
    const id = `wheel-${draw}-arc-${i}`;
    group.append(svg("path", { id, d: `M${polar(r, from)}A${r} ${r} 0 ${large} ${lower ? 0 : 1} ${polar(r, to)}`, fill: "none" }));
    const text = svg("text", { "font-size": fontSize, class: "wheel-label", "dominant-baseline": "central" });
    const textPath = svg("textPath", { href: `#${id}`, startOffset: "50%", "text-anchor": "middle" });
    const arcLength = r * Math.abs(to - from);
    textPath.textContent = shorten(name, Math.max(3, Math.floor(arcLength / (CHAR_WIDTH * fontSize))));
    text.append(textPath);
    group.append(text);
    return group;
  }
  const fontSize = n <= 14 ? 8 : n <= 20 ? 6.5 : 5.5;
  const mid = (a0 + a1) / 2;
  const deg = (((mid * 180) / Math.PI) % 360 + 360) % 360;
  const flip = deg > 90.5 && deg < 269.5; // keep left-half labels upright
  const outer = RB - 7;
  const label = svg("text", {
    x: flip ? -outer : outer, y: 0, transform: `rotate(${flip ? deg - 180 : deg})`,
    "text-anchor": flip ? "start" : "end", "dominant-baseline": "central", "font-size": fontSize, class: "wheel-label"
  });
  const room = outer - HUB - 6;
  label.textContent = shorten(name, Math.max(3, Math.floor(room / (CHAR_WIDTH * fontSize))));
  return label;
}

/** Draw a wheel with one segment per name into `host` (replacing its contents). */
export function drawWheel(host, names) {
  const R = 100;        // outer edge of the color band
  const RB = 86;        // inner edge of the color band / outer edge of the name face
  const n = Math.max(1, names.length);
  const step = (Math.PI * 2) / n;
  const draw = (drawCount += 1);

  const root = svg("svg", { viewBox: "-104 -104 208 208", class: "wheel-svg", "aria-hidden": "true", focusable: "false" });
  const defs = svg("defs");
  const filter = svg("filter", { id: "wheel-hub-shadow", x: "-50%", y: "-50%", width: "200%", height: "200%" });
  filter.append(svg("feDropShadow", { dx: 0, dy: 1.2, stdDeviation: 1.6, "flood-opacity": 0.28 }));
  defs.append(filter);
  root.append(defs, svg("circle", { r: R + 3, class: "wheel-rim" }));

  for (let i = 0; i < n; i += 1) {
    const c = `c${colorIndex(i, n)}`;
    const a0 = -Math.PI / 2 + i * step;
    const a1 = a0 + step;
    if (n === 1) {
      root.append(svg("circle", { r: RB, class: `seg-face ${c}` }));
      root.append(svg("path", {
        d: `M0 ${-R}A${R} ${R} 0 1 1 0 ${R}A${R} ${R} 0 1 1 0 ${-R}ZM0 ${-RB}A${RB} ${RB} 0 1 0 0 ${RB}A${RB} ${RB} 0 1 0 0 ${-RB}Z`,
        class: `seg-band ${c}`, "fill-rule": "evenodd"
      }));
    } else {
      const large = step > Math.PI ? 1 : 0;
      root.append(svg("path", { d: `M0 0L${polar(RB, a0)}A${RB} ${RB} 0 ${large} 1 ${polar(RB, a1)}Z`, class: `seg-face ${c}` }));
      root.append(svg("path", {
        d: `M${polar(RB, a0)}L${polar(R, a0)}A${R} ${R} 0 ${large} 1 ${polar(R, a1)}L${polar(RB, a1)}A${RB} ${RB} 0 ${large} 0 ${polar(RB, a0)}Z`,
        class: `seg-band ${c}`
      }));
    }

    if (names[i] !== undefined) root.append(segmentLabel(names[i], i, n, a0, a1, RB, draw));
  }

  root.append(svg("circle", { r: HUB, class: "wheel-hub", filter: "url(#wheel-hub-shadow)" }));
  root.append(svg("circle", { r: 4.5, class: "wheel-hub-dot" }));
  host.replaceChildren(root);
  host.dataset.segments = String(n);
}

// ------------------------------------------------------------------ reveal

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wheel angle (deg) at time t: a short pull-back, then a long decelerating spin. */
function angleAt(ms, total) {
  if (ms <= 0) return 0;
  if (ms < WIND_MS) return -WIND_DEG * Math.sin(((ms / WIND_MS) * Math.PI) / 2) ** 2;
  const p = Math.min(1, (ms - WIND_MS) / (SPIN_MS - WIND_MS));
  return -WIND_DEG + (total + WIND_DEG) * (1 - (1 - p) ** 3.4);
}

function spectrumColors() {
  const style = getComputedStyle(document.documentElement);
  const colors = [];
  for (let i = 0; i < SPECTRUM; i += 1) colors.push(style.getPropertyValue(`--c${i}`).trim() || "#007AFF");
  return colors;
}

/**
 * Play the reveal. Always resolves (hard timeout), and always ends with the
 * result visible and the wheel hidden.
 *
 * els: { wheelArea, resultArea, stage, rotor, pointer, shadow }
 * showResult(): renders the result into resultArea and returns the rows to stagger.
 */
export async function playReveal({ els, showResult, reducedMotion = prefersReducedMotion() }) {
  const running = [];
  const extras = [];
  let resultShown = false;
  let aborted = false;
  let rows = [];
  let rafId = 0;

  const animate = (el, keyframes, options) => {
    if (aborted || !el || typeof el.animate !== "function") return null;
    const anim = el.animate(keyframes, options);
    running.push(anim);
    return anim;
  };
  const done = (anim) => (anim ? anim.finished.catch(() => {}) : Promise.resolve());

  const revealResult = () => {
    if (resultShown) return;
    resultShown = true;
    rows = showResult() || [];
    els.wheelArea.hidden = true;
    els.resultArea.hidden = false;
  };

  const sequence = async () => {
    if (reducedMotion) {
      await done(animate(els.wheelArea, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" }));
      if (aborted) return;
      revealResult();
      await done(animate(els.resultArea, [{ opacity: 0 }, { opacity: 1 }], { duration: 220 }));
      return;
    }

    // 1. Spin: wind-up, release, long deceleration; the pointer flicks at every segment edge.
    const total = 360 * (5 + Math.random());
    const frames = [];
    for (let i = 0; i <= 120; i += 1) frames.push({ transform: `rotate(${angleAt((i / 120) * SPIN_MS, total)}deg)` });
    const spin = animate(els.rotor, frames, { duration: SPIN_MS, easing: "linear", fill: "forwards" });

    const segment = 360 / Math.max(1, Number(els.rotor.dataset.segments) || 1);
    let lastEdge = 0;
    let lastTick = 0;
    let tick = null;
    const watch = (now) => {
      if (aborted || !spin) return;
      const t = Number(spin.currentTime) || 0;
      const edge = Math.floor(angleAt(t, total) / segment);
      if (edge !== lastEdge && now - lastTick > 45) {
        const forward = edge > lastEdge;
        lastEdge = edge;
        lastTick = now;
        tick?.cancel();
        tick = animate(els.pointer, [{ rotate: forward ? "-20deg" : "14deg" }, { rotate: "0deg" }], { duration: 560, easing: EASE_BOUNCY });
      }
      if (t < SPIN_MS) rafId = requestAnimationFrame(watch);
    };
    rafId = requestAnimationFrame(watch);
    await done(spin);
    cancelAnimationFrame(rafId);
    if (aborted) return;

    // 2. The wheel dissolves into a spectrum bloom and colored shards.
    const layer = document.createElement("div");
    layer.className = "burst";
    layer.setAttribute("aria-hidden", "true");
    const bloom = document.createElement("div");
    bloom.className = "bloom";
    layer.append(bloom);
    els.stage.append(layer);
    extras.push(layer);

    const colors = spectrumColors();
    const radius = els.rotor.offsetWidth / 2 || 160; // layout size; a rotated bounding box is inflated
    const shards = [];
    for (let i = 0; i < SHARDS; i += 1) {
      const p = document.createElement("span");
      p.className = "particle";
      const size = 5 + Math.random() * 7;
      p.style.width = `${size}px`;
      p.style.height = `${size * (0.5 + Math.random() * 0.7)}px`;
      p.style.background = colors[i % colors.length];
      if (i % 3 === 0) p.style.borderRadius = "50%";
      layer.append(p);
      const angle = Math.random() * Math.PI * 2;
      const start = radius * (i % 4 === 0 ? Math.sqrt(Math.random()) * 0.8 : 0.82 + Math.random() * 0.16);
      const end = start + 70 + Math.random() * 110;
      const turn = (Math.random() - 0.5) * 540;
      const duration = 620 + Math.random() * 220;
      const delay = Math.random() * 60;
      const from = `translate(${Math.cos(angle) * start}px, ${Math.sin(angle) * start}px)`;
      const to = `translate(${Math.cos(angle) * end}px, ${Math.sin(angle) * end}px)`;
      shards.push(animate(p, [
        { transform: `${from} rotate(0deg) scale(1)` },
        { transform: `${to} rotate(${turn}deg) scale(0.6)` }
      ], { duration, delay, easing: EASE_OUT_EXPO, fill: "both" }));
      shards.push(animate(p, [{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], { duration, delay, fill: "both" }));
    }
    const peak = Number(getComputedStyle(document.documentElement).getPropertyValue("--bloom-peak")) || 0.7;
    const bloomAnim = animate(bloom, [
      { opacity: 0, transform: "scale(0.55)" },
      { opacity: peak, transform: "scale(1.02)", offset: 0.3 },
      { opacity: 0, transform: "scale(1.4)" }
    ], { duration: 760, easing: "ease-out", fill: "forwards" });
    const wheelOut = animate(els.rotor, [
      { transform: `rotate(${total}deg) scale(1)`, opacity: 1, filter: "blur(0px)" },
      { transform: `rotate(${total}deg) scale(1.06)`, opacity: 0, filter: "blur(12px)" }
    ], { duration: 340, easing: "ease-out", fill: "forwards" });
    const fades = [els.shadow, els.pointer].map((el) =>
      animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: "ease-out", fill: "forwards" }));
    await Promise.all([done(wheelOut), done(bloomAnim), ...fades.map(done), ...shards.map(done)]);
    layer.remove(); // the burst is over; don't keep 64 invisible nodes around during the rows
    if (aborted) return;

    // 3. The result springs in: heading first, then each row.
    revealResult();
    const head = els.resultArea.querySelector(".result-head");
    const fadeIn = animate(els.resultArea, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
    const headIn = animate(head, [
      { opacity: 0, transform: "translateY(14px)" },
      { opacity: 1, transform: "translateY(0)" }
    ], { duration: ROW_MS, easing: EASE_GENTLE, fill: "backwards" });
    const rowAnims = rows.map((row, i) => animate(row, [
      { opacity: 0, transform: "translateY(18px) scale(0.985)" },
      { opacity: 1, transform: "translateY(0) scale(1)" }
    ], { duration: ROW_MS, delay: 120 + i * ROW_STAGGER_MS, easing: EASE_GENTLE, fill: "backwards" }));
    await Promise.all([done(fadeIn), done(headIn), ...rowAnims.map(done)]);
  };

  const limit = reducedMotion ? 1500 : SPIN_MS + BURST_MS + ROW_MS + 40 * ROW_STAGGER_MS + 2000;
  try {
    await Promise.race([sequence(), sleep(limit)]);
  } catch (error) {
    console.warn("[WheelOfTest] reveal animation failed; showing the result", error);
  } finally {
    revealResult();
    aborted = true;
    cancelAnimationFrame(rafId);
    for (const anim of running) {
      try { anim.cancel(); } catch { /* ignore */ }
    }
    for (const el of extras) el.remove();
  }
}
