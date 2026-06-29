import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';

const DOMAIN = 7;
const SURFACE_OFFSET = 0.035;
const state = {
  amplitude: 1.6,
  frequency: 0.7,
  resolution: 64,
  colorMode: 'distortion',
  wireframe: true,
  mode: 'navigate',
  source: null,
  destination: null,
  obstacles: [],
  draftObstacle: [],
};

const viewport = document.querySelector('#viewport');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x071018, 0.025);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(10.5, 10, 11.5);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 0, 0);
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 5;
controls.maxDistance = 32;

scene.add(new THREE.HemisphereLight(0xbdefff, 0x081018, 2.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
keyLight.position.set(6, 12, 8);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x36d7d0, 1.6);
rimLight.position.set(-9, 3, -7);
scene.add(rimLight);

const root = new THREE.Group();
scene.add(root);
const annotationLayer = new THREE.Group();
scene.add(annotationLayer);

let terrainMesh;
let terrainWire;
let sourceObject;
let destinationObject;
let draftLine;
let obstacleObjects = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerDown = null;

function surfaceHeight(x, y) {
  const { amplitude: a, frequency: f } = state;
  return a * (0.72 * Math.sin(f * x) * Math.cos(f * y) + 0.28 * Math.sin(0.55 * f * x + 0.8) * Math.sin(1.25 * f * y));
}

function derivatives(x, y) {
  const { amplitude: a, frequency: f } = state;
  const fx = a * (0.72 * f * Math.cos(f * x) * Math.cos(f * y) + 0.28 * 0.55 * f * Math.cos(0.55 * f * x + 0.8) * Math.sin(1.25 * f * y));
  const fy = a * (-0.72 * f * Math.sin(f * x) * Math.sin(f * y) + 0.28 * 1.25 * f * Math.sin(0.55 * f * x + 0.8) * Math.cos(1.25 * f * y));
  return { fx, fy };
}

function metricData(x, y) {
  const { fx, fy } = derivatives(x, y);
  return {
    slope: Math.sqrt(fx * fx + fy * fy),
    distortion: Math.sqrt(1 + fx * fx + fy * fy),
  };
}

function colorFor(x, y, z) {
  const metric = metricData(x, y);
  let value;
  if (state.colorMode === 'height') value = THREE.MathUtils.clamp((z / Math.max(state.amplitude, .01) + 1) / 2, 0, 1);
  else if (state.colorMode === 'slope') value = THREE.MathUtils.clamp(metric.slope / 1.8, 0, 1);
  else value = THREE.MathUtils.clamp((metric.distortion - 1) / 1.2, 0, 1);
  const low = new THREE.Color(0x0b4f65);
  const mid = new THREE.Color(0x20b5a8);
  const high = new THREE.Color(0xf3c755);
  return value < .55 ? low.lerp(mid, value / .55) : mid.lerp(high, (value - .55) / .45);
}

function createTerrainGeometry() {
  const n = state.resolution;
  const positions = [];
  const colors = [];
  const indices = [];
  for (let j = 0; j <= n; j += 1) {
    const y = -DOMAIN + (2 * DOMAIN * j) / n;
    for (let i = 0; i <= n; i += 1) {
      const x = -DOMAIN + (2 * DOMAIN * i) / n;
      const z = surfaceHeight(x, y);
      positions.push(x, z, y);
      const color = colorFor(x, y, z);
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + n + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function rebuildTerrain() {
  const geometry = createTerrainGeometry();
  if (terrainMesh) {
    terrainMesh.geometry.dispose();
    terrainWire.geometry.dispose();
    root.remove(terrainMesh, terrainWire);
  }
  terrainMesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .72, metalness: .03, side: THREE.DoubleSide }));
  terrainMesh.name = 'riemannian-surface';
  terrainWire = new THREE.LineSegments(new THREE.WireframeGeometry(geometry), new THREE.LineBasicMaterial({ color: 0xa8d8dc, transparent: true, opacity: .12 }));
  terrainWire.visible = state.wireframe;
  root.add(terrainMesh, terrainWire);
  refreshAnnotations();
  document.querySelector('#triangle-count').textContent = (state.resolution * state.resolution * 2).toLocaleString();
}

function makeLabel(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 72;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(5,13,19,.86)';
  ctx.beginPath();
  ctx.roundRect(8, 8, 144, 52, 18);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 27px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(text, 80, 43);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(1.55, .7, 1);
  return sprite;
}

function markerObject(point, color, label) {
  const group = new THREE.Group();
  const marker = new THREE.Mesh(new THREE.SphereGeometry(.16, 24, 16), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4 }));
  marker.position.y = .12;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, .48, 10), new THREE.MeshBasicMaterial({ color }));
  stem.position.y = .28;
  const sprite = makeLabel(label, `#${new THREE.Color(color).getHexString()}`);
  sprite.position.y = .95;
  group.add(marker, stem, sprite);
  group.position.set(point.x, surfaceHeight(point.x, point.y) + SURFACE_OFFSET, point.y);
  return group;
}

function obstacleMesh(points) {
  const contour = points.map((p) => new THREE.Vector2(p.x, p.y));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  const positions = [];
  points.forEach((p) => positions.push(p.x, surfaceHeight(p.x, p.y) + SURFACE_OFFSET * 2, p.y));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(triangles.flat());
  geometry.computeVertexNormals();
  const fill = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xff5147, emissive: 0x5a0906, emissiveIntensity: .65, transparent: true, opacity: .82, side: THREE.DoubleSide, depthWrite: false }));
  const outlinePoints = [...points, points[0]].map((p) => new THREE.Vector3(p.x, surfaceHeight(p.x, p.y) + SURFACE_OFFSET * 3, p.y));
  const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(outlinePoints), new THREE.LineBasicMaterial({ color: 0xffaaa5, linewidth: 2 }));
  const group = new THREE.Group();
  group.add(fill, outline);
  return group;
}

function updateDraftLine() {
  if (draftLine) {
    annotationLayer.remove(draftLine);
    draftLine.geometry.dispose();
    draftLine.material.dispose();
    draftLine = null;
  }
  if (!state.draftObstacle.length) return;
  const points = state.draftObstacle.map((p) => new THREE.Vector3(p.x, surfaceHeight(p.x, p.y) + SURFACE_OFFSET * 4, p.y));
  draftLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xff8a83 }));
  annotationLayer.add(draftLine);
}

function refreshAnnotations() {
  if (sourceObject) annotationLayer.remove(sourceObject);
  if (destinationObject) annotationLayer.remove(destinationObject);
  obstacleObjects.forEach((obj) => annotationLayer.remove(obj));
  obstacleObjects = [];
  if (state.source) {
    sourceObject = markerObject(state.source, 0x25d0c8, 'SOURCE');
    annotationLayer.add(sourceObject);
  }
  if (state.destination) {
    destinationObject = markerObject(state.destination, 0xffcf5c, 'TARGET');
    annotationLayer.add(destinationObject);
  }
  state.obstacles.forEach((polygon) => {
    const obj = obstacleMesh(polygon);
    obstacleObjects.push(obj);
    annotationLayer.add(obj);
  });
  updateDraftLine();
  updateStatusPanel();
}

function updateStatusPanel() {
  const formatPoint = (p) => p ? `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})` : 'Not placed';
  document.querySelector('#source-status').textContent = formatPoint(state.source);
  document.querySelector('#destination-status').textContent = formatPoint(state.destination);
  document.querySelector('#obstacle-count').textContent = `${state.obstacles.length} polygon${state.obstacles.length === 1 ? '' : 's'}`;
  document.querySelector('#close-polygon').disabled = state.draftObstacle.length < 3;
}

function pointFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(terrainMesh, false)[0];
  if (!hit) return null;
  return { x: hit.point.x, y: hit.point.z };
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.mode-button').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  document.querySelector('#obstacle-actions').classList.toggle('hidden', mode !== 'obstacle');
  controls.enabled = mode === 'navigate';
  renderer.domElement.style.cursor = mode === 'navigate' ? 'grab' : 'crosshair';
  if (mode !== 'obstacle' && state.draftObstacle.length) cancelDraft();
  const messages = {
    navigate: 'Navigation mode: drag to orbit, scroll to zoom, right-drag to pan.',
    source: 'Source mode: click any point on the curved surface.',
    destination: 'Destination mode: click any point on the curved surface.',
    obstacle: 'Obstacle mode: click polygon vertices on the surface, then close the polygon.',
  };
  setStatus(messages[mode]);
}

function setStatus(message) {
  document.querySelector('#status-message').textContent = message;
}

function cancelDraft() {
  state.draftObstacle = [];
  updateDraftLine();
  updateStatusPanel();
}

function closePolygon() {
  if (state.draftObstacle.length < 3) return;
  state.obstacles.push(state.draftObstacle.map((p) => ({ ...p })));
  state.draftObstacle = [];
  refreshAnnotations();
  persist();
  setStatus(`Obstacle ${state.obstacles.length} created. Continue drawing or change mode.`);
}

function handleSurfaceClick(event) {
  if (state.mode === 'navigate') return;
  const point = pointFromEvent(event);
  if (!point) {
    setStatus('No surface selected. Click directly on the terrain.');
    return;
  }
  if (state.mode === 'source') {
    state.source = point;
    refreshAnnotations();
    persist();
    setStatus(`Source placed at (${point.x.toFixed(2)}, ${point.y.toFixed(2)}).`);
  } else if (state.mode === 'destination') {
    state.destination = point;
    refreshAnnotations();
    persist();
    setStatus(`Destination placed at (${point.x.toFixed(2)}, ${point.y.toFixed(2)}).`);
  } else if (state.mode === 'obstacle') {
    state.draftObstacle.push(point);
    updateDraftLine();
    updateStatusPanel();
    setStatus(`Obstacle vertex ${state.draftObstacle.length} added${state.draftObstacle.length >= 3 ? '; close the polygon when ready.' : '.'}`);
  }
}

function scenePayload() {
  return {
    schema: 'riemannian-space-lab/v1',
    surface: { type: 'sinusoidal-height-field', amplitude: state.amplitude, frequency: state.frequency, resolution: state.resolution, domain: DOMAIN },
    visualization: { colorMode: state.colorMode, wireframe: state.wireframe },
    source: state.source,
    destination: state.destination,
    obstacles: state.obstacles,
  };
}

function applyPayload(payload) {
  if (!payload?.surface || payload.schema !== 'riemannian-space-lab/v1') throw new Error('Unsupported scene format');
  state.amplitude = Number(payload.surface.amplitude);
  state.frequency = Number(payload.surface.frequency);
  state.resolution = Number(payload.surface.resolution);
  state.colorMode = payload.visualization?.colorMode || 'distortion';
  state.wireframe = payload.visualization?.wireframe ?? true;
  state.source = payload.source || null;
  state.destination = payload.destination || null;
  state.obstacles = Array.isArray(payload.obstacles) ? payload.obstacles : [];
  state.draftObstacle = [];
  syncControls();
  rebuildTerrain();
  persist();
}

function persist() {
  localStorage.setItem('riemannian-space-lab-scene', JSON.stringify(scenePayload()));
}

function restore() {
  const raw = localStorage.getItem('riemannian-space-lab-scene');
  if (!raw) return false;
  try { applyPayload(JSON.parse(raw)); return true; } catch { return false; }
}

function syncControls() {
  for (const key of ['amplitude', 'frequency', 'resolution']) {
    document.querySelector(`#${key}`).value = state[key];
    document.querySelector(`#${key}-output`).value = key === 'resolution' ? state[key] : state[key].toFixed(2);
  }
  document.querySelector('#color-mode').value = state.colorMode;
  document.querySelector('#wireframe').checked = state.wireframe;
}

function bindUI() {
  document.querySelectorAll('.mode-button').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  for (const key of ['amplitude', 'frequency', 'resolution']) {
    const input = document.querySelector(`#${key}`);
    input.addEventListener('input', () => {
      state[key] = key === 'resolution' ? Number.parseInt(input.value, 10) : Number.parseFloat(input.value);
      document.querySelector(`#${key}-output`).value = key === 'resolution' ? state[key] : state[key].toFixed(2);
      rebuildTerrain();
      persist();
    });
  }
  document.querySelector('#color-mode').addEventListener('change', (event) => { state.colorMode = event.target.value; rebuildTerrain(); persist(); });
  document.querySelector('#wireframe').addEventListener('change', (event) => { state.wireframe = event.target.checked; terrainWire.visible = state.wireframe; persist(); });
  document.querySelector('#close-polygon').addEventListener('click', closePolygon);
  document.querySelector('#cancel-polygon').addEventListener('click', () => { cancelDraft(); setStatus('Draft obstacle cancelled.'); });
  document.querySelector('#undo-obstacle').addEventListener('click', () => {
    if (!state.obstacles.length) return setStatus('There are no completed obstacles to remove.');
    state.obstacles.pop(); refreshAnnotations(); persist(); setStatus('Last obstacle removed.');
  });
  document.querySelector('#clear-all').addEventListener('click', () => {
    state.source = null; state.destination = null; state.obstacles = []; state.draftObstacle = [];
    refreshAnnotations(); persist(); setStatus('Source, destination, and all obstacles cleared.');
  });
  document.querySelector('#export-button').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(scenePayload(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'riemannian-scene.json'; anchor.click(); URL.revokeObjectURL(url);
    setStatus('Scene exported as riemannian-scene.json.');
  });
  document.querySelector('#import-button').addEventListener('click', () => document.querySelector('#import-input').click());
  document.querySelector('#import-input').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { applyPayload(JSON.parse(await file.text())); setStatus(`Imported ${file.name}.`); }
    catch (error) { setStatus(`Import failed: ${error.message}.`); }
    event.target.value = '';
  });
}

renderer.domElement.addEventListener('pointerdown', (event) => { pointerDown = { x: event.clientX, y: event.clientY }; });
renderer.domElement.addEventListener('pointerup', (event) => {
  if (!pointerDown) return;
  const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
  pointerDown = null;
  if (moved < 5 && event.button === 0) handleSurfaceClick(event);
});
renderer.domElement.addEventListener('pointermove', (event) => {
  const point = pointFromEvent(event);
  const readout = document.querySelector('#cursor-readout');
  if (!point) return readout.textContent = 'Move over the surface to inspect coordinates';
  const z = surfaceHeight(point.x, point.y);
  const metric = metricData(point.x, point.y);
  readout.textContent = `x ${point.x.toFixed(2)} · y ${point.y.toFixed(2)} · z ${z.toFixed(2)} · √det(g) ${metric.distortion.toFixed(2)}`;
});

function resize() {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(viewport);

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

bindUI();
syncControls();
if (!restore()) rebuildTerrain();
setMode('navigate');
resize();
animate();
