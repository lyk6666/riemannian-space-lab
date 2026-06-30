import * as THREE from 'three';

const TAU = Math.PI * 2;
const control = (key, label, min, max, step) => ({ key, label, min, max, step });

function sampleHeightmap(u, v, params) {
  const { extent, heightmap } = params;
  if (!heightmap?.values?.length) {
    const radius = Math.hypot(u, v);
    return 0.5
      + 0.22 * Math.sin(0.75 * u) * Math.cos(0.65 * v)
      + 0.18 * Math.exp(-0.18 * radius * radius);
  }
  const x = THREE.MathUtils.clamp(((u + extent) / (2 * extent)) * (heightmap.width - 1), 0, heightmap.width - 1);
  const y = THREE.MathUtils.clamp(((v + extent) / (2 * extent)) * (heightmap.height - 1), 0, heightmap.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, heightmap.width - 1);
  const y1 = Math.min(y0 + 1, heightmap.height - 1);
  const tx = x - x0;
  const ty = y - y0;
  const at = (column, row) => heightmap.values[row * heightmap.width + column];
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(at(x0, y0), at(x1, y0), tx),
    THREE.MathUtils.lerp(at(x0, y1), at(x1, y1), tx),
    ty,
  );
}

export const specialSurfaces = [
  {
    id: 'poincare-disk',
    name: 'Poincaré disk',
    category: 'Abstract metrics',
    description: 'A planar disk carrying its true negatively curved hyperbolic metric.',
    topology: 'periodic',
    defaultParams: { displayRadius: 5, boundary: 0.93 },
    controls: [control('displayRadius', 'Display radius', 3, 6, 0.1), control('boundary', 'Metric boundary', 0.75, 0.97, 0.01)],
    domain: (params) => ({ uMin: 0, uMax: TAU, vMin: 0.002, vMax: params.boundary, uPeriodic: true, vPeriodic: false }),
    position(u, v, { displayRadius }) {
      return new THREE.Vector3(displayRadius * v * Math.cos(u), 0, displayRadius * v * Math.sin(u));
    },
    metric(u, v) {
      const factor = 4 / ((1 - v * v) ** 2);
      return {
        tensor: [[factor * v * v, 0], [0, factor]],
        distortion: factor * Math.max(v, 1e-6),
        slope: 0,
      };
    },
  },
  {
    id: 'heightmap',
    name: 'Heightmap / DEM',
    category: 'Imported terrain',
    description: 'A terrain generated from a grayscale PNG or JPEG elevation map.',
    topology: 'open',
    acceptsHeightmap: true,
    defaultParams: { verticalScale: 4, extent: 7, heightmap: null, sourceName: 'Procedural preview' },
    controls: [control('verticalScale', 'Vertical scale', 0.5, 8, 0.1), control('extent', 'Ground extent', 4, 10, 0.2)],
    domain: (params) => ({ uMin: -params.extent, uMax: params.extent, vMin: -params.extent, vMax: params.extent, uPeriodic: false, vPeriodic: false }),
    position(u, v, params) {
      return new THREE.Vector3(u, params.verticalScale * (sampleHeightmap(u, v, params) - 0.5), v);
    },
  },
];

