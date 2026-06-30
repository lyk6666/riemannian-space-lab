import * as THREE from 'three';
import { getSurfaceDomain, surfacePosition } from './surface.js';

const EPSILON = 1e-8;

function cross(a, b, c) {
  return (b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u);
}

function polygonArea(points) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.u * next.v - next.u * point.v;
  }, 0) / 2;
}

function onSegment(a, b, point) {
  return Math.abs(cross(a, b, point)) < EPSILON
    && point.u >= Math.min(a.u, b.u) - EPSILON
    && point.u <= Math.max(a.u, b.u) + EPSILON
    && point.v >= Math.min(a.v, b.v) - EPSILON
    && point.v <= Math.max(a.v, b.v) + EPSILON;
}

function segmentsIntersect(a, b, c, d) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
    && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

export function validateObstacle(points) {
  if (points.length < 3) return { valid: false, message: 'An obstacle needs at least three vertices.' };
  const unique = points.filter((point, index) => points.findIndex((candidate) => Math.hypot(candidate.u - point.u, candidate.v - point.v) < 1e-4) === index);
  if (unique.length < 3) return { valid: false, message: 'Obstacle vertices must be distinct.' };
  if (Math.abs(polygonArea(points)) < 0.02) return { valid: false, message: 'The obstacle area is too small.' };
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j += 1) {
      if (j === i || j === (i + 1) % points.length || (j + 1) % points.length === i) continue;
      if (segmentsIntersect(a, b, points[j], points[(j + 1) % points.length])) {
        return { valid: false, message: 'Obstacle edges cannot cross each other.' };
      }
    }
  }
  return { valid: true, message: '' };
}

export function validateObstacleForSurface(points, config) {
  const validation = validateObstacle(points);
  if (!validation.valid) return validation;
  const domain = getSurfaceDomain(config);
  const uValues = points.map((point) => point.u);
  const vValues = points.map((point) => point.v);
  if (domain.uPeriodic && Math.max(...uValues) - Math.min(...uValues) > (domain.uMax - domain.uMin) / 2) {
    return { valid: false, message: 'This obstacle crosses the protected u-parameter seam.' };
  }
  if (domain.vPeriodic && Math.max(...vValues) - Math.min(...vValues) > (domain.vMax - domain.vMin) / 2) {
    return { valid: false, message: 'This obstacle crosses the protected v-parameter seam.' };
  }
  return validation;
}

export function draftCrossesProtectedSeam(points, config) {
  if (points.length < 2) return false;
  const domain = getSurfaceDomain(config);
  const uValues = points.map((point) => point.u);
  const vValues = points.map((point) => point.v);
  return (domain.uPeriodic && Math.max(...uValues) - Math.min(...uValues) > (domain.uMax - domain.uMin) / 2)
    || (domain.vPeriodic && Math.max(...vValues) - Math.min(...vValues) > (domain.vMax - domain.vMin) / 2);
}

export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (onSegment(a, b, point)) return true;
    const crosses = ((a.v > point.v) !== (b.v > point.v))
      && point.u < ((b.u - a.u) * (point.v - a.v)) / (b.v - a.v) + a.u;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function pointInsideAnyObstacle(point, obstacles) {
  return obstacles.some((polygon) => pointInPolygon(point, polygon));
}

function lineIntersection(start, end, clipStart, clipEnd) {
  const segment = { u: end.u - start.u, v: end.v - start.v };
  const edge = { u: clipEnd.u - clipStart.u, v: clipEnd.v - clipStart.v };
  const denominator = segment.u * edge.v - segment.v * edge.u;
  if (Math.abs(denominator) < EPSILON) return { ...end };
  const offset = { u: clipStart.u - start.u, v: clipStart.v - start.v };
  const t = (offset.u * edge.v - offset.v * edge.u) / denominator;
  return { u: start.u + t * segment.u, v: start.v + t * segment.v };
}

function clipAgainstTriangle(subject, clipTriangle) {
  let output = subject;
  const orientation = Math.sign(polygonArea(clipTriangle)) || 1;
  for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
    const clipStart = clipTriangle[edgeIndex];
    const clipEnd = clipTriangle[(edgeIndex + 1) % 3];
    const input = output;
    output = [];
    if (!input.length) break;
    let start = input[input.length - 1];
    for (const end of input) {
      const startInside = orientation * cross(clipStart, clipEnd, start) >= -EPSILON;
      const endInside = orientation * cross(clipStart, clipEnd, end) >= -EPSILON;
      if (endInside) {
        if (!startInside) output.push(lineIntersection(start, end, clipStart, clipEnd));
        output.push(end);
      } else if (startInside) output.push(lineIntersection(start, end, clipStart, clipEnd));
      start = end;
    }
  }
  return output;
}

function interpolatePosition(point, triangle) {
  const [a, b, c] = triangle;
  const denominator = (b.v - c.v) * (a.u - c.u) + (c.u - b.u) * (a.v - c.v);
  const wa = ((b.v - c.v) * (point.u - c.u) + (c.u - b.u) * (point.v - c.v)) / denominator;
  const wb = ((c.v - a.v) * (point.u - c.u) + (a.u - c.u) * (point.v - c.v)) / denominator;
  return a.position.clone().multiplyScalar(wa)
    .add(b.position.clone().multiplyScalar(wb))
    .add(c.position.clone().multiplyScalar(1 - wa - wb));
}

function addClippedTriangle(positions, terrainTriangle, obstacleTriangle) {
  const clipped = clipAgainstTriangle(terrainTriangle.map(({ u, v }) => ({ u, v })), obstacleTriangle);
  if (clipped.length < 3) return;
  for (let index = 1; index < clipped.length - 1; index += 1) {
    for (const point of [clipped[0], clipped[index], clipped[index + 1]]) {
      const position = interpolatePosition(point, terrainTriangle);
      positions.push(position.x, position.y, position.z);
    }
  }
}

export function createObstacleObject(points, config) {
  const contour = points.map((point) => new THREE.Vector2(point.u, point.v));
  const obstacleTriangles = THREE.ShapeUtils.triangulateShape(contour, [])
    .map((triangle) => triangle.map((index) => points[index]));
  const domain = getSurfaceDomain(config);
  const minU = Math.max(domain.uMin, Math.min(...points.map((point) => point.u)));
  const maxU = Math.min(domain.uMax, Math.max(...points.map((point) => point.u)));
  const minV = Math.max(domain.vMin, Math.min(...points.map((point) => point.v)));
  const maxV = Math.min(domain.vMax, Math.max(...points.map((point) => point.v)));
  const n = config.resolution;
  const toUCell = (value) => THREE.MathUtils.clamp(Math.floor(((value - domain.uMin) / (domain.uMax - domain.uMin)) * n), 0, n - 1);
  const toVCell = (value) => THREE.MathUtils.clamp(Math.floor(((value - domain.vMin) / (domain.vMax - domain.vMin)) * n), 0, n - 1);
  const positions = [];
  for (let j = toVCell(minV); j <= toVCell(maxV); j += 1) {
    const v0 = domain.vMin + ((domain.vMax - domain.vMin) * j) / n;
    const v1 = domain.vMin + ((domain.vMax - domain.vMin) * (j + 1)) / n;
    for (let i = toUCell(minU); i <= toUCell(maxU); i += 1) {
      const u0 = domain.uMin + ((domain.uMax - domain.uMin) * i) / n;
      const u1 = domain.uMin + ((domain.uMax - domain.uMin) * (i + 1)) / n;
      const a = { u: u0, v: v0, position: surfacePosition(u0, v0, config) };
      const b = { u: u1, v: v0, position: surfacePosition(u1, v0, config) };
      const c = { u: u0, v: v1, position: surfacePosition(u0, v1, config) };
      const d = { u: u1, v: v1, position: surfacePosition(u1, v1, config) };
      for (const obstacleTriangle of obstacleTriangles) {
        addClippedTriangle(positions, [a, c, b], obstacleTriangle);
        addClippedTriangle(positions, [b, c, d], obstacleTriangle);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: 0xff5147,
    emissive: 0x5a0906,
    emissiveIntensity: 0.65,
    transparent: true,
    opacity: 0.86,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }));
}

export function createDraftLine(points, config) {
  if (!points.length) return null;
  const vertices = points.map((point) => surfacePosition(point.u, point.v, config));
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(vertices),
    new THREE.LineBasicMaterial({ color: 0xff8a83, depthTest: false }),
  );
}
