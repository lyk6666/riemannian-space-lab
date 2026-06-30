import * as THREE from 'three';
import { DOMAIN, surfaceHeight } from './surface.js';

const EPSILON = 1e-8;

function cross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function polygonArea(points) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function onSegment(a, b, p) {
  return Math.abs(cross(a, b, p)) < EPSILON
    && p.x >= Math.min(a.x, b.x) - EPSILON
    && p.x <= Math.max(a.x, b.x) + EPSILON
    && p.y >= Math.min(a.y, b.y) - EPSILON
    && p.y <= Math.max(a.y, b.y) + EPSILON;
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
  const unique = points.filter((point, index) => points.findIndex((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) < 1e-4) === index);
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

export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (onSegment(a, b, point)) return true;
    const crosses = ((a.y > point.y) !== (b.y > point.y))
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function pointInsideAnyObstacle(point, obstacles) {
  return obstacles.some((polygon) => pointInPolygon(point, polygon));
}

function lineIntersection(start, end, clipStart, clipEnd) {
  const segment = { x: end.x - start.x, y: end.y - start.y };
  const edge = { x: clipEnd.x - clipStart.x, y: clipEnd.y - clipStart.y };
  const denominator = segment.x * edge.y - segment.y * edge.x;
  if (Math.abs(denominator) < EPSILON) return { ...end };
  const offset = { x: clipStart.x - start.x, y: clipStart.y - start.y };
  const t = (offset.x * edge.y - offset.y * edge.x) / denominator;
  return { x: start.x + t * segment.x, y: start.y + t * segment.y };
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
      } else if (startInside) {
        output.push(lineIntersection(start, end, clipStart, clipEnd));
      }
      start = end;
    }
  }
  return output;
}

function interpolateHeight(point, triangle) {
  const [a, b, c] = triangle;
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  const wa = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / denominator;
  const wb = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / denominator;
  return wa * a.height + wb * b.height + (1 - wa - wb) * c.height;
}

function addClippedTriangle(positions, terrainTriangle, obstacleTriangle) {
  const clipped = clipAgainstTriangle(terrainTriangle.map(({ x, y }) => ({ x, y })), obstacleTriangle);
  if (clipped.length < 3) return;
  for (let index = 1; index < clipped.length - 1; index += 1) {
    for (const point of [clipped[0], clipped[index], clipped[index + 1]]) {
      positions.push(point.x, interpolateHeight(point, terrainTriangle), point.y);
    }
  }
}

export function createObstacleObject(points, config) {
  const contour = points.map((point) => new THREE.Vector2(point.x, point.y));
  const obstacleTriangles = THREE.ShapeUtils.triangulateShape(contour, [])
    .map((triangle) => triangle.map((index) => points[index]));
  const minX = Math.max(-DOMAIN, Math.min(...points.map((point) => point.x)));
  const maxX = Math.min(DOMAIN, Math.max(...points.map((point) => point.x)));
  const minY = Math.max(-DOMAIN, Math.min(...points.map((point) => point.y)));
  const maxY = Math.min(DOMAIN, Math.max(...points.map((point) => point.y)));
  const n = config.resolution;
  const toCell = (value) => THREE.MathUtils.clamp(Math.floor(((value + DOMAIN) / (2 * DOMAIN)) * n), 0, n - 1);
  const positions = [];
  for (let j = toCell(minY); j <= toCell(maxY); j += 1) {
    const y0 = -DOMAIN + (2 * DOMAIN * j) / n;
    const y1 = -DOMAIN + (2 * DOMAIN * (j + 1)) / n;
    for (let i = toCell(minX); i <= toCell(maxX); i += 1) {
      const x0 = -DOMAIN + (2 * DOMAIN * i) / n;
      const x1 = -DOMAIN + (2 * DOMAIN * (i + 1)) / n;
      const a = { x: x0, y: y0, height: surfaceHeight(x0, y0, config) };
      const b = { x: x1, y: y0, height: surfaceHeight(x1, y0, config) };
      const c = { x: x0, y: y1, height: surfaceHeight(x0, y1, config) };
      const d = { x: x1, y: y1, height: surfaceHeight(x1, y1, config) };
      for (const obstacleTriangle of obstacleTriangles) {
        addClippedTriangle(positions, [a, c, b], obstacleTriangle);
        addClippedTriangle(positions, [b, c, d], obstacleTriangle);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
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
  });
  return new THREE.Mesh(geometry, material);
}

export function createDraftLine(points, config) {
  if (!points.length) return null;
  const vertices = points.map((point) => new THREE.Vector3(
    point.x,
    surfaceHeight(point.x, point.y, config) + 0.012,
    point.y,
  ));
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(vertices),
    new THREE.LineBasicMaterial({ color: 0xff8a83 }),
  );
}

