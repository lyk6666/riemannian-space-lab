import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import {
  createTerrainGeometry,
  getSurfaceDefinition,
  metricData,
  parametersFromUv,
  surfacePosition,
} from './geometry/surface.js';
import {
  createDraftLine,
  createObstacleObject,
  draftCrossesProtectedSeam,
  pointInPolygon,
  pointInsideAnyObstacle,
  validateObstacleForSurface,
} from './geometry/obstacles.js';
import {
  buildFaceAdjacency,
  createFaceObstacleObject,
  createImportedMeshGeometry,
  facePatch,
  loadMeshFile,
  loadMeshUrl,
} from './geometry/importedMesh.js';
import { createMarker, createMarkerAtPosition, disposeObject } from './rendering/markers.js';
import { bidirectionalDijkstra } from './pathfinding/bidirectionalDijkstra.js';
import { contractionHierarchyQuery } from './pathfinding/contractionHierarchy.js';
import { dijkstra } from './pathfinding/dijkstra.js';
import { buildLandmarkIndex, landmarkAStar } from './pathfinding/landmarkIndex.js';
import { attachQueryPoints, buildBaseGraph } from './pathfinding/meshGraph.js';
import {
  createSceneState,
  persistScene,
  restoreScene,
  selectSurface,
} from './state/sceneState.js';
import { listSurfaces } from './surfaces/registry.js';

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
let faceObstacleObject;
let pathObject;
let forwardSearchObject;
let backwardSearchObject;
let landmarkObject;
let lastSearch = null;
let baseGraph = null;
let baseGraphBuildMs = 0;
let landmarkIndex = null;
let chIndex = null;
let separatorChIndex = null;
let chWorker = null;
let chProgress = null;
let chBuildAlgorithm = null;
let partitionObject = null;
let meshAdjacency = [];
let pointerDown = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function setStatus(message) {
  document.querySelector('#status-message').textContent = message;
}

const algorithmNames = {
  dijkstra: 'Dijkstra',
  bidirectional: 'Bidirectional Dijkstra',
  landmark: 'Landmark A*',
  contraction: 'Contraction Hierarchies',
  separator: 'Separator-order CH',
};

function isChAlgorithm(algorithm) {
  return algorithm === 'contraction' || algorithm === 'separator';
}

function activeChIndex(algorithm = document.querySelector('#algorithm-select').value) {
  return algorithm === 'separator' ? separatorChIndex : chIndex;
}

function updatePathStats(search = null) {
  document.querySelector('#path-algorithm').textContent = search ? algorithmNames[search.algorithm] : '—';
  document.querySelector('#path-status').textContent = search
    ? (search.result.found ? 'Path found' : 'No path')
    : 'Not computed';
  document.querySelector('#path-length').textContent = search?.result.found
    ? search.result.distance.toFixed(4)
    : '—';
  document.querySelector('#path-expanded').textContent = search
    ? search.result.expanded.toLocaleString()
    : '—';
  document.querySelector('#path-time').textContent = search
    ? `${search.totalMs.toFixed(1)} ms`
    : '—';
  document.querySelector('#clear-path').disabled = !search;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function updateIndexStats() {
  const algorithm = document.querySelector('#algorithm-select').value;
  const type = document.querySelector('#index-type');
  const status = document.querySelector('#index-status');
  const sizeLabel = document.querySelector('#index-size-label');
  const size = document.querySelector('#index-size');
  const time = document.querySelector('#index-time');
  const memory = document.querySelector('#index-memory');
  if (algorithm === 'landmark') {
    type.textContent = 'Landmark ALT';
    status.textContent = landmarkIndex ? 'Ready' : 'Not built';
    sizeLabel.textContent = 'Landmarks';
    size.textContent = landmarkIndex ? landmarkIndex.landmarks.length : '—';
    time.textContent = landmarkIndex ? `${landmarkIndex.preprocessingMs.toFixed(1)} ms` : '—';
    memory.textContent = landmarkIndex ? formatBytes(landmarkIndex.memoryBytes) : '—';
  } else if (isChAlgorithm(algorithm)) {
    const index = activeChIndex(algorithm);
    const building = chWorker && chBuildAlgorithm === algorithm;
    type.textContent = algorithm === 'separator'
      ? (index?.fallback ? 'Standard CH fallback' : 'Nested-dissection CH')
      : 'Contraction hierarchy';
    status.textContent = building ? 'Building' : (index ? 'Ready' : 'Not built');
    sizeLabel.textContent = algorithm === 'separator' && index && !index.fallback ? 'Regions / shortcuts' : 'Shortcuts';
    size.textContent = algorithm === 'separator' && index && !index.fallback
      ? `${index.regionCount.toLocaleString()} / ${index.shortcutCount.toLocaleString()}`
      : (index ? index.shortcutCount.toLocaleString() : (building && chProgress ? chProgress.shortcuts.toLocaleString() : '—'));
    time.textContent = index ? `${index.preprocessingMs.toFixed(1)} ms` : '—';
    memory.textContent = index ? formatBytes(index.memoryBytes) : '—';
  } else {
    type.textContent = 'None required';
    status.textContent = 'Ready';
    sizeLabel.textContent = 'Size';
    size.textContent = '—';
    time.textContent = '—';
    memory.textContent = '—';
  }
  document.querySelector('#build-index').textContent = landmarkIndex ? 'Rebuild landmark index' : 'Build landmark index';
  const selectedChIndex = isChAlgorithm(algorithm) ? activeChIndex(algorithm) : null;
  const chLabel = algorithm === 'separator' ? 'separator CH index' : 'CH index';
  document.querySelector('#build-ch-index').textContent = `${selectedChIndex ? 'Rebuild' : 'Build'} ${chLabel}`;
}

function createSearchPointCloud(nodeIds, graph, color) {
  const positions = [];
  for (const nodeId of nodeIds) positions.push(...graph.nodes[nodeId].position);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    color,
    size: 0.055,
    transparent: true,
    opacity: 0.72,
    depthTest: false,
    sizeAttenuation: true,
  }));
  points.renderOrder = 8;
  return points;
}

function refreshLandmarks() {
  disposeObject(landmarkObject);
  landmarkObject = null;
  if (!landmarkIndex || !baseGraph) return;
  landmarkObject = createSearchPointCloud(landmarkIndex.landmarks, baseGraph, 0xa78bfa);
  landmarkObject.material.size = 0.14;
  landmarkObject.material.opacity = 1;
  landmarkObject.renderOrder = 9;
  annotationLayer.add(landmarkObject);
}

function refreshPartitionVisualization() {
  disposeObject(partitionObject);
  partitionObject = null;
  if (!separatorChIndex?.regionOfNode || !baseGraph || separatorChIndex.fallback) return;
  const positions = [];
  const colors = [];
  const color = new THREE.Color();
  for (let node = 0; node < baseGraph.nodes.length; node += 1) {
    positions.push(...baseGraph.nodes[node].position);
    const separatorLevel = separatorChIndex.separatorLevel[node];
    if (separatorLevel >= 0) {
      color.setHSL(0.78, 0.8, Math.max(0.58, 0.82 - separatorLevel * 0.06));
    } else {
      const region = separatorChIndex.regionOfNode[node];
      color.setHSL(((region * 0.61803398875) % 1 + 1) % 1, 0.72, 0.54);
    }
    colors.push(color.r, color.g, color.b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  partitionObject = new THREE.Points(geometry, new THREE.PointsMaterial({
    vertexColors: true,
    size: 0.075,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    sizeAttenuation: true,
  }));
  partitionObject.renderOrder = 7;
  partitionObject.visible = document.querySelector('#algorithm-select').value === 'separator'
    && document.querySelector('#show-partition').checked;
  annotationLayer.add(partitionObject);
}

function refreshSearchFronts() {
  disposeObject(forwardSearchObject);
  disposeObject(backwardSearchObject);
  forwardSearchObject = null;
  backwardSearchObject = null;
  if (!lastSearch || !document.querySelector('#show-search-fronts').checked) return;
  forwardSearchObject = createSearchPointCloud(lastSearch.result.visitedForward, lastSearch.graph, 0x25d0c8);
  backwardSearchObject = createSearchPointCloud(lastSearch.result.visitedBackward, lastSearch.graph, 0xffcf5c);
  annotationLayer.add(forwardSearchObject, backwardSearchObject);
}

function clearPath({ announce = false } = {}) {
  disposeObject(pathObject);
  disposeObject(forwardSearchObject);
  disposeObject(backwardSearchObject);
  pathObject = null;
  forwardSearchObject = null;
  backwardSearchObject = null;
  lastSearch = null;
  updatePathStats();
  if (announce) setStatus('Computed path cleared.');
}

function clearLandmarkIndex() {
  disposeObject(landmarkObject);
  landmarkObject = null;
  landmarkIndex = null;
  updateIndexStats();
  updateStatusPanel();
}

function clearChIndex({ cancelled = false, algorithm = null } = {}) {
  if (chWorker) chWorker.terminate();
  chWorker = null;
  chBuildAlgorithm = null;
  if (!algorithm || algorithm === 'contraction') chIndex = null;
  if (!algorithm || algorithm === 'separator') {
    separatorChIndex = null;
    disposeObject(partitionObject);
    partitionObject = null;
  }
  chProgress = null;
  document.querySelector('#build-ch-index').disabled = false;
  document.querySelector('#cancel-ch-index').classList.add('hidden');
  document.querySelector('#ch-progress-wrap').classList.add('hidden');
  updateIndexStats();
  updateStatusPanel();
  if (cancelled) setStatus('CH preprocessing cancelled.');
}

function invalidateGraph() {
  clearPath();
  clearLandmarkIndex();
  clearChIndex();
  baseGraph = null;
  baseGraphBuildMs = 0;
}

function ensureBaseGraph() {
  if (baseGraph) return baseGraph;
  const started = performance.now();
  baseGraph = buildBaseGraph(state);
  baseGraphBuildMs = performance.now() - started;
  return baseGraph;
}

async function buildIndex() {
  clearPath();
  const button = document.querySelector('#build-index');
  button.disabled = true;
  button.textContent = 'Building…';
  setStatus('Building the landmark distance index…');
  await new Promise((resolve) => requestAnimationFrame(resolve));
  try {
    const graph = ensureBaseGraph();
    const count = Number.parseInt(document.querySelector('#landmark-count').value, 10);
    landmarkIndex = buildLandmarkIndex(graph, count);
    refreshLandmarks();
    updateIndexStats();
    updateStatusPanel();
    setStatus(`Landmark index ready: ${landmarkIndex.landmarks.length} landmarks, ${landmarkIndex.preprocessingMs.toFixed(1)} ms preprocessing.`);
  } catch (error) {
    clearLandmarkIndex();
    setStatus(`Index construction failed: ${error.message}.`);
  } finally {
    button.disabled = false;
    updateIndexStats();
  }
}

function buildChIndex() {
  clearPath();
  const algorithm = document.querySelector('#algorithm-select').value;
  clearChIndex({ algorithm });
  try {
    const graph = ensureBaseGraph();
    const workerGraph = {
      nodes: graph.nodes,
      adjacency: graph.adjacency,
      partition: graph.partition,
    };
    const ordering = algorithm === 'separator' ? 'nested-dissection' : 'standard';
    const leafSize = Number.parseInt(document.querySelector('#separator-leaf-size').value, 10);
    chBuildAlgorithm = algorithm;
    chWorker = new Worker(new URL('./workers/chWorker.js', import.meta.url), { type: 'module' });
    document.querySelector('#build-ch-index').disabled = true;
    document.querySelector('#cancel-ch-index').classList.remove('hidden');
    document.querySelector('#ch-progress-wrap').classList.remove('hidden');
    document.querySelector('#ch-progress').value = 0;
    document.querySelector('#ch-progress-text').textContent = 'Preparing hierarchy…';
    setStatus(`Building the ${algorithmNames[algorithm]} index in a background worker…`);
    updateIndexStats();
    updateStatusPanel();
    chWorker.addEventListener('message', (event) => {
      if (event.data.type === 'progress') {
        chProgress = event.data.progress;
        const ratio = chProgress.total ? chProgress.contracted / chProgress.total : 0;
        document.querySelector('#ch-progress').value = ratio;
        document.querySelector('#ch-progress-text').textContent = `${chProgress.contracted.toLocaleString()} / ${chProgress.total.toLocaleString()} vertices · ${chProgress.shortcuts.toLocaleString()} shortcuts`;
        updateIndexStats();
      } else if (event.data.type === 'complete') {
        const completedIndex = event.data.index;
        if (algorithm === 'separator') separatorChIndex = completedIndex;
        else chIndex = completedIndex;
        chWorker.terminate();
        chWorker = null;
        chBuildAlgorithm = null;
        chProgress = null;
        document.querySelector('#build-ch-index').disabled = false;
        document.querySelector('#cancel-ch-index').classList.add('hidden');
        document.querySelector('#ch-progress-wrap').classList.add('hidden');
        if (algorithm === 'separator') refreshPartitionVisualization();
        updateIndexStats();
        updateStatusPanel();
        if (completedIndex.fallback) {
          setStatus(`Separator ordering requires a uniform parameter grid. A standard exact CH index was built for this imported mesh instead.`);
        } else {
          const regionSummary = algorithm === 'separator' ? `, ${completedIndex.regionCount.toLocaleString()} leaf regions` : '';
          setStatus(`${algorithmNames[algorithm]} index ready: ${completedIndex.shortcutCount.toLocaleString()} shortcuts${regionSummary}, ${completedIndex.preprocessingMs.toFixed(1)} ms preprocessing.`);
        }
      } else if (event.data.type === 'error') {
        const message = event.data.message;
        clearChIndex({ algorithm });
        setStatus(`CH preprocessing failed: ${message}.`);
      }
    });
    chWorker.addEventListener('error', (event) => {
      const message = event.message || 'worker error';
      clearChIndex({ algorithm });
      setStatus(`CH preprocessing failed: ${message}.`);
    });
    chWorker.postMessage({ type: 'build', graph: workerGraph, ordering, leafSize });
  } catch (error) {
    clearChIndex({ algorithm });
    setStatus(`CH preprocessing failed: ${error.message}.`);
  }
}

function computePath() {
  if (!state.source || !state.destination) {
    setStatus('Place both source and destination before computing a path.');
    return;
  }
  const algorithm = document.querySelector('#algorithm-select').value;
  if (algorithm === 'landmark' && !landmarkIndex) {
    setStatus('Build the landmark index before running Landmark A*.');
    return;
  }
  if (isChAlgorithm(algorithm) && !activeChIndex(algorithm)) {
    setStatus(`Build the ${algorithmNames[algorithm]} index before running it.`);
    return;
  }
  clearPath();
  try {
    const graph = attachQueryPoints(ensureBaseGraph(), state.source, state.destination, state);
    const started = performance.now();
    let result;
    if (algorithm === 'dijkstra') result = dijkstra(graph, graph.source, graph.target);
    else if (algorithm === 'bidirectional') result = bidirectionalDijkstra(graph, graph.source, graph.target);
    else if (algorithm === 'landmark') result = landmarkAStar(graph, graph.source, graph.target, landmarkIndex);
    else if (isChAlgorithm(algorithm)) result = contractionHierarchyQuery(graph, activeChIndex(algorithm));
    else throw new Error('The selected algorithm is not implemented');
    const finished = performance.now();
    lastSearch = {
      graph,
      result,
      algorithm,
      buildMs: baseGraphBuildMs,
      searchMs: finished - started,
      totalMs: finished - started,
    };
    if (result.found) {
      const points = result.path.map((nodeId) => new THREE.Vector3(...graph.nodes[nodeId].position));
      pathObject = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0xf8fafc, depthTest: false, linewidth: 3 }),
      );
      pathObject.renderOrder = 10;
      annotationLayer.add(pathObject);
      setStatus(`${algorithmNames[algorithm]} found a shortest mesh-edge path: ${result.distance.toFixed(4)} units, ${result.expanded.toLocaleString()} vertices expanded.`);
    } else {
      setStatus(`No collision-free mesh-edge path exists. ${result.expanded.toLocaleString()} vertices were expanded.`);
    }
    refreshSearchFronts();
    updatePathStats(lastSearch);
  } catch (error) {
    clearPath();
    setStatus(`Path computation failed: ${error.message}.`);
  }
}

function updateStatusPanel() {
  const surface = getSurfaceDefinition(state);
  const formatPoint = (point) => {
    if (!point) return 'Not placed';
    if (surface.kind === 'mesh') return `face ${point.faceIndex}`;
    return `(${point.u.toFixed(2)}, ${point.v.toFixed(2)})`;
  };
  document.querySelector('#source-status').textContent = formatPoint(state.source);
  document.querySelector('#destination-status').textContent = formatPoint(state.destination);
  document.querySelector('#obstacle-count').textContent = surface.kind === 'mesh'
    ? `${state.blockedFaces.length} blocked faces`
    : `${state.obstacles.length} polygon${state.obstacles.length === 1 ? '' : 's'}`;
  document.querySelector('#close-polygon').disabled = state.draftObstacle.length < 3;
  document.querySelector('#undo-obstacle').textContent = surface.kind === 'mesh' ? 'Clear painted faces' : 'Remove last obstacle';
  const algorithm = document.querySelector('#algorithm-select').value;
  document.querySelector('#landmark-controls').classList.toggle('hidden', algorithm !== 'landmark');
  document.querySelector('#ch-controls').classList.toggle('hidden', !isChAlgorithm(algorithm));
  document.querySelector('#separator-options').classList.toggle('hidden', algorithm !== 'separator');
  if (landmarkObject) landmarkObject.visible = algorithm === 'landmark';
  if (partitionObject) {
    partitionObject.visible = algorithm === 'separator' && document.querySelector('#show-partition').checked;
  }
  const missingIndex = (algorithm === 'landmark' && !landmarkIndex)
    || (isChAlgorithm(algorithm) && !activeChIndex(algorithm));
  document.querySelector('#compute-path').disabled = !state.source || !state.destination || missingIndex;
  document.querySelector('#build-ch-index').disabled = Boolean(chWorker);
  updateIndexStats();
}

function rebuildTerrain({ invalidate = true } = {}) {
  if (invalidate) invalidateGraph();
  disposeObject(terrainMesh);
  disposeObject(terrainWire);
  const surface = getSurfaceDefinition(state);
  if (surface.kind === 'mesh' && !state.meshData) return;
  const geometry = surface.kind === 'mesh'
    ? createImportedMeshGeometry(state.meshData, state.colorMode)
    : createTerrainGeometry(state);
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
  meshAdjacency = surface.kind === 'mesh' ? buildFaceAdjacency(state.meshData) : [];
  refreshAnnotations();
  document.querySelector('#triangle-count').textContent = surface.kind === 'mesh'
    ? state.meshData.faceCount.toLocaleString()
    : (state.resolution * state.resolution * 2).toLocaleString();
}

function updateDraftLine() {
  disposeObject(draftLine);
  draftLine = createDraftLine(state.draftObstacle, state);
  if (draftLine) annotationLayer.add(draftLine);
}

function refreshAnnotations() {
  disposeObject(sourceObject);
  disposeObject(destinationObject);
  disposeObject(faceObstacleObject);
  faceObstacleObject = null;
  obstacleObjects.forEach(disposeObject);
  obstacleObjects = [];
  const surface = getSurfaceDefinition(state);
  const markerFor = (point, color, label) => surface.kind === 'mesh'
    ? createMarkerAtPosition(new THREE.Vector3(...point.position), color, label)
    : createMarker(point, color, label, state);
  sourceObject = state.source ? markerFor(state.source, 0x25d0c8, 'SOURCE') : null;
  destinationObject = state.destination ? markerFor(state.destination, 0xffcf5c, 'TARGET') : null;
  if (sourceObject) annotationLayer.add(sourceObject);
  if (destinationObject) annotationLayer.add(destinationObject);
  if (surface.kind === 'mesh') {
    faceObstacleObject = createFaceObstacleObject(state.meshData, state.blockedFaces);
    annotationLayer.add(faceObstacleObject);
  } else {
    state.obstacles.forEach((polygon) => {
      const obstacle = createObstacleObject(polygon, state);
      obstacleObjects.push(obstacle);
      annotationLayer.add(obstacle);
    });
  }
  updateDraftLine();
  updateStatusPanel();
}

function pointFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(terrainMesh, false)[0];
  if (!hit) return null;
  if (getSurfaceDefinition(state).kind === 'mesh') {
    return { faceIndex: hit.faceIndex, position: hit.point.toArray() };
  }
  return hit.uv ? parametersFromUv(hit.uv, state) : null;
}

function cancelDraft() {
  state.draftObstacle = [];
  updateDraftLine();
  updateStatusPanel();
}

function setMode(mode) {
  const meshMode = getSurfaceDefinition(state).kind === 'mesh';
  state.mode = mode;
  document.querySelectorAll('.mode-button').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  document.querySelector('#obstacle-actions').classList.toggle('hidden', mode !== 'obstacle' || meshMode);
  controls.enabled = mode === 'navigate';
  renderer.domElement.style.cursor = mode === 'navigate' ? 'grab' : 'crosshair';
  if (mode !== 'obstacle' && state.draftObstacle.length) cancelDraft();
  const messages = {
    navigate: 'Navigation mode: drag to orbit, scroll to zoom, right-drag to pan.',
    source: 'Source mode: click any traversable point on the curved surface.',
    destination: 'Destination mode: click any traversable point on the curved surface.',
    obstacle: meshMode
      ? 'Obstacle mode: click the mesh to toggle connected face patches.'
      : 'Obstacle mode: click polygon vertices on the surface, then close the polygon.',
  };
  setStatus(messages[mode]);
}

function closePolygon() {
  const validation = validateObstacleForSurface(state.draftObstacle, state);
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
  invalidateGraph();
  state.obstacles.push(state.draftObstacle.map((point) => ({ ...point })));
  state.draftObstacle = [];
  refreshAnnotations();
  persistScene(state);
  setStatus(`Obstacle ${state.obstacles.length} clipped to the terrain surface.`);
}

function handleSurfaceClick(event) {
  if (state.mode === 'navigate') return;
  const point = pointFromEvent(event);
  if (!point) {
    setStatus('No surface selected. Click directly on the terrain.');
    return;
  }
  const meshMode = getSurfaceDefinition(state).kind === 'mesh';
  if (meshMode && state.mode === 'obstacle') {
    const patch = facePatch(point.faceIndex, Math.round(state.surfaceParams.brushRings), meshAdjacency);
    if (patch.includes(state.source?.faceIndex) || patch.includes(state.destination?.faceIndex)) {
      setStatus('Painted obstacles cannot cover the source or destination face.');
      return;
    }
    const blocked = new Set(state.blockedFaces);
    const remove = patch.every((face) => blocked.has(face));
    invalidateGraph();
    for (const face of patch) {
      if (remove) blocked.delete(face);
      else blocked.add(face);
    }
    state.blockedFaces = [...blocked].sort((a, b) => a - b);
    refreshAnnotations();
    persistScene(state);
    setStatus(`${remove ? 'Unpainted' : 'Painted'} ${patch.length} connected faces.`);
    return;
  }
  if (state.mode === 'source' || state.mode === 'destination') {
    const blocked = meshMode
      ? state.blockedFaces.includes(point.faceIndex)
      : pointInsideAnyObstacle(point, state.obstacles);
    if (blocked) {
      setStatus('Query points cannot be placed inside an obstacle.');
      return;
    }
    clearPath();
    if (state.mode === 'source') state.source = point;
    else state.destination = point;
    refreshAnnotations();
    persistScene(state);
    const label = state.mode === 'source' ? 'Source' : 'Destination';
    setStatus(meshMode
      ? `${label} placed on mesh face ${point.faceIndex}.`
      : `${label} placed at (${point.u.toFixed(2)}, ${point.v.toFixed(2)}).`);
    return;
  }
  if (meshMode) return;
  const candidateDraft = [...state.draftObstacle, point];
  if (draftCrossesProtectedSeam(candidateDraft, state)) {
    setStatus('Obstacle edges cannot cross a protected parameter seam.');
    return;
  }
  state.draftObstacle.push(point);
  updateDraftLine();
  updateStatusPanel();
  setStatus(`Obstacle vertex ${state.draftObstacle.length} added${state.draftObstacle.length >= 3 ? '; close the polygon when ready.' : '.'}`);
}

function syncControls() {
  document.querySelector('#resolution').value = state.resolution;
  document.querySelector('#resolution-output').value = state.resolution;
  document.querySelector('#resolution').disabled = getSurfaceDefinition(state).kind === 'mesh';
  document.querySelector('#color-mode').value = state.colorMode;
  document.querySelector('#wireframe').checked = state.wireframe;
  renderSurfaceControls();
  renderSurfaceCards();
}

function renderSurfaceControls() {
  const surface = getSurfaceDefinition(state);
  document.querySelector('#surface-heading').textContent = surface.name;
  const container = document.querySelector('#surface-parameter-controls');
  container.replaceChildren();
  for (const control of surface.controls) {
    const label = document.createElement('label');
    label.className = 'control-row';
    const caption = document.createElement('span');
    const output = document.createElement('output');
    const value = Number(state.surfaceParams[control.key]);
    output.value = value.toFixed(control.step < 0.1 ? 2 : 1);
    caption.append(control.label, output);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = control.min;
    input.max = control.max;
    input.step = control.step;
    input.value = value;
    input.addEventListener('input', () => {
      state.surfaceParams[control.key] = Number.parseFloat(input.value);
      output.value = state.surfaceParams[control.key].toFixed(control.step < 0.1 ? 2 : 1);
      if (surface.kind !== 'mesh') rebuildTerrain();
      persistScene(state);
    });
    label.append(caption, input);
    container.append(label);
  }
  if (surface.acceptsHeightmap) {
    const panel = document.createElement('div');
    panel.className = 'heightmap-control';
    const source = document.createElement('p');
    source.textContent = `Elevation source: ${state.surfaceParams.sourceName}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-primary';
    button.textContent = 'Load PNG / JPEG';
    button.addEventListener('click', () => document.querySelector('#heightmap-input').click());
    panel.append(source, button);
    container.append(panel);
  }
}

async function decodeHeightmap(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 128 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(2, Math.round(bitmap.width * scale));
  const height = Math.max(2, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const pixels = context.getImageData(0, 0, width, height).data;
  const values = [];
  for (let index = 0; index < pixels.length; index += 4) {
    values.push((0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2]) / 255);
  }
  return { width, height, values };
}

function renderSurfaceCards() {
  const grid = document.querySelector('#surface-card-grid');
  grid.replaceChildren();
  for (const surface of listSurfaces()) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `surface-card${surface.id === state.surfaceId ? ' active' : ''}`;
    card.dataset.surfaceId = surface.id;
    const category = document.createElement('span');
    category.className = 'surface-card-category';
    category.textContent = surface.category;
    const title = document.createElement('strong');
    title.textContent = surface.name;
    const description = document.createElement('p');
    description.textContent = surface.description;
    card.append(category, title, description);
    card.addEventListener('click', async () => {
      if (surface.acceptsMesh) {
        document.querySelector('#mesh-input').click();
        return;
      }
      if (surface.kind === 'mesh' && surface.builtinMeshUrl) {
        document.querySelector('#space-dialog').close();
        setStatus(`Loading ${surface.name}…`);
        try {
          const meshData = await loadMeshUrl(surface.builtinMeshUrl, 'stanford-bunny.ply');
          activateMeshSurface(surface.id, meshData);
          setStatus(`${surface.name} loaded with ${meshData.faceCount.toLocaleString()} faces.`);
        } catch (error) {
          setStatus(`Could not load ${surface.name}: ${error.message}.`);
        }
        return;
      }
      if (surface.id !== state.surfaceId) {
        selectSurface(state, surface.id);
        syncControls();
        rebuildTerrain();
        setMode(state.mode);
        persistScene(state);
        setStatus(`Switched to ${surface.name}. Query geometry was cleared.`);
      }
      document.querySelector('#space-dialog').close();
    });
    grid.append(card);
  }
}

function activateMeshSurface(surfaceId, meshData) {
  selectSurface(state, surfaceId);
  state.meshData = meshData;
  state.blockedFaces = [];
  syncControls();
  rebuildTerrain();
  setMode(state.mode);
  persistScene(state);
}

function bindUI() {
  document.querySelectorAll('.mode-button').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  document.querySelector('#resolution').addEventListener('input', (event) => {
    state.resolution = Number.parseInt(event.target.value, 10);
    document.querySelector('#resolution-output').value = state.resolution;
    rebuildTerrain();
    persistScene(state);
  });
  document.querySelector('#space-config-button').addEventListener('click', () => {
    renderSurfaceCards();
    document.querySelector('#space-dialog').showModal();
  });
  document.querySelector('#space-dialog-close').addEventListener('click', () => document.querySelector('#space-dialog').close());
  document.querySelector('#heightmap-input').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const heightmap = await decodeHeightmap(file);
      if (state.surfaceId !== 'heightmap') selectSurface(state, 'heightmap');
      state.surfaceParams.heightmap = heightmap;
      state.surfaceParams.sourceName = file.name;
      state.source = null;
      state.destination = null;
      state.obstacles = [];
      syncControls();
      rebuildTerrain();
      setMode(state.mode);
      persistScene(state);
      setStatus(`Loaded ${file.name} as a ${heightmap.width} × ${heightmap.height} heightmap.`);
    } catch (error) {
      setStatus(`Heightmap import failed: ${error.message}.`);
    }
    event.target.value = '';
  });
  document.querySelector('#mesh-input').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setStatus(`Loading ${file.name}…`);
      const meshData = await loadMeshFile(file);
      activateMeshSurface('imported-mesh', meshData);
      document.querySelector('#space-dialog').close();
      setStatus(`Loaded ${file.name} with ${meshData.faceCount.toLocaleString()} faces.`);
    } catch (error) {
      setStatus(`Mesh import failed: ${error.message}.`);
    }
    event.target.value = '';
  });
  document.querySelector('#color-mode').addEventListener('change', (event) => {
    state.colorMode = event.target.value;
    rebuildTerrain({ invalidate: false });
    persistScene(state);
  });
  document.querySelector('#wireframe').addEventListener('change', (event) => {
    state.wireframe = event.target.checked;
    terrainWire.visible = state.wireframe;
    persistScene(state);
  });
  document.querySelector('#compute-path').addEventListener('click', computePath);
  document.querySelector('#clear-path').addEventListener('click', () => clearPath({ announce: true }));
  document.querySelector('#show-search-fronts').addEventListener('change', refreshSearchFronts);
  document.querySelector('#algorithm-select').addEventListener('change', (event) => {
    clearPath();
    updateStatusPanel();
    setStatus(`${algorithmNames[event.target.value]} selected.`);
  });
  document.querySelector('#landmark-count').addEventListener('input', (event) => {
    document.querySelector('#landmark-count-output').value = event.target.value;
    clearPath();
    clearLandmarkIndex();
  });
  document.querySelector('#build-index').addEventListener('click', buildIndex);
  document.querySelector('#build-ch-index').addEventListener('click', buildChIndex);
  document.querySelector('#cancel-ch-index').addEventListener('click', () => clearChIndex({
    cancelled: true,
    algorithm: chBuildAlgorithm,
  }));
  document.querySelector('#separator-leaf-size').addEventListener('change', () => {
    clearPath();
    clearChIndex({ algorithm: 'separator' });
    setStatus('Separator leaf size changed. Rebuild the separator-order CH index.');
  });
  document.querySelector('#show-partition').addEventListener('change', updateStatusPanel);
  document.querySelector('#close-polygon').addEventListener('click', closePolygon);
  document.querySelector('#cancel-polygon').addEventListener('click', () => {
    cancelDraft();
    setStatus('Draft obstacle cancelled.');
  });
  document.querySelector('#undo-obstacle').addEventListener('click', () => {
    if (getSurfaceDefinition(state).kind === 'mesh') {
      if (!state.blockedFaces.length) {
        setStatus('There are no painted obstacle faces to clear.');
        return;
      }
      invalidateGraph();
      state.blockedFaces = [];
      refreshAnnotations();
      persistScene(state);
      setStatus('All painted obstacle faces were cleared.');
      return;
    }
    if (!state.obstacles.length) {
      setStatus('There are no completed obstacles to remove.');
      return;
    }
    invalidateGraph();
    state.obstacles.pop();
    refreshAnnotations();
    persistScene(state);
    setStatus('Last obstacle removed.');
  });
  document.querySelector('#clear-all').addEventListener('click', () => {
    invalidateGraph();
    state.source = null;
    state.destination = null;
    state.obstacles = [];
    state.draftObstacle = [];
    state.blockedFaces = [];
    refreshAnnotations();
    persistScene(state);
    setStatus('Source, destination, and all obstacles cleared.');
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
  if (getSurfaceDefinition(state).kind === 'mesh') {
    readout.textContent = `face ${point.faceIndex} · x ${point.position[0].toFixed(2)} · y ${point.position[1].toFixed(2)} · z ${point.position[2].toFixed(2)}`;
    return;
  }
  const position = surfacePosition(point.u, point.v, state);
  const metric = metricData(point.u, point.v, state);
  readout.textContent = `u ${point.u.toFixed(2)} · v ${point.v.toFixed(2)} · y ${position.y.toFixed(2)} · √det(g) ${metric.distortion.toFixed(2)}`;
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
