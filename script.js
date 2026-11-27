import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const MAX_WORDS = 4;
const MAX_LETTERS_PER_WORD = 15;
const FRUSTUM_SIZE = 24;
const MAX_CACHE_ENTRIES = 50;
const DEFAULT_CAM_DIR = new THREE.Vector3(24, 18, 26).normalize();

const FONT_PRESETS = [
  { name: 'GAISYR', url: './Font/ABCGaisyrTrial-Book.otf' },
  { name: 'PLAYFAIR', url: 'https://cdn.jsdelivr.net/npm/@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff' },
  { name: 'INTER', url: 'https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-700-normal.woff' },
  { name: 'SPACE MONO', url: 'https://cdn.jsdelivr.net/npm/@fontsource/space-mono/files/space-mono-latin-700-normal.woff' },
];

const I18N = {
  it: {
    uploadFont: 'UPLOAD FONT',
    placeholder: 'SCRIVI QUI',
    height: 'ALTEZZA',
    width: 'LARGHEZZA',
    rotation: 'TORSIONE',
    entasi: 'RIGONFIAMENTO',
    density: 'DENSITÀ',
    thickness: 'SPESSORE',
    distance: 'DISTANZA',
    resetGlobal: 'RESETTA GLOBALE',
    selectColumn: 'SELEZIONA COLONNA',
    editColumn: 'MODIFICA COLONNA',
    resetColumn: 'RESETTA FORMA',
    night: 'NOTTE',
    day: 'GIORNO',
    langSwitch: 'ENG',
    downloadPng: 'DOWNLOAD PNG',
    downloadPdf: 'DOWNLOAD PDF',
    customPngTitle: 'DIMENSIONI PNG (PX)',
    screen: 'SCHERMO',
    exportHqPng: 'ESPORTA PNG HQ',
    navTitle: 'TRASCINA PER RUOTARE • DOPPIO CLICK PER RESET',
    pdfPhrase: 'FRASE',
    pdfParams: 'PARAMETRI GLOBALI',
    pdfColumns: 'MODIFICHE COLONNE',
    pdfNone: 'NESSUNA MODIFICA SINGOLA',
  },
  en: {
    uploadFont: 'UPLOAD FONT',
    placeholder: 'TYPE HERE',
    height: 'HEIGHT',
    width: 'WIDTH',
    rotation: 'TORSION',
    entasi: 'BULGE',
    density: 'DENSITY',
    thickness: 'THICKNESS',
    distance: 'DISTANCE',
    resetGlobal: 'RESET GLOBAL',
    selectColumn: 'SELECT COLUMN',
    editColumn: 'EDIT COLUMN',
    resetColumn: 'RESET SHAPE',
    night: 'NIGHT',
    day: 'DAY',
    langSwitch: 'ITA',
    downloadPng: 'DOWNLOAD PNG',
    downloadPdf: 'DOWNLOAD PDF',
    customPngTitle: 'PNG DIMENSIONS (PX)',
    screen: 'SCREEN',
    exportHqPng: 'EXPORT HQ PNG',
    navTitle: 'DRAG TO ORBIT • DOUBLE CLICK TO RESET',
    pdfPhrase: 'PHRASE',
    pdfParams: 'GLOBAL PARAMETERS',
    pdfColumns: 'COLUMN OVERRIDES',
    pdfNone: 'NO INDIVIDUAL OVERRIDES',
  },
};

const SLIDER_KEYS = ['height', 'width', 'rotation', 'entasi', 'density', 'thickness', 'distance'];
const createDefaultSliders = () => Object.fromEntries(SLIDER_KEYS.map((key) => [key, 0.5]));

const state = {
  lang: 'it',
  darkMode: false,
  fontName: 'GAISYR',
  text: 'COLUMN\nSTUDIO\nTYPE',
  words: [], // [{ text, letters: [{ char, h, w }] }]
  selectedColIdx: null,
  selectedSegmentIdx: null,
  sliders: createDefaultSliders(),
};

let currentFont = null;
const customFonts = [];
const glyphCache = new Map();
const wordMeshCache = new Map();
const columnCircleEls = [];
let cameraFocusAnim = null; // { startTheta, targetTheta, startTime, duration }

// --- Parametri 3D (Valore Neutro al 50%, Massimi Ridotti per Densità e Spessore) ---
function getComputedParams() {
  const s = state.sliders;
  return {
    heightScale: 0.3 + s.height * 1.4,            // 0.5 -> 1.00
    widthScale: 0.35 + s.width * 1.3,             // 0.5 -> 1.00
    rotationDeg: (s.rotation - 0.5) * 360,        // 0.5 -> 0°
    entasi: (s.entasi - 0.5) * 1.3,               // 0.5 -> 0.00
    sheetsPerUnit: 2.0 + s.density * 8.0,         // 0.5 -> 6.0 fogli/unità, max 10.0
    sheetThickness: 0.015 + s.thickness * 0.21,   // 0.5 -> 0.12, max 0.225
    clusterSpacing: s.distance * 10.0,            // 0.5 -> 5.0
  };
}

// --- Traduzione ITA / ENG ---
function applyLanguage() {
  const dict = I18N[state.lang];
  document.documentElement.lang = state.lang;

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    el.textContent = key === 'night' ? (state.darkMode ? dict.day : dict.night) : dict[key];
  });

  document.getElementById('text-input').placeholder = dict.placeholder;
  document.getElementById('btn-lang-toggle').textContent = dict.langSwitch;
  document.getElementById('nav-sphere-wrap').title = dict.navTitle;
}

// --- Setup Three.js (Viewport Smarginato Full-Bleed) ---
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
controls.addEventListener('start', () => {
  cameraFocusAnim = null;
});

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

// --- Setup Navigatore 3D Trasparente (Filetti Sottili & Sfere Ingrandite) ---
const navCanvas = document.getElementById('nav-sphere-canvas');
const navRenderer = new THREE.WebGLRenderer({ canvas: navCanvas, antialias: true, alpha: true });
navRenderer.setClearColor(0x000000, 0);
navRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
navRenderer.setSize(114, 114);

const navScene = new THREE.Scene();
const navCamera = new THREE.OrthographicCamera(-1.32, 1.32, 1.32, -1.32, 0.1, 20);
navCamera.position.set(0, 0, 5);

const navGizmo = new THREE.Group();
navScene.add(navGizmo);

const navHairlineMat = new THREE.LineBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.72,
});
const navRingMat = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.78,
});
navScene.add(new THREE.Mesh(new THREE.RingGeometry(0.982, 0.993, 96), navRingMat));

function makeCircleLine(axis, radius = 0.986) {
  const pts = [];
  for (let i = 0; i <= 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    if (axis === 'xz') pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    if (axis === 'xy') pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
    if (axis === 'yz') pts.push(new THREE.Vector3(0, Math.cos(a) * radius, Math.sin(a) * radius));
  }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), navHairlineMat);
}

navGizmo.add(makeCircleLine('xz'), makeCircleLine('xy'), makeCircleLine('yz'));

const axesLinesGeo = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(-0.98, 0, 0), new THREE.Vector3(0.98, 0, 0),
  new THREE.Vector3(0, -0.98, 0), new THREE.Vector3(0, 0.98, 0),
  new THREE.Vector3(0, 0, -0.98), new THREE.Vector3(0, 0, 0.98),
]);
navGizmo.add(new THREE.LineSegments(axesLinesGeo, navHairlineMat));

const axisDotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const dotGeo = new THREE.SphereGeometry(0.115, 20, 20);
[
  [0.985, 0, 0], [-0.985, 0, 0],
  [0, 0.985, 0], [0, -0.985, 0],
  [0, 0, 0.985], [0, 0, -0.985],
].forEach(([x, y, z]) => {
  const m = new THREE.Mesh(dotGeo, axisDotMat);
  m.position.set(x, y, z);
  navGizmo.add(m);
});

function syncThemeTo3D() {
  const dark = state.darkMode;
  const bgHex = dark ? 0x000000 : 0xffffff;
  const fgHex = dark ? 0xffffff : 0x000000;

  scene.background.set(bgHex);
  fillMaterial.color.set(bgHex);
  strokeMaterial.color.set(fgHex);
}

const navWrap = document.getElementById('nav-sphere-wrap');
navWrap.style.touchAction = 'none';
navWrap.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  cameraFocusAnim = null;
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

navWrap.addEventListener('dblclick', () => {
  cameraFocusAnim = null;
  fitCameraToScene(true);
});

// --- Rotazione Fluida della Camera per Portare la Colonna Selezionata di Fronte ---
function focusCameraOnColumn(wIdx) {
  const n = state.words.length;
  if (n === 0 || wIdx === null || wIdx < 0 || wIdx >= n) return;

  const colTheta = n === 1 ? Math.PI * 0.5 : Math.PI * 0.5 + (wIdx / n) * Math.PI * 2;
  const desiredSphTheta = Math.atan2(Math.cos(colTheta), Math.sin(colTheta));

  const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
  const sph = new THREE.Spherical().setFromVector3(offset);

  let delta = desiredSphTheta - sph.theta;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;

  cameraFocusAnim = {
    startTheta: sph.theta,
    targetTheta: sph.theta + delta,
    startTime: performance.now(),
    duration: 360,
  };
}

function stepCameraFocusAnim(nowMs) {
  if (!cameraFocusAnim) return;
  const elapsed = nowMs - cameraFocusAnim.startTime;
  const t = THREE.MathUtils.clamp(elapsed / cameraFocusAnim.duration, 0, 1);
  const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
  const sph = new THREE.Spherical().setFromVector3(offset);
  sph.theta = cameraFocusAnim.startTheta + (cameraFocusAnim.targetTheta - cameraFocusAnim.startTheta) * eased;
  offset.setFromSpherical(sph);
  camera.position.copy(controls.target).add(offset);
  camera.lookAt(controls.target);

  if (t >= 1) cameraFocusAnim = null;
}

// --- Formattazione Testo in Epigrafe (Max 4 Parole, Solo Maiuscolo, No Doppio A Capo) ---
const distanceSliderItem = document.getElementById('slider-distance-item');

function updateDistanceSliderVisibility() {
  distanceSliderItem.hidden = state.words.length <= 1;
}

function formatEpigraphText(rawText) {
  const normalized = rawText
    .toUpperCase()
    .replace(/[ \t\r]+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/^\n+/, '');

  const rawLines = normalized.split('\n');
  const lines = [];
  const validWords = [];

  for (let i = 0; i < rawLines.length; i++) {
    const token = rawLines[i];
    if (token.length === 0) {
      if (i === rawLines.length - 1 && validWords.length > 0 && validWords.length < MAX_WORDS) {
        lines.push('');
      }
      continue;
    }
    if (validWords.length >= MAX_WORDS) break;
    const clipped = Array.from(token).slice(0, MAX_LETTERS_PER_WORD).join('');
    validWords.push(clipped);
    lines.push(clipped);
  }

  state.text = lines.join('\n');

  const prevWords = state.words;
  state.words = validWords.map((wordStr, wIdx) => {
    const prevWord = prevWords[wIdx];
    const letters = Array.from(wordStr).map((ch, lIdx) => {
      const prevLetter = prevWord?.letters[lIdx];
      return {
        char: ch,
        h: prevLetter ? prevLetter.h : 1.0,
        w: prevLetter ? prevLetter.w : 1.0,
      };
    });
    return { text: wordStr, letters };
  });

  if (state.selectedColIdx !== null && state.selectedColIdx >= state.words.length) {
    state.selectedColIdx = null;
    state.selectedSegmentIdx = null;
  } else if (
    state.selectedColIdx !== null &&
    state.selectedSegmentIdx !== null &&
    state.selectedSegmentIdx >= state.words[state.selectedColIdx].letters.length
  ) {
    state.selectedSegmentIdx = null;
  }

  updateDistanceSliderVisibility();
  return state.text;
}

// --- Centratura & Margine Automatico Viewport 3D ---
function fitCameraToScene(resetAngle = false, customAspect = null) {
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
  const aspect = customAspect ?? (viewport.clientWidth / Math.max(viewport.clientHeight, 1));
  const marginFill = 0.74;

  camera.zoom = Math.min(
    (FRUSTUM_SIZE * aspect * marginFill) / viewW,
    (FRUSTUM_SIZE * marginFill) / viewH
  );
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

function buildDualStrokeGeometry(shapes, width, thickness, curveDiv = 10) {
  if (width <= 0.0005 || shapes.length === 0) return new THREE.BufferGeometry();

  const positions = [];
  const indices = [];
  const hw = width * 0.5;
  let offset = 0;

  const contours = [];
  for (const shape of shapes) {
    contours.push(shape.getPoints(curveDiv));
    for (const hole of shape.holes) contours.push(hole.getPoints(curveDiv));
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

  if (THREE.ShapeUtils.area(pts.map((p) => new THREE.Vector2(p.x, p.y))) < 0) pts.reverse();

  let topIdx = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].y > pts[topIdx].y || (pts[i].y === pts[topIdx].y && pts[i].x < pts[topIdx].x)) {
      topIdx = i;
    }
  }
  return [...pts.slice(topIdx), ...pts.slice(0, topIdx)];
}

function getGlyphData(char, ringSamples = 96) {
  const key = `${char}#${ringSamples}`;
  if (glyphCache.has(key)) return glyphCache.get(key);

  const glyph = currentFont.charToGlyph(char);
  const shapes = opentypePathToShapes(glyph.getPath(0, 0, 5.0));

  if (shapes.length === 0) {
    const empty = { char, shapes: [], center: new THREE.Vector2(), morphSolids: [], morphHoles: [] };
    glyphCache.set(key, empty);
    return empty;
  }

  const measureGeo = new THREE.ShapeGeometry(shapes, 12);
  measureGeo.computeBoundingBox();
  const center = new THREE.Vector2();
  measureGeo.boundingBox.getCenter(center);
  measureGeo.dispose();

  const morphSolids = [];
  const morphHoles = [];
  for (const s of shapes) {
    const sampledSolid = resampleClosedContour(s, center, ringSamples);
    if (sampledSolid) morphSolids.push(sampledSolid);
    for (const h of s.holes) {
      const sampledHole = resampleClosedContour(h, center, ringSamples);
      if (sampledHole) morphHoles.push(sampledHole);
    }
  }

  const data = { char, shapes, center, morphSolids, morphHoles };
  glyphCache.set(key, data);
  return data;
}

function makeCollapsedRing(cx, cy, ringSamples, radius = 0.002) {
  return Array.from({ length: ringSamples }, (_, i) => {
    const a = (i / ringSamples) * Math.PI * 2;
    return { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius };
  });
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
  wordMeshCache.forEach(disposeSlices);
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

function getWordSlices(validLetters, layers, totalHeightWeight, sheetThickness, highQuality = false) {
  const ringSamples = highQuality ? 192 : 96;
  const curveSeg = highQuality ? 18 : 8;
  const strokeDiv = highQuality ? 18 : 10;

  const wordKey = validLetters.map((l) => `${l.glyph.char}:${(l.h / totalHeightWeight).toFixed(3)}`).join('|');
  const cacheKey = `${wordKey}#${layers}#${sheetThickness.toFixed(3)}#${highQuality ? 'HQ' : 'SD'}`;
  if (wordMeshCache.has(cacheKey)) return wordMeshCache.get(cacheKey);

  const strokeW = 0.075;

  if (validLetters.length === 1) {
    const g = validLetters[0].glyph;
    const bodyGeo = buildSheetBodyGeometry(g.shapes, sheetThickness, curveSeg);
    bodyGeo.translate(-g.center.x, -g.center.y, 0);
    const strokeGeo = buildDualStrokeGeometry(g.shapes, strokeW, sheetThickness, strokeDiv);
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
    const solids = Array.from({ length: maxSolids }, (_, s) =>
      g.morphSolids[s] || makeCollapsedRing(0, 0, ringSamples, 0.003)
    );
    const holes = Array.from({ length: maxHoles }, (_, h) => {
      if (g.morphHoles[h]) return g.morphHoles[h];
      const refHole = validLetters.find((other) => other.glyph.morphHoles[h])?.glyph.morphHoles[h];
      const c = refHole ? getContourCentroid(refHole) : { x: 0, y: 0 };
      return makeCollapsedRing(c.x, c.y, ringSamples, 0.002);
    });
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

    let idx0 = 0, idx1 = 0, alpha = 0;
    if (topDown <= centers[0]) {
      idx0 = idx1 = 0;
    } else if (topDown >= centers[centers.length - 1]) {
      idx0 = idx1 = centers.length - 1;
    } else {
      for (let k = 0; k < centers.length - 1; k++) {
        if (topDown >= centers[k] && topDown <= centers[k + 1]) {
          idx0 = k;
          idx1 = k + 1;
          const rawA = (topDown - centers[k]) / Math.max(centers[k + 1] - centers[k], 1e-5);
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
      for (let k = 0; k < ringSamples; k++) {
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
            for (let k = 0; k < ringSamples; k++) {
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

    slices.push({
      bodyGeo: shapes.length > 0 ? buildSheetBodyGeometry(shapes, sheetThickness, 1) : null,
      strokeGeo: shapes.length > 0 ? buildDualStrokeGeometry(shapes, strokeW, sheetThickness, 1) : null,
    });
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
      const rawA = (topDown - centers[k]) / Math.max(centers[k + 1] - centers[k], 1e-5);
      const alpha = rawA * rawA * (3 - 2 * rawA);
      return validLetters[k].w + (validLetters[k + 1].w - validLetters[k].w) * alpha;
    }
  }
  return 1.0;
}

// --- Costruzione Scena 3D ---
function rebuildScene({ resetAngle = false, fit = false, highQuality = false } = {}) {
  while (rootGroup.children.length > 0) {
    rootGroup.remove(rootGroup.children[0]);
  }
  if (!currentFont) return;

  const ringSamples = highQuality ? 192 : 96;
  const activeColumns = state.words
    .map((wordObj) => ({
      wordObj,
      validLetters: wordObj.letters
        .map((l) => ({ ...l, glyph: getGlyphData(l.char, ringSamples) }))
        .filter((l) => l.glyph.shapes.length > 0),
    }))
    .filter((item) => item.validLetters.length > 0);

  const n = activeColumns.length;
  if (n === 0) return;

  const p = getComputedParams();
  const unitHeight = 1.35 * p.heightScale;
  const baseScale = 0.78 * p.widthScale;
  const twistRad = THREE.MathUtils.degToRad(p.rotationDeg);

  const maxWidthWeight = Math.max(1.0, ...activeColumns.flatMap((c) => c.validLetters.map((l) => l.w)));
  const maxEntasi = 1.0 + Math.max(0, p.entasi);
  const colFootprint = 2.4 * baseScale * maxWidthWeight * maxEntasi;
  const chord = colFootprint * 2 + p.clusterSpacing;
  const ringRadius = n === 1 ? 0 : chord / (2 * Math.sin(Math.PI / n));

  const bodyMat = [fillMaterial, strokeMaterial];
  const dummy = new THREE.Object3D();

  activeColumns.forEach((col, idx) => {
    const theta = n === 1 ? Math.PI * 0.5 : Math.PI * 0.5 + (idx / n) * Math.PI * 2;
    const cx = n === 1 ? 0 : Math.cos(theta) * ringRadius;
    const cz = n === 1 ? 0 : Math.sin(theta) * ringRadius;
    const baseYaw = n === 1 ? 0 : Math.PI * 0.5 - theta;

    const totalHWeight = col.validLetters.reduce((sum, l) => sum + l.h, 0);
    const colHeight = totalHWeight * unitHeight;

    const colLayers = THREE.MathUtils.clamp(Math.round(colHeight * p.sheetsPerUnit) + 1, 3, 120);
    const slices = getWordSlices(col.validLetters, colLayers, totalHWeight, p.sheetThickness, highQuality);

    for (let i = 0; i < colLayers; i++) {
      const slice = slices[i];
      if (!slice || (!slice.bodyGeo && !slice.strokeGeo)) continue;

      const t = colLayers > 1 ? i / (colLayers - 1) : 1;
      const topDown = 1 - t;
      const y = t * colHeight + p.sheetThickness * 0.5 + 0.002;

      const wWeight = sampleLetterWidthAt(col.validLetters, totalHWeight, topDown);
      const entasiMul = 1.0 + p.entasi * Math.sin(Math.PI * t);
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

  if (fit) {
    fitCameraToScene(resetAngle);
  }
}

// --- Render Alta Qualità Presenvando Angolazione e Zoom Correnti della Viewport ---
function renderHighQualityDataURL(targetW, targetH, autoFitForSheet = false) {
  const maxTexSize = renderer.capabilities.maxTextureSize || 4096;
  const safeW = THREE.MathUtils.clamp(Math.round(targetW), 200, Math.min(6000, maxTexSize));
  const safeH = THREE.MathUtils.clamp(Math.round(targetH), 200, Math.min(6000, maxTexSize));
  const exportAspect = safeW / safeH;

  const prevW = viewport.clientWidth;
  const prevH = Math.max(viewport.clientHeight, 1);
  const prevPixelRatio = renderer.getPixelRatio();
  const prevZoom = camera.zoom;
  const prevPos = camera.position.clone();
  const prevTarget = controls.target.clone();

  // Ricostruisce con suddivisione curve ad alta precisione senza resettare angolo o zoom
  rebuildScene({ resetAngle: false, fit: false, highQuality: true });

  if (autoFitForSheet) {
    fitCameraToScene(false, exportAspect);
  }

  camera.left = (-FRUSTUM_SIZE * exportAspect) / 2;
  camera.right = (FRUSTUM_SIZE * exportAspect) / 2;
  camera.top = FRUSTUM_SIZE / 2;
  camera.bottom = -FRUSTUM_SIZE / 2;
  camera.updateProjectionMatrix();

  renderer.setPixelRatio(1);
  renderer.setSize(safeW, safeH, false);
  renderer.render(scene, camera);

  const dataURL = renderer.domElement.toDataURL('image/png');

  // Ripristina esattamente lo stato interattivo della viewport
  const restoreAspect = prevW / prevH;
  camera.left = (-FRUSTUM_SIZE * restoreAspect) / 2;
  camera.right = (FRUSTUM_SIZE * restoreAspect) / 2;
  camera.top = FRUSTUM_SIZE / 2;
  camera.bottom = -FRUSTUM_SIZE / 2;
  camera.zoom = prevZoom;
  camera.position.copy(prevPos);
  controls.target.copy(prevTarget);
  camera.updateProjectionMatrix();
  controls.update();

  renderer.setPixelRatio(prevPixelRatio);
  renderer.setSize(prevW, prevH, false);
  rebuildScene({ resetAngle: false, fit: false, highQuality: false });
  renderer.render(scene, camera);

  return dataURL;
}

// --- Disegno Testo Vettoriale su PDF usando il Font Attivo ---
function drawFontTextOnPDF(doc, text, x, y, fontSizePt, align = 'left') {
  if (!currentFont || !text) {
    doc.text(text, x, y, { align });
    return;
  }

  const sizeMm = fontSizePt * 0.352778;
  const totalWidth = currentFont.getAdvanceWidth(text, sizeMm);
  let drawX = x;
  if (align === 'center') drawX = x - totalWidth * 0.5;
  else if (align === 'right') drawX = x - totalWidth;

  const path = currentFont.getPath(text, drawX, y, sizeMm);
  let cx = 0;
  let cy = 0;
  let hasSegments = false;

  for (const cmd of path.commands) {
    if (cmd.type === 'M') {
      doc.moveTo(cmd.x, cmd.y);
      cx = cmd.x;
      cy = cmd.y;
      hasSegments = true;
    } else if (cmd.type === 'L') {
      doc.lineTo(cmd.x, cmd.y);
      cx = cmd.x;
      cy = cmd.y;
    } else if (cmd.type === 'C') {
      doc.curveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
      cx = cmd.x;
      cy = cmd.y;
    } else if (cmd.type === 'Q') {
      const c1x = cx + (2 / 3) * (cmd.x1 - cx);
      const c1y = cy + (2 / 3) * (cmd.y1 - cy);
      const c2x = cmd.x + (2 / 3) * (cmd.x1 - cmd.x);
      const c2y = cmd.y + (2 / 3) * (cmd.y1 - cmd.y);
      doc.curveTo(c1x, c1y, c2x, c2y, cmd.x, cmd.y);
      cx = cmd.x;
      cy = cmd.y;
    } else if (cmd.type === 'Z') {
      doc.close();
    }
  }

  if (hasSegments) {
    doc.fill();
  }
}

// --- Generazione PDF A4 ---
function exportA4PDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) return;
  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210;
  const pageH = 297;
  const margin = 16;
  const contentW = pageW - margin * 2;

  const isDark = state.darkMode;
  const bgRgb = isDark ? [0, 0, 0] : [255, 255, 255];
  const fgRgb = isDark ? [255, 255, 255] : [17, 17, 17];

  doc.setFillColor(...bgRgb);
  doc.rect(0, 0, pageW, pageH, 'F');
  doc.setFillColor(...fgRgb);
  doc.setDrawColor(...fgRgb);
  doc.setLineWidth(0.28);

  drawFontTextOnPDF(doc, 'ARCHTYPE', margin, 22, 18, 'left');
  drawFontTextOnPDF(doc, `FONT: ${state.fontName}`, pageW - margin, 22, 10, 'right');
  doc.line(margin, 26, pageW - margin, 26);

  const imgData = renderHighQualityDataURL(2400, 2180, true);
  doc.addImage(imgData, 'PNG', margin, 29, contentW, 160);

  const specTop = 193;
  doc.line(margin, specTop, pageW - margin, specTop);

  const dict = I18N[state.lang];
  const p = getComputedParams();
  const s = state.sliders;

  let leftY = specTop + 8;
  drawFontTextOnPDF(doc, dict.pdfPhrase, margin, leftY, 9.5, 'left');
  leftY += 7;

  const wordsList = state.words.length > 0 ? state.words : [{ text: 'ARCHTYPE', letters: [] }];
  wordsList.forEach((wObj) => {
    drawFontTextOnPDF(doc, wObj.text, margin, leftY, 15, 'left');
    leftY += 6.5;
  });

  leftY += 3;
  drawFontTextOnPDF(doc, dict.pdfColumns, margin, leftY, 9, 'left');
  leftY += 5.5;

  const modifiedCols = state.words.filter((w) =>
    w.letters.some((l) => Math.abs(l.h - 1.0) > 0.02 || Math.abs(l.w - 1.0) > 0.02)
  );

  if (modifiedCols.length === 0) {
    drawFontTextOnPDF(doc, dict.pdfNone, margin, leftY, 8.5, 'left');
  } else {
    modifiedCols.slice(0, 4).forEach((wObj) => {
      const detail = wObj.letters
        .map((l) => `${l.char}[${l.h.toFixed(1)}/${l.w.toFixed(1)}]`)
        .join(' ');
      drawFontTextOnPDF(doc, `${wObj.text}: ${detail}`.slice(0, 48), margin, leftY, 8, 'left');
      leftY += 5;
    });
  }

  const rightColX = pageW * 0.52;
  let rightY = specTop + 8;
  drawFontTextOnPDF(doc, dict.pdfParams, rightColX, rightY, 9.5, 'left');
  rightY += 7;

  const rows = [
    [dict.height, `${p.heightScale.toFixed(2)}X (${Math.round(s.height * 100)}%)`],
    [dict.width, `${p.widthScale.toFixed(2)}X (${Math.round(s.width * 100)}%)`],
    [dict.rotation, `${Math.round(p.rotationDeg)} DEG (${Math.round(s.rotation * 100)}%)`],
    [dict.entasi, `${p.entasi.toFixed(2)} (${Math.round(s.entasi * 100)}%)`],
    [dict.density, `${p.sheetsPerUnit.toFixed(1)} / U (${Math.round(s.density * 100)}%)`],
    [dict.thickness, `${p.sheetThickness.toFixed(3)} (${Math.round(s.thickness * 100)}%)`],
  ];
  if (state.words.length > 1) {
    rows.push([dict.distance, `${p.clusterSpacing.toFixed(1)} (${Math.round(s.distance * 100)}%)`]);
  }

  rows.forEach(([label, val]) => {
    drawFontTextOnPDF(doc, label, rightColX, rightY, 9.5, 'left');
    drawFontTextOnPDF(doc, val, pageW - margin, rightY, 9.5, 'right');
    rightY += 6.2;
  });

  doc.line(margin, pageH - 14, pageW - margin, pageH - 14);
  drawFontTextOnPDF(doc, 'ARCHTYPE — GENERATIVE 3D TYPOGRAPHY', margin, pageH - 9, 8, 'left');
  drawFontTextOnPDF(doc, 'A4 SPECIMEN', pageW - margin, pageH - 9, 8, 'right');

  const slug = state.text.trim().replace(/\s+/g, '_') || 'ARCHTYPE';
  doc.save(`${slug}_A4.pdf`);
}

// --- COLONNA 2: Selettore Colonne Disposte a Cerchio e Sincronizzate col 3D ---
const columnCirclesEl = document.getElementById('column-circles');
const colVisualizerBlock = document.getElementById('col-visualizer-block');
const visualizerBox = document.getElementById('visualizer-box');
const columnEditorSvg = document.getElementById('column-editor-svg');

function renderColumnSelectorCircles() {
  columnCirclesEl.innerHTML = '';
  columnCircleEls.length = 0;

  state.words.forEach((wordObj, wIdx) => {
    const firstChar = Array.from(wordObj.text)[0] || '?';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'col-circle-btn';
    if (state.selectedColIdx === wIdx) btn.classList.add('selected');
    btn.textContent = firstChar;
    btn.title = wordObj.text;

    btn.addEventListener('click', () => {
      const selectingNew = state.selectedColIdx !== wIdx;
      state.selectedColIdx = selectingNew ? wIdx : null;
      state.selectedSegmentIdx = null;

      if (selectingNew) {
        focusCameraOnColumn(wIdx);
      }

      renderColumnSelectorCircles();
      renderColumnVisualizer();
    });

    columnCirclesEl.appendChild(btn);
    columnCircleEls.push(btn);
  });

  updateColumnSelectorOrbit();
}

function updateColumnSelectorOrbit() {
  const n = columnCircleEls.length;
  if (n === 0) return;

  if (n === 1) {
    columnCircleEls[0].style.transform = 'translate(0px, 0px)';
    return;
  }

  camera.updateMatrixWorld();
  const me = camera.matrixWorld.elements;
  let rightX = me[0], rightZ = me[2];
  const rightLen = Math.hypot(rightX, rightZ) || 1;
  rightX /= rightLen;
  rightZ /= rightLen;

  let awayX = camera.position.x - controls.target.x;
  let awayZ = camera.position.z - controls.target.z;
  const awayLen = Math.hypot(awayX, awayZ) || 1;
  awayX /= awayLen;
  awayZ /= awayLen;

  const orbitRadiusPx = 36;

  for (let idx = 0; idx < n; idx++) {
    const theta = Math.PI * 0.5 + (idx / n) * Math.PI * 2;
    const wx = Math.cos(theta);
    const wz = Math.sin(theta);

    const sx = (wx * rightX + wz * rightZ) * orbitRadiusPx;
    const sy = (wx * awayX + wz * awayZ) * orbitRadiusPx;
    columnCircleEls[idx].style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
  }
}

// --- COLONNA 2: Visualizzatore & Editor a Colonna (Nodi XY, Linee Orizzontali Y, Linee Laterali X) ---
function renderColumnVisualizer() {
  columnEditorSvg.innerHTML = '';

  if (state.selectedColIdx === null || !state.words[state.selectedColIdx]) {
    colVisualizerBlock.classList.add('hidden-editor');
    return;
  }

  colVisualizerBlock.classList.remove('hidden-editor');

  const letters = state.words[state.selectedColIdx].letters;
  if (!letters || letters.length === 0) return;

  const boxRect = visualizerBox.getBoundingClientRect();
  const boxW = Math.max(150, Math.floor(boxRect.width));
  const boxH = Math.max(150, Math.floor(boxRect.height));
  columnEditorSvg.setAttribute('viewBox', `0 0 ${boxW} ${boxH}`);

  const fgColor = state.darkMode ? '#ffffff' : '#111111';
  const cx = boxW * 0.5;
  const baselineY = boxH - 12;
  const availH = Math.max(40, baselineY - 14);
  const maxHalfW = Math.max(28, boxW * 0.42);
  const baseHalfW = Math.min(34, maxHalfW * 0.56);

  const m = letters.length;
  const spanWeights =
    m === 1
      ? [letters[0].h]
      : Array.from({ length: m - 1 }, (_, i) => (letters[i].h + letters[i + 1].h) * 0.5);

  const totalSpanWeight = spanWeights.reduce((a, b) => a + b, 0);
  const naturalUnitPx = 34;
  const unitPx =
    totalSpanWeight * naturalUnitPx > availH
      ? availH / Math.max(totalSpanWeight, 0.2)
      : naturalUnitPx;

  const leftEdgePts = [];
  const rightEdgePts = [];

  if (m === 1) {
    const hPx = Math.min(availH, letters[0].h * unitPx);
    const halfW = THREE.MathUtils.clamp(baseHalfW * letters[0].w, 8, maxHalfW);
    leftEdgePts.push({ x: cx - halfW, y: baselineY - hPx, letterIdx: 0 });
    leftEdgePts.push({ x: cx - halfW, y: baselineY, letterIdx: 0 });
    rightEdgePts.push({ x: cx + halfW, y: baselineY - hPx, letterIdx: 0 });
    rightEdgePts.push({ x: cx + halfW, y: baselineY, letterIdx: 0 });
  } else {
    let currY = baselineY;
    const rungs = new Array(m);
    for (let i = m - 1; i >= 0; i--) {
      const halfW = THREE.MathUtils.clamp(baseHalfW * letters[i].w, 8, maxHalfW);
      rungs[i] = { xL: cx - halfW, xR: cx + halfW, y: currY, letterIdx: i };
      if (i > 0) currY -= spanWeights[i - 1] * unitPx;
    }
    for (const r of rungs) {
      leftEdgePts.push({ x: r.xL, y: r.y, letterIdx: r.letterIdx });
      rightEdgePts.push({ x: r.xR, y: r.y, letterIdx: r.letterIdx });
    }
  }

  const makeSvgEl = (tag, attrs) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };

  // Linea di base inferiore
  const baseLineSpan = Math.min(boxW * 0.46, maxHalfW + 18);
  columnEditorSvg.appendChild(
    makeSvgEl('line', {
      x1: cx - baseLineSpan,
      x2: cx + baseLineSpan,
      y1: baselineY,
      y2: baselineY,
      stroke: fgColor,
      'stroke-width': '1',
    })
  );

  // Segmenti laterali (verticali o inclinati): traslano solo in X (destra/sinistra)
  for (let sIdx = 0; sIdx < leftEdgePts.length - 1; sIdx++) {
    const affectedIndices =
      m === 1 ? [0] : [leftEdgePts[sIdx].letterIdx, leftEdgePts[sIdx + 1].letterIdx];

    [
      { p0: leftEdgePts[sIdx], p1: leftEdgePts[sIdx + 1], sideSign: -1 },
      { p0: rightEdgePts[sIdx], p1: rightEdgePts[sIdx + 1], sideSign: 1 },
    ].forEach(({ p0, p1, sideSign }) => {
      const vGroup = makeSvgEl('g', { class: 'col-v-line-group' });
      vGroup.appendChild(
        makeSvgEl('line', {
          x1: p0.x,
          y1: p0.y,
          x2: p1.x,
          y2: p1.y,
          stroke: 'transparent',
          'stroke-width': '12',
        })
      );
      vGroup.appendChild(
        makeSvgEl('line', {
          class: 'col-line-visible',
          x1: p0.x,
          y1: p0.y,
          x2: p1.x,
          y2: p1.y,
          'stroke-width': '1',
        })
      );
      attachSideLineHorizontalDrag(vGroup, affectedIndices, sideSign, baseHalfW);
      columnEditorSvg.appendChild(vGroup);
    });
  }

  // Linee orizzontali: traslano solo in Y (su/giù)
  for (let idx = 0; idx < leftEdgePts.length; idx++) {
    const lp = leftEdgePts[idx];
    const rp = rightEdgePts[idx];
    const lIdx = lp.letterIdx;
    const isSelected = state.selectedSegmentIdx === lIdx;

    const hGroup = makeSvgEl('g', { class: 'col-h-line-group' });
    hGroup.appendChild(
      makeSvgEl('line', {
        x1: lp.x,
        x2: rp.x,
        y1: lp.y,
        y2: rp.y,
        stroke: 'transparent',
        'stroke-width': '12',
      })
    );
    hGroup.appendChild(
      makeSvgEl('line', {
        class: 'col-line-visible',
        x1: lp.x,
        x2: rp.x,
        y1: lp.y,
        y2: rp.y,
        'stroke-width': isSelected ? '1.6' : '1',
      })
    );
    attachRungVerticalDrag(hGroup, lIdx, unitPx);
    columnEditorSvg.appendChild(hGroup);
  }

  // Nodi circolari agli estremi: traslano sia in X che in Y
  for (let idx = 0; idx < leftEdgePts.length; idx++) {
    const lp = leftEdgePts[idx];
    const rp = rightEdgePts[idx];
    const lIdx = lp.letterIdx;
    const isSelected = state.selectedSegmentIdx === lIdx;

    [
      { x: lp.x, y: lp.y, sideSign: -1 },
      { x: rp.x, y: rp.y, sideSign: 1 },
    ].forEach(({ x, y, sideSign }) => {
      const gNode = makeSvgEl('g', {
        class: isSelected ? 'col-node-group selected' : 'col-node-group',
      });
      gNode.appendChild(makeSvgEl('circle', { cx: x, cy: y, r: '11', fill: 'transparent' }));
      gNode.appendChild(makeSvgEl('circle', { class: 'col-node-circle', cx: x, cy: y, r: '4.6' }));
      attachCombinedNodeDrag(gNode, lIdx, sideSign, baseHalfW, unitPx);
      columnEditorSvg.appendChild(gNode);
    });
  }
}

// Drag 2D sui punti (X + Y)
function attachCombinedNodeDrag(el, lIdx, sideSign, baseHalfW, unitPx) {
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();

    const wIdx = state.selectedColIdx;
    if (wIdx === null || !state.words[wIdx]?.letters[lIdx]) return;

    state.selectedSegmentIdx = lIdx;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = state.words[wIdx].letters[lIdx].w;
    const startH = state.words[wIdx].letters[lIdx].h;

    const onMove = (ev) => {
      if (state.selectedColIdx !== wIdx || !state.words[wIdx]?.letters[lIdx]) return;

      const dx = (ev.clientX - startX) * sideSign;
      const dyUp = startY - ev.clientY;

      state.words[wIdx].letters[lIdx].w = THREE.MathUtils.clamp(
        startW + dx / Math.max(baseHalfW, 12),
        0.25,
        2.0
      );
      state.words[wIdx].letters[lIdx].h = THREE.MathUtils.clamp(
        startH + dyUp / Math.max(unitPx, 14),
        0.3,
        2.5
      );

      renderColumnVisualizer();
      rebuildScene();
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      renderColumnVisualizer();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

// Drag solo verticale (Y) sulle linee orizzontali
function attachRungVerticalDrag(el, lIdx, unitPx) {
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();

    const wIdx = state.selectedColIdx;
    if (wIdx === null || !state.words[wIdx]?.letters[lIdx]) return;

    state.selectedSegmentIdx = lIdx;
    const startY = e.clientY;
    const startH = state.words[wIdx].letters[lIdx].h;

    const onMove = (ev) => {
      if (state.selectedColIdx !== wIdx || !state.words[wIdx]?.letters[lIdx]) return;

      const dyUp = startY - ev.clientY;
      state.words[wIdx].letters[lIdx].h = THREE.MathUtils.clamp(
        startH + dyUp / Math.max(unitPx, 14),
        0.3,
        2.5
      );

      renderColumnVisualizer();
      rebuildScene();
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      renderColumnVisualizer();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

// Drag solo orizzontale (X) sulle linee verticali/inclinate
function attachSideLineHorizontalDrag(el, letterIndices, sideSign, baseHalfW) {
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();

    const wIdx = state.selectedColIdx;
    if (wIdx === null || !state.words[wIdx]) return;

    state.selectedSegmentIdx = letterIndices[0];
    const startX = e.clientX;
    const initialWidths = letterIndices.map((idx) => state.words[wIdx].letters[idx].w);

    const onMove = (ev) => {
      if (state.selectedColIdx !== wIdx || !state.words[wIdx]) return;

      const dx = (ev.clientX - startX) * sideSign;
      const deltaW = dx / Math.max(baseHalfW, 12);

      letterIndices.forEach((idx, k) => {
        if (state.words[wIdx].letters[idx]) {
          state.words[wIdx].letters[idx].w = THREE.MathUtils.clamp(
            initialWidths[k] + deltaW,
            0.25,
            2.0
          );
        }
      });

      renderColumnVisualizer();
      rebuildScene();
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      renderColumnVisualizer();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

// --- COLONNA 1: 7 Slider Globali ---
const sliderElements = new Map();

document.querySelectorAll('.slider-item').forEach((item) => {
  const key = item.dataset.key;
  const trackWrap = item.querySelector('.slider-track-wrap');
  const thumb = item.querySelector('.slider-thumb');
  sliderElements.set(key, thumb);

  const updateFromClientX = (clientX) => {
    const rect = trackWrap.getBoundingClientRect();
    const ratio = THREE.MathUtils.clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
    state.sliders[key] = ratio;
    thumb.style.left = `${ratio * 100}%`;
    rebuildScene();
  };

  trackWrap.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    trackWrap.classList.add('dragging');
    updateFromClientX(e.clientX);

    const onMove = (ev) => updateFromClientX(ev.clientX);
    const onUp = () => {
      trackWrap.classList.remove('dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
});

function syncSlidersUI() {
  SLIDER_KEYS.forEach((key) => {
    const thumb = sliderElements.get(key);
    if (thumb) thumb.style.left = `${state.sliders[key] * 100}%`;
  });
}

// --- Pulsanti Resetta Globale & Resetta Forma ---
document.getElementById('btn-reset-global').addEventListener('click', (e) => {
  e.currentTarget.blur();
  state.sliders = createDefaultSliders();
  syncSlidersUI();
  rebuildScene();
});

document.getElementById('btn-reset-column').addEventListener('click', (e) => {
  e.currentTarget.blur();
  if (state.selectedColIdx === null || !state.words[state.selectedColIdx]) return;
  state.words[state.selectedColIdx].letters.forEach((l) => {
    l.h = 1.0;
    l.w = 1.0;
  });
  state.selectedSegmentIdx = null;
  renderColumnVisualizer();
  rebuildScene();
});

// --- Toggle Notte & Lingua ITA / ENG (senza stato evidenziato persistente) ---
document.getElementById('btn-dark-mode').addEventListener('click', (e) => {
  e.currentTarget.blur();
  state.darkMode = !state.darkMode;
  document.body.classList.toggle('dark-mode', state.darkMode);
  syncThemeTo3D();
  applyLanguage();
  renderColumnVisualizer();
});

document.getElementById('btn-lang-toggle').addEventListener('click', (e) => {
  e.currentTarget.blur();
  state.lang = state.lang === 'it' ? 'en' : 'it';
  applyLanguage();
});

// --- Menù Selezione Font Custom (Bordo Nero, Sfondo Bianco, Filetti Divisori) ---
const fontDropdownBtn = document.getElementById('font-dropdown-btn');
const fontDropdownMenu = document.getElementById('font-dropdown-menu');
const fontSelectedLabel = document.getElementById('font-selected-label');

function setLoadedFont(font, name, initialFit = false) {
  glyphCache.clear();
  clearWordMeshCache();
  currentFont = font;
  if (name) {
    state.fontName = name;
    fontSelectedLabel.textContent = name;
  }
  rebuildScene({ fit: initialFit });
}

function loadFontFromUrl(url, name, fallbackPreset = null, initialFit = false) {
  window.opentype.load(url, (err, font) => {
    if (err || !font) {
      if (fallbackPreset) loadFontFromUrl(fallbackPreset.url, fallbackPreset.name, null, initialFit);
      return;
    }
    setLoadedFont(font, name, initialFit);
  });
}

function setActiveFontOption(targetBtn) {
  fontDropdownMenu.querySelectorAll('.font-option').forEach((btn) => {
    btn.classList.toggle('active', btn === targetBtn);
  });
}

fontDropdownBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = !fontDropdownMenu.hidden;
  fontDropdownMenu.hidden = isOpen;
  fontDropdownBtn.setAttribute('aria-expanded', String(!isOpen));
});

fontDropdownMenu.addEventListener('pointerdown', (e) => e.stopPropagation());

fontDropdownMenu.addEventListener('click', (e) => {
  const optBtn = e.target.closest('.font-option');
  if (!optBtn) return;

  setActiveFontOption(optBtn);
  fontDropdownMenu.hidden = true;
  fontDropdownBtn.setAttribute('aria-expanded', 'false');

  if (optBtn.dataset.custom !== undefined) {
    const idx = parseInt(optBtn.dataset.custom, 10);
    if (customFonts[idx]) setLoadedFont(customFonts[idx].font, customFonts[idx].name);
  } else if (optBtn.dataset.preset !== undefined) {
    const idx = parseInt(optBtn.dataset.preset, 10);
    const preset = FONT_PRESETS[idx];
    if (preset) loadFontFromUrl(preset.url, preset.name, FONT_PRESETS[1]);
  }
});

document.getElementById('font-upload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = window.opentype.parse(reader.result);
      const cleanName = file.name.replace(/\.[^/.]+$/, '').toUpperCase().slice(0, 16) || `FONT ${customFonts.length + 1}`;
      const customIdx = customFonts.push({ font: parsed, name: cleanName }) - 1;

      const optBtn = document.createElement('button');
      optBtn.type = 'button';
      optBtn.className = 'font-option';
      optBtn.dataset.custom = String(customIdx);
      optBtn.textContent = cleanName;
      fontDropdownMenu.appendChild(optBtn);

      setActiveFontOption(optBtn);
      setLoadedFont(parsed, cleanName);
    } catch {
      // Font non valido
    }
  };
  reader.readAsArrayBuffer(file);
});

// --- Eventi Box di Testo in Epigrafe ---
const textInput = document.getElementById('text-input');

textInput.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    const val = textInput.value;
    const pos = textInput.selectionStart ?? val.length;
    const end = textInput.selectionEnd ?? pos;
    const before = val.slice(0, pos);
    const after = val.slice(end);

    if (before.length === 0 || before.endsWith('\n') || after.startsWith('\n')) return;
    if (val.split('\n').filter(Boolean).length >= MAX_WORDS) return;

    const cleaned = formatEpigraphText(`${before}\n${after}`);
    textInput.value = cleaned;
    const nextCursor = Math.min(pos + 1, cleaned.length);
    textInput.setSelectionRange(nextCursor, nextCursor);

    renderColumnSelectorCircles();
    renderColumnVisualizer();
    rebuildScene({ fit: true });
  }
});

textInput.addEventListener('input', (e) => {
  const cleaned = formatEpigraphText(e.target.value);
  if (textInput.value !== cleaned) textInput.value = cleaned;
  renderColumnSelectorCircles();
  renderColumnVisualizer();
  rebuildScene({ fit: true });
});

// --- Esportazione PNG (Tagliato in Base allo Zoom e Angolo della Viewport) & PDF A4 ---
const pngPopover = document.getElementById('png-export-popover');
const pngWidthInput = document.getElementById('png-width-input');
const pngHeightInput = document.getElementById('png-height-input');

document.getElementById('btn-toggle-png').addEventListener('click', (e) => {
  e.stopPropagation();
  e.currentTarget.blur();
  pngPopover.hidden = !pngPopover.hidden;
});

pngPopover.addEventListener('pointerdown', (e) => e.stopPropagation());

window.addEventListener('pointerdown', () => {
  if (!pngPopover.hidden) pngPopover.hidden = true;
  if (!fontDropdownMenu.hidden) {
    fontDropdownMenu.hidden = true;
    fontDropdownBtn.setAttribute('aria-expanded', 'false');
  }
});

document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.id === 'btn-preset-screen') {
      pngWidthInput.value = Math.round(viewport.clientWidth * 2);
      pngHeightInput.value = Math.round(viewport.clientHeight * 2);
    } else {
      pngWidthInput.value = btn.dataset.w;
      pngHeightInput.value = btn.dataset.h;
    }
  });
});

document.getElementById('btn-confirm-png').addEventListener('click', () => {
  const w = parseInt(pngWidthInput.value, 10) || 2400;
  const h = parseInt(pngHeightInput.value, 10) || 3000;
  // autoFitForSheet = false -> preserva esattamente angolazione, pan e zoom della viewport
  const dataURL = renderHighQualityDataURL(w, h, false);

  const link = document.createElement('a');
  const slug = state.text.trim().replace(/\s+/g, '_') || 'ARCHTYPE';
  link.download = `${slug}_${w}x${h}.png`;
  link.href = dataURL;
  link.click();
  pngPopover.hidden = true;
});

document.getElementById('btn-export-pdf').addEventListener('click', (e) => {
  e.currentTarget.blur();
  pngPopover.hidden = true;
  exportA4PDF();
});

// --- Resize Responsive ---
window.addEventListener('resize', () => {
  const aspect = viewport.clientWidth / Math.max(viewport.clientHeight, 1);
  camera.left = (-FRUSTUM_SIZE * aspect) / 2;
  camera.right = (FRUSTUM_SIZE * aspect) / 2;
  camera.top = FRUSTUM_SIZE / 2;
  camera.bottom = -FRUSTUM_SIZE / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);

  renderColumnVisualizer();
});

function animate(nowMs = 0) {
  requestAnimationFrame(animate);
  stepCameraFocusAnim(nowMs);
  controls.update();

  updateColumnSelectorOrbit();

  navGizmo.quaternion.copy(camera.quaternion).invert();
  navRenderer.render(navScene, navCamera);
  renderer.render(scene, camera);
}

// --- Avvio ---
formatEpigraphText(state.text);
textInput.value = state.text;
applyLanguage();
syncSlidersUI();
renderColumnSelectorCircles();
renderColumnVisualizer();
loadFontFromUrl(FONT_PRESETS[0].url, FONT_PRESETS[0].name, FONT_PRESETS[1], true);
animate();