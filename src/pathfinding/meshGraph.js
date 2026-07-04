import { getSurfaceDefinition, getSurfaceDomain, metricData, surfacePosition } from '../geometry/surface.js';
import { pointInsideAnyObstacle } from '../geometry/obstacles.js';

const EPSILON = 1e-9;

function orientation(a, b, c) {
  return (b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u);
}

function onSegment(a, b, point) {
  return Math.abs(orientation(a, b, point)) <= EPSILON
    && point.u >= Math.min(a.u, b.u) - EPSILON
    && point.u <= Math.max(a.u, b.u) + EPSILON
    && point.v >= Math.min(a.v, b.v) - EPSILON
    && point.v <= Math.max(a.v, b.v) + EPSILON;
}

function segmentsIntersect(a, b, c, d) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
    && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function segmentBlocked(a, b, obstacles) {
  const midpoint = { u: (a.u + b.u) / 2, v: (a.v + b.v) / 2 };
  if (pointInsideAnyObstacle(a, obstacles)
    || pointInsideAnyObstacle(b, obstacles)
    || pointInsideAnyObstacle(midpoint, obstacles)) return true;
  return obstacles.some((polygon) => polygon.some((point, index) => (
    segmentsIntersect(a, b, point, polygon[(index + 1) % polygon.length])
  )));
}

function createGraphStorage() {
  const nodes = [];
  const edges = [];
  const addNode = (position) => {
    nodes.push({ position: [position.x, position.y, position.z] });
    edges.push(new Map());
    return nodes.length - 1;
  };
  const addEdge = (a, b, weight) => {
    if (a === b || !Number.isFinite(weight) || weight < 0) return;
    const previous = edges[a].get(b);
    if (previous === undefined || weight < previous) {
      edges[a].set(b, weight);
      edges[b].set(a, weight);
    }
  };
  const finalize = () => ({
    nodes,
    adjacency: edges.map((neighbors) => [...neighbors].map(([to, weight]) => ({ to, weight }))),
  });
  return { nodes, edges, addNode, addEdge, finalize };
}

function parametricWeight(a, b, config) {
  const du = b.u - a.u;
  const dv = b.v - a.v;
  const midpointU = (a.u + b.u) / 2;
  const midpointV = (a.v + b.v) / 2;
  const tensor = metricData(midpointU, midpointV, config).tensor;
  const squared = du * (tensor[0][0] * du + tensor[0][1] * dv)
    + dv * (tensor[1][0] * du + tensor[1][1] * dv);
  return Math.sqrt(Math.max(squared, 0));
}

function triangleForPoint(point, config, gridNodeIds) {
  const domain = getSurfaceDomain(config);
  const n = config.resolution;
  const scaledU = ((point.u - domain.uMin) / (domain.uMax - domain.uMin)) * n;
  const scaledV = ((point.v - domain.vMin) / (domain.vMax - domain.vMin)) * n;
  const i = Math.max(0, Math.min(n - 1, Math.floor(scaledU)));
  const j = Math.max(0, Math.min(n - 1, Math.floor(scaledV)));
  const localU = Math.max(0, Math.min(1, scaledU - i));
  const localV = Math.max(0, Math.min(1, scaledV - j));
  const corner = (di, dj) => {
    const u = domain.uMin + ((domain.uMax - domain.uMin) * (i + di)) / n;
    const v = domain.vMin + ((domain.vMax - domain.vMin) * (j + dj)) / n;
    return {
      node: gridNodeIds[(j + dj) * (n + 1) + i + di],
      u,
      v,
      position: surfacePosition(u, v, config),
    };
  };
  const a = corner(0, 0);
  const b = corner(1, 0);
  const c = corner(0, 1);
  const d = corner(1, 1);
  return localU + localV <= 1 + EPSILON ? [a, c, b] : [b, c, d];
}

function buildParametricGraph(config) {
  const storage = createGraphStorage();
  const domain = getSurfaceDomain(config);
  const n = config.resolution;
  const gridNodeIds = new Int32Array((n + 1) * (n + 1));
  const periodicBoundaryNodes = new Map();
  const positionKey = (position) => `${Math.round(position.x * 1e6)},${Math.round(position.y * 1e6)},${Math.round(position.z * 1e6)}`;
  for (let j = 0; j <= n; j += 1) {
    const v = domain.vMin + ((domain.vMax - domain.vMin) * j) / n;
    for (let i = 0; i <= n; i += 1) {
      const u = domain.uMin + ((domain.uMax - domain.uMin) * i) / n;
      const position = surfacePosition(u, v, config);
      const onPeriodicBoundary = (domain.uPeriodic && (i === 0 || i === n))
        || (domain.vPeriodic && (j === 0 || j === n));
      const key = onPeriodicBoundary ? positionKey(position) : null;
      if (key && periodicBoundaryNodes.has(key)) {
        gridNodeIds[j * (n + 1) + i] = periodicBoundaryNodes.get(key);
      } else {
        const node = storage.addNode(position);
        gridNodeIds[j * (n + 1) + i] = node;
        if (key) periodicBoundaryNodes.set(key, node);
      }
    }
  }
  const corner = (i, j) => {
    const u = domain.uMin + ((domain.uMax - domain.uMin) * i) / n;
    const v = domain.vMin + ((domain.vMax - domain.vMin) * j) / n;
    return { node: gridNodeIds[j * (n + 1) + i], u, v };
  };
  const addTriangle = (triangle) => {
    for (const [a, b] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
      if (segmentBlocked(a, b, config.obstacles)) continue;
      storage.addEdge(a.node, b.node, parametricWeight(a, b, config));
    }
  };
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = corner(i, j);
      const b = corner(i + 1, j);
      const c = corner(i, j + 1);
      const d = corner(i + 1, j + 1);
      addTriangle([a, c, b]);
      addTriangle([b, c, d]);
    }
  }
  const connectQueryPoint = (point) => {
    const node = storage.addNode(surfacePosition(point.u, point.v, config));
    for (const cornerPoint of triangleForPoint(point, config, gridNodeIds)) {
      if (segmentBlocked(point, cornerPoint, config.obstacles)) continue;
      storage.addEdge(node, cornerPoint.node, parametricWeight(point, cornerPoint, config));
    }
    return node;
  };
  const source = connectQueryPoint(config.source);
  const target = connectQueryPoint(config.destination);
  return { ...storage.finalize(), source, target, kind: 'parametric' };
}

function vertexKey(position) {
  return `${Math.round(position[0] * 1e5)},${Math.round(position[1] * 1e5)},${Math.round(position[2] * 1e5)}`;
}

function euclideanDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function buildImportedMeshGraph(config) {
  const storage = createGraphStorage();
  const meshData = config.meshData;
  const vertexIds = new Map();
  const faceVertices = Array.from({ length: meshData.faceCount }, () => []);
  for (let face = 0; face < meshData.faceCount; face += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const offset = face * 9 + corner * 3;
      const position = meshData.positions.slice(offset, offset + 3);
      const key = vertexKey(position);
      if (!vertexIds.has(key)) {
        vertexIds.set(key, storage.addNode({ x: position[0], y: position[1], z: position[2] }));
      }
      faceVertices[face].push(vertexIds.get(key));
    }
  }
  const blocked = new Set(config.blockedFaces);
  for (let face = 0; face < meshData.faceCount; face += 1) {
    if (blocked.has(face)) continue;
    const vertices = faceVertices[face];
    for (const [a, b] of [[vertices[0], vertices[1]], [vertices[1], vertices[2]], [vertices[2], vertices[0]]]) {
      storage.addEdge(a, b, euclideanDistance(storage.nodes[a].position, storage.nodes[b].position));
    }
  }
  const connectQueryPoint = (point) => {
    if (blocked.has(point.faceIndex)) throw new Error('A query point lies on a blocked face');
    const position = point.position;
    const node = storage.addNode({ x: position[0], y: position[1], z: position[2] });
    for (const vertex of faceVertices[point.faceIndex]) {
      storage.addEdge(node, vertex, euclideanDistance(position, storage.nodes[vertex].position));
    }
    return node;
  };
  const source = connectQueryPoint(config.source);
  const target = connectQueryPoint(config.destination);
  return { ...storage.finalize(), source, target, kind: 'mesh' };
}

export function buildSearchGraph(config) {
  if (!config.source || !config.destination) throw new Error('Place both source and destination before computing a path');
  const surface = getSurfaceDefinition(config);
  if (surface.kind === 'mesh') {
    if (!config.meshData) throw new Error('The imported mesh is not available');
    return buildImportedMeshGraph(config);
  }
  if (pointInsideAnyObstacle(config.source, config.obstacles)
    || pointInsideAnyObstacle(config.destination, config.obstacles)) {
    throw new Error('Source and destination must be outside obstacles');
  }
  return buildParametricGraph(config);
}
