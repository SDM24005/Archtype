import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const MAX_WORDS = 5;
const MAX_LETTERS_PER_WORD = 15;
const MORPH_RING_SAMPLES = 96;
const FRUSTUM_SIZE = 24;
const MAX_CACHE_ENTRIES = 40;
const EQUAL_HEIGHT_UNITS = 5.0;
const DEFAULT_CAM_DIR = new THREE.Vector3(26, 22, 26).normalize();

const FONT_PRESETS = [
  'https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-700-normal.woff',
  'https://cdn.jsdelivr.net/npm/@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff',
  'https://cdn.jsdelivr.net/npm/@fontsource/space-mono/files/space-mono-latin-700-normal.woff',
];

const state = {
  text: 'TYPE COLUMN STUDIO',
  words: [], // [{ text, letters: [{ char, h, w }], dialAngle }]
  equalHeight: false,
  globalHeight: false,
  globalHeightScale: 1.0,
  globalWidth: false,
  globalWidthScale: 1.0,
  entasi: 0.0,
  globalRotation: false,
  clusterSpacing: 2.6,
  columnLayers: 44,
  sheetThickness: 0.14,
  darkMode: false,
  monoMode: false,
};

let currentFont = null;
const glyphCache = new Map();
const wordMeshCache = new Map();

// --- Palette Dinamica UI SVG ---
function getThemeColors() {
  const dark = state.darkMode;
  const mono = state.monoMode;
  const bg = dark ? '#0c0c0c' : '#ffffff';
  const fg = dark ? '#f5f5f5' : '#111111';
  const line = dark ? '#444444' : '#333333';
  const red = mono ? fg : '#e51919';
  const blue = mono ? fg : '#2266dd';
  const orange = mono ? fg : '#e8960c';
  return { dark, mono, bg, fg, line, red, blue, orange };
}

// --- Setup Three.js (Viewport Principale Assonometrico) ---
const viewport = document.getElementById('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const initAspect = viewport.clientWidth / Math.max(viewport.clientHeight, 1);
const camera = new THREE.OrthographicCamera(
  (-FRUSTUM_SIZE * initAspect) / 2,
  (FRUSTUM_SIZE * initAspect) / 2,
  FRUSTUM_SIZE / 2,
  -FRUSTUM_SIZE / 2,
  0.1,
  1000
);
camera.position.copy(DEFAULT_CAM_DIR).multiplyScalar(100);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;

const rootGroup = new THREE.Group();
scene.add(rootGroup);

const fillMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 1.5,
  polygonOffsetUnits: 1.5,
});

const strokeMaterial = new THREE.MeshBasicMaterial({
  color: 0x000000,
  side: THREE.DoubleSide,
});

// --- Setup Sfera 3D di Navigazione (in alto a destra) ---
const navCanvas = document.getElementById('nav-sphere-canvas');
const navRenderer = new THREE.WebGLRenderer({ canvas: navCanvas, antialias: true, alpha: true });
navRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
navRenderer.setSize(96, 96);

const navScene = new THREE.Scene();
const navCamera = new THREE.OrthographicCamera(-1.45, 1.45, 1.45, -1.45, 0.1, 20);
navCamera.position.set(0, 0, 5);

const navGizmo = new THREE.Group();
navScene.add(navGizmo);

const sphereCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const sphereCore = new THREE.Mesh(new THREE.SphereGeometry(0.96, 28, 28), sphereCoreMat);
navGizmo.add(sphereCore);

const outlineRingMat = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide });
const outlineRing = new THREE.Mesh(new THREE.RingGeometry(0.96, 1.0, 48), outlineRingMat);
navScene.add(outlineRing);

const navLinesMat = new THREE.LineBasicMaterial({ color: 0x222222 });

function makeCircleLine(axis, radius = 0.98) {
  const pts = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    if (axis === 'xz') pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    if (axis === 'xy') pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
    if (axis === 'yz') pts.push(new THREE.Vector3(0, Math.cos(a) * radius, Math.sin(a) * radius));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.Line(geo, navLinesMat);
}

navGizmo.add(makeCircleLine('xz'));
navGizmo.add(makeCircleLine('xy'));
navGizmo.add(makeCircleLine('yz'));

const axesLinesGeo = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(-1.12, 0, 0), new THREE.Vector3(1.12, 0, 0),
  new THREE.Vector3(0, -1.12, 0), new THREE.Vector3(0, 1.12, 0),
  new THREE.Vector3(0, 0, -1.12), new THREE.Vector3(0, 0, 1.12),
]);
navGizmo.add(new THREE.LineSegments(axesLinesGeo, navLinesMat));

const axisSprites = [];
function drawAxisTexture(canvas, label, isDark) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 48, 48);
  ctx.fillStyle = isDark ? '#f5f5f5' : '#111111';
  ctx.beginPath();
  ctx.arc(24, 24, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = isDark ? '#0c0c0c' : '#ffffff';
  ctx.font = 'bold 22px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 24, 25);
}

function makeAxisDot(pos, label) {
  const c = document.createElement('canvas');
  c.width = 48;
  c.height = 48;
  drawAxisTexture(c, label, false);

  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
  sprite.position.copy(pos);
  sprite.scale.set(0.36, 0.36, 1);
  axisSprites.push({ canvas: c, tex, label });
  return sprite;
}

navGizmo.add(makeAxisDot(new THREE.Vector3(1.06, 0, 0), 'X'));
navGizmo.add(makeAxisDot(new THREE.Vector3(0, 1.06, 0), 'Y'));
navGizmo.add(makeAxisDot(new THREE.Vector3(0, 0, 1.06), 'Z'));

function syncThemeTo3D() {
  const dark = state.darkMode;
  scene.background.set(dark ? 0x0c0c0c : 0xffffff);
  fillMaterial.color.set(dark ? 0x0c0c0c : 0xffffff);
  strokeMaterial.color.set(dark ? 0xffffff : 0x000000);

  sphereCoreMat.color.set(dark ? 0x0c0c0c : 0xffffff);
  outlineRingMat.color.set(dark ? 0xf5f5f5 : 0x111111);
  navLinesMat.color.set(dark ? 0xdddddd : 0x222222);

  for (const item of axisSprites) {
    drawAxisTexture(item.canvas, item.label, dark);
    item.tex.needsUpdate = true;
  }
}

const navWrap = document.getElementById('nav-sphere-wrap');
navWrap.style.touchAction = 'none';
navWrap.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  let prevX = e.clientX;
  let prevY = e.clientY;

  const onMove = (ev) => {
    const dx = ev.clientX - prevX;
    const dy = ev.clientY - prevY;
    prevX = ev.clientX;
    prevY = ev.clientY;

    const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    sph.theta -= dx * 0.015;
    sph.phi = THREE.MathUtils.clamp(sph.phi - dy * 0.015, 0.08, Math.PI - 0.08);
    offset.setFromSpherical(sph);
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);
    controls.update();
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
});

navWrap.addEventListener('dblclick', () => fitCameraToScene(true));

// --- Sincronizzazione Testo -> Struttura Dati Parole/Lettere ---
const clusterCtrl = document.getElementById('cluster-dist-control');
const bottomBar = document.getElementById('bottom-bar');

function updateClusterVisibility() {
  const singleWord = state.words.length <= 1;
  clusterCtrl.hidden = singleWord;
  bottomBar.classList.toggle('two-cols', singleWord);
}

function sanitizeAndSyncWords(rawText) {
  const rawWords = rawText.split(/\s+/);
  const filteredWords = [];
  const rebuiltTokens = [];

  for (let i = 0; i < rawWords.length; i++) {
    const w = rawWords[i];
    if (w.length === 0) {
      if (i === rawWords.length - 1 && filteredWords.length < MAX_WORDS && rawText.endsWith(' ')) {
        rebuiltTokens.push('');
      }
      continue;
    }
    if (filteredWords.length >= MAX_WORDS) break;
    const clipped = Array.from(w).slice(0, MAX_LETTERS_PER_WORD).join('');
    filteredWords.push(clipped);
    rebuiltTokens.push(clipped);
  }

  const sanitized = rebuiltTokens.join(' ');
  state.text = sanitized;

  const prevWords = state.words;
  state.words = filteredWords.map((wordStr, wIdx) => {
    const prevWord = prevWords[wIdx];
    const chars = Array.from(wordStr);
    const letters = chars.map((ch, lIdx) => {
      const prevLetter = prevWord && prevWord.letters[lIdx];
      return {
        char: ch,
        h: prevLetter ? prevLetter.h : 1.0,
        w: prevLetter ? prevLetter.w : 1.0,
      };
    });
    return {
      text: wordStr,
      letters,
      dialAngle: prevWord ? prevWord.dialAngle : 0,
    };
  });

  document.getElementById('text-counter').textContent = `${state.words.length}/${MAX_WORDS} parole`;
  updateClusterVisibility();
  return sanitized;
}

// --- Centratura & Margine Automatico Viewport 3D ---
function fitCameraToScene(resetAngle = false) {
  const box = new THREE.Box3().setFromObject(rootGroup);
  if (box.isEmpty()) return;

  const center = new THREE.Vector3();
  box.getCenter(center);

  const dir = resetAngle
    ? DEFAULT_CAM_DIR.clone()
    : new THREE.Vector3().subVectors(camera.position, controls.target).normalize();

  if (dir.lengthSq() < 1e-6) dir.copy(DEFAULT_CAM_DIR);

  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(dir, 100);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);

  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const c of corners) {
    c.applyMatrix4(camera.matrixWorldInverse);
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }

  const viewW = Math.max(maxX - minX, 0.1);
  const viewH = Math.max(maxY - minY, 0.1);
  const aspect = viewport.clientWidth / Math.max(viewport.clientHeight, 1);
  const marginFill = 0.74;

  const zoomX = (FRUSTUM_SIZE * aspect * marginFill) / viewW;
  const zoomY = (FRUSTUM_SIZE * marginFill) / viewH;
  camera.zoom = Math.min(zoomX, zoomY);
  camera.updateProjectionMatrix();
  controls.update();
}

// --- Geometria Vettoriale Glifi ---
function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function opentypePathToShapes(otPath) {
  const subpaths = [];
  let current = null;

  for (const cmd of otPath.commands) {
    if (cmd.type === 'M') {
      current = new THREE.Path();
      current.moveTo(cmd.x, -cmd.y);
      subpaths.push(current);
    } else if (cmd.type === 'L' && current) {
      current.lineTo(cmd.x, -cmd.y);
    } else if (cmd.type === 'Q' && current) {
      current.quadraticCurveTo(cmd.x1, -cmd.y1, cmd.x, -cmd.y);
    } else if (cmd.type === 'C' && current) {
      current.bezierCurveTo(cmd.x1, -cmd.y1, cmd.x2, -cmd.y2, cmd.x, -cmd.y);
    } else if (cmd.type === 'Z' && current) {
      current.closePath();
    }
  }

  const items = subpaths
    .map((path) => {
      const pts = path.getPoints(12);
      return { path, pts, area: Math.abs(THREE.ShapeUtils.area(pts)) };
    })
    .filter((it) => it.pts.length >= 3 && it.area > 1e-5);

  const solids = [];
  const holes = [];

  for (let i = 0; i < items.length; i++) {
    const containers = [];
    for (let j = 0; j < items.length; j++) {
      if (i !== j && pointInPolygon(items[i].pts[0], items[j].pts)) containers.push(j);
    }
    if (containers.length % 2 === 0) {
      const shape = new THREE.Shape();
      shape.curves = items[i].path.curves;
      shape.currentPoint = items[i].path.currentPoint;
      solids.push({ index: i, shape, area: items[i].area });
    } else {
      holes.push({ path: items[i].path, containers });
    }
  }

  for (const hole of holes) {
    let best = null;
    let minArea = Infinity;
    for (const cIdx of hole.containers) {
      const s = solids.find((item) => item.index === cIdx);
      if (s && s.area < minArea) {
        minArea = s.area;
        best = s;
      }
    }
    if (best) best.shape.holes.push(hole.path);
  }

  return solids.map((s) => s.shape);
}

function buildSheetBodyGeometry(shapes, thickness, curveSegments = 8) {
  if (shapes.length === 0) return new THREE.BufferGeometry();
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments,
    steps: 1,
  });
  geo.translate(0, 0, -thickness * 0.5);
  return geo;
}

function buildDualStrokeGeometry(shapes, width, thickness) {
  if (width <= 0.0005 || shapes.length === 0) return new THREE.BufferGeometry();

  const positions = [];
  const indices = [];
  const hw = width * 0.5;
  let offset = 0;

  const contours = [];
  for (const shape of shapes) {
    contours.push(shape.getPoints(10));
    for (const hole of shape.holes) contours.push(hole.getPoints(10));
  }

  const zPlanes = [thickness * 0.5 + 0.001, -thickness * 0.5 - 0.001];

  for (const zVal of zPlanes) {
    for (const rawPts of contours) {
      const pts = [];
      for (const p of rawPts) {
        if (pts.length === 0 || p.distanceToSquared(pts[pts.length - 1]) > 1e-6) pts.push(p);
      }
      if (pts.length > 1 && pts[0].distanceToSquared(pts[pts.length - 1]) < 1e-6) pts.pop();
      const n = pts.length;
      if (n < 3) continue;

      for (let i = 0; i < n; i++) {
        const prev = pts[(i - 1 + n) % n];
        const curr = pts[i];
        const next = pts[(i + 1) % n];

        const d0 = new THREE.Vector2().subVectors(curr, prev).normalize();
        const d1 = new THREE.Vector2().subVectors(next, curr).normalize();
        const n0 = new THREE.Vector2(-d0.y, d0.x);
        const n1 = new THREE.Vector2(-d1.y, d1.x);

        const miter = new THREE.Vector2().addVectors(n0, n1);
        if (miter.lengthSq() < 1e-6) miter.copy(n0);
        else miter.normalize();

        const miterLen = hw / Math.max(Math.abs(miter.dot(n0)), 0.35);
        positions.push(
          curr.x + miter.x * miterLen, curr.y + miter.y * miterLen, zVal,
          curr.x - miter.x * miterLen, curr.y - miter.y * miterLen, zVal
        );
      }

      for (let i = 0; i < n; i++) {
        const nextI = (i + 1) % n;
        const a = offset + i * 2;
        const b = offset + i * 2 + 1;
        const c = offset + nextI * 2;
        const d = offset + nextI * 2 + 1;
        indices.push(a, b, c, b, d, c);
      }
      offset += n * 2;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

function resampleClosedContour(curvePath, center, sampleCount) {
  const pts = curvePath.getSpacedPoints(sampleCount).slice(0, sampleCount).map((p) => ({
    x: p.x - center.x,
    y: p.y - center.y,
  }));
  if (pts.length < sampleCount) return null;

  if (THREE.ShapeUtils.area(pts.map((p) => new THREE.Vector2(p.x, p.y))) < 0) {
    pts.reverse();
  }

  let topIdx = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].y > pts[topIdx].y || (pts[i].y === pts[topIdx].y && pts[i].x < pts[topIdx].x)) {
      topIdx = i;
    }
  }
  return [...pts.slice(topIdx), ...pts.slice(0, topIdx)];
}

function getGlyphData(char) {
  if (glyphCache.has(char)) return glyphCache.get(char);

  const fontSize = 5.0;
  const glyph = currentFont.charToGlyph(char);
  const shapes = opentypePathToShapes(glyph.getPath(0, 0, fontSize));

  if (shapes.length === 0) {
    const empty = { char, shapes: [], center: new THREE.Vector2(), morphSolids: [], morphHoles: [] };
    glyphCache.set(char, empty);
    return empty;
  }

  const measureGeo = new THREE.ShapeGeometry(shapes, 8);
  measureGeo.computeBoundingBox();
  const center = new THREE.Vector2();
  measureGeo.boundingBox.getCenter(center);
  measureGeo.dispose();

  const morphSolids = [];
  const morphHoles = [];
  for (const s of shapes) {
    const sampledSolid = resampleClosedContour(s, center, MORPH_RING_SAMPLES);
    if (sampledSolid) morphSolids.push(sampledSolid);
    for (const h of s.holes) {
      const sampledHole = resampleClosedContour(h, center, MORPH_RING_SAMPLES);
      if (sampledHole) morphHoles.push(sampledHole);
    }
  }

  const data = { char, shapes, center, morphSolids, morphHoles };
  glyphCache.set(char, data);
  return data;
}

function makeCollapsedRing(cx, cy, radius = 0.002) {
  const ring = [];
  for (let i = 0; i < MORPH_RING_SAMPLES; i++) {
    const a = (i / MORPH_RING_SAMPLES) * Math.PI * 2;
    ring.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
  }
  return ring;
}

function getContourCentroid(ring) {
  let sx = 0, sy = 0;
  for (const p of ring) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / ring.length, y: sy / ring.length };
}

function disposeSlices(slices) {
  if (!slices) return;
  const seen = new Set();
  for (const s of slices) {
    if (s.bodyGeo && !seen.has(s.bodyGeo)) {
      seen.add(s.bodyGeo);
      s.bodyGeo.dispose();
    }
    if (s.strokeGeo && !seen.has(s.strokeGeo)) {
      seen.add(s.strokeGeo);
      s.strokeGeo.dispose();
    }
  }
}

function clearWordMeshCache() {
  wordMeshCache.forEach((slices) => disposeSlices(slices));
  wordMeshCache.clear();
}

function setWordMeshCache(key, slices) {
  if (wordMeshCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = wordMeshCache.keys().next().value;
    disposeSlices(wordMeshCache.get(oldestKey));
    wordMeshCache.delete(oldestKey);
  }
  wordMeshCache.set(key, slices);
}

function getWordSlices(validLetters, layers, totalHeightWeight) {
  const wordKey = validLetters.map((l) => `${l.glyph.char}:${(l.h / totalHeightWeight).toFixed(3)}`).join('|');
  const cacheKey = `${wordKey}#${layers}#${state.sheetThickness.toFixed(3)}`;
  if (wordMeshCache.has(cacheKey)) return wordMeshCache.get(cacheKey);

  const strokeW = 0.075;

  if (validLetters.length === 1) {
    const g = validLetters[0].glyph;
    const bodyGeo = buildSheetBodyGeometry(g.shapes, state.sheetThickness, 8);
    bodyGeo.translate(-g.center.x, -g.center.y, 0);
    const strokeGeo = buildDualStrokeGeometry(g.shapes, strokeW, state.sheetThickness);
    strokeGeo.translate(-g.center.x, -g.center.y, 0);
    const shared = { bodyGeo, strokeGeo };
    const slices = Array.from({ length: layers }, () => shared);
    setWordMeshCache(cacheKey, slices);
    return slices;
  }

  const maxSolids = Math.max(1, ...validLetters.map((l) => l.glyph.morphSolids.length));
  const maxHoles = Math.max(0, ...validLetters.map((l) => l.glyph.morphHoles.length));

  const normalized = validLetters.map((l) => {
    const g = l.glyph;
    const solids = [];
    for (let s = 0; s < maxSolids; s++) {
      solids.push(g.morphSolids[s] || makeCollapsedRing(0, 0, 0.003));
    }
    const holes = [];
    for (let h = 0; h < maxHoles; h++) {
      if (g.morphHoles[h]) {
        holes.push(g.morphHoles[h]);
      } else {
        const refHole = validLetters.find((other) => other.glyph.morphHoles[h])?.glyph.morphHoles[h];
        const c = refHole ? getContourCentroid(refHole) : { x: 0, y: 0 };
        holes.push(makeCollapsedRing(c.x, c.y, 0.002));
      }
    }
    return { solids, holes };
  });

  const centers = [];
  let acc = 0;
  for (const l of validLetters) {
    centers.push((acc + l.h * 0.5) / totalHeightWeight);
    acc += l.h;
  }

  const slices = [];
  for (let i = 0; i < layers; i++) {
    const t = layers > 1 ? i / (layers - 1) : 1;
    const topDown = 1 - t;

    let idx0 = 0;
    let idx1 = 0;
    let alpha = 0;

    if (topDown <= centers[0]) {
      idx0 = idx1 = 0;
    } else if (topDown >= centers[centers.length - 1]) {
      idx0 = idx1 = centers.length - 1;
    } else {
      for (let k = 0; k < centers.length - 1; k++) {
        if (topDown >= centers[k] && topDown <= centers[k + 1]) {
          idx0 = k;
          idx1 = k + 1;
          const span = Math.max(centers[k + 1] - centers[k], 1e-5);
          const rawA = (topDown - centers[k]) / span;
          alpha = rawA * rawA * (3 - 2 * rawA);
          break;
        }
      }
    }

    const g0 = normalized[idx0];
    const g1 = normalized[idx1];
    const shapes = [];

    for (let s = 0; s < maxSolids; s++) {
      const r0 = g0.solids[s];
      const r1 = g1.solids[s];
      const pts = [];
      for (let k = 0; k < MORPH_RING_SAMPLES; k++) {
        pts.push(
          new THREE.Vector2(
            r0[k].x + (r1[k].x - r0[k].x) * alpha,
            r0[k].y + (r1[k].y - r0[k].y) * alpha
          )
        );
      }
      if (Math.abs(THREE.ShapeUtils.area(pts)) > 0.015) {
        const shape = new THREE.Shape(pts);
        shape.closePath();

        if (s === 0) {
          for (let h = 0; h < maxHoles; h++) {
            const h0 = g0.holes[h];
            const h1 = g1.holes[h];
            const hPts = [];
            for (let k = 0; k < MORPH_RING_SAMPLES; k++) {
              hPts.push(
                new THREE.Vector2(
                  h0[k].x + (h1[k].x - h0[k].x) * alpha,
                  h0[k].y + (h1[k].y - h0[k].y) * alpha
                )
              );
            }
            if (Math.abs(THREE.ShapeUtils.area(hPts)) > 0.015) {
              const holePath = new THREE.Path(hPts);
              holePath.closePath();
              shape.holes.push(holePath);
            }
          }
        }
        shapes.push(shape);
      }
    }

    const bodyGeo = shapes.length > 0 ? buildSheetBodyGeometry(shapes, state.sheetThickness, 1) : null;
    const strokeGeo = shapes.length > 0 ? buildDualStrokeGeometry(shapes, strokeW, state.sheetThickness) : null;
    slices.push({ bodyGeo, strokeGeo });
  }

  setWordMeshCache(cacheKey, slices);
  return slices;
}

function sampleLetterWidthAt(validLetters, totalHeightWeight, topDown) {
  if (validLetters.length === 1) return validLetters[0].w;

  const centers = [];
  let acc = 0;
  for (const l of validLetters) {
    centers.push((acc + l.h * 0.5) / totalHeightWeight);
    acc += l.h;
  }

  if (topDown <= centers[0]) return validLetters[0].w;
  if (topDown >= centers[centers.length - 1]) return validLetters[validLetters.length - 1].w;

  for (let k = 0; k < centers.length - 1; k++) {
    if (topDown >= centers[k] && topDown <= centers[k + 1]) {
      const span = Math.max(centers[k + 1] - centers[k], 1e-5);
      const rawA = (topDown - centers[k]) / span;
      const alpha = rawA * rawA * (3 - 2 * rawA);
      return validLetters[k].w + (validLetters[k + 1].w - validLetters[k].w) * alpha;
    }
  }
  return 1.0;
}

// --- Costruzione della Scena 3D ---
function rebuildScene(resetAngle = false) {
  while (rootGroup.children.length > 0) {
    rootGroup.remove(rootGroup.children[0]);
  }
  if (!currentFont) return;

  const activeColumns = state.words
    .map((wordObj) => {
      const validLetters = wordObj.letters
        .map((l) => ({ ...l, glyph: getGlyphData(l.char) }))
        .filter((l) => l.glyph.shapes.length > 0);
      return { wordObj, validLetters };
    })
    .filter((item) => item.validLetters.length > 0);

  const n = activeColumns.length;
  if (n === 0) return;

  const layers = Math.max(12, Math.round(state.columnLayers));
  const unitHeight = 1.35 * (state.globalHeight ? state.globalHeightScale : 1.0);
  const baseScale = 0.78 * (state.globalWidth ? state.globalWidthScale : 1.0);
  const entasiFactor = state.globalWidth ? state.entasi : 0.0;

  const maxWidthWeight = Math.max(
    1.0,
    ...activeColumns.flatMap((c) => c.validLetters.map((l) => l.w))
  );
  const maxEntasi = 1.0 + Math.max(0, entasiFactor);
  const colFootprint = 2.4 * baseScale * maxWidthWeight * maxEntasi;
  const chord = colFootprint * 2 + state.clusterSpacing;
  const ringRadius = n === 1 ? 0 : chord / (2 * Math.sin(Math.PI / n));

  const bodyMat = [fillMaterial, strokeMaterial];
  const dummy = new THREE.Object3D();

  activeColumns.forEach((col, idx) => {
    const theta = n === 1 ? Math.PI * 0.5 : Math.PI * 0.5 + (idx / n) * Math.PI * 2;
    const cx = n === 1 ? 0 : Math.cos(theta) * ringRadius;
    const cz = n === 1 ? 0 : Math.sin(theta) * ringRadius;
    const baseYaw = n === 1 ? 0 : Math.PI * 0.5 - theta;

    const totalHWeight = col.validLetters.reduce((sum, l) => sum + l.h, 0);
    // Se equalHeight è attivo, tutte le colonne hanno la stessa altezza totale indipendentemente dal numero di lettere
    const effectiveUnits = state.equalHeight ? EQUAL_HEIGHT_UNITS : totalHWeight;
    const colHeight = effectiveUnits * unitHeight;
    const twistRad = THREE.MathUtils.degToRad(col.wordObj.dialAngle);

    const slices = getWordSlices(col.validLetters, layers, totalHWeight);

    for (let i = 0; i < layers; i++) {
      const slice = slices[i];
      if (!slice || (!slice.bodyGeo && !slice.strokeGeo)) continue;

      const t = layers > 1 ? i / (layers - 1) : 1;
      const topDown = 1 - t;
      const y = t * colHeight + state.sheetThickness * 0.5 + 0.002;

      const wWeight = sampleLetterWidthAt(col.validLetters, totalHWeight, topDown);
      const entasiMul = 1.0 + entasiFactor * Math.sin(Math.PI * t);
      const scaleXZ = Math.max(0.05, baseScale * wWeight * entasiMul);

      dummy.position.set(cx, y, cz);
      dummy.rotation.set(-Math.PI * 0.5, baseYaw + twistRad * topDown, 0, 'YXZ');
      dummy.scale.set(scaleXZ, scaleXZ, 1);
      dummy.updateMatrix();

      if (slice.bodyGeo) {
        const bodyMesh = new THREE.Mesh(slice.bodyGeo, bodyMat);
        bodyMesh.applyMatrix4(dummy.matrix);
        rootGroup.add(bodyMesh);
      }

      if (slice.strokeGeo) {
        const strokeMesh = new THREE.Mesh(slice.strokeGeo, strokeMaterial);
        strokeMesh.applyMatrix4(dummy.matrix);
        rootGroup.add(strokeMesh);
      }
    }
  });

  fitCameraToScene(resetAngle);
}

// --- Rendering UI 2D: Colonne Interattive ---
const columnsWrap = document.getElementById('columns-canvas-wrap');
const columnsSvg = document.getElementById('columns-svg');
const dialsSvg = document.getElementById('dials-svg');

columnsSvg.style.touchAction = 'none';
dialsSvg.style.touchAction = 'none';

function getColumnLayoutMetrics() {
  const n = Math.max(1, state.words.length);
  const availW = Math.max(340, columnsWrap.clientWidth - 20);
  const slotW = availW / n;
  const baseBarW = Math.min(44, Math.max(22, slotW * 0.34));
  const unitPx = 28 * (state.globalHeight ? state.globalHeightScale : 1.0);
  return { n, availW, slotW, baseBarW, unitPx };
}

function renderColumnsUI() {
  columnsSvg.innerHTML = '';
  const { availW, slotW, baseBarW, unitPx } = getColumnLayoutMetrics();
  if (state.words.length === 0) return;

  const theme = getThemeColors();
  const topMargin = 16;
  const bottomMargin = 18;
  let maxColPx = 120;

  const globalWScale = state.globalWidth ? state.globalWidthScale : 1.0;
  const entasiVal = state.globalWidth ? state.entasi : 0.0;

  state.words.forEach((wordObj, wIdx) => {
    const centerX = slotW * (wIdx + 0.5) + 8;
    const totalH = wordObj.letters.reduce((s, l) => s + l.h, 0);
    // Se equalHeight è attivo, tutte le colonne hanno la stessa altezza grafica
    const effectiveUnits = state.equalHeight ? EQUAL_HEIGHT_UNITS : totalH;
    const colHeightPx = effectiveUnits * unitPx;
    const heightScalePerLetter = totalH > 0 ? effectiveUnits / totalH : 1;

    if (colHeightPx > maxColPx) maxColPx = colHeightPx;

    const gCol = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    let accY = topMargin;
    const nodes = wordObj.letters.map((letter, lIdx) => {
      const hPx = letter.h * heightScalePerLetter * unitPx;
      const yLine = accY + hPx * 0.5;
      accY += hPx;

      const tNorm = colHeightPx > 1 ? (yLine - topMargin) / colHeightPx : 0.5;
      const entasiMul = 1.0 + entasiVal * Math.sin(Math.PI * tNorm);
      const halfW = Math.max(5, baseBarW * 0.5 * letter.w * globalWScale * entasiMul);

      return { letter, lIdx, yLine, halfW };
    });

    const yTop = topMargin;
    const yBot = topMargin + colHeightPx;

    const polyPts = [];
    if (nodes.length > 0) {
      polyPts.push(`${centerX - nodes[0].halfW},${yTop}`);
      nodes.forEach((nd) => polyPts.push(`${centerX - nd.halfW},${nd.yLine}`));
      polyPts.push(`${centerX - nodes[nodes.length - 1].halfW},${yBot}`);
      polyPts.push(`${centerX + nodes[nodes.length - 1].halfW},${yBot}`);
      for (let k = nodes.length - 1; k >= 0; k--) {
        polyPts.push(`${centerX + nodes[k].halfW},${nodes[k].yLine}`);
      }
      polyPts.push(`${centerX + nodes[0].halfW},${yTop}`);
    }

    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', polyPts.join(' '));
    poly.setAttribute('fill', theme.fg);
    gCol.appendChild(poly);

    const tickHalfSpan = Math.max(baseBarW * 1.15, 36);

    nodes.forEach((nd) => {
      const { letter, lIdx, yLine, halfW } = nd;

      const lineOut = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      lineOut.setAttribute('x1', centerX - tickHalfSpan);
      lineOut.setAttribute('x2', centerX + tickHalfSpan);
      lineOut.setAttribute('y1', yLine);
      lineOut.setAttribute('y2', yLine);
      lineOut.setAttribute('stroke', theme.line);
      lineOut.setAttribute('stroke-width', '1');
      gCol.appendChild(lineOut);

      const lineIn = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      lineIn.setAttribute('x1', centerX - halfW);
      lineIn.setAttribute('x2', centerX + halfW);
      lineIn.setAttribute('y1', yLine);
      lineIn.setAttribute('y2', yLine);
      lineIn.setAttribute('stroke', theme.bg);
      lineIn.setAttribute('stroke-width', '1');
      gCol.appendChild(lineIn);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', centerX - tickHalfSpan - 5);
      label.setAttribute('y', yLine + 3.5);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('font-size', '11');
      label.setAttribute('font-weight', '600');
      label.setAttribute('fill', theme.fg);
      label.textContent = letter.char;
      gCol.appendChild(label);

      // Triangolo Blu Sinistro & Destro
      const triSize = 4.5;

      const gTriL = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      gTriL.classList.add('handle-blue');
      const hitTriL = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      hitTriL.setAttribute('cx', centerX - halfW - triSize * 0.6);
      hitTriL.setAttribute('cy', yLine);
      hitTriL.setAttribute('r', '10');
      hitTriL.setAttribute('fill', 'transparent');
      const triL = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      triL.setAttribute(
        'points',
        `${centerX - halfW - triSize - 1},${yLine} ${centerX - halfW - 1},${yLine - triSize} ${centerX - halfW - 1},${yLine + triSize}`
      );
      triL.setAttribute('fill', theme.bg);
      triL.setAttribute('stroke', theme.blue);
      triL.setAttribute('stroke-width', '1.2');
      gTriL.appendChild(hitTriL);
      gTriL.appendChild(triL);
      attachBlueHandleDrag(gTriL, wIdx, lIdx, -1, baseBarW);
      gCol.appendChild(gTriL);

      const gTriR = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      gTriR.classList.add('handle-blue');
      const hitTriR = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      hitTriR.setAttribute('cx', centerX + halfW + triSize * 0.6);
      hitTriR.setAttribute('cy', yLine);
      hitTriR.setAttribute('r', '10');
      hitTriR.setAttribute('fill', 'transparent');
      const triR = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      triR.setAttribute(
        'points',
        `${centerX + halfW + triSize + 1},${yLine} ${centerX + halfW + 1},${yLine - triSize} ${centerX + halfW + 1},${yLine + triSize}`
      );
      triR.setAttribute('fill', theme.bg);
      triR.setAttribute('stroke', theme.blue);
      triR.setAttribute('stroke-width', '1.2');
      gTriR.appendChild(hitTriR);
      gTriR.appendChild(triR);
      attachBlueHandleDrag(gTriR, wIdx, lIdx, 1, baseBarW);
      gCol.appendChild(gTriR);

      // Rombo Rosso a destra (altezza segmento)
      if (!state.globalHeight || wIdx === 0) {
        const rx = centerX + tickHalfSpan + 7;
        const r = 3.8;

        const gRed = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        gRed.classList.add('handle-red');

        const hitRed = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        hitRed.setAttribute('cx', rx);
        hitRed.setAttribute('cy', yLine);
        hitRed.setAttribute('r', '10');
        hitRed.setAttribute('fill', 'transparent');

        const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        diamond.setAttribute(
          'points',
          `${rx},${yLine - r} ${rx + r},${yLine} ${rx},${yLine + r} ${rx - r},${yLine}`
        );
        diamond.setAttribute('fill', theme.bg);
        diamond.setAttribute('stroke', theme.red);
        diamond.setAttribute('stroke-width', '1.2');

        gRed.appendChild(hitRed);
        gRed.appendChild(diamond);
        attachRedHandleDrag(gRed, wIdx, lIdx, unitPx);
        gCol.appendChild(gRed);
      }
    });

    columnsSvg.appendChild(gCol);
  });

  const totalSvgH = maxColPx + topMargin + bottomMargin;
  columnsSvg.setAttribute('viewBox', `0 0 ${availW} ${totalSvgH}`);
  columnsSvg.style.height = `${totalSvgH}px`;
}

function attachRedHandleDrag(el, wIdx, lIdx, unitPx) {
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const startH = state.words[wIdx].letters[lIdx].h;

    const onMove = (ev) => {
      const dy = ev.clientY - startY;
      const newH = THREE.MathUtils.clamp(startH + dy / Math.max(unitPx, 12), 0.35, 2.6);

      if (state.globalHeight) {
        state.words.forEach((w) => {
          if (w.letters[lIdx]) w.letters[lIdx].h = newH;
        });
      } else if (state.words[wIdx] && state.words[wIdx].letters[lIdx]) {
        state.words[wIdx].letters[lIdx].h = newH;
      }

      renderColumnsUI();
      rebuildScene(false);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

function attachBlueHandleDrag(el, wIdx, lIdx, sideSign, baseBarW) {
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = state.words[wIdx].letters[lIdx].w;

    const onMove = (ev) => {
      const dx = (ev.clientX - startX) * sideSign;
      const newW = THREE.MathUtils.clamp(startW + (dx * 2) / Math.max(baseBarW, 18), 0.25, 2.1);

      if (state.globalWidth) {
        state.words.forEach((w) => {
          if (w.letters[lIdx]) w.letters[lIdx].w = newW;
        });
      } else if (state.words[wIdx] && state.words[wIdx].letters[lIdx]) {
        state.words[wIdx].letters[lIdx].w = newW;
      }

      renderColumnsUI();
      rebuildScene(false);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

// --- Rendering UI 2D: Diale di Rotazione con 16 Linee Equidistanti ---
function renderDialsUI() {
  dialsSvg.innerHTML = '';
  const { availW, slotW } = getColumnLayoutMetrics();
  const theme = getThemeColors();
  const h = 76;
  const cy = h * 0.5;
  const radius = 21;

  dialsSvg.setAttribute('viewBox', `0 0 ${availW} ${h}`);

  state.words.forEach((wordObj, wIdx) => {
    const cx = slotW * (wIdx + 0.5) + 8;

    if (wIdx < state.words.length - 1) {
      const nextCx = slotW * (wIdx + 1.5) + 8;
      const conn = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      conn.setAttribute('x1', cx + radius + 6);
      conn.setAttribute('x2', nextCx - radius - 6);
      conn.setAttribute('y1', cy);
      conn.setAttribute('y2', cy);
      conn.setAttribute('stroke', theme.line);
      conn.setAttribute('stroke-width', '1');
      dialsSvg.appendChild(conn);
    }

    const gDial = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gDial.classList.add('dial-unit');

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', radius);
    circle.setAttribute('fill', theme.bg);
    circle.setAttribute('stroke', theme.fg);
    circle.setAttribute('stroke-width', '1.2');
    gDial.appendChild(circle);

    const deg = wordObj.dialAngle;
    const rad = THREE.MathUtils.degToRad(deg);

    if (Math.abs(deg) > 0.5) {
      const numRays = 16;
      for (let i = 0; i < numRays; i++) {
        const frac = i / (numRays - 1);
        const a = -Math.PI * 0.5 + rad * frac;
        const ray = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        ray.setAttribute('x1', cx);
        ray.setAttribute('y1', cy);
        ray.setAttribute('x2', cx + Math.cos(a) * (radius - 1));
        ray.setAttribute('y2', cy + Math.sin(a) * (radius - 1));
        ray.setAttribute('stroke', theme.line);
        ray.setAttribute('stroke-width', '0.85');
        gDial.appendChild(ray);
      }
    }

    const pointerA = -Math.PI * 0.5 + rad;
    const px = cx + Math.cos(pointerA) * radius;
    const py = cy + Math.sin(pointerA) * radius;

    const needle = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    needle.setAttribute('x1', cx);
    needle.setAttribute('y1', cy);
    needle.setAttribute('x2', px);
    needle.setAttribute('y2', py);
    needle.setAttribute('stroke', theme.fg);
    needle.setAttribute('stroke-width', '1.3');
    gDial.appendChild(needle);

    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', px);
    dot.setAttribute('cy', py);
    dot.setAttribute('r', '3.2');
    dot.setAttribute('fill', theme.bg);
    dot.setAttribute('stroke', theme.orange);
    dot.setAttribute('stroke-width', '1.4');
    gDial.appendChild(dot);

    attachDialDrag(gDial, wIdx, cx, cy);
    dialsSvg.appendChild(gDial);
  });
}

function attachDialDrag(el, wIdx, dialCx, dialCy) {
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();

    const getPointerAngleDeg = (ev) => {
      const rect = dialsSvg.getBoundingClientRect();
      const vb = dialsSvg.viewBox.baseVal;
      const sx = ((ev.clientX - rect.left) / Math.max(rect.width, 1)) * vb.width;
      const sy = ((ev.clientY - rect.top) / Math.max(rect.height, 1)) * vb.height;
      return THREE.MathUtils.radToDeg(Math.atan2(sy - dialCy, sx - dialCx));
    };

    let prevAngle = getPointerAngleDeg(e);

    const onMove = (ev) => {
      const currAngle = getPointerAngleDeg(ev);
      let delta = currAngle - prevAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      prevAngle = currAngle;

      if (!state.words[wIdx]) return;
      const updated = THREE.MathUtils.clamp(state.words[wIdx].dialAngle + delta, -540, 540);
      if (state.globalRotation) {
        state.words.forEach((w) => {
          w.dialAngle = updated;
        });
      } else {
        state.words[wIdx].dialAngle = updated;
      }

      renderDialsUI();
      rebuildScene(false);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

// --- Controlli Globali Sinistra (Altezza Uguale, Altezza Globale Invertita, Larghezza, Entasi, Rotazione) ---
const toggleEqualHeight = document.getElementById('toggle-equal-height');
toggleEqualHeight.addEventListener('click', () => {
  state.equalHeight = !state.equalHeight;
  toggleEqualHeight.classList.toggle('active', state.equalHeight);
  renderColumnsUI();
  rebuildScene(false);
});

const toggleGlobalHeight = document.getElementById('toggle-global-height');
const globalHeightWrap = document.getElementById('global-height-slider-wrap');
const globalHeightSlider = document.getElementById('global-height-slider');
const globalHeightThumb = document.getElementById('global-height-thumb');

toggleGlobalHeight.addEventListener('click', () => {
  state.globalHeight = !state.globalHeight;
  toggleGlobalHeight.classList.toggle('active', state.globalHeight);
  globalHeightWrap.hidden = !state.globalHeight;
  renderColumnsUI();
  rebuildScene(false);
});

// Slider globale altezza INVERTITO: in alto (ratio=0) = 0.45, in basso (ratio=1) = 1.75
globalHeightSlider.style.touchAction = 'none';
globalHeightSlider.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const updateFromEvent = (ev) => {
    const rect = globalHeightSlider.getBoundingClientRect();
    const ratio = THREE.MathUtils.clamp((ev.clientY - rect.top) / rect.height, 0, 1);
    globalHeightThumb.style.top = `${ratio * 100}%`;
    state.globalHeightScale = 0.45 + ratio * 1.3;
    renderColumnsUI();
    rebuildScene(false);
  };
  updateFromEvent(e);
  const onUp = () => {
    window.removeEventListener('pointermove', updateFromEvent);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };
  window.addEventListener('pointermove', updateFromEvent);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
});

const toggleGlobalWidth = document.getElementById('toggle-global-width');
const globalWidthControls = document.getElementById('global-width-controls');
const globalWidthSlider = document.getElementById('global-width-slider');
const globalWidthThumb = document.getElementById('global-width-thumb');

toggleGlobalWidth.addEventListener('click', () => {
  state.globalWidth = !state.globalWidth;
  toggleGlobalWidth.classList.toggle('active', state.globalWidth);
  globalWidthControls.hidden = !state.globalWidth;
  renderColumnsUI();
  rebuildScene(false);
});

globalWidthSlider.style.touchAction = 'none';
globalWidthSlider.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const updateFromEvent = (ev) => {
    const rect = globalWidthSlider.getBoundingClientRect();
    const ratio = THREE.MathUtils.clamp((ev.clientX - rect.left) / rect.width, 0, 1);
    globalWidthThumb.style.left = `${ratio * 100}%`;
    state.globalWidthScale = 0.4 + ratio * 1.35;
    renderColumnsUI();
    rebuildScene(false);
  };
  updateFromEvent(e);
  const onUp = () => {
    window.removeEventListener('pointermove', updateFromEvent);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };
  window.addEventListener('pointermove', updateFromEvent);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
});

const entasiWidget = document.getElementById('global-entasi-widget');
const entasiPoly = document.getElementById('entasi-poly');
const entasiTriL = document.getElementById('entasi-tri-l');
const entasiTriR = document.getElementById('entasi-tri-r');

function updateEntasiIcon() {
  const midHalf = 10 + state.entasi * 10;
  const lx = 24 - midHalf;
  const rx = 24 + midHalf;
  entasiPoly.setAttribute('points', `14,6 34,6 ${rx},33 34,60 14,60 ${lx},33`);
  entasiTriL.setAttribute('points', `${lx - 6},33 ${lx - 1},29.5 ${lx - 1},36.5`);
  entasiTriR.setAttribute('points', `${rx + 6},33 ${rx + 1},29.5 ${rx + 1},36.5`);
}

entasiWidget.style.touchAction = 'none';
entasiWidget.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const startX = e.clientX;
  const startEntasi = state.entasi;

  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    state.entasi = THREE.MathUtils.clamp(startEntasi + dx * 0.015, -0.55, 0.85);
    updateEntasiIcon();
    renderColumnsUI();
    rebuildScene(false);
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
});

const toggleGlobalRot = document.getElementById('toggle-global-rot');
toggleGlobalRot.addEventListener('click', () => {
  state.globalRotation = !state.globalRotation;
  toggleGlobalRot.classList.toggle('active', state.globalRotation);
  if (state.globalRotation && state.words.length > 0) {
    const masterAngle = state.words[0].dialAngle;
    state.words.forEach((w) => {
      w.dialAngle = masterAngle;
    });
    renderDialsUI();
    rebuildScene(false);
  }
});

// --- Controlli Inferiori: Distanza Colonne | Densità Fogli | Spessore Fogli ---
const clusterTri = document.getElementById('cluster-tri');
const clusterDots = [
  document.getElementById('cluster-dot-0'),
  document.getElementById('cluster-dot-1'),
  document.getElementById('cluster-dot-2'),
];

function updateClusterIcon(norm) {
  const r = 6 + norm * 16;
  const pts = [];
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI * 0.5 + (i * Math.PI * 2) / 3;
    const x = 37 + Math.cos(a) * r;
    const y = 37 + Math.sin(a) * r;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    clusterDots[i].setAttribute('cx', x.toFixed(1));
    clusterDots[i].setAttribute('cy', y.toFixed(1));
  }
  clusterTri.setAttribute('points', pts.join(' '));
}

let clusterNorm = 0.28;
updateClusterIcon(clusterNorm);

clusterCtrl.style.touchAction = 'none';
clusterCtrl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const startX = e.clientX;
  const startNorm = clusterNorm;

  const onMove = (ev) => {
    clusterNorm = THREE.MathUtils.clamp(startNorm + (ev.clientX - startX) / 70, 0, 1);
    updateClusterIcon(clusterNorm);
    state.clusterSpacing = clusterNorm * 11.0;
    rebuildScene(false);
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
});

const densityCtrl = document.getElementById('density-control');
const densityBars = Array.from(document.querySelectorAll('.d-bar'));

function updateDensityIcon(norm) {
  const activeCount = Math.max(1, Math.round(norm * 6));
  densityBars.forEach((bar, idx) => {
    bar.classList.toggle('active', idx < activeCount);
  });
}

let densityNorm = 0.5;
updateDensityIcon(densityNorm);

densityCtrl.style.touchAction = 'none';
densityCtrl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const updateFromEvent = (ev) => {
    const rect = densityCtrl.getBoundingClientRect();
    densityNorm = THREE.MathUtils.clamp((ev.clientX - rect.left) / rect.width, 0.05, 1);
    updateDensityIcon(densityNorm);
    state.columnLayers = Math.round(12 + densityNorm * 80);
    rebuildScene(false);
  };
  updateFromEvent(e);
  const onUp = () => {
    window.removeEventListener('pointermove', updateFromEvent);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };
  window.addEventListener('pointermove', updateFromEvent);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
});

const thicknessCtrl = document.getElementById('thickness-control');
const cubeSideR = document.getElementById('cube-side-r');
const cubeSideB = document.getElementById('cube-side-b');

function updateThicknessIcon(norm) {
  const depth = 2 + norm * 16;
  const dx = depth;
  const dy = depth * 0.72;
  cubeSideR.setAttribute('points', `48,14 ${48 + dx},${14 + dy} ${48 + dx},${52 + dy} 48,52`);
  cubeSideB.setAttribute('points', `10,52 48,52 ${48 + dx},${52 + dy} ${10 + dx},${52 + dy}`);
}

let thicknessNorm = 0.28;
updateThicknessIcon(thicknessNorm);

thicknessCtrl.style.touchAction = 'none';
thicknessCtrl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const startX = e.clientX;
  const startNorm = thicknessNorm;

  const onMove = (ev) => {
    thicknessNorm = THREE.MathUtils.clamp(startNorm + (ev.clientX - startX) / 70, 0.02, 1);
    updateThicknessIcon(thicknessNorm);
    state.sheetThickness = 0.015 + thicknessNorm * 0.44;
    rebuildScene(false);
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
});

// --- Toggle Dark Mode & Modalità Senza Colori (Alto a Sinistra Viewport) ---
const btnDarkMode = document.getElementById('btn-dark-mode');
const btnMonoMode = document.getElementById('btn-mono-mode');

btnDarkMode.addEventListener('click', () => {
  state.darkMode = !state.darkMode;
  btnDarkMode.classList.toggle('active', state.darkMode);
  document.body.classList.toggle('dark-mode', state.darkMode);
  syncThemeTo3D();
  renderColumnsUI();
  renderDialsUI();
});

btnMonoMode.addEventListener('click', () => {
  state.monoMode = !state.monoMode;
  btnMonoMode.classList.toggle('active', state.monoMode);
  document.body.classList.toggle('mono-mode', state.monoMode);
  renderColumnsUI();
  renderDialsUI();
});

// --- Caricamento Font & Eventi Testo/Export ---
const statusBadge = document.getElementById('status-badge');

function setLoadedFont(font, label) {
  glyphCache.clear();
  clearWordMeshCache();
  currentFont = font;
  statusBadge.textContent = label || 'Pronto';
  renderColumnsUI();
  renderDialsUI();
  rebuildScene(false);
}

function loadFontFromUrl(url) {
  statusBadge.textContent = 'Caricamento...';
  window.opentype.load(url, (err, font) => {
    if (err || !font) {
      statusBadge.textContent = 'Errore font';
      return;
    }
    setLoadedFont(font, 'Pronto');
  });
}

document.querySelectorAll('.font-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.font-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const idx = parseInt(btn.dataset.font, 10);
    loadFontFromUrl(FONT_PRESETS[idx]);
  });
});

document.getElementById('font-upload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      document.querySelectorAll('.font-btn').forEach((b) => b.classList.remove('active'));
      setLoadedFont(window.opentype.parse(reader.result), file.name.slice(0, 12));
    } catch {
      statusBadge.textContent = 'Font non valido';
    }
  };
  reader.readAsArrayBuffer(file);
});

const textInput = document.getElementById('text-input');
textInput.addEventListener('input', (e) => {
  const cleaned = sanitizeAndSyncWords(e.target.value);
  if (textInput.value !== cleaned) textInput.value = cleaned;
  renderColumnsUI();
  renderDialsUI();
  rebuildScene(false);
});

document.getElementById('btn-export').addEventListener('click', () => {
  renderer.render(scene, camera);
  const link = document.createElement('a');
  link.download = `type-columns-${state.text.trim().replace(/\s+/g, '_') || 'export'}.png`;
  link.href = renderer.domElement.toDataURL('image/png');
  link.click();
});

window.addEventListener('resize', () => {
  const aspect = viewport.clientWidth / Math.max(viewport.clientHeight, 1);
  camera.left = (-FRUSTUM_SIZE * aspect) / 2;
  camera.right = (FRUSTUM_SIZE * aspect) / 2;
  camera.top = FRUSTUM_SIZE / 2;
  camera.bottom = -FRUSTUM_SIZE / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
  renderColumnsUI();
  renderDialsUI();
  fitCameraToScene(false);
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();

  navGizmo.quaternion.copy(camera.quaternion).invert();
  navRenderer.render(navScene, navCamera);

  renderer.render(scene, camera);
}

sanitizeAndSyncWords(state.text);
loadFontFromUrl(FONT_PRESETS[0]);
animate();