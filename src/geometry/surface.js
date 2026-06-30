import * as THREE from 'three';

export const DOMAIN = 7;

export function surfaceHeight(x, y, { amplitude: a, frequency: f }) {
  return a * (
    0.72 * Math.sin(f * x) * Math.cos(f * y)
    + 0.28 * Math.sin(0.55 * f * x + 0.8) * Math.sin(1.25 * f * y)
  );
}

export function surfaceDerivatives(x, y, { amplitude: a, frequency: f }) {
  const fx = a * (
    0.72 * f * Math.cos(f * x) * Math.cos(f * y)
    + 0.28 * 0.55 * f * Math.cos(0.55 * f * x + 0.8) * Math.sin(1.25 * f * y)
  );
  const fy = a * (
    -0.72 * f * Math.sin(f * x) * Math.sin(f * y)
    + 0.28 * 1.25 * f * Math.sin(0.55 * f * x + 0.8) * Math.cos(1.25 * f * y)
  );
  return { fx, fy };
}

export function metricData(x, y, config) {
  const { fx, fy } = surfaceDerivatives(x, y, config);
  return {
    tensor: [[1 + fx * fx, fx * fy], [fx * fy, 1 + fy * fy]],
    slope: Math.hypot(fx, fy),
    distortion: Math.sqrt(1 + fx * fx + fy * fy),
  };
}

function colorFor(x, y, z, config) {
  const metric = metricData(x, y, config);
  let value;
  if (config.colorMode === 'height') {
    value = THREE.MathUtils.clamp((z / Math.max(config.amplitude, 0.01) + 1) / 2, 0, 1);
  } else if (config.colorMode === 'slope') {
    value = THREE.MathUtils.clamp(metric.slope / 1.8, 0, 1);
  } else {
    value = THREE.MathUtils.clamp((metric.distortion - 1) / 1.2, 0, 1);
  }
  const low = new THREE.Color(0x0b4f65);
  const mid = new THREE.Color(0x20b5a8);
  const high = new THREE.Color(0xf3c755);
  return value < 0.55
    ? low.lerp(mid, value / 0.55)
    : mid.lerp(high, (value - 0.55) / 0.45);
}

export function createTerrainGeometry(config) {
  const n = config.resolution;
  const positions = [];
  const colors = [];
  const indices = [];
  for (let j = 0; j <= n; j += 1) {
    const y = -DOMAIN + (2 * DOMAIN * j) / n;
    for (let i = 0; i <= n; i += 1) {
      const x = -DOMAIN + (2 * DOMAIN * i) / n;
      const z = surfaceHeight(x, y, config);
      positions.push(x, z, y);
      const color = colorFor(x, y, z, config);
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

