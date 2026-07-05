import { MinPriorityQueue } from './bidirectionalDijkstra.js';
import { dijkstraDistances } from './dijkstra.js';

function connectedComponents(graph) {
  const componentOf = new Int32Array(graph.adjacency.length);
  componentOf.fill(-1);
  const components = [];
  for (let start = 0; start < graph.adjacency.length; start += 1) {
    if (componentOf[start] !== -1) continue;
    const id = components.length;
    const nodes = [];
    const stack = [start];
    componentOf[start] = id;
    while (stack.length) {
      const node = stack.pop();
      nodes.push(node);
      for (const edge of graph.adjacency[node]) {
        if (componentOf[edge.to] !== -1) continue;
        componentOf[edge.to] = id;
        stack.push(edge.to);
      }
    }
    components.push(nodes);
  }
  return { components, componentOf };
}

function allocateLandmarks(components, requested) {
  const allocation = new Int32Array(components.length);
  let nontrivial = components
    .map((nodes, id) => ({ id, size: nodes.length }))
    .filter(({ size }) => size > 1)
    .sort((a, b) => b.size - a.size);
  if (!nontrivial.length && components.length) nontrivial = [{ id: 0, size: components[0].length }];
  let remaining = Math.min(requested, nontrivial.reduce((sum, item) => sum + item.size, 0));
  for (const component of nontrivial) {
    if (!remaining) break;
    allocation[component.id] = 1;
    remaining -= 1;
  }
  while (remaining > 0) {
    let best = null;
    for (const component of nontrivial) {
      if (allocation[component.id] >= component.size) continue;
      const score = component.size / (allocation[component.id] + 1);
      if (!best || score > best.score) best = { ...component, score };
    }
    if (!best) break;
    allocation[best.id] += 1;
    remaining -= 1;
  }
  return allocation;
}

function farthestNode(nodes, distances, excluded = new Set()) {
  let selected = -1;
  let best = -Infinity;
  for (const node of nodes) {
    if (excluded.has(node)) continue;
    const distance = distances[node];
    if (Number.isFinite(distance) && distance > best) {
      best = distance;
      selected = node;
    }
  }
  return selected;
}

export function buildLandmarkIndex(baseGraph, requestedLandmarks = 8) {
  const started = performance.now();
  const { components, componentOf } = connectedComponents(baseGraph);
  const allocation = allocateLandmarks(components, Math.max(1, Math.floor(requestedLandmarks)));
  const landmarks = [];
  const distances = [];

  for (let componentId = 0; componentId < components.length; componentId += 1) {
    const nodes = components[componentId];
    const count = allocation[componentId];
    if (!count) continue;
    const initialDistances = dijkstraDistances(baseGraph, nodes[0]);
    let candidate = farthestNode(nodes, initialDistances);
    const chosen = new Set();
    const nearestLandmark = new Float64Array(baseGraph.nodes.length);
    nearestLandmark.fill(Infinity);
    for (let index = 0; index < count && candidate !== -1; index += 1) {
      chosen.add(candidate);
      const landmarkDistances = dijkstraDistances(baseGraph, candidate);
      landmarks.push(candidate);
      distances.push(landmarkDistances);
      for (const node of nodes) nearestLandmark[node] = Math.min(nearestLandmark[node], landmarkDistances[node]);
      candidate = farthestNode(nodes, nearestLandmark, chosen);
    }
  }

  return {
    landmarks,
    distances,
    componentOf,
    componentCount: components.length,
    preprocessingMs: performance.now() - started,
    memoryBytes: distances.length * baseGraph.nodes.length * Float64Array.BYTES_PER_ELEMENT,
    nodeCount: baseGraph.nodes.length,
  };
}

function distanceFromLandmarkToQuery(landmarkDistances, graph, queryNode) {
  let best = Infinity;
  for (const edge of graph.adjacency[queryNode]) {
    if (edge.to >= graph.baseNodeCount) continue;
    best = Math.min(best, landmarkDistances[edge.to] + edge.weight);
  }
  return best;
}

function reconstructPath(previous, target) {
  const path = [];
  for (let node = target; node !== -1; node = previous[node]) path.push(node);
  path.reverse();
  return path;
}

export function createLandmarkHeuristic(graph, target, index) {
  if (!index || index.nodeCount !== graph.baseNodeCount) throw new Error('The landmark index does not match the current graph');
  const targetDistances = index.distances.map((distances) => distanceFromLandmarkToQuery(distances, graph, target));
  const queryDistanceCache = new Map([[target, targetDistances]]);
  return (node) => {
    if (node === target) return 0;
    if (node >= graph.baseNodeCount && !queryDistanceCache.has(node)) {
      queryDistanceCache.set(node, index.distances.map((distances) => distanceFromLandmarkToQuery(distances, graph, node)));
    }
    let estimate = 0;
    for (let landmark = 0; landmark < index.distances.length; landmark += 1) {
      const nodeDistance = node < graph.baseNodeCount
        ? index.distances[landmark][node]
        : queryDistanceCache.get(node)[landmark];
      const targetDistance = targetDistances[landmark];
      if (Number.isFinite(nodeDistance) && Number.isFinite(targetDistance)) {
        estimate = Math.max(estimate, Math.abs(targetDistance - nodeDistance));
      }
    }
    return estimate;
  };
}

export function landmarkAStar(graph, source, target, index) {
  const heuristic = createLandmarkHeuristic(graph, target, index);

  const count = graph.adjacency.length;
  const distances = new Float64Array(count);
  distances.fill(Infinity);
  distances[source] = 0;
  const previous = new Int32Array(count);
  previous.fill(-1);
  const settled = new Uint8Array(count);
  const queue = new MinPriorityQueue();
  const visited = [];
  queue.push(source, heuristic(source));

  while (queue.size) {
    const item = queue.pop();
    if (settled[item.node]) continue;
    const expectedPriority = distances[item.node] + heuristic(item.node);
    if (item.priority > expectedPriority + 1e-10) continue;
    settled[item.node] = 1;
    visited.push(item.node);
    if (item.node === target) break;
    for (const edge of graph.adjacency[item.node]) {
      if (settled[edge.to]) continue;
      const candidate = distances[item.node] + edge.weight;
      if (candidate >= distances[edge.to]) continue;
      distances[edge.to] = candidate;
      previous[edge.to] = item.node;
      queue.push(edge.to, candidate + heuristic(edge.to));
    }
  }

  const found = Number.isFinite(distances[target]);
  return {
    found,
    distance: distances[target],
    path: found ? reconstructPath(previous, target) : [],
    visitedForward: visited,
    visitedBackward: [],
    expanded: visited.length,
  };
}
