import * as THREE from 'three';

const TAU = Math.PI * 2;
const openDomain = (extent = 7) => () => ({
  uMin: -extent, uMax: extent, vMin: -extent, vMax: extent, uPeriodic: false, vPeriodic: false,
});
const angularDomain = (vMin, vMax, vPeriodic = false) => () => ({
  uMin: 0, uMax: TAU, vMin, vMax, uPeriodic: true, vPeriodic,
});
const control = (key, label, min, max, step) => ({ key, label, min, max, step });

export const analyticSurfaces = [
  {
    id: 'sinusoidal',
    name: 'Sinusoidal terrain',
    category: 'Height fields',
    description: 'Smooth periodic hills with controllable amplitude and frequency.',
    topology: 'open',
    defaultParams: { amplitude: 1.6, frequency: 0.7 },
    controls: [control('amplitude', 'Amplitude', 0.4, 3, 0.05), control('frequency', 'Frequency', 0.3, 1.5, 0.05)],
    domain: openDomain(7),
    position(u, v, params) {
      const { amplitude: a, frequency: f } = params;
      const y = a * (0.72 * Math.sin(f * u) * Math.cos(f * v)
        + 0.28 * Math.sin(0.55 * f * u + 0.8) * Math.sin(1.25 * f * v));
      return new THREE.Vector3(u, y, v);
    },
  },
  {
    id: 'sphere', name: 'Sphere', category: 'Positive curvature',
    description: 'A closed constant-curvature manifold with great-circle geodesics.', topology: 'closed',
    defaultParams: { radius: 4 }, controls: [control('radius', 'Radius', 2, 6, 0.1)],
    domain: angularDomain(0.035, Math.PI - 0.035),
    position(u, v, { radius }) {
      return new THREE.Vector3(radius * Math.sin(v) * Math.cos(u), radius * Math.cos(v), radius * Math.sin(v) * Math.sin(u));
    },
  },
  {
    id: 'ellipsoid', name: 'Ellipsoid', category: 'Positive curvature',
    description: 'A stretched sphere with spatially varying positive curvature.', topology: 'closed',
    defaultParams: { radius: 4, polarScale: 1.45 },
    controls: [control('radius', 'Equatorial radius', 2, 5.5, 0.1), control('polarScale', 'Polar scale', 0.55, 1.8, 0.05)],
    domain: angularDomain(0.035, Math.PI - 0.035),
    position(u, v, { radius, polarScale }) {
      return new THREE.Vector3(radius * Math.sin(v) * Math.cos(u), radius * polarScale * Math.cos(v), radius * Math.sin(v) * Math.sin(u));
    },
  },
  {
    id: 'cylinder', name: 'Cylinder', category: 'Developable surfaces',
    description: 'Extrinsically curved but intrinsically flat, with angular periodicity.', topology: 'periodic',
    defaultParams: { radius: 3.2, height: 8 },
    controls: [control('radius', 'Radius', 1.5, 5, 0.1), control('height', 'Height', 4, 11, 0.2)],
    domain: (params) => ({ uMin: 0, uMax: TAU, vMin: -params.height / 2, vMax: params.height / 2, uPeriodic: true, vPeriodic: false }),
    position(u, v, { radius }) { return new THREE.Vector3(radius * Math.cos(u), v, radius * Math.sin(u)); },
  },
  {
    id: 'cone', name: 'Cone', category: 'Developable surfaces',
    description: 'A developable surface approaching a concentrated-curvature apex.', topology: 'periodic',
    defaultParams: { radius: 4.2, height: 7 },
    controls: [control('radius', 'Base radius', 2, 6, 0.1), control('height', 'Height', 3, 10, 0.2)],
    domain: angularDomain(0.035, 1),
    position(u, v, { radius, height }) { return new THREE.Vector3(radius * v * Math.cos(u), height * (v - 0.5), radius * v * Math.sin(u)); },
  },
  {
    id: 'torus', name: 'Torus', category: 'Nontrivial topology',
    description: 'A genus-one manifold with positive and negative curvature regions.', topology: 'doubly-periodic',
    defaultParams: { majorRadius: 4, minorRadius: 1.45 },
    controls: [control('majorRadius', 'Major radius', 2.5, 5.5, 0.1), control('minorRadius', 'Tube radius', 0.6, 2, 0.05)],
    domain: angularDomain(0, TAU, true),
    position(u, v, { majorRadius: R, minorRadius: r }) {
      return new THREE.Vector3((R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u));
    },
  },
  {
    id: 'paraboloid', name: 'Paraboloid', category: 'Quadratic surfaces',
    description: 'A smooth bowl with increasing positive curvature toward its centre.', topology: 'open',
    defaultParams: { curvature: 0.2, extent: 4.5 },
    controls: [control('curvature', 'Curvature', 0.06, 0.45, 0.01), control('extent', 'Extent', 3, 6, 0.1)],
    domain: (params) => openDomain(params.extent)(),
    position(u, v, { curvature }) { return new THREE.Vector3(u, curvature * (u * u + v * v) - 2.2, v); },
  },
  {
    id: 'hyperbolic-paraboloid', name: 'Hyperbolic paraboloid', category: 'Negative curvature',
    description: 'A saddle surface exhibiting negative Gaussian curvature.', topology: 'open',
    defaultParams: { curvature: 0.18, extent: 4.5 },
    controls: [control('curvature', 'Curvature', 0.05, 0.4, 0.01), control('extent', 'Extent', 3, 6, 0.1)],
    domain: (params) => openDomain(params.extent)(),
    position(u, v, { curvature }) { return new THREE.Vector3(u, curvature * (u * u - v * v), v); },
  },
  {
    id: 'gaussian-hill', name: 'Gaussian hill', category: 'Height fields',
    description: 'A localized smooth hill with a flat far field.', topology: 'open',
    defaultParams: { height: 4, width: 2.2 },
    controls: [control('height', 'Hill height', 1, 6, 0.1), control('width', 'Hill width', 1, 4, 0.1)],
    domain: openDomain(7),
    position(u, v, { height, width }) { return new THREE.Vector3(u, height * Math.exp(-(u * u + v * v) / (2 * width * width)), v); },
  },
  {
    id: 'surface-of-revolution', name: 'Surface of revolution', category: 'Generated surfaces',
    description: 'A vase-like profile rotated around a vertical axis.', topology: 'periodic',
    defaultParams: { height: 7, bulge: 1.1 },
    controls: [control('height', 'Height', 4, 10, 0.2), control('bulge', 'Profile bulge', 0.2, 1.8, 0.05)],
    domain: angularDomain(-1, 1),
    position(u, v, { height, bulge }) {
      const radius = 2.4 + bulge * (0.55 * Math.cos(Math.PI * v) + 0.25 * Math.cos(2 * Math.PI * v));
      return new THREE.Vector3(radius * Math.cos(u), (height / 2) * v, radius * Math.sin(u));
    },
  },
  {
    id: 'catenoid', name: 'Catenoid', category: 'Minimal surfaces',
    description: 'A minimal surface with a narrow geodesic bottleneck.', topology: 'periodic',
    defaultParams: { neck: 1.5, extent: 1.25 },
    controls: [control('neck', 'Neck radius', 0.8, 2.3, 0.05), control('extent', 'Vertical extent', 0.7, 1.6, 0.05)],
    domain: (params) => angularDomain(-params.extent, params.extent)(),
    position(u, v, { neck }) {
      const radius = neck * Math.cosh(v);
      return new THREE.Vector3(radius * Math.cos(u), neck * v, radius * Math.sin(u));
    },
  },
  {
    id: 'helicoid', name: 'Helicoid', category: 'Minimal surfaces',
    description: 'A twisted minimal surface with controllable turns and pitch.', topology: 'open',
    defaultParams: { turns: 2.2, pitch: 2 },
    controls: [control('turns', 'Turns', 1, 3.5, 0.1), control('pitch', 'Pitch', 0.8, 3.5, 0.1)],
    domain: (params) => ({ uMin: 0, uMax: TAU * params.turns, vMin: -4, vMax: 4, uPeriodic: false, vPeriodic: false }),
    position(u, v, { turns, pitch }) {
      return new THREE.Vector3(v * Math.cos(u), pitch * (u / TAU - turns / 2), v * Math.sin(u));
    },
  },
  {
    id: 'mobius', name: 'Möbius strip', category: 'Non-orientable',
    description: 'A one-sided strip with a half twist and a protected parameter seam.', topology: 'twisted-periodic',
    defaultParams: { radius: 3.8, width: 1.2 },
    controls: [control('radius', 'Loop radius', 2.5, 5, 0.1), control('width', 'Half width', 0.6, 1.7, 0.05)],
    domain: (params) => ({ uMin: 0, uMax: TAU, vMin: -params.width, vMax: params.width, uPeriodic: true, vPeriodic: false }),
    position(u, v, { radius }) {
      const radial = radius + v * Math.cos(u / 2);
      return new THREE.Vector3(radial * Math.cos(u), v * Math.sin(u / 2), radial * Math.sin(u));
    },
  },
  {
    id: 'klein-bottle', name: 'Klein bottle immersion', category: 'Non-orientable',
    description: 'A self-intersecting 3D immersion of a closed non-orientable surface.', topology: 'doubly-periodic',
    defaultParams: { scale: 1.45 }, controls: [control('scale', 'Scale', 0.8, 2, 0.05)],
    domain: angularDomain(0, TAU, true),
    position(u, v, { scale: s }) {
      const common = 2.8 + Math.cos(u / 2) * Math.sin(v) - Math.sin(u / 2) * Math.sin(2 * v);
      return new THREE.Vector3(
        s * common * Math.cos(u),
        s * (Math.sin(u / 2) * Math.sin(v) + Math.cos(u / 2) * Math.sin(2 * v)),
        s * common * Math.sin(u),
      );
    },
  },
];

