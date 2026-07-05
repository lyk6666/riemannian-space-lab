import { buildContractionHierarchy } from '../pathfinding/contractionHierarchy.js';
import { buildNestedDissectionHierarchy } from '../pathfinding/nestedDissection.js';

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'build') return;
  try {
    const options = {
      onProgress(progress) {
        self.postMessage({ type: 'progress', progress });
      },
    };
    let index;
    if (event.data.ordering === 'nested-dissection' && event.data.graph.partition) {
      index = buildNestedDissectionHierarchy(event.data.graph, {
        ...options,
        leafSize: event.data.leafSize,
      });
    } else {
      index = buildContractionHierarchy(event.data.graph, options);
      if (event.data.ordering === 'nested-dissection') {
        index.requestedOrdering = 'nested-dissection';
        index.fallback = true;
      }
    }
    self.postMessage({ type: 'complete', index });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
});
