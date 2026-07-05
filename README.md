# Riemannian Space Lab

An interactive browser environment for defining and solving mesh-based shortest-path problems on curved Riemannian surfaces. It supports analytical parameterizations, heightmaps, imported triangle meshes, obstacle placement, unindexed baselines, and an ALT landmark index.

## Documentation

- [Index-method survey](riemannian-shortest-path-index-methods.md)

## Run locally

```powershell
pnpm.cmd install
pnpm.cmd dev
```

Open the local address printed by Vite, normally `http://127.0.0.1:5173`.

Run the deterministic geometry and import checks with:

```powershell
pnpm.cmd test
```

## Controls

- Adjust surface parameters, mesh resolution (up to 256), and surface colour from the left panel.
- Choose **Source** or **Destination**, then click the surface.
- Choose **Obstacle**, click at least three vertices, then select **Close polygon**.
- Choose **Dijkstra**, **Bidirectional Dijkstra**, or **Landmark A*** and select **Compute path**.
- For Landmark A*, choose the landmark count and run **Build landmark index** before querying.
- Toggle **Show expanded vertices** to inspect the search region.
- Drag to orbit, scroll to zoom, and right-drag to pan in navigation mode.

## Mathematical model

The surface is a height field

\[
r(x,y)=(x,y,f(x,y)),
\]

with the induced Riemannian metric

\[
g=J^T J=
\begin{bmatrix}
1+f_x^2 & f_xf_y\\
f_xf_y & 1+f_y^2
\end{bmatrix}.
\]

The default colour map displays the local area distortion

\[
\sqrt{\det g}=\sqrt{1+f_x^2+f_y^2}.
\]

## Current scope

- Curved, non-flat height-field manifold
- Interactive terrain controls
- Arbitrary source and destination placement
- Multiple polygonal obstacles clipped directly to the rendered terrain triangles
- Validation for duplicate vertices, negligible area, and self-intersecting obstacle edges
- Protection against placing query points inside obstacles
- Classic Dijkstra and bidirectional Dijkstra baselines
- ALT Landmark A* with farthest-point landmark selection and reusable distance tables
- Component-aware landmark allocation for obstacle-disconnected graphs
- Temporary source and destination graph nodes shared by every algorithm
- Riemannian midpoint edge weights on parameterized surfaces
- Euclidean intrinsic edge weights on imported triangle meshes
- Path length, expanded-vertex count, runtime, and search-front visualization
- Automatic local persistence

All implemented algorithms return the same exact shortest path on the finite mesh graph. The route approximates the continuous geodesic because it is restricted to mesh edges. Geometry, resolution, or obstacle changes invalidate the landmark index; moving only the source or destination preserves it. Contraction Hierarchies appears in the selector as a disabled future method.

## Built-in analytical spaces

The configuration modal currently includes sinusoidal terrain, sphere, ellipsoid,
cylinder, cone, torus, paraboloid, hyperbolic paraboloid, Gaussian hill, surface
of revolution, catenoid, helicoid, Möbius strip, and a Klein-bottle immersion.
Periodic parameter seams are protected: obstacles must remain on one side of a
seam so that their polygon representation stays unambiguous.

The catalogue also includes a Poincaré disk with its hyperbolic metric and a
heightmap/DEM mode. Heightmaps accept PNG or JPEG files and are downsampled to a
maximum dimension of 128 pixels for interactive evaluation.

OBJ, PLY, and STL triangle meshes can be imported from the configuration modal.
Imported meshes use connected face painting for obstacles, with a configurable
brush-ring radius. A reduced Stanford Bunny from the Stanford 3D Scanning
Repository is bundled as a classic benchmark; attribution is recorded in
`public/models/ATTRIBUTION.md`.

## Source structure

```text
src/
├── geometry/             # surfaces, obstacles, and imported meshes
├── pathfinding/
│   ├── dijkstra.js
│   ├── bidirectionalDijkstra.js
│   ├── landmarkIndex.js
│   └── meshGraph.js
├── rendering/            # markers and WebGL resource disposal
├── state/                # scene schema, persistence, and import state
├── surfaces/             # available spaces and parameterizations
├── main.js               # Three.js scene and application event wiring
└── style.css             # application layout and visual design
```
