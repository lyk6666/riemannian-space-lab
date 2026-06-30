import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import { DOMAIN, createTerrainGeometry, metricData, surfaceHeight } from './geometry/surface.js';
import {
  createDraftLine,
  createObstacleObject,
  pointInPolygon,
  pointInsideAnyObstacle,
  validateObstacle,
} from './geometry/obstacles.js';
import { createMarker, disposeObject } from './rendering/markers.js';
import {
  applyPayloadToState,
  createSceneState,
  persistScene,
  restoreScene,
  scenePayload,
} from './state/sceneState.js';

const state = createSceneState();
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

const terrainLayer = new THREE.Group();
const annotationLayer = new THREE.Group();
scene.add(terrainLayer, annotationLayer);

let terrainMesh;
let terrainWire;
let sourceObject;
let destinationObject;
let draftLine;
let obstacleObjects = [];
let pointerDown = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function setStatus(message) {
  document.querySelector('#status-message').textContent = message;
}

function updateStatusPanel() {
  const formatPoint = (point) => point ? `(${point.x.toFixed(2)}, ${point.y.toFixed(2)})` : 'Not placed';
  document.querySelector('#source-status').textContent = formatPoint(state.source);
  document.querySelector('#destination-status').textContent = formatPoint(state.destination);
  document.querySelector('#obstacle-count').textContent = `${state.obstacles.length} polygon${state.obstacles.length === 1 ? '' : 's'}`;
  document.querySelector('#close-polygon').disabled = state.draftObstacle.length < 3;
}

function rebuildTerrain() {
  disposeObject(terrainMesh);
  disposeObject(terrainWire);
  const geometry = createTerrainGeometry(state);
  terrainMesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.03, side: THREE.DoubleSide }),
  );
  terrainMesh.name = 'riemannian-surface';
  terrainWire = new THREE.LineSegments(
    new THREE.WireframeGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0xa8d8dc, transparent: true, opacity: 0.12 }),
  );
  terrainWire.visible = state.wireframe;
  terrainLayer.add(terrainMesh, terrainWire);
  refreshAnnotations();
  document.querySelector('#triangle-count').textContent = (state.resolution * state.resolution * 2).toLocaleString();
}

function updateDraftLine() {
  disposeObject(draftLine);
  draftLine = createDraftLine(state.draftObstacle, state);
  if (draftLine) annotationLayer.add(draftLine);
}

function refreshAnnotations() {
  disposeObject(sourceObject);
  disposeObject(destinationObject);
  obstacleObjects.forEach(disposeObject);
  obstacleObjects = [];
  sourceObject = state.source ? createMarker(state.source, 0x25d0c8, 'SOURCE', state) : null;
  destinationObject = state.destination ? createMarker(state.destination, 0xffcf5c, 'TARGET', state) : null;
  if (sourceObject) annotationLayer.add(sourceObject);
  if (destinationObject) annotationLayer.add(destinationObject);
  state.obstacles.forEach((polygon) => {
    const obstacle = createObstacleObject(polygon, state);
    obstacleObjects.push(obstacle);
    annotationLayer.add(obstacle);
  });
  updateDraftLine();
  updateStatusPanel();
}

function pointFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(terrainMesh, false)[0];
  return hit ? { x: hit.point.x, y: hit.point.z } : null;
}

function cancelDraft() {
  state.draftObstacle = [];
  updateDraftLine();
  updateStatusPanel();
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
    source: 'Source mode: click any traversable point on the curved surface.',
    destination: 'Destination mode: click any traversable point on the curved surface.',
    obstacle: 'Obstacle mode: click polygon vertices on the surface, then close the polygon.',
  };
  setStatus(messages[mode]);
}

function closePolygon() {
  const validation = validateObstacle(state.draftObstacle);
  if (!validation.valid) {
    setStatus(validation.message);
    return;
  }
  if (state.source && pointInPolygon(state.source, state.draftObstacle)) {
    setStatus('The obstacle cannot contain the source point.');
    return;
  }
  if (state.destination && pointInPolygon(state.destination, state.draftObstacle)) {
    setStatus('The obstacle cannot contain the destination point.');
    return;
  }
  state.obstacles.push(state.draftObstacle.map((point) => ({ ...point })));
  state.draftObstacle = [];
  refreshAnnotations();
  persistScene(state, DOMAIN);
  setStatus(`Obstacle ${state.obstacles.length} clipped to the terrain surface.`);
}

function handleSurfaceClick(event) {
  if (state.mode === 'navigate') return;
  const point = pointFromEvent(event);
  if (!point) {
    setStatus('No surface selected. Click directly on the terrain.');
    return;
  }
  if (state.mode === 'source' || state.mode === 'destination') {
    if (pointInsideAnyObstacle(point, state.obstacles)) {
      setStatus('Query points cannot be placed inside an obstacle.');
      return;
    }
    if (state.mode === 'source') state.source = point;
    else state.destination = point;
    refreshAnnotations();
    persistScene(state, DOMAIN);
    const label = state.mode === 'source' ? 'Source' : 'Destination';
    setStatus(`${label} placed at (${point.x.toFixed(2)}, ${point.y.toFixed(2)}).`);
    return;
  }
  state.draftObstacle.push(point);
  updateDraftLine();
  updateStatusPanel();
  setStatus(`Obstacle vertex ${state.draftObstacle.length} added${state.draftObstacle.length >= 3 ? '; close the polygon when ready.' : '.'}`);
}

function syncControls() {
  for (const key of ['amplitude', 'frequency', 'resolution']) {
    document.querySelector(`#${key}`).value = state[key];
    document.querySelector(`#${key}-output`).value = key === 'resolution' ? state[key] : state[key].toFixed(2);
  }
  document.querySelector('#color-mode').value = state.colorMode;
  document.querySelector('#wireframe').checked = state.wireframe;
}

function applyPayload(payload) {
  applyPayloadToState(state, payload);
  for (const polygon of state.obstacles) {
    const validation = validateObstacle(polygon);
    if (!validation.valid) throw new Error(`Invalid obstacle: ${validation.message}`);
  }
  if (state.source && pointInsideAnyObstacle(state.source, state.obstacles)) throw new Error('Source lies inside an obstacle');
  if (state.destination && pointInsideAnyObstacle(state.destination, state.obstacles)) throw new Error('Destination lies inside an obstacle');
  syncControls();
  rebuildTerrain();
  persistScene(state, DOMAIN);
}

function bindUI() {
  document.querySelectorAll('.mode-button').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  for (const key of ['amplitude', 'frequency', 'resolution']) {
    const input = document.querySelector(`#${key}`);
    input.addEventListener('input', () => {
      state[key] = key === 'resolution' ? Number.parseInt(input.value, 10) : Number.parseFloat(input.value);
      document.querySelector(`#${key}-output`).value = key === 'resolution' ? state[key] : state[key].toFixed(2);
      rebuildTerrain();
      persistScene(state, DOMAIN);
    });
  }
  document.querySelector('#color-mode').addEventListener('change', (event) => {
    state.colorMode = event.target.value;
    rebuildTerrain();
    persistScene(state, DOMAIN);
  });
  document.querySelector('#wireframe').addEventListener('change', (event) => {
    state.wireframe = event.target.checked;
    terrainWire.visible = state.wireframe;
    persistScene(state, DOMAIN);
  });
  document.querySelector('#close-polygon').addEventListener('click', closePolygon);
  document.querySelector('#cancel-polygon').addEventListener('click', () => {
    cancelDraft();
    setStatus('Draft obstacle cancelled.');
  });
  document.querySelector('#undo-obstacle').addEventListener('click', () => {
    if (!state.obstacles.length) {
      setStatus('There are no completed obstacles to remove.');
      return;
    }
    state.obstacles.pop();
    refreshAnnotations();
    persistScene(state, DOMAIN);
    setStatus('Last obstacle removed.');
  });
  document.querySelector('#clear-all').addEventListener('click', () => {
    state.source = null;
    state.destination = null;
    state.obstacles = [];
    state.draftObstacle = [];
    refreshAnnotations();
    persistScene(state, DOMAIN);
    setStatus('Source, destination, and all obstacles cleared.');
  });
  document.querySelector('#export-button').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(scenePayload(state, DOMAIN), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'riemannian-scene.json';
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus('Scene exported as riemannian-scene.json.');
  });
  document.querySelector('#import-button').addEventListener('click', () => document.querySelector('#import-input').click());
  document.querySelector('#import-input').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      applyPayload(JSON.parse(await file.text()));
      setStatus(`Imported ${file.name}.`);
    } catch (error) {
      setStatus(`Import failed: ${error.message}.`);
    }
    event.target.value = '';
  });
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  pointerDown = { x: event.clientX, y: event.clientY };
});
renderer.domElement.addEventListener('pointerup', (event) => {
  if (!pointerDown) return;
  const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
  pointerDown = null;
  if (moved < 5 && event.button === 0) handleSurfaceClick(event);
});
renderer.domElement.addEventListener('pointermove', (event) => {
  const point = pointFromEvent(event);
  const readout = document.querySelector('#cursor-readout');
  if (!point) {
    readout.textContent = 'Move over the surface to inspect coordinates';
    return;
  }
  const z = surfaceHeight(point.x, point.y, state);
  const metric = metricData(point.x, point.y, state);
  readout.textContent = `x ${point.x.toFixed(2)} · y ${point.y.toFixed(2)} · z ${z.toFixed(2)} · √det(g) ${metric.distortion.toFixed(2)}`;
});

function resize() {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

new ResizeObserver(resize).observe(viewport);

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

bindUI();
const restored = restoreScene(state);
syncControls();
rebuildTerrain();
setMode('navigate');
if (restored) setStatus('Restored the previous Riemannian scene.');
resize();
animate();
