# Riemannian Space Lab

An interactive browser environment for defining a shortest-path problem on a curved Riemannian surface. This first stage visualizes a sinusoidal manifold and allows users to place a source, destination, and polygonal obstacle regions. It intentionally does not compute a path yet.

## Documentation

- [Project report](docs/RiemannGL.pdf)
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
- Multiple polygonal obstacles
- Local persistence and JSON import/export
- No shortest-path computation yet
