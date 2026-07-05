import { buildContractionHierarchy } from './contractionHierarchy.js';

function validatePartition(baseGraph) {
  const partition = baseGraph.partition;
  if (!partition || partition.type !== 'uniform-grid') {
    throw new Error('Nested-dissection CH requires a uniformly sampled parameter grid');
  }
  const expected = (partition.resolution + 1) ** 2;
  if (partition.gridNodeIds.length !== expected) throw new Error('Uniform-grid partition metadata is inconsistent');
  return partition;
}

export function createNestedDissectionOrder(baseGraph, requestedLeafSize = 16) {
  const partition = validatePartition(baseGraph);
  const resolution = partition.resolution;
  const leafSize = Math.max(2, Math.min(resolution, Math.floor(requestedLeafSize)));
  const gridWidth = resolution + 1;
  const assigned = new Uint8Array(baseGraph.nodes.length);
  const regionOfNode = new Int32Array(baseGraph.nodes.length);
  const separatorLevel = new Int16Array(baseGraph.nodes.length);
  regionOfNode.fill(-1);
  separatorLevel.fill(-1);
  const order = [];
  let regionCount = 0;

  const nodeAt = (i, j) => partition.gridNodeIds[j * gridWidth + i];
  const append = (node, region, separatorDepth) => {
    if (assigned[node]) return false;
    assigned[node] = 1;
    order.push(node);
    if (region >= 0) regionOfNode[node] = region;
    if (separatorDepth >= 0) separatorLevel[node] = separatorDepth;
    return true;
  };

  const recurse = (i0, i1, j0, j1, depth) => {
    if (i0 > i1 || j0 > j1) return;
    const widthCells = Math.max(0, i1 - i0);
    const heightCells = Math.max(0, j1 - j0);
    if (widthCells <= leafSize && heightCells <= leafSize) {
      const region = regionCount;
      let populated = false;
      for (let j = j0; j <= j1; j += 1) {
        for (let i = i0; i <= i1; i += 1) populated = append(nodeAt(i, j), region, -1) || populated;
      }
      if (populated) regionCount += 1;
      return;
    }

    const splitI = widthCells > leafSize ? Math.floor((i0 + i1) / 2) : -1;
    const splitJ = heightCells > leafSize ? Math.floor((j0 + j1) / 2) : -1;
    const iRanges = splitI >= 0 ? [[i0, splitI - 1], [splitI + 1, i1]] : [[i0, i1]];
    const jRanges = splitJ >= 0 ? [[j0, splitJ - 1], [splitJ + 1, j1]] : [[j0, j1]];
    for (const [childJ0, childJ1] of jRanges) {
      for (const [childI0, childI1] of iRanges) recurse(childI0, childI1, childJ0, childJ1, depth + 1);
    }
    if (splitJ >= 0) {
      for (let i = i0; i <= i1; i += 1) append(nodeAt(i, splitJ), -1, depth);
    }
    if (splitI >= 0) {
      for (let j = j0; j <= j1; j += 1) append(nodeAt(splitI, j), -1, depth);
    }
  };

  const rootI0 = partition.uPeriodic ? 1 : 0;
  const rootI1 = partition.uPeriodic ? resolution - 1 : resolution;
  const rootJ0 = partition.vPeriodic ? 1 : 0;
  const rootJ1 = partition.vPeriodic ? resolution - 1 : resolution;
  recurse(rootI0, rootI1, rootJ0, rootJ1, 0);
  if (partition.uPeriodic) {
    for (let j = 0; j <= resolution; j += 1) append(nodeAt(0, j), -1, 0);
  }
  if (partition.vPeriodic) {
    for (let i = 0; i <= resolution; i += 1) append(nodeAt(i, 0), -1, 0);
  }
  for (let node = 0; node < baseGraph.nodes.length; node += 1) append(node, -1, 0);
  let separatorCount = 0;
  for (const level of separatorLevel) if (level >= 0) separatorCount += 1;
  return {
    order: Int32Array.from(order),
    regionOfNode,
    separatorLevel,
    regionCount,
    separatorCount,
    leafSize,
  };
}

export function buildNestedDissectionHierarchy(baseGraph, options = {}) {
  const partition = createNestedDissectionOrder(baseGraph, options.leafSize ?? 16);
  const hierarchy = buildContractionHierarchy(baseGraph, {
    order: partition.order,
    onProgress: options.onProgress,
    isCancelled: options.isCancelled,
  });
  return {
    ...hierarchy,
    ordering: 'nested-dissection',
    leafSize: partition.leafSize,
    regionOfNode: partition.regionOfNode,
    separatorLevel: partition.separatorLevel,
    regionCount: partition.regionCount,
    separatorCount: partition.separatorCount,
    memoryBytes: hierarchy.memoryBytes + partition.regionOfNode.byteLength + partition.separatorLevel.byteLength,
  };
}
