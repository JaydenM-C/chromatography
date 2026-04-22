import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Upload, X, Copy, Check, Crosshair, Eye, EyeOff, Download, Pipette, Sparkles, Trash2, Plus, Save } from 'lucide-react';

// ============================================================
// colour space conversions — sRGB <-> linear <-> OKLab <-> OKLCH
// ============================================================

const srgbToLinear = (c) => {
  const u = c / 255;
  return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
};
const linearToSrgb = (c) => {
  const u = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1/2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(u * 255)));
};

const rgbToOklab = (r, g, b) => {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
};

const oklabToLinearRgb = (L, a, b) => {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_**3, m = m_**3, s = s_**3;
  return {
    r:  4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  };
};
const oklabToRgb = (L, a, b) => {
  const { r, g, b: bb } = oklabToLinearRgb(L, a, b);
  return { r: linearToSrgb(r), g: linearToSrgb(g), b: linearToSrgb(bb) };
};
const isInGamut = (L, a, b, eps = 0.001) => {
  const { r, g, b: bb } = oklabToLinearRgb(L, a, b);
  return r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && bb >= -eps && bb <= 1 + eps;
};

const oklabToOklch = (L, a, b) => ({
  L, C: Math.sqrt(a*a + b*b), h: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360,
});
const oklchToOklab = (L, C, h) => ({
  L, a: C * Math.cos(h * Math.PI / 180), b: C * Math.sin(h * Math.PI / 180),
});

const rgbToHex = (r, g, b) => '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('').toUpperCase();
const hexToRgb = (hex) => {
  const h = hex.replace('#','');
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return { r, g, b };
};

// ============================================================
// APCA — modern contrast algorithm (drafted for WCAG 3)
// ============================================================
const sRGBtoY = (r, g, b) => (
  0.2126729 * Math.pow(r/255, 2.4) +
  0.7151522 * Math.pow(g/255, 2.4) +
  0.0721750 * Math.pow(b/255, 2.4)
);
const APCA = (txt, bg) => {
  const softClamp = (Y) => Y < 0.022 ? Y + Math.pow(0.022 - Y, 1.414) : Y;
  const Yt = softClamp(sRGBtoY(txt.r, txt.g, txt.b));
  const Yb = softClamp(sRGBtoY(bg.r, bg.g, bg.b));
  if (Math.abs(Yt - Yb) < 0.0005) return 0;
  let Sapc;
  if (Yb > Yt) Sapc = (Math.pow(Yb, 0.56) - Math.pow(Yt, 0.57)) * 1.14;
  else         Sapc = (Math.pow(Yb, 0.65) - Math.pow(Yt, 0.62)) * 1.14;
  let Lc = Sapc * 100;
  if (Math.abs(Lc) < 15) return 0;
  return Lc > 0 ? Lc - 1 : Lc + 1;
};

// ============================================================
// k-means++ in OKLab space, tracking source (x,y) per cluster
// ============================================================
const kmeansPlusPlus = (points, k, maxIter = 24) => {
  if (points.length === 0) return [];
  k = Math.min(k, points.length);
  const centroids = [points[Math.floor(Math.random() * points.length)]];
  while (centroids.length < k) {
    const distances = points.map(p => {
      let min = Infinity;
      for (const c of centroids) {
        const dL = p.L-c.L, da = p.a-c.a, db = p.b-c.b;
        const d = dL*dL + da*da + db*db;
        if (d < min) min = d;
      }
      return min;
    });
    const sum = distances.reduce((a,b)=>a+b, 0);
    if (sum === 0) break;
    let r = Math.random() * sum, idx = 0;
    for (let i = 0; i < distances.length; i++) {
      r -= distances[i];
      if (r <= 0) { idx = i; break; }
    }
    centroids.push(points[idx]);
  }

  const assignments = new Array(points.length).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < points.length; i++) {
      let min = Infinity, best = 0;
      for (let j = 0; j < centroids.length; j++) {
        const dL = points[i].L - centroids[j].L;
        const da = points[i].a - centroids[j].a;
        const db = points[i].b - centroids[j].b;
        const d = dL*dL + da*da + db*db;
        if (d < min) { min = d; best = j; }
      }
      if (assignments[i] !== best) { assignments[i] = best; changed = true; }
    }
    const sums = Array.from({length: centroids.length}, () => ({L:0,a:0,b:0,x:0,y:0,n:0}));
    for (let i = 0; i < points.length; i++) {
      const c = sums[assignments[i]];
      c.L += points[i].L; c.a += points[i].a; c.b += points[i].b;
      c.x += points[i].x; c.y += points[i].y; c.n++;
    }
    for (let j = 0; j < centroids.length; j++) {
      if (sums[j].n > 0) {
        centroids[j] = {
          L: sums[j].L/sums[j].n, a: sums[j].a/sums[j].n, b: sums[j].b/sums[j].n,
          x: sums[j].x/sums[j].n, y: sums[j].y/sums[j].n, n: sums[j].n,
        };
      }
    }
    if (!changed) break;
  }
  return centroids.filter(c => c.n > 0).sort((a,b) => (b.n||0) - (a.n||0));
};

// ============================================================
// main component
// ============================================================

let idCounter = 0;
const newId = () => `s${++idCounter}`;

function KofiButton() {
  const containerRef = useRef(null);
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://storage.ko-fi.com/cdn/widget/Widget_2.js';
    script.type = 'text/javascript';
    script.onload = () => {
      if (window.kofiwidget2 && containerRef.current) {
        window.kofiwidget2.init('Support me', '#8A3A24', 'Z8Z61Y87TQ');
        containerRef.current.innerHTML = window.kofiwidget2.getHTML();
      }
    };
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); };
  }, []);
  return <div ref={containerRef} className="kofi-container" />;
}

export default function App() {
  const [image, setImage] = useState(null); // { el, naturalW, naturalH, url }
  const [samples, setSamples] = useState([]); // [{id, rgb, L, C, h, source, x, y, weight}]
  const [selectedId, setSelectedId] = useState(null);
  const [k, setK] = useState(6);
  const [extracting, setExtracting] = useState(false);
  const [showMarkers, setShowMarkers] = useState(true);
  const [hoverPixel, setHoverPixel] = useState(null); // {x, y, rgb, L, C, h}
  const [copiedId, setCopiedId] = useState(null);
  const [hexInput, setHexInput] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const displayCanvasRef = useRef(null);
  const sampleCanvasRef = useRef(null); // offscreen, natural size
  const loupeCanvasRef = useRef(null);
  const containerRef = useRef(null);

  // ---- load image or project ----
  const [loadError, setLoadError] = useState(null);
  const loadImageFile = useCallback((file) => {
    setLoadError(null);
    if (!file) { setLoadError('No file received.'); return; }
    const isJson = file.type === 'application/json' || /\.json$/i.test(file.name);
    if (isJson) {
      const r = new FileReader();
      r.onerror = () => setLoadError('FileReader failed to read the project file.');
      r.onload = (ev) => {
        const txt = ev.target?.result;
        if (typeof txt !== 'string') { setLoadError('Project file was not text.'); return; }
        loadProjectJSON(txt);
      };
      r.readAsText(file);
      return;
    }
    if (!file.type.startsWith('image/')) {
      setLoadError(`Not an image or project file (type: ${file.type || 'unknown'}).`);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setLoadError('FileReader failed to read the file.');
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result;
      if (typeof dataUrl !== 'string') {
        setLoadError('FileReader returned unexpected data.');
        return;
      }
      const el = new Image();
      el.onerror = () => setLoadError('Image element failed to decode the file.');
      el.onload = () => {
        if (!el.naturalWidth || !el.naturalHeight) {
          setLoadError('Image decoded but has zero dimensions.');
          return;
        }
        setImage({ el, naturalW: el.naturalWidth, naturalH: el.naturalHeight, url: dataUrl });
        setSamples([]);
        setSelectedId(null);
      };
      el.src = dataUrl;
    };
    reader.readAsDataURL(file);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFileInput = (e) => { if (e.target.files?.[0]) loadImageFile(e.target.files[0]); };
  const onDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) loadImageFile(e.dataTransfer.files[0]);
  };

  // ---- render image to both canvases ----
  useEffect(() => {
    if (!image) return;
    const sc = sampleCanvasRef.current;
    sc.width = image.naturalW;
    sc.height = image.naturalH;
    sc.getContext('2d', { willReadFrequently: true }).drawImage(image.el, 0, 0);
    renderDisplay();
    // eslint-disable-next-line
  }, [image]);

  // ---- redraw display canvas (image + markers) ----
  const renderDisplay = useCallback(() => {
    const dc = displayCanvasRef.current;
    if (!dc || !image) return;
    const container = containerRef.current;
    if (!container) return;

    const maxW = Math.max(200, (container.clientWidth || window.innerWidth) - 32);
    const maxH = Math.max(200, (container.clientHeight || window.innerHeight - 80) - 32);
    const ratio = Math.min(maxW / image.naturalW, maxH / image.naturalH, 1);
    const w = Math.floor(image.naturalW * ratio);
    const h = Math.floor(image.naturalH * ratio);
    dc.width = w;
    dc.height = h;
    const ctx = dc.getContext('2d');
    ctx.drawImage(image.el, 0, 0, w, h);

    if (showMarkers) {
      samples.forEach((s, i) => {
        if (s.source !== 'auto' && s.source !== 'manual') return;
        if (s.x == null || s.y == null) return;
        const mx = s.x * ratio;
        const my = s.y * ratio;
        const isSel = s.id === selectedId;
        const r = isSel ? 10 : 7;
        // crosshair
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = isSel ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(mx - r, my); ctx.lineTo(mx + r, my);
        ctx.moveTo(mx, my - r); ctx.lineTo(mx, my + r);
        ctx.stroke();
        // inner circle filled with the colour
        ctx.fillStyle = rgbToHex(s.rgb.r, s.rgb.g, s.rgb.b);
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(mx, my, isSel ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // label
        if (isSel) {
          ctx.fillStyle = '#1A1815';
          ctx.font = '10px "Geist Mono", monospace';
          const label = rgbToHex(s.rgb.r, s.rgb.g, s.rgb.b);
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = 'rgba(251, 248, 242, 0.95)';
          ctx.fillRect(mx + 10, my - 8, tw + 10, 16);
          ctx.strokeStyle = '#1A1815';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(mx + 10, my - 8, tw + 10, 16);
          ctx.fillStyle = '#1A1815';
          ctx.fillText(label, mx + 15, my + 3);
        }
      });
    }
  }, [image, samples, selectedId, showMarkers]);

  useEffect(() => { renderDisplay(); }, [renderDisplay]);

  useEffect(() => {
    const onResize = () => renderDisplay();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [renderDisplay]);

  // ---- eyedropper: on mousemove read pixel + draw loupe ----
  const onCanvasMove = useCallback((e) => {
    if (!image) return;
    const dc = displayCanvasRef.current;
    const sc = sampleCanvasRef.current;
    if (!dc || !sc) return;
    const rect = dc.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    if (cx < 0 || cy < 0 || cx >= dc.width || cy >= dc.height) {
      setHoverPixel(null); return;
    }
    const scaleX = image.naturalW / dc.width;
    const scaleY = image.naturalH / dc.height;
    const ix = Math.floor(cx * scaleX);
    const iy = Math.floor(cy * scaleY);
    const ctx = sc.getContext('2d', { willReadFrequently: true });
    const px = ctx.getImageData(ix, iy, 1, 1).data;
    const rgb = { r: px[0], g: px[1], b: px[2] };
    const { L, a, b } = rgbToOklab(rgb.r, rgb.g, rgb.b);
    const { C, h } = oklabToOklch(L, a, b);
    setHoverPixel({ clientX: e.clientX, clientY: e.clientY, cx, cy, ix, iy, rgb, L, C, h });

    // loupe: sample 11x11 grid around cursor
    const loupe = loupeCanvasRef.current;
    if (loupe) {
      const size = 11;
      const half = Math.floor(size / 2);
      const zoom = 10;
      loupe.width = size * zoom;
      loupe.height = size * zoom;
      const lctx = loupe.getContext('2d');
      lctx.imageSmoothingEnabled = false;
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const sx = ix + dx, sy = iy + dy;
          if (sx < 0 || sy < 0 || sx >= image.naturalW || sy >= image.naturalH) {
            lctx.fillStyle = '#EDEAE3'; // panel colour for out-of-bounds
          } else {
            const p = ctx.getImageData(sx, sy, 1, 1).data;
            lctx.fillStyle = `rgb(${p[0]},${p[1]},${p[2]})`;
          }
          lctx.fillRect((dx + half) * zoom, (dy + half) * zoom, zoom, zoom);
        }
      }
      // crosshair on centre pixel — white outer stroke + accent inner for visibility on any background
      lctx.strokeStyle = '#FBF8F2';
      lctx.lineWidth = 2.5;
      lctx.strokeRect(half * zoom - 0.5, half * zoom - 0.5, zoom + 1, zoom + 1);
      lctx.strokeStyle = '#1A1815';
      lctx.lineWidth = 1;
      lctx.strokeRect(half * zoom - 0.5, half * zoom - 0.5, zoom + 1, zoom + 1);
    }
  }, [image]);

  const onCanvasLeave = () => setHoverPixel(null);

  // ---- click to sample ----
  const onCanvasClick = useCallback(() => {
    if (!hoverPixel) return;
    const s = {
      id: newId(),
      rgb: hoverPixel.rgb,
      L: hoverPixel.L, C: hoverPixel.C, h: hoverPixel.h,
      originalRgb: hoverPixel.rgb,
      originalL: hoverPixel.L, originalC: hoverPixel.C, originalH: hoverPixel.h,
      inGamut: true, // sampled directly from sRGB image, always in gamut
      source: 'manual',
      x: hoverPixel.ix, y: hoverPixel.iy,
      weight: null,
    };
    setSamples(prev => [...prev, s]);
    setSelectedId(s.id);
  }, [hoverPixel]);

  // ---- extract palette ----
  const extractPalette = useCallback(() => {
    if (!image) return;
    setExtracting(true);
    // defer for UI responsiveness
    setTimeout(() => {
      const sc = sampleCanvasRef.current;
      const ctx = sc.getContext('2d', { willReadFrequently: true });
      // downsample
      const maxDim = 200;
      const ratio = Math.min(maxDim / image.naturalW, maxDim / image.naturalH, 1);
      const dw = Math.max(1, Math.floor(image.naturalW * ratio));
      const dh = Math.max(1, Math.floor(image.naturalH * ratio));
      const tmp = document.createElement('canvas');
      tmp.width = dw; tmp.height = dh;
      const tctx = tmp.getContext('2d');
      tctx.drawImage(image.el, 0, 0, dw, dh);
      const data = tctx.getImageData(0, 0, dw, dh).data;
      const points = [];
      for (let y = 0; y < dh; y++) {
        for (let x = 0; x < dw; x++) {
          const i = (y * dw + x) * 4;
          const { L, a, b } = rgbToOklab(data[i], data[i+1], data[i+2]);
          // map back to original image coords for source positions
          points.push({ L, a, b, x: x / ratio, y: y / ratio });
        }
      }
      const clusters = kmeansPlusPlus(points, k);
      const totalN = clusters.reduce((a,c) => a + c.n, 0);
      const newSamples = clusters.map(c => {
        const { r, g, b } = oklabToRgb(c.L, c.a, c.b);
        const { L, C, h } = oklabToOklch(c.L, c.a, c.b);
        const rgb = { r, g, b };
        return {
          id: newId(),
          rgb,
          L, C, h,
          originalRgb: rgb,
          originalL: L, originalC: C, originalH: h,
          inGamut: isInGamut(c.L, c.a, c.b),
          source: 'auto',
          x: c.x, y: c.y,
          weight: c.n / totalN,
        };
      });
      setSamples(newSamples);
      setSelectedId(newSamples[0]?.id ?? null);
      setExtracting(false);
    }, 40);
  }, [image, k]);

  // ---- selected swatch + adjustments ----
  const selected = samples.find(s => s.id === selectedId) || null;

  useEffect(() => {
    if (selected) setHexInput(rgbToHex(selected.rgb.r, selected.rgb.g, selected.rgb.b));
  }, [selected?.id]); // eslint-disable-line

  const updateSelected = (patch) => {
    setSamples(prev => prev.map(s => s.id === selectedId ? { ...s, ...patch } : s));
  };

  const adjustLCH = (newL, newC, newH) => {
    const { a, b } = oklchToOklab(newL, newC, newH);
    const { r, g, b: bb } = oklabToRgb(newL, a, b);
    updateSelected({
      L: newL, C: newC, h: newH,
      rgb: { r, g, b: bb },
      inGamut: isInGamut(newL, a, b),
    });
  };

  const revertSelected = () => {
    if (!selected) return;
    updateSelected({
      L: selected.originalL,
      C: selected.originalC,
      h: selected.originalH,
      rgb: selected.originalRgb,
      inGamut: true,
    });
  };

  const applyHexInput = () => {
    const parsed = hexToRgb(hexInput);
    if (!parsed) return;
    const { L, a, b } = rgbToOklab(parsed.r, parsed.g, parsed.b);
    const { C, h } = oklabToOklch(L, a, b);
    updateSelected({ rgb: parsed, L, C, h, inGamut: true });
  };

  const removeSample = (id) => {
    setSamples(prev => prev.filter(s => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const clearAll = () => { setSamples([]); setSelectedId(null); };

  const sortBy = (key) => {
    setSamples(prev => {
      const copy = [...prev];
      if (key === 'hue')     copy.sort((a,b) => a.h - b.h);
      if (key === 'light')   copy.sort((a,b) => a.L - b.L);
      if (key === 'chroma')  copy.sort((a,b) => b.C - a.C);
      if (key === 'weight')  copy.sort((a,b) => (b.weight ?? -1) - (a.weight ?? -1));
      return copy;
    });
  };

  // drag-to-reorder
  const [dragIdx, setDragIdx] = useState(null);
  const [dropIdx, setDropIdx] = useState(null);
  const onDragStart = (idx) => (e) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    // setData required by Firefox to initiate drag
    try { e.dataTransfer.setData('text/plain', String(idx)); } catch {}
  };
  const onDragOver = (idx) => (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragIdx !== null && dragIdx !== idx) setDropIdx(idx);
  };
  const onDragEnd = () => { setDragIdx(null); setDropIdx(null); };
  const onDropOn = (idx) => (e) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) { onDragEnd(); return; }
    setSamples(prev => {
      const copy = [...prev];
      const [moved] = copy.splice(dragIdx, 1);
      copy.splice(idx, 0, moved);
      return copy;
    });
    onDragEnd();
  };

  const copy = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1200);
    } catch {}
  };

  const [exportOpen, setExportOpen] = useState(false);
  const [exportCopied, setExportCopied] = useState(false);
  const [exportFormat, setExportFormat] = useState('css');
  const exportTextareaRef = useRef(null);

  // ---- export format generators ----
  const generateCSS = (samples) => {
    const lines = ['/* palette — extracted with Chromatography */', ':root {'];
    samples.forEach((s, i) => {
      const hex = rgbToHex(s.rgb.r, s.rgb.g, s.rgb.b);
      lines.push(`  --colour-${String(i+1).padStart(2,'0')}: ${hex};`);
    });
    lines.push('}');
    return lines.join('\n');
  };

  const generateJSON = (samples) => {
    const out = {
      name: 'palette',
      generated: new Date().toISOString(),
      colours: samples.map((s, i) => ({
        index: i + 1,
        hex: rgbToHex(s.rgb.r, s.rgb.g, s.rgb.b),
        rgb: [s.rgb.r, s.rgb.g, s.rgb.b],
        oklch: [Number(s.L.toFixed(4)), Number(s.C.toFixed(4)), Number(s.h.toFixed(2))],
        source: s.source,
        weight: s.weight != null ? Number(s.weight.toFixed(4)) : null,
      })),
    };
    return JSON.stringify(out, null, 2);
  };

  const generateR = (samples) => {
    const hexes = samples.map(s => rgbToHex(s.rgb.r, s.rgb.g, s.rgb.b));
    const lines = [
      '# Palette exported from Chromatography',
      '',
      'palette <- c(',
    ];
    hexes.forEach((h, i) => {
      const comma = i < hexes.length - 1 ? ',' : '';
      lines.push(`  "${h}"${comma}  # ${String(i+1).padStart(2,'0')}`);
    });
    lines.push(')');
    lines.push('');
    lines.push('# Named vector:');
    lines.push('palette_named <- c(');
    hexes.forEach((h, i) => {
      const name = `c${String(i+1).padStart(2,'0')}`;
      const comma = i < hexes.length - 1 ? ',' : '';
      lines.push(`  ${name} = "${h}"${comma}`);
    });
    lines.push(')');
    lines.push('');
    lines.push('# Example with ggplot2:');
    lines.push('# library(ggplot2)');
    lines.push('# ggplot(data, aes(x, y, colour = group)) +');
    lines.push('#   geom_point() +');
    lines.push('#   scale_colour_manual(values = palette)');
    return lines.join('\n');
  };

  const generateGPL = (samples) => {
    const lines = [
      'GIMP Palette',
      'Name: Chromatography palette',
      `Columns: ${Math.min(samples.length, 8)}`,
      '#',
    ];
    samples.forEach((s, i) => {
      const pad = (n) => String(n).padStart(3, ' ');
      const name = `Colour ${String(i+1).padStart(2,'0')}`;
      lines.push(`${pad(s.rgb.r)} ${pad(s.rgb.g)} ${pad(s.rgb.b)}\t${name}`);
    });
    return lines.join('\n');
  };

  const generateMarkdown = (samples) => {
    const lines = [
      '# [Palette name]',
      '',
      '_[A short description of the palette. Where it was sampled from; what it evokes. This placeholder is deliberately empty — fill it in yourself, or paste the palette JSON into Claude with the companion prompt template.]_',
      '',
      '## Palette',
      '',
      '| # | Name | Hex | RGB | OKLCH | Role |',
      '|---|------|-----|-----|-------|------|',
    ];
    samples.forEach((s, i) => {
      const hex = rgbToHex(s.rgb.r, s.rgb.g, s.rgb.b);
      const rgb = `${s.rgb.r} ${s.rgb.g} ${s.rgb.b}`;
      const oklch = `${(s.L*100).toFixed(0)}% ${s.C.toFixed(2)} ${s.h.toFixed(0)}°`;
      lines.push(`| ${String(i+1).padStart(2,'0')} | [name] | \`${hex}\` | ${rgb} | ${oklch} | [role] |`);
    });
    lines.push('');
    lines.push('## Source');
    lines.push('');
    lines.push(`- Extracted with Chromatography`);
    lines.push(`- Method: k-means++ clustering in OKLab, k=${samples.filter(s => s.source === 'auto').length || samples.length}`);
    lines.push(`- ${samples.length} swatches total (${samples.filter(s => s.source === 'auto').length} auto, ${samples.filter(s => s.source === 'manual').length} manual)`);
    return lines.join('\n');
  };

  const generateHTML = (samples, imageDataUrl) => {
    const swatchRows = samples.map((s, i) => {
      const hex = rgbToHex(s.rgb.r, s.rgb.g, s.rgb.b);
      return `    <div class="swatch">
      <div class="chip" style="background:${hex}"></div>
      <div class="meta">
        <div class="idx">${String(i+1).padStart(2,'0')}</div>
        <div class="hex">${hex}</div>
        <div class="rgb">${s.rgb.r} · ${s.rgb.g} · ${s.rgb.b}</div>
        <div class="oklch">${(s.L*100).toFixed(0)}% · ${s.C.toFixed(2)} · ${s.h.toFixed(0)}°</div>
      </div>
    </div>`;
    }).join('\n');

    const imgBlock = imageDataUrl
      ? `  <figure class="source">\n    <img src="${imageDataUrl}" alt="Source photograph" />\n  </figure>`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Palette</title>
<style>
  :root {
    --paper: #F2EEE5; --ink: #1A1815; --muted: #6E685D; --rule: #D8D2C4;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 48px 32px;
    background: var(--paper); color: var(--ink);
    font-family: Georgia, 'Times New Roman', serif;
    max-width: 900px; margin: 0 auto;
  }
  h1 { font-weight: 500; letter-spacing: -0.01em; margin: 0 0 8px; font-size: 38.4px; }
  .description { color: var(--muted); font-size: 18px; line-height: 1.6; max-width: 60ch; margin: 0 0 32px; font-style: italic; }
  .source { margin: 0 0 40px; }
  .source img { width: 100%; height: auto; display: block; border: 1px solid var(--ink); }
  .palette { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; }
  .swatch { border: 1px solid var(--rule); background: #FBF8F2; }
  .chip { height: 80px; }
  .meta { padding: 10px 12px 12px; font-family: 'SF Mono', Menlo, monospace; font-size: 13.2px; line-height: 1.5; }
  .idx { color: var(--muted); font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 4px; }
  .hex { color: var(--ink); font-size: 15.6px; font-weight: 600; letter-spacing: 0.03em; }
  .rgb, .oklch { color: var(--muted); }
  footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--rule); color: var(--muted); font-size: 14.4px; }
</style>
</head>
<body>
  <h1>[Palette name]</h1>
  <p class="description">[A short description of the palette — where it came from, what it evokes.]</p>
${imgBlock}
  <section class="palette">
${swatchRows}
  </section>
  <footer>Generated with Chromatography · ${new Date().toISOString().slice(0,10)}</footer>
</body>
</html>`;
  };

  const exportText = useMemo(() => {
    if (!samples.length) return '';
    switch (exportFormat) {
      case 'css':      return generateCSS(samples);
      case 'json':     return generateJSON(samples);
      case 'r':        return generateR(samples);
      case 'gpl':      return generateGPL(samples);
      case 'markdown': return generateMarkdown(samples);
      case 'html':     return generateHTML(samples, image?.url);
      default:         return '';
    }
  }, [samples, exportFormat, image]);

  const exportFormatMeta = {
    css:      { label: 'CSS',       ext: 'css',  hint: 'CSS custom properties — drop into your :root.' },
    json:     { label: 'JSON',      ext: 'json', hint: 'Structured data — hex, rgb, and OKLCH coordinates.' },
    r:        { label: 'R',         ext: 'R',    hint: 'R vector + ggplot2 scale_colour_manual example.' },
    gpl:      { label: 'GPL',       ext: 'gpl',  hint: 'GIMP palette format — loads into GIMP, Inkscape, Krita.' },
    markdown: { label: 'Markdown',  ext: 'md',   hint: 'Palette guide template — prose placeholders to fill in.' },
    html:     { label: 'HTML',      ext: 'html', hint: 'Standalone HTML document with image + swatches.' },
  };

  const openExport = () => { setExportOpen(true); setExportCopied(false); };
  const closeExport = () => setExportOpen(false);
  const copyExport = () => {
    const ta = exportTextareaRef.current;
    if (!ta) return;
    try {
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      if (ok) { setExportCopied(true); setTimeout(() => setExportCopied(false), 1500); return; }
    } catch {}
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(exportText).then(
        () => { setExportCopied(true); setTimeout(() => setExportCopied(false), 1500); },
        () => {}
      );
    }
  };

  const downloadExport = () => {
    const meta = exportFormatMeta[exportFormat];
    const blob = new Blob([exportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `palette.${meta.ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ---- project save/load ----
  const saveProject = () => {
    if (!image) return;
    const project = {
      version: 1,
      tool: 'chromatography',
      saved: new Date().toISOString(),
      imageDataUrl: image.url,
      imageNaturalW: image.naturalW,
      imageNaturalH: image.naturalH,
      k,
      samples: samples.map(s => ({
        id: s.id,
        rgb: s.rgb,
        L: s.L, C: s.C, h: s.h,
        originalRgb: s.originalRgb,
        originalL: s.originalL, originalC: s.originalC, originalH: s.originalH,
        inGamut: s.inGamut,
        source: s.source,
        x: s.x, y: s.y,
        weight: s.weight,
      })),
    };
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chromatography-project-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const loadProjectJSON = (text) => {
    let project;
    try { project = JSON.parse(text); }
    catch { setLoadError('Could not parse project JSON.'); return; }
    if (project.tool !== 'chromatography') {
      setLoadError('JSON does not look like a Chromatography project file.');
      return;
    }
    const el = new Image();
    el.onerror = () => setLoadError('Image inside project failed to decode.');
    el.onload = () => {
      setImage({ el, naturalW: el.naturalWidth, naturalH: el.naturalHeight, url: project.imageDataUrl });
      // rehydrate samples with fresh IDs
      const restored = (project.samples || []).map(s => ({ ...s, id: newId() }));
      setSamples(restored);
      setSelectedId(restored[0]?.id ?? null);
      if (typeof project.k === 'number') setK(project.k);
    };
    el.src = project.imageDataUrl;
  };

  // ---- derived: APCA for selected vs page / black / white ----
  const apcaReadouts = useMemo(() => {
    if (!selected) return null;
    const rgb = selected.rgb;
    return {
      onPage: APCA(rgb, { r: 242, g: 238, b: 229 }),
      onWhite: APCA(rgb, { r: 255, g: 255, b: 255 }),
      onBlack: APCA(rgb, { r: 0, g: 0, b: 0 }),
      pageOn: APCA({ r: 242, g: 238, b: 229 }, rgb),
      whiteOn: APCA({ r: 255, g: 255, b: 255 }, rgb),
      blackOn: APCA({ r: 0, g: 0, b: 0 }, rgb),
    };
  }, [selected]);

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600&family=Instrument+Sans:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap');

        :root {
          --paper: #F2EEE5;
          --surface: #FBF8F2;
          --panel: #EDEAE3;
          --ink: #1A1815;
          --ink-muted: #6E685D;
          --ink-faint: #A39C90;
          --rule: #D8D2C4;
          --rule-strong: #1A1815;
          --accent: #8B3A1F;
          --accent-hi: #C04526;
          --ok: #4A7A3A;
        }
        * { box-sizing: border-box; }
        html, body, #root { margin: 0; padding: 0; height: 100%; }
        body {
          background: var(--paper);
          color: var(--ink);
          font-family: 'Instrument Sans', sans-serif;
          font-size: 15.6px;
          line-height: 1.5;
          -webkit-font-smoothing: antialiased;
          overflow: hidden;
        }
        .mono { font-family: 'Geist Mono', monospace; font-feature-settings: 'tnum' 1; }
        .serif { font-family: 'Fraunces', Georgia, serif; }
        button { font-family: inherit; cursor: pointer; border: none; background: none; color: inherit; padding: 0; }
        input { font-family: inherit; }

        .app {
          display: grid;
          grid-template-columns: 1fr 380px;
          grid-template-rows: 56px 1fr auto;
          height: 100vh;
          max-height: 100vh;
        }
        @media (max-width: 900px) {
          .app { grid-template-columns: 1fr; grid-template-rows: 56px 55vh 1fr auto; }
        }

        /* header */
        .header {
          grid-column: 1 / -1;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 24px;
          border-bottom: 1px solid var(--rule-strong);
          background: var(--paper);
        }
        .brand { display: flex; align-items: baseline; gap: 12px; }
        .brand-mark {
          font-family: 'Fraunces', serif;
          font-variation-settings: 'opsz' 144, 'SOFT' 0;
          font-weight: 500;
          font-size: 43.2px;
          letter-spacing: -0.01em;
        }
        .brand-sub {
          font-family: 'Geist Mono', monospace;
          font-size: 12px;
          color: var(--ink-muted);
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .header-actions { display: flex; gap: 4px; align-items: center; }

        .btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 12px;
          font-size: 14.4px;
          font-weight: 500;
          border: 1px solid var(--rule-strong);
          border-radius: 2px;
          background: var(--paper);
          transition: all 0.15s ease;
        }
        .btn:hover:not(:disabled) { background: var(--ink); color: var(--paper); }
        .btn.primary { background: var(--ink); color: var(--paper); }
        .btn.primary:hover:not(:disabled) { background: var(--accent); border-color: var(--accent); }
        .btn.ghost { border-color: transparent; padding: 6px 10px; }
        .btn.ghost:hover { background: var(--panel); color: var(--ink); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn .icon { width: 13px; height: 13px; }

        /* canvas area */
        .canvas-area {
          position: relative;
          background:
            linear-gradient(var(--rule) 1px, transparent 1px) 0 0 / 32px 32px,
            linear-gradient(90deg, var(--rule) 1px, transparent 1px) 0 0 / 32px 32px,
            var(--surface);
          background-position: 0 0;
          border-right: 1px solid var(--rule-strong);
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        @media (max-width: 900px) {
          .canvas-area { border-right: none; border-bottom: 1px solid var(--rule-strong); }
        }
        .drop-zone {
          position: absolute;
          inset: 24px;
          border: 1px dashed var(--rule-strong);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          color: var(--ink-muted);
          text-align: center;
          transition: background 0.15s;
        }
        .drop-zone.active { background: var(--panel); border-color: var(--accent); color: var(--accent); }
        .drop-zone h2 {
          font-family: 'Fraunces', serif;
          font-variation-settings: 'opsz' 72;
          font-weight: 400;
          font-size: 28.8px;
          margin: 0;
          color: var(--ink);
          letter-spacing: -0.01em;
        }
        .drop-zone p { margin: 0; font-size: 15.6px; max-width: 36ch; line-height: 1.55; }
        .drop-zone .tick {
          font-family: 'Geist Mono', monospace; font-size: 12px;
          letter-spacing: 0.14em; text-transform: uppercase;
          color: var(--ink-faint);
        }

        .image-canvas-wrap {
          position: relative;
          padding: 16px;
        }
        canvas.display {
          display: block;
          cursor: crosshair;
          box-shadow: 0 1px 0 var(--rule-strong), 0 0 0 1px var(--rule-strong);
          image-rendering: auto;
        }

        /* loupe */
        .loupe {
          position: fixed;
          pointer-events: none;
          z-index: 100;
          background: var(--surface);
          border: 1px solid var(--rule-strong);
          padding: 6px 6px 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          font-family: 'Geist Mono', monospace;
          font-size: 12px;
          line-height: 1.4;
        }
        .loupe canvas { display: block; border: 1px solid var(--rule-strong); margin-bottom: 6px; }
        .loupe-swatch {
          height: 26px;
          border: 1px solid var(--rule-strong);
          margin-bottom: 6px;
        }
        .loupe .row { display: flex; justify-content: space-between; gap: 12px; color: var(--ink); }
        .loupe .lbl { color: var(--ink-muted); }

        /* right panel */
        .sidebar {
          display: flex;
          flex-direction: column;
          background: var(--paper);
          overflow-y: auto;
          overflow-x: hidden;
        }
        .section {
          border-bottom: 1px solid var(--rule);
          padding: 18px 20px;
        }
        .section-kicker {
          font-family: 'Geist Mono', monospace;
          font-size: 12px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--ink-muted);
          margin-bottom: 12px;
          display: flex;
          justify-content: space-between;
          align-items: baseline;
        }
        .section-kicker .right { color: var(--ink-faint); font-size: 11.4px; }

        /* extract controls */
        .k-control {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 10px;
          align-items: center;
          margin-bottom: 14px;
        }
        .k-control .lbl { font-size: 14.4px; color: var(--ink-muted); }
        .k-control .val { font-family: 'Geist Mono', monospace; font-size: 15.6px; min-width: 2ch; text-align: right; }
        input[type=range] {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 22px;
          background: transparent;
        }
        input[type=range]::-webkit-slider-runnable-track {
          height: 1px;
          background: var(--rule-strong);
        }
        input[type=range]::-moz-range-track {
          height: 1px;
          background: var(--rule-strong);
        }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 13px; height: 13px;
          background: var(--ink);
          border: 2px solid var(--paper);
          box-shadow: 0 0 0 1px var(--ink);
          margin-top: -6px;
          cursor: grab;
          border-radius: 50%;
        }
        input[type=range]::-moz-range-thumb {
          width: 9px; height: 9px;
          background: var(--ink);
          border: 2px solid var(--paper);
          box-shadow: 0 0 0 1px var(--ink);
          cursor: grab;
          border-radius: 50%;
        }
        input[type=range].accent::-webkit-slider-thumb { background: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
        input[type=range].accent::-moz-range-thumb { background: var(--accent); box-shadow: 0 0 0 1px var(--accent); }

        /* palette grid */
        .palette-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
        }
        .swatch {
          border: 1px solid var(--rule);
          background: var(--surface);
          cursor: pointer;
          position: relative;
          transition: border-color 0.1s, transform 0.12s, opacity 0.12s;
          overflow: hidden;
        }
        .swatch:hover { border-color: var(--ink); }
        .swatch.selected {
          border-color: var(--accent);
          box-shadow: 0 0 0 1px var(--accent);
        }
        .swatch.dragging { opacity: 0.35; }
        .swatch.drop-target { border-color: var(--accent); box-shadow: -2px 0 0 0 var(--accent); }
        .swatch .gamut-dot {
          position: absolute;
          bottom: 22px; right: 4px;
          width: 7px; height: 7px;
          background: var(--accent);
          border: 1px solid var(--paper);
          border-radius: 50%;
        }
        .sort-menu {
          display: inline-flex;
          align-items: baseline;
          gap: 4px;
        }
        .sort-row {
          display: flex;
          align-items: baseline;
          gap: 4px;
          margin-bottom: 8px;
        }
        .sort-lbl {
          color: var(--ink-faint);
          margin-right: 2px;
        }
        .sort-btn {
          font-family: 'Geist Mono', monospace;
          font-size: 11.4px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--ink-muted);
          padding: 1px 4px;
          border: 1px solid var(--rule);
          border-radius: 1px;
          transition: all 0.1s;
        }
        .sort-btn:hover { background: var(--ink); color: var(--paper); border-color: var(--ink); }
        .swatch .chip { height: 48px; width: 100%; display: block; }
        .swatch .meta {
          padding: 5px 7px 6px;
          font-family: 'Geist Mono', monospace;
          font-size: 12px;
          display: flex;
          justify-content: space-between;
          gap: 4px;
        }
        .swatch .hex { color: var(--ink); letter-spacing: 0.02em; }
        .swatch .weight { color: var(--ink-faint); }
        .swatch .src-tag {
          position: absolute;
          top: 4px; right: 4px;
          font-family: 'Geist Mono', monospace;
          font-size: 10.2px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          padding: 1px 4px;
          background: rgba(251, 248, 242, 0.92);
          color: var(--ink-muted);
          border-radius: 1px;
        }
        .swatch.selected .src-tag { background: var(--accent); color: var(--paper); }
        .swatch .remove {
          position: absolute;
          top: 4px; left: 4px;
          width: 16px; height: 16px;
          display: none;
          align-items: center;
          justify-content: center;
          background: rgba(251, 248, 242, 0.92);
          border: 1px solid var(--rule);
          border-radius: 1px;
        }
        .swatch:hover .remove { display: flex; }
        .swatch .remove:hover { background: var(--accent); color: var(--paper); border-color: var(--accent); }

        .palette-empty {
          text-align: center;
          padding: 24px 8px;
          color: var(--ink-faint);
          font-size: 14.4px;
          border: 1px dashed var(--rule);
        }
        .palette-empty em { font-style: italic; color: var(--ink-muted); }

        /* support */
        .support-text {
          font-size: 13.2px;
          color: var(--ink-muted);
          line-height: 1.5;
          margin: 0 0 10px;
        }
        .kofi-container { display: flex; }
        .kofi-container a { display: inline-block; }

        /* adjustments */
        .adjust-preview {
          height: 64px;
          border: 1px solid var(--rule);
          margin-bottom: 14px;
          position: relative;
          overflow: hidden;
        }
        .adjust-preview .hex-overlay {
          position: absolute;
          bottom: 6px; left: 8px;
          font-family: 'Geist Mono', monospace;
          font-size: 12px;
          padding: 2px 5px;
          background: rgba(251, 248, 242, 0.9);
          color: var(--ink);
          border: 1px solid var(--rule);
          letter-spacing: 0.04em;
        }
        .hex-input-row {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 6px;
          margin-bottom: 16px;
        }
        .hex-input {
          font-family: 'Geist Mono', monospace;
          font-size: 15.6px;
          padding: 6px 10px;
          border: 1px solid var(--rule-strong);
          background: var(--surface);
          border-radius: 2px;
          outline: none;
          letter-spacing: 0.03em;
          width: 100%;
          color: var(--ink);
        }
        .hex-input:focus { border-color: var(--accent); }
        .slider-row {
          display: grid;
          grid-template-columns: 56px 1fr 52px;
          gap: 10px;
          align-items: center;
          margin-bottom: 6px;
        }
        .slider-row .axis {
          font-family: 'Geist Mono', monospace;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--ink-muted);
        }
        .slider-row .num {
          font-family: 'Geist Mono', monospace;
          font-size: 14.4px;
          text-align: right;
          color: var(--ink);
        }
        .adjust-footer {
          display: flex;
          align-items: center;
          gap: 10px;
          justify-content: space-between;
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px dashed var(--rule);
        }
        .adjust-footer .hint {
          font-size: 12.6px;
          color: var(--ink-muted);
          line-height: 1.45;
          flex: 1;
          letter-spacing: -0.005em;
        }
        .gamut-badge {
          position: absolute;
          top: 6px; right: 6px;
          font-family: 'Geist Mono', monospace;
          font-size: 10.8px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          padding: 2px 6px;
          background: var(--accent);
          color: var(--paper);
          border-radius: 1px;
        }

        /* APCA readout */
        .apca-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 4px;
          margin-top: 14px;
        }
        .apca-cell {
          border: 1px solid var(--rule);
          padding: 6px 7px;
          font-family: 'Geist Mono', monospace;
          font-size: 12px;
          text-align: center;
        }
        .apca-cell .bg-chip {
          height: 18px;
          margin-bottom: 4px;
          border: 1px solid var(--rule);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10.8px;
        }
        .apca-cell .val { font-size: 15.6px; color: var(--ink); font-weight: 500; }
        .apca-cell .lbl { color: var(--ink-muted); font-size: 10.8px; letter-spacing: 0.08em; text-transform: uppercase; margin-top: 2px; }

        /* extracting overlay */
        .extracting-overlay {
          position: absolute;
          inset: 0;
          background: rgba(251, 248, 242, 0.85);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Fraunces', serif;
          font-variation-settings: 'opsz' 72;
          font-size: 19.2px;
          color: var(--ink);
          z-index: 50;
          letter-spacing: -0.005em;
        }

        /* error toast */
        .error-toast {
          position: absolute;
          top: 16px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 150;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 8px 8px 14px;
          background: var(--paper);
          border: 1px solid var(--accent);
          color: var(--accent);
          font-family: 'Geist Mono', monospace;
          font-size: 13.2px;
          letter-spacing: 0.02em;
          max-width: 44ch;
          box-shadow: 0 2px 10px rgba(0,0,0,0.08);
        }
        .error-toast button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px; height: 20px;
          color: var(--accent);
          border: 1px solid var(--accent);
          border-radius: 1px;
        }
        .error-toast button:hover { background: var(--accent); color: var(--paper); }

        /* scrollbar styling */
        .sidebar::-webkit-scrollbar { width: 8px; }
        .sidebar::-webkit-scrollbar-track { background: var(--paper); }
        .sidebar::-webkit-scrollbar-thumb { background: var(--rule); border: 2px solid var(--paper); border-radius: 4px; }
        .sidebar::-webkit-scrollbar-thumb:hover { background: var(--ink-faint); }

        /* footer */
        .footer {
          grid-column: 1 / -1;
          border-top: 1px solid var(--rule-strong);
          background: var(--panel);
          padding: 14px 24px;
          font-size: 13.2px;
          line-height: 1.55;
          color: var(--ink-muted);
          letter-spacing: -0.003em;
          display: flex;
          gap: 40px;
          align-items: flex-start;
        }
        .footer-body { margin: 0; flex: 2; min-width: 0; }
        .footer-body b {
          color: var(--ink);
          font-weight: 500;
        }
        .footer-body code {
          font-family: 'Geist Mono', monospace;
          font-size: 12px;
          color: var(--ink);
          background: var(--surface);
          padding: 1px 4px;
          border: 1px solid var(--rule);
          border-radius: 1px;
        }
        .footer-bio {
          flex: 1;
          min-width: 0;
          border-left: 1px solid var(--rule);
          padding-left: 40px;
          margin: 0;
        }
        .footer-bio a {
          color: var(--ink-muted);
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .footer-bio a:hover { color: var(--ink); }
        .footer-bio .footer-links {
          margin-top: 6px;
          font-size: 12px;
          color: var(--ink-faint);
        }
        .footer-bio .footer-links a { color: var(--ink-faint); }

        /* export modal */
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(26, 24, 21, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 200;
          padding: 24px;
        }
        .modal {
          background: var(--paper);
          border: 1px solid var(--rule-strong);
          width: 100%;
          max-width: 620px;
          max-height: 80vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 60px rgba(0,0,0,0.25);
        }
        .modal-head {
          padding: 18px 22px 14px;
          border-bottom: 1px solid var(--rule);
          display: flex;
          justify-content: space-between;
          align-items: baseline;
        }
        .modal-title {
          font-family: 'Fraunces', serif;
          font-variation-settings: 'opsz' 72;
          font-weight: 500;
          font-size: 24px;
          margin: 0;
          letter-spacing: -0.01em;
          color: var(--ink);
        }
        .modal-kicker {
          font-family: 'Geist Mono', monospace;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: var(--ink-muted);
        }
        .format-tabs {
          display: flex;
          border-bottom: 1px solid var(--rule);
          padding: 0 14px;
          gap: 0;
          overflow-x: auto;
        }
        .format-tab {
          font-family: 'Instrument Sans', sans-serif;
          font-size: 14.4px;
          font-weight: 500;
          padding: 10px 14px;
          color: var(--ink-muted);
          border-bottom: 2px solid transparent;
          margin-bottom: -1px;
          white-space: nowrap;
          transition: color 0.1s, border-color 0.1s;
        }
        .format-tab:hover { color: var(--ink); }
        .format-tab.active {
          color: var(--ink);
          border-bottom-color: var(--accent);
        }
        .format-hint {
          font-size: 13.2px;
          color: var(--ink-muted);
          margin-bottom: 10px;
          line-height: 1.45;
          letter-spacing: -0.003em;
        }
        .modal-body {
          padding: 16px 22px;
          overflow-y: auto;
          flex: 1;
        }
        .modal-body textarea {
          width: 100%;
          min-height: 220px;
          font-family: 'Geist Mono', monospace;
          font-size: 14.4px;
          line-height: 1.5;
          border: 1px solid var(--rule-strong);
          background: var(--surface);
          padding: 12px 14px;
          color: var(--ink);
          resize: vertical;
          outline: none;
          letter-spacing: 0.01em;
        }
        .modal-body textarea:focus { border-color: var(--accent); }
        .modal-foot {
          padding: 12px 22px 16px;
          border-top: 1px solid var(--rule);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }
        .modal-foot .note { font-size: 13.2px; color: var(--ink-muted); max-width: 38ch; line-height: 1.45; }
        .modal-foot .actions { display: flex; gap: 6px; }
      `}</style>

      <div className="app">
        {/* =========== HEADER =========== */}
        <div className="header">
          <div className="brand">
            <div className="brand-mark serif">Chromatography</div>
            <div className="brand-sub">palette ∙ field tool</div>
          </div>
          <div className="header-actions">
            {image && (
              <>
                <button className="btn ghost" onClick={() => setShowMarkers(v => !v)} title={showMarkers ? 'Hide markers' : 'Show markers'}>
                  {showMarkers ? <Eye className="icon" /> : <EyeOff className="icon" />}
                </button>
                <button className="btn ghost" onClick={saveProject} title="Save project — image + palette as JSON">
                  <Save className="icon" />
                  <span>save</span>
                </button>
                <button className="btn ghost" onClick={openExport} disabled={!samples.length} title="Export palette">
                  <Download className="icon" />
                  <span>export</span>
                </button>
              </>
            )}
            <label className="btn">
              <Upload className="icon" />
              <span>open</span>
              <input type="file" accept="image/*,.json,application/json" onChange={onFileInput} style={{display:'none'}} />
            </label>
          </div>
        </div>

        {/* =========== CANVAS AREA =========== */}
        <div
          className="canvas-area"
          ref={containerRef}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
        >
          {!image && (
            <div className={`drop-zone ${dragActive ? 'active' : ''}`}>
              <div className="tick">01 — source image or saved project</div>
              <h2>Drop a photograph.</h2>
              <p>Any colour in the frame becomes samplable. The extraction engine clusters in OKLab space; the eyedropper is sub-pixel accurate. Saved <code style={{fontFamily:'Geist Mono, monospace',fontSize:11}}>.json</code> projects can be opened here too.</p>
              <label className="btn primary" style={{marginTop: 8}}>
                <Upload className="icon" />
                <span>Browse files</span>
                <input type="file" accept="image/*,.json,application/json" onChange={onFileInput} style={{display:'none'}} />
              </label>
            </div>
          )}

          {loadError && (
            <div className="error-toast">
              <span>{loadError}</span>
              <button onClick={() => setLoadError(null)} title="Dismiss"><X style={{width:12,height:12}} /></button>
            </div>
          )}

          {image && (
            <div className="image-canvas-wrap">
              <canvas
                ref={displayCanvasRef}
                className="display"
                onMouseMove={onCanvasMove}
                onMouseLeave={onCanvasLeave}
                onClick={onCanvasClick}
              />
              {extracting && <div className="extracting-overlay">Clustering in OKLab…</div>}
            </div>
          )}

          <canvas ref={sampleCanvasRef} style={{display:'none'}} />
        </div>

        {/* =========== SIDEBAR =========== */}
        <div className="sidebar">
          {/* extract */}
          <div className="section">
            <div className="section-kicker">
              <span>Extract</span>
              <span className="right">k-means++ · OKLab</span>
            </div>
            <div className="k-control">
              <span className="lbl">k</span>
              <input
                type="range"
                min="2" max="12" step="1"
                value={k}
                onChange={(e) => setK(parseInt(e.target.value))}
              />
              <span className="val">{k}</span>
            </div>
            <div style={{display:'flex', gap: 6}}>
              <button className="btn primary" onClick={extractPalette} disabled={!image || extracting} style={{flex:1}}>
                <Sparkles className="icon" />
                <span>Extract {k} colours</span>
              </button>
              {samples.length > 0 && (
                <button className="btn" onClick={clearAll} title="Clear palette">
                  <Trash2 className="icon" />
                </button>
              )}
            </div>
          </div>

          {/* palette */}
          <div className="section">
            <div className="section-kicker">
              <span>Palette</span>
              <span className="right">{samples.length} {samples.length === 1 ? 'swatch' : 'swatches'}</span>
            </div>
            {samples.length > 1 && (
              <div className="sort-row">
                <span className="sort-lbl">sort</span>
                <button className="sort-btn" onClick={() => sortBy('hue')} title="Sort by hue">hue</button>
                <button className="sort-btn" onClick={() => sortBy('light')} title="Sort by lightness, dark → light">light</button>
                <button className="sort-btn" onClick={() => sortBy('chroma')} title="Sort by chroma, saturated → muted">chr</button>
                <button className="sort-btn" onClick={() => sortBy('weight')} title="Sort by pixel weight">wt</button>
              </div>
            )}
            {samples.length === 0 ? (
              <div className="palette-empty">
                <em>Empty.</em> Extract, or click anywhere on the image to sample.
              </div>
            ) : (
              <div className="palette-grid">
                {samples.map((s, idx) => {
                  const hex = rgbToHex(s.rgb.r, s.rgb.g, s.rgb.b);
                  const isDragging = dragIdx === idx;
                  const isDropTarget = dropIdx === idx && dragIdx !== null && dragIdx !== idx;
                  return (
                    <div
                      key={s.id}
                      className={`swatch ${s.id === selectedId ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''}`}
                      onClick={() => setSelectedId(s.id)}
                      draggable
                      onDragStart={onDragStart(idx)}
                      onDragOver={onDragOver(idx)}
                      onDragEnd={onDragEnd}
                      onDrop={onDropOn(idx)}
                    >
                      <div className="chip" style={{ background: hex }} />
                      <div className="src-tag">{s.source === 'auto' ? 'auto' : 'manual'}</div>
                      {s.inGamut === false && (
                        <div className="gamut-dot" title="Outside sRGB gamut — colour is clamped" />
                      )}
                      <button className="remove" onClick={(e) => { e.stopPropagation(); removeSample(s.id); }}>
                        <X style={{width:10,height:10}} />
                      </button>
                      <div className="meta">
                        <span className="hex">{hex}</span>
                        {s.weight != null && <span className="weight">{(s.weight * 100).toFixed(0)}%</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* support */}
          <div className="section">
            <div className="section-kicker">
              <span>Support</span>
            </div>
            <p className="support-text">
              If Chromatography has been useful, a small tip means a lot — suggested £3 per palette.
            </p>
            <KofiButton />
          </div>

          {/* adjustments */}
          {selected && (
            <div className="section">
              <div className="section-kicker">
                <span>Adjust</span>
                <span className="right">OKLCH</span>
              </div>
              <div className="adjust-preview" style={{ background: rgbToHex(selected.rgb.r, selected.rgb.g, selected.rgb.b) }}>
                <div className="hex-overlay">{rgbToHex(selected.rgb.r, selected.rgb.g, selected.rgb.b)}</div>
                {selected.inGamut === false && (
                  <div className="gamut-badge" title="Outside sRGB gamut — the displayed colour is clamped">out of gamut</div>
                )}
              </div>
              <div className="hex-input-row">
                <input
                  className="hex-input"
                  value={hexInput}
                  onChange={(e) => setHexInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === 'Enter') applyHexInput(); }}
                  onBlur={applyHexInput}
                  spellCheck={false}
                />
                <button className="btn" onClick={applyHexInput} title="Apply hex">↵</button>
                <button className="btn" onClick={() => copy(rgbToHex(selected.rgb.r, selected.rgb.g, selected.rgb.b), selected.id)} title="Copy hex">
                  {copiedId === selected.id ? <Check className="icon" /> : <Copy className="icon" />}
                </button>
              </div>

              <div className="slider-row">
                <span className="axis">Light</span>
                <input
                  type="range" className="accent"
                  min="0" max="1" step="0.001"
                  value={selected.L}
                  onChange={(e) => adjustLCH(parseFloat(e.target.value), selected.C, selected.h)}
                />
                <span className="num">{(selected.L * 100).toFixed(1)}%</span>
              </div>
              <div className="slider-row">
                <span className="axis">Chroma</span>
                <input
                  type="range" className="accent"
                  min="0" max="0.4" step="0.001"
                  value={selected.C}
                  onChange={(e) => adjustLCH(selected.L, parseFloat(e.target.value), selected.h)}
                />
                <span className="num">{selected.C.toFixed(3)}</span>
              </div>
              <div className="slider-row">
                <span className="axis">Hue</span>
                <input
                  type="range" className="accent"
                  min="0" max="360" step="0.1"
                  value={selected.h}
                  onChange={(e) => adjustLCH(selected.L, selected.C, parseFloat(e.target.value))}
                />
                <span className="num">{selected.h.toFixed(1)}°</span>
              </div>

              <div className="adjust-footer">
                <div className="hint">Perceptually-uniform space: Lightness 0–100%, Chroma 0–0.4, Hue 0–360°.</div>
                <button className="btn" onClick={revertSelected} title="Revert to original sampled colour">
                  <span style={{fontSize: 11}}>revert</span>
                </button>
              </div>

              {/* APCA */}
              <div className="section-kicker" style={{marginTop: 20, marginBottom: 8}}>
                <span>APCA Lc</span>
                <span className="right">text ↔ bg</span>
              </div>
              {apcaReadouts && (() => {
                const hex = rgbToHex(selected.rgb.r, selected.rgb.g, selected.rgb.b);
                const fmt = (n) => (n === 0 ? '—' : (n > 0 ? '+' : '') + n.toFixed(0));
                return (
                  <>
                    <div className="apca-grid">
                      <div className="apca-cell">
                        <div className="bg-chip" style={{background:'#F2EEE5', color: hex}}>Aa</div>
                        <div className="val">{fmt(apcaReadouts.onPage)}</div>
                        <div className="lbl">on page</div>
                      </div>
                      <div className="apca-cell">
                        <div className="bg-chip" style={{background:'#FFFFFF', color: hex}}>Aa</div>
                        <div className="val">{fmt(apcaReadouts.onWhite)}</div>
                        <div className="lbl">on white</div>
                      </div>
                      <div className="apca-cell">
                        <div className="bg-chip" style={{background:'#000000', color: hex}}>Aa</div>
                        <div className="val">{fmt(apcaReadouts.onBlack)}</div>
                        <div className="lbl">on black</div>
                      </div>
                    </div>
                    <div className="apca-grid" style={{marginTop: 4}}>
                      <div className="apca-cell">
                        <div className="bg-chip" style={{background: hex, color: '#F2EEE5'}}>Aa</div>
                        <div className="val">{fmt(apcaReadouts.pageOn)}</div>
                        <div className="lbl">page text</div>
                      </div>
                      <div className="apca-cell">
                        <div className="bg-chip" style={{background: hex, color: '#FFFFFF'}}>Aa</div>
                        <div className="val">{fmt(apcaReadouts.whiteOn)}</div>
                        <div className="lbl">white text</div>
                      </div>
                      <div className="apca-cell">
                        <div className="bg-chip" style={{background: hex, color: '#000000'}}>Aa</div>
                        <div className="val">{fmt(apcaReadouts.blackOn)}</div>
                        <div className="lbl">black text</div>
                      </div>
                    </div>
                    <div style={{fontFamily:'Geist Mono, monospace', fontSize: 9.5, color: 'var(--ink-faint)', marginTop: 8, lineHeight: 1.5, letterSpacing: '0.02em'}}>
                      |Lc| ≥ 75 body · ≥ 60 large body · ≥ 45 large text · ≥ 30 spot
                    </div>
                    <div style={{fontSize: 10.5, color: 'var(--ink-muted)', marginTop: 6, lineHeight: 1.5, letterSpacing: '-0.003em'}}>
                      Top row: the selected swatch used as text on each background. Bottom row: used as a background with each text colour on top. A positive score means the scored colour is darker than its reference; negative means lighter.
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>

        {/* loupe — follows cursor over image */}
        {hoverPixel && image && (
          <div
            className="loupe"
            style={{
              left: Math.min(hoverPixel.clientX + 20, window.innerWidth - 200),
              top: Math.min(hoverPixel.clientY + 20, window.innerHeight - 220),
            }}
          >
            <canvas ref={loupeCanvasRef} />
            <div className="loupe-swatch" style={{ background: rgbToHex(hoverPixel.rgb.r, hoverPixel.rgb.g, hoverPixel.rgb.b) }} />
            <div className="row"><span className="lbl">hex</span><span>{rgbToHex(hoverPixel.rgb.r, hoverPixel.rgb.g, hoverPixel.rgb.b)}</span></div>
            <div className="row"><span className="lbl">rgb</span><span>{hoverPixel.rgb.r} {hoverPixel.rgb.g} {hoverPixel.rgb.b}</span></div>
            <div className="row"><span className="lbl">L C h</span><span>{(hoverPixel.L*100).toFixed(0)} {hoverPixel.C.toFixed(2)} {hoverPixel.h.toFixed(0)}°</span></div>
            <div className="row"><span className="lbl">xy</span><span>{hoverPixel.ix}, {hoverPixel.iy}</span></div>
          </div>
        )}

        {/* footer — tech notes + bio */}
        <div className="footer">
          <p className="footer-body">
            <b>Chromatography</b> is a desktop tool for building colour palettes from photographs.
            Automatic extraction uses <b>k-means++</b> clustering with <code>k</code> centroids, run in <b>OKLab</b> —
            a perceptually-uniform space where equal distances approximate equal perceived differences, unlike RGB.
            Sliders edit in <b>OKLCH</b>: lightness, chroma, hue. Colours pushed outside the sRGB gamut by slider edits
            are flagged; the displayed colour is the gamut-clamped approximation. Contrast readouts use <b>APCA</b> (the algorithm drafted for WCAG 3),
            which is meaningfully more accurate than the legacy <code>WCAG 2.1</code> ratio for real-world text-on-background pairs.
            All computation runs locally; nothing is uploaded.
          </p>
          <p className="footer-bio">
            <b>Jayden Macklin-Cordes</b> is a linguist researching language evolution. He built Chromatography
            to bring a personal touch — drawn from his own photographs — to academic figures and web projects.
            He has a weakness for good typography, design, and data visualisation.{' '}
            <a href="https://macklin-cordes.com/" target="_blank" rel="noreferrer">macklin-cordes.com</a>
            <br />
            If you've enjoyed the app, please consider{' '}
            <a href="https://ko-fi.com/Z8Z61Y87TQ" target="_blank" rel="noreferrer">supporting the work</a>.
            <span className="footer-links">
              {' '}· Chromatography is open source on{' '}
              <a href="https://github.com/JaydenM-C/chromatography/tree/main" target="_blank" rel="noreferrer">GitHub</a>
              {' '}·{' '}
              <a href="https://github.com/JaydenM-C/chromatography/blob/main/LICENSE" target="_blank" rel="noreferrer">GNU GPL v3</a>
            </span>
          </p>
        </div>

        {/* export modal */}
        {exportOpen && (
          <div className="modal-backdrop" onClick={closeExport}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3 className="modal-title">Export palette</h3>
                <span className="modal-kicker">{samples.length} swatches</span>
              </div>
              <div className="format-tabs">
                {Object.entries(exportFormatMeta).map(([key, meta]) => (
                  <button
                    key={key}
                    className={`format-tab ${exportFormat === key ? 'active' : ''}`}
                    onClick={() => setExportFormat(key)}
                  >
                    {meta.label}
                  </button>
                ))}
              </div>
              <div className="modal-body">
                <div className="format-hint">{exportFormatMeta[exportFormat].hint}</div>
                <textarea
                  ref={exportTextareaRef}
                  value={exportText}
                  readOnly
                  spellCheck={false}
                  onFocus={(e) => e.target.select()}
                />
              </div>
              <div className="modal-foot">
                <div className="note">
                  {exportFormat === 'markdown' || exportFormat === 'html' ? (
                    <>Prose placeholders are left blank by design — fill them in, or paste this plus the JSON export into Claude with the companion prompt.</>
                  ) : (
                    <>All computation is local. Nothing leaves this page.</>
                  )}
                </div>
                <div className="actions">
                  <button className="btn" onClick={closeExport}>close</button>
                  <button className="btn" onClick={downloadExport} title={`Download as .${exportFormatMeta[exportFormat].ext}`}>
                    <Download className="icon" />
                    <span>download</span>
                  </button>
                  <button className="btn primary" onClick={copyExport}>
                    {exportCopied ? <Check className="icon" /> : <Copy className="icon" />}
                    <span>{exportCopied ? 'copied' : 'copy'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
