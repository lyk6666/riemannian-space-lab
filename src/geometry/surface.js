import * as THREE from 'three';
import { getSurface } from '../surfaces/registry.js';

export function getSurfaceDefinition(config) {
  return getSurface(config.surfaceId);
}

export function getSurfaceDomain(config) {
  return getSurfaceDefinition(config).domain(config.surfaceParams);
}

export function surfacePosition(u, v, config) {
  return getSurfaceDefinition(config).position(u, v, config.surfaceParams);
}

function clampToDomain(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function metricData(u, v, config) {
  const surface = getSurfaceDefinition(config);
  if (surface.metric) return surface.metric(u, v, config.surfaceParams);
  const domain = getSurfaceDomain(config);
  const du = Math.max((domain.uMax - domain.uMin) * 1e-4, 1e-5);
  const dv = Math.max((domain.vMax - domain.vMin) * 1e-4, 1e-5);
  const u0 = clampToDomain(u - du, domain.uMin, domain.uMax);
  const u1 = clampToDomain(u + du, domain.uMin, domain.uMax);
  const v0 = clampToDomain(v - dv, domain.vMin, domain.vMax);
  const v1 = clampToDomain(v + dv, domain.vMin, domain.vMax);
  const ru = surface.position(u1, v, config.surfaceParams)
    .sub(surface.position(u0, v, config.surfaceParams))
    .multiplyScalar(1 / Math.max(u1 - u0, 1e-8));
  const rv = surface.position(u, v1, config.surfaceParams)
    .sub(surface.position(u, v0, config.surfaceParams))
    .multiplyScalar(1 / Math.max(v1 - v0, 1e-8));
  const E = ru.dot(ru);
  const F = ru.dot(rv);
  const G = rv.dot(rv);
  const determinant = Math.max(E * G - F * F, 0);
  const normal = ru.clone().cross(rv).normalize();
  return {
    tensor: [[E, F], [F, G]],
    distortion: Math.sqrt(determinant),
    slope: 1 - Math.abs(normal.y),
  };
}

function normalizedValues(values) {
  const finite = values.filter(Number.isFinite);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const range = Math.max(max - min, 1e-8);
  return values.map((value) => THREE.MathUtils.clamp((value - min) / range, 0, 1));
}

function palette(value) {
  const low = new THREE.Color(0x0b4f65);
  const mid = new THREE.Color(0x20b5a8);
  const high = new THREE.Color(0xf3c755);
  return value < 0.55
    ? low.lerp(mid, value / 0.55)
    : mid.lerp(high, (value - 0.55) / 0.45);
}

export function createTerrainGeometry(config) {
  const domain = getSurfaceDomain(config);
  const n = config.resolution;
  const positions = [];
  const rawColorValues = [];
  const uvCoordinates = [];
  const indices = [];
  for (let j = 0; j <= n; j += 1) {
    const v = domain.vMin + ((domain.vMax - domain.vMin) * j) / n;
    for (let i = 0; i <= n; i += 1) {
      const u = domain.uMin + ((domain.uMax - domain.uMin) * i) / n;
      const position = surfacePosition(u, v, config);
      const metric = metricData(u, v, config);
      positions.push(position.x, position.y, position.z);
      uvCoordinates.push(i / n, j / n);
      if (config.colorMode === 'height') rawColorValues.push(position.y);
      else if (config.colorMode === 'slope') rawColorValues.push(metric.slope);
      else rawColorValues.push(Math.log1p(metric.distortion));
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
  const colors = [];
  for (const value of normalizedValues(rawColorValues)) {
    const color = palette(value);
    colors.push(color.r, color.g, color.b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvCoordinates, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function parametersFromUv(uv, config) {
  const domain = getSurfaceDomain(config);
  return {
    u: THREE.MathUtils.lerp(domain.uMin, domain.uMax, uv.x),
    v: THREE.MathUtils.lerp(domain.vMin, domain.vMax, uv.y),
  };
}
