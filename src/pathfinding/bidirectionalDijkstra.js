export class MinPriorityQueue {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(node, priority) {
    const item = { node, priority };
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].priority <= priority) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }

  pop() {
    if (!this.items.length) return null;
    const root = this.items[0];
    const tail = this.items.pop();
    if (this.items.length) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.items.length) break;
        let child = left;
        if (right < this.items.length && this.items[right].priority < this.items[left].priority) child = right;
        if (this.items[child].priority >= tail.priority) break;
        this.items[index] = this.items[child];
        index = child;
      }
      this.items[index] = tail;
    }
    return root;
  }

  peekPriority() {
    return this.items.length ? this.items[0].priority : Infinity;
  }
}

function discardStale(queue, distances, settled) {
  while (queue.size) {
    const item = queue.items[0];
    if (!settled[item.node] && item.priority === distances[item.node]) return;
    queue.pop();
  }
}

function reconstructPath(meeting, previousForward, previousBackward) {
  const forward = [];
  for (let node = meeting; node !== -1; node = previousForward[node]) forward.push(node);
  forward.reverse();
  const backward = [];
  for (let node = previousBackward[meeting]; node !== -1; node = previousBackward[node]) backward.push(node);
  return [...forward, ...backward];
}

export function bidirectionalDijkstra(graph, source, target) {
  const count = graph.adjacency.length;
  if (source < 0 || source >= count || target < 0 || target >= count) throw new Error('Source or target node is outside the graph');
  if (source === target) {
    return { found: true, distance: 0, path: [source], visitedForward: [source], visitedBackward: [], expanded: 1 };
  }

  const distanceForward = new Float64Array(count);
  const distanceBackward = new Float64Array(count);
  distanceForward.fill(Infinity);
  distanceBackward.fill(Infinity);
  const previousForward = new Int32Array(count);
  const previousBackward = new Int32Array(count);
  previousForward.fill(-1);
  previousBackward.fill(-1);
  const settledForward = new Uint8Array(count);
  const settledBackward = new Uint8Array(count);
  const queueForward = new MinPriorityQueue();
  const queueBackward = new MinPriorityQueue();
  const visitedForward = [];
  const visitedBackward = [];

  distanceForward[source] = 0;
  distanceBackward[target] = 0;
  queueForward.push(source, 0);
  queueBackward.push(target, 0);
  let bestDistance = Infinity;
  let meeting = -1;

  const expand = (queue, distances, otherDistances, previous, settled, visited) => {
    discardStale(queue, distances, settled);
    const item = queue.pop();
    if (!item) return;
    const node = item.node;
    settled[node] = 1;
    visited.push(node);
    if (otherDistances[node] < Infinity && distances[node] + otherDistances[node] < bestDistance) {
      bestDistance = distances[node] + otherDistances[node];
      meeting = node;
    }
    for (const edge of graph.adjacency[node]) {
      if (settled[edge.to]) continue;
      const candidate = distances[node] + edge.weight;
      if (candidate < distances[edge.to]) {
        distances[edge.to] = candidate;
        previous[edge.to] = node;
        queue.push(edge.to, candidate);
      }
      if (otherDistances[edge.to] < Infinity && distances[edge.to] + otherDistances[edge.to] < bestDistance) {
        bestDistance = distances[edge.to] + otherDistances[edge.to];
        meeting = edge.to;
      }
    }
  };

  while (queueForward.size && queueBackward.size) {
    discardStale(queueForward, distanceForward, settledForward);
    discardStale(queueBackward, distanceBackward, settledBackward);
    if (!queueForward.size || !queueBackward.size) break;
    if (queueForward.peekPriority() + queueBackward.peekPriority() >= bestDistance) break;
    if (queueForward.peekPriority() <= queueBackward.peekPriority()) {
      expand(queueForward, distanceForward, distanceBackward, previousForward, settledForward, visitedForward);
    } else {
      expand(queueBackward, distanceBackward, distanceForward, previousBackward, settledBackward, visitedBackward);
    }
  }

  if (meeting === -1) {
    return {
      found: false,
      distance: Infinity,
      path: [],
      visitedForward,
      visitedBackward,
      expanded: visitedForward.length + visitedBackward.length,
    };
  }
  return {
    found: true,
    distance: bestDistance,
    path: reconstructPath(meeting, previousForward, previousBackward),
    visitedForward,
    visitedBackward,
    expanded: visitedForward.length + visitedBackward.length,
  };
}
