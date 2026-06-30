# Riemannian Space Lab

An interactive browser environment for defining a shortest-path problem on a curved Riemannian surface. This first stage visualizes a sinusoidal manifold and allows users to place a source, destination, and polygonal obstacle regions. It intentionally does not compute a path yet.

## Documentation

- [Index-method survey](riemannian-shortest-path-index-methods.md)

## Run locally

```powershell
pnpm install
pnpm dev
```

Open the local address printed by Vite, normally `http://127.0.0.1:5173`.

## Controls

- Adjust amplitude, frequency, mesh resolution, and surface colour from the left panel.
- Choose **Source** or **Destination**, then click the surface.
- Choose **Obstacle**, click at least three vertices, then select **Close polygon**.
- Use **Export** and **Import** to store and restore the complete setup as JSON.
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
- Local persistence and JSON import/export
- No shortest-path computation yet

## Built-in analytical spaces

The configuration modal currently includes sinusoidal terrain, sphere, ellipsoid,
cylinder, cone, torus, paraboloid, hyperbolic paraboloid, Gaussian hill, surface
of revolution, catenoid, helicoid, Möbius strip, and a Klein-bottle immersion.
Periodic parameter seams are protected: obstacles must remain on one side of a
seam so that their polygon representation stays unambiguous.

The catalogue also includes a Poincaré disk with its hyperbolic metric and a
heightmap/DEM mode. Heightmaps accept PNG or JPEG files, are downsampled to a
maximum dimension of 128 pixels for interactive evaluation, and remain embedded
in exported scene JSON.

## Source structure

```text
src/
├── geometry/
│   ├── surface.js       # generic parametric metric and terrain mesh
│   └── obstacles.js     # polygon validation and surface clipping
├── rendering/
│   └── markers.js       # query markers and WebGL resource disposal
├── state/
│   └── sceneState.js    # scene schema, persistence, and import state
├── surfaces/
│   └── registry.js      # available spaces and their parameterizations
├── main.js              # Three.js scene and application event wiring
└── style.css            # application layout and visual design
```
