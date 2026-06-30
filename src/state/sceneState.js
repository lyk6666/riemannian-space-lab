export function createSceneState() {
  return {
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
}

export function scenePayload(state, domain) {
  return {
    schema: 'riemannian-space-lab/v1',
    surface: {
      type: 'sinusoidal-height-field',
      amplitude: state.amplitude,
      frequency: state.frequency,
      resolution: state.resolution,
      domain,
    },
    visualization: { colorMode: state.colorMode, wireframe: state.wireframe },
    source: state.source,
    destination: state.destination,
    obstacles: state.obstacles,
  };
}

export function applyPayloadToState(state, payload) {
  if (!payload?.surface || payload.schema !== 'riemannian-space-lab/v1') {
    throw new Error('Unsupported scene format');
  }
  state.amplitude = Number(payload.surface.amplitude);
  state.frequency = Number(payload.surface.frequency);
  state.resolution = Number(payload.surface.resolution);
  state.colorMode = payload.visualization?.colorMode || 'distortion';
  state.wireframe = payload.visualization?.wireframe ?? true;
  state.source = payload.source || null;
  state.destination = payload.destination || null;
  state.obstacles = Array.isArray(payload.obstacles) ? payload.obstacles : [];
  state.draftObstacle = [];
}

export function persistScene(state, domain) {
  localStorage.setItem('riemannian-space-lab-scene', JSON.stringify(scenePayload(state, domain)));
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

