import * as THREE from 'three';

const sinusoidal = {
  id: 'sinusoidal',
  name: 'Sinusoidal terrain',
  category: 'Height fields',
  description: 'Smooth periodic hills with controllable amplitude and frequency.',
  topology: 'open',
  defaultParams: { amplitude: 1.6, frequency: 0.7 },
  controls: [
    { key: 'amplitude', label: 'Amplitude', min: 0.4, max: 3, step: 0.05 },
    { key: 'frequency', label: 'Frequency', min: 0.3, max: 1.5, step: 0.05 },
  ],
  domain: () => ({ uMin: -7, uMax: 7, vMin: -7, vMax: 7, uPeriodic: false, vPeriodic: false }),
  position(u, v, params) {
    const { amplitude: a, frequency: f } = params;
    const height = a * (
      0.72 * Math.sin(f * u) * Math.cos(f * v)
      + 0.28 * Math.sin(0.55 * f * u + 0.8) * Math.sin(1.25 * f * v)
    );
    return new THREE.Vector3(u, height, v);
  },
};

const surfaces = [sinusoidal];
const surfaceMap = new Map(surfaces.map((surface) => [surface.id, surface]));

export function listSurfaces() {
  return surfaces;
}

export function getSurface(id) {
  const surface = surfaceMap.get(id);
  if (!surface) throw new Error(`Unknown surface: ${id}`);
  return surface;
}

