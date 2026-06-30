import { getSurface } from '../surfaces/registry.js';

export function createSceneState() {
  const surface = getSurface('sinusoidal');
  return {
    surfaceId: surface.id,
    surfaceParams: { ...surface.defaultParams },
    resolution: 64,
    colorMode: 'distortion',
    wireframe: true,
    mode: 'navigate',
    source: null,
    destination: null,
    obstacles: [],
    draftObstacle: [],
  };
}

function normalizePoint(point) {
  if (!point) return null;
  if (Number.isFinite(point.u) && Number.isFinite(point.v)) return { u: point.u, v: point.v };
  if (Number.isFinite(point.x) && Number.isFinite(point.y)) return { u: point.x, v: point.y };
  throw new Error('Invalid surface point');
}

export function scenePayload(state) {
  return {
    schema: 'riemannian-space-lab/v2',
    surface: { id: state.surfaceId, params: state.surfaceParams, resolution: state.resolution },
    visualization: { colorMode: state.colorMode, wireframe: state.wireframe },
    source: state.source,
    destination: state.destination,
    obstacles: state.obstacles,
  };
}

export function applyPayloadToState(state, payload) {
  if (!payload?.surface || !['riemannian-space-lab/v1', 'riemannian-space-lab/v2'].includes(payload.schema)) {
    throw new Error('Unsupported scene format');
  }
  const legacy = payload.schema === 'riemannian-space-lab/v1';
  const surfaceId = legacy ? 'sinusoidal' : payload.surface.id;
  const surface = getSurface(surfaceId);
  state.surfaceId = surface.id;
  state.surfaceParams = legacy
    ? { amplitude: Number(payload.surface.amplitude), frequency: Number(payload.surface.frequency) }
    : { ...surface.defaultParams, ...payload.surface.params };
  state.resolution = Number(payload.surface.resolution);
  state.colorMode = payload.visualization?.colorMode || 'distortion';
  state.wireframe = payload.visualization?.wireframe ?? true;
  state.source = normalizePoint(payload.source);
  state.destination = normalizePoint(payload.destination);
  state.obstacles = Array.isArray(payload.obstacles)
    ? payload.obstacles.map((polygon) => polygon.map(normalizePoint))
    : [];
  state.draftObstacle = [];
}

export function selectSurface(state, surfaceId) {
  const surface = getSurface(surfaceId);
  state.surfaceId = surface.id;
  state.surfaceParams = { ...surface.defaultParams };
  state.source = null;
  state.destination = null;
  state.obstacles = [];
  state.draftObstacle = [];
}

export function persistScene(state) {
  localStorage.setItem('riemannian-space-lab-scene', JSON.stringify(scenePayload(state)));
}

export function restoreScene(state) {
  const raw = localStorage.getItem('riemannian-space-lab-scene');
  if (!raw) return false;
  try {
    applyPayloadToState(state, JSON.parse(raw));
    return true;
  } catch {
    return false;
  }
}
