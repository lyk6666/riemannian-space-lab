import { buildContractionHierarchy } from '../pathfinding/contractionHierarchy.js';

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'build') return;
  try {
    const index = buildContractionHierarchy(event.data.graph, {
      onProgress(progress) {
        self.postMessage({ type: 'progress', progress });
      },
    });
    self.postMessage({ type: 'complete', index });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
});
