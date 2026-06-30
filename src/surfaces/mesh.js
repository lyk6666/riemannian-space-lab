export const meshSurfaces = [
  {
    id: 'stanford-bunny',
    name: 'Stanford Bunny',
    category: 'Classic benchmark',
    description: 'The standard Stanford scanning benchmark with face-painted obstacles.',
    kind: 'mesh',
    topology: 'mesh',
    builtinMeshUrl: '/models/stanford-bunny.ply',
    attribution: 'Stanford Computer Graphics Laboratory',
    defaultParams: { brushRings: 2 },
    controls: [{ key: 'brushRings', label: 'Obstacle brush rings', min: 0, max: 6, step: 1 }],
  },
  {
    id: 'imported-mesh',
    name: 'Import OBJ / PLY / STL',
    category: 'User mesh',
    description: 'Load an arbitrary triangle mesh and paint obstacle faces directly.',
    kind: 'mesh',
    topology: 'mesh',
    acceptsMesh: true,
    defaultParams: { brushRings: 2 },
    controls: [{ key: 'brushRings', label: 'Obstacle brush rings', min: 0, max: 6, step: 1 }],
  },
];

