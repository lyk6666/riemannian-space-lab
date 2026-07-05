import { MinPriorityQueue } from './bidirectionalDijkstra.js';

const EPSILON = 1e-10;

function edgeConnects(edge, a, b) {
  return (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a);
}

function createMutableGraph(baseGraph) {
  const adjacency = Array.from({ length: baseGraph.nodes.length }, () => new Map());
  const edges = [];
  const addEdge = (a, b, weight, metadata = {}) => {
    if (a === b || !Number.isFinite(weight)) return { id: -1, added: false };
    const existingId = adjacency[a].get(b);
    if (existingId !== undefined && edges[existingId].weight <= weight + EPSILON) {
      return { id: existingId, added: false };
    }
    const id = edges.length;
    edges.push({
      a,
      b,
      weight,
      original: metadata.original ?? false,
      via: metadata.via ?? -1,
      childA: metadata.childA ?? -1,
      childB: metadata.childB ?? -1,
    });
    adjacency[a].set(b, id);
    adjacency[b].set(a, id);
    return { id, added: true };
  };
  for (let node = 0; node < baseGraph.adjacency.length; node += 1) {
    for (const edge of baseGraph.adjacency[node]) {
      if (node < edge.to) addEdge(node, edge.to, edge.weight, { original: true });
    }
  }
  return { adjacency, edges, addEdge };
}

class WitnessWorkspace {
  constructor(size) {
    this.distances = new Float64Array(size);
    this.distances.fill(Infinity);
    this.touched = [];
  }

  set(node, distance) {
    if (!Number.isFinite(this.distances[node])) this.touched.push(node);
    this.distances[node] = distance;
  }

  reset() {
    for (const node of this.touched) this.distances[node] = Infinity;
    this.touched.length = 0;
  }
}

function boundedWitnessDistances(mutable, contracted, start, targets, avoid, maxDistance, workspace, isCancelled) {
  const queue = new MinPriorityQueue();
  const remaining = new Set(targets);
  workspace.set(start, 0);
  queue.push(start, 0);
  while (queue.size && remaining.size) {
    if (isCancelled?.()) throw new Error('CH preprocessing cancelled');
    const item = queue.pop();
    if (item.priority !== workspace.distances[item.node]) continue;
    if (item.priority > maxDistance + EPSILON) break;
    remaining.delete(item.node);
    for (const [neighbor, edgeId] of mutable.adjacency[item.node]) {
      if (neighbor === avoid || contracted[neighbor]) continue;
      const candidate = item.priority + mutable.edges[edgeId].weight;
      if (candidate >= workspace.distances[neighbor] || candidate > maxDistance + EPSILON) continue;
      workspace.set(neighbor, candidate);
      queue.push(neighbor, candidate);
    }
  }
  const results = new Map(targets.map((target) => [target, workspace.distances[target]]));
  workspace.reset();
  return results;
}

function activeNeighbors(adjacency, contracted, node) {
  return [...adjacency[node]].filter(([neighbor]) => !contracted[neighbor]);
}

function contractionPriority(mutable, contracted, contractedNeighbors, levels, node) {
  const neighbors = activeNeighbors(mutable.adjacency, contracted, node);
  let missingPairs = 0;
  for (let i = 0; i < neighbors.length; i += 1) {
    for (let j = i + 1; j < neighbors.length; j += 1) {
      if (!mutable.adjacency[neighbors[i][0]].has(neighbors[j][0])) missingPairs += 1;
    }
  }
  return missingPairs - neighbors.length + 2 * contractedNeighbors[node] + levels[node] + node * 1e-9;
}

function contractNode(mutable, contracted, node, workspace, isCancelled) {
  const neighbors = activeNeighbors(mutable.adjacency, contracted, node);
  const shortcuts = [];
  for (let i = 0; i < neighbors.length; i += 1) {
    const [source, sourceEdgeId] = neighbors[i];
    const candidates = [];
    let maxDistance = 0;
    for (let j = i + 1; j < neighbors.length; j += 1) {
      const [target, targetEdgeId] = neighbors[j];
      const throughDistance = mutable.edges[sourceEdgeId].weight + mutable.edges[targetEdgeId].weight;
      const directEdgeId = mutable.adjacency[source].get(target);
      if (directEdgeId !== undefined && mutable.edges[directEdgeId].weight <= throughDistance + EPSILON) continue;
      candidates.push({ source, target, sourceEdgeId, targetEdgeId, throughDistance });
      maxDistance = Math.max(maxDistance, throughDistance);
    }
    if (!candidates.length) continue;
    const witnesses = boundedWitnessDistances(
      mutable,
      contracted,
      source,
      candidates.map(({ target }) => target),
      node,
      maxDistance,
      workspace,
      isCancelled,
    );
    for (const candidate of candidates) {
      if (witnesses.get(candidate.target) > candidate.throughDistance + EPSILON) shortcuts.push(candidate);
    }
  }
  for (const shortcut of shortcuts) {
    mutable.addEdge(shortcut.source, shortcut.target, shortcut.throughDistance, {
      via: node,
      childA: shortcut.sourceEdgeId,
      childB: shortcut.targetEdgeId,
    });
  }
  return { neighbors: neighbors.map(([neighbor]) => neighbor), shortcutsAdded: shortcuts.length };
}

export function buildContractionHierarchy(baseGraph, options = {}) {
  const started = performance.now();
  const mutable = createMutableGraph(baseGraph);
  const count = baseGraph.nodes.length;
  const contracted = new Uint8Array(count);
  const contractedNeighbors = new Uint32Array(count);
  const levels = new Uint32Array(count);
  const ranks = new Int32Array(count);
  ranks.fill(-1);
  const priorities = new Float64Array(count);
  const queue = new MinPriorityQueue();
  const workspace = new WitnessWorkspace(count);
  const suppliedOrder = options.order ? Array.from(options.order) : null;
  let shortcutCount = 0;

  if (suppliedOrder) {
    if (suppliedOrder.length !== count || new Set(suppliedOrder).size !== count
      || suppliedOrder.some((node) => !Number.isInteger(node) || node < 0 || node >= count)) {
      throw new Error('The supplied CH contraction order is not a vertex permutation');
    }
  } else {
    for (let node = 0; node < count; node += 1) {
      priorities[node] = contractionPriority(mutable, contracted, contractedNeighbors, levels, node);
      queue.push(node, priorities[node]);
    }
  }

  for (let rank = 0; rank < count; rank += 1) {
    let node = suppliedOrder ? suppliedOrder[rank] : -1;
    if (!suppliedOrder) {
      while (queue.size) {
        const item = queue.pop();
        if (contracted[item.node] || item.priority !== priorities[item.node]) continue;
        node = item.node;
        break;
      }
      if (node === -1) throw new Error('CH priority queue became empty before all vertices were contracted');
    }
    if (options.isCancelled?.()) throw new Error('CH preprocessing cancelled');
    const result = contractNode(mutable, contracted, node, workspace, options.isCancelled);
    shortcutCount += result.shortcutsAdded;
    contracted[node] = 1;
    ranks[node] = rank;
    for (const neighbor of result.neighbors) {
      if (contracted[neighbor]) continue;
      contractedNeighbors[neighbor] += 1;
      levels[neighbor] = Math.max(levels[neighbor], levels[node] + 1);
      if (!suppliedOrder) {
        priorities[neighbor] = contractionPriority(mutable, contracted, contractedNeighbors, levels, neighbor);
        queue.push(neighbor, priorities[neighbor]);
      }
    }
    if (rank % 128 === 0 || rank === count - 1) {
      options.onProgress?.({ contracted: rank + 1, total: count, shortcuts: shortcutCount });
    }
  }

  const upward = Array.from({ length: count }, () => []);
  const activeEdgeIds = new Set();
  for (let node = 0; node < count; node += 1) {
    for (const [neighbor, edgeId] of mutable.adjacency[node]) {
      if (node >= neighbor || activeEdgeIds.has(edgeId)) continue;
      activeEdgeIds.add(edgeId);
      const lower = ranks[node] < ranks[neighbor] ? node : neighbor;
      const higher = lower === node ? neighbor : node;
      upward[lower].push({ to: higher, weight: mutable.edges[edgeId].weight, edgeId });
    }
  }
  const activeEdges = activeEdgeIds.size;
  return {
    ranks,
    upward,
    edges: mutable.edges,
    nodeCount: count,
    shortcutCount,
    activeEdges,
    preprocessingMs: performance.now() - started,
    memoryBytes: ranks.byteLength + activeEdges * 32 + mutable.edges.length * 48,
    ordering: suppliedOrder ? 'supplied' : 'edge-difference',
  };
}

function unpackEdge(index, edgeId, from, to, output) {
  const edge = index.edges[edgeId];
  if (edge.original) {
    output.push(to);
    return;
  }
  const first = edgeConnects(index.edges[edge.childA], from, edge.via) ? edge.childA : edge.childB;
  const second = first === edge.childA ? edge.childB : edge.childA;
  unpackEdge(index, first, from, edge.via, output);
  unpackEdge(index, second, edge.via, to, output);
}

function baseVertexQuery(index, source, target) {
  if (source === target) {
    return { found: true, distance: 0, path: [source], visitedForward: [source], visitedBackward: [], expanded: 1 };
  }
  const count = index.nodeCount;
  const forward = new Float64Array(count);
  const backward = new Float64Array(count);
  forward.fill(Infinity);
  backward.fill(Infinity);
  forward[source] = 0;
  backward[target] = 0;
  const previousForwardNode = new Int32Array(count);
  const previousBackwardNode = new Int32Array(count);
  const previousForwardEdge = new Int32Array(count);
  const previousBackwardEdge = new Int32Array(count);
  previousForwardNode.fill(-1);
  previousBackwardNode.fill(-1);
  previousForwardEdge.fill(-1);
  previousBackwardEdge.fill(-1);
  const settledForward = new Uint8Array(count);
  const settledBackward = new Uint8Array(count);
  const queueForward = new MinPriorityQueue();
  const queueBackward = new MinPriorityQueue();
  const visitedForward = [];
  const visitedBackward = [];
  queueForward.push(source, 0);
  queueBackward.push(target, 0);
  let bestDistance = Infinity;
  let meeting = -1;

  const expand = (queue, distances, otherDistances, previousNode, previousEdge, settled, visited) => {
    let item = queue.pop();
    while (item && (settled[item.node] || item.priority !== distances[item.node])) item = queue.pop();
    if (!item) return;
    settled[item.node] = 1;
    visited.push(item.node);
    if (Number.isFinite(otherDistances[item.node]) && distances[item.node] + otherDistances[item.node] < bestDistance) {
      bestDistance = distances[item.node] + otherDistances[item.node];
      meeting = item.node;
    }
    for (const edge of index.upward[item.node]) {
      const candidate = distances[item.node] + edge.weight;
      if (candidate < distances[edge.to]) {
        distances[edge.to] = candidate;
        previousNode[edge.to] = item.node;
        previousEdge[edge.to] = edge.edgeId;
        queue.push(edge.to, candidate);
      }
      if (Number.isFinite(otherDistances[edge.to]) && distances[edge.to] + otherDistances[edge.to] < bestDistance) {
        bestDistance = distances[edge.to] + otherDistances[edge.to];
        meeting = edge.to;
      }
    }
  };

  const discardStale = (queue, distances, settled) => {
    while (queue.size) {
      const item = queue.items[0];
      if (!settled[item.node] && item.priority === distances[item.node]) return;
      queue.pop();
    }
  };

  while (queueForward.size && queueBackward.size) {
    discardStale(queueForward, forward, settledForward);
    discardStale(queueBackward, backward, settledBackward);
    if (!queueForward.size || !queueBackward.size) break;
    const minForward = queueForward.peekPriority();
    const minBackward = queueBackward.peekPriority();
    if (minForward + minBackward >= bestDistance) break;
    if (minForward <= minBackward) {
      expand(queueForward, forward, backward, previousForwardNode, previousForwardEdge, settledForward, visitedForward);
    } else {
      expand(queueBackward, backward, forward, previousBackwardNode, previousBackwardEdge, settledBackward, visitedBackward);
    }
  }
  if (meeting === -1) return { found: false, distance: Infinity, path: [], visitedForward, visitedBackward, expanded: visitedForward.length + visitedBackward.length };

  const segments = [];
  for (let node = meeting; node !== source;) {
    const parent = previousForwardNode[node];
    segments.push({ edgeId: previousForwardEdge[node], from: parent, to: node });
    node = parent;
  }
  segments.reverse();
  for (let node = meeting; node !== target;) {
    const parent = previousBackwardNode[node];
    segments.push({ edgeId: previousBackwardEdge[node], from: node, to: parent });
    node = parent;
  }
  const path = [source];
  for (const segment of segments) unpackEdge(index, segment.edgeId, segment.from, segment.to, path);
  return { found: true, distance: bestDistance, path, visitedForward, visitedBackward, expanded: visitedForward.length + visitedBackward.length };
}

export function contractionHierarchyQuery(graph, index) {
  if (!index || index.nodeCount !== graph.baseNodeCount) throw new Error('The CH index does not match the current graph');
  const sourceConnections = graph.adjacency[graph.source].filter((edge) => edge.to < graph.baseNodeCount);
  const targetConnections = graph.adjacency[graph.target].filter((edge) => edge.to < graph.baseNodeCount);
  let best = null;
  const visitedForward = new Set();
  const visitedBackward = new Set();
  let expanded = 0;
  for (const sourceEdge of sourceConnections) {
    for (const targetEdge of targetConnections) {
      const result = baseVertexQuery(index, sourceEdge.to, targetEdge.to);
      result.visitedForward.forEach((node) => visitedForward.add(node));
      result.visitedBackward.forEach((node) => visitedBackward.add(node));
      expanded += result.expanded;
      if (!result.found) continue;
      const distance = sourceEdge.weight + result.distance + targetEdge.weight;
      if (!best || distance < best.distance) best = { distance, basePath: result.path };
    }
  }
  if (!best) {
    return { found: false, distance: Infinity, path: [], visitedForward: [...visitedForward], visitedBackward: [...visitedBackward], expanded };
  }
  return {
    found: true,
    distance: best.distance,
    path: [graph.source, ...best.basePath, graph.target],
    visitedForward: [...visitedForward],
    visitedBackward: [...visitedBackward],
    expanded,
  };
}
