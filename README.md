# Beam & Frame Sketchbook

**Live site:** https://rahulwala10.github.io/beam-frame-sketchbook/

Sixty-six beams, frames, trusses and arches on graph-paper sheets, each one a live finite element model running in your browser.

Grab any point on a structure and pull it, then let go and watch it spring back. Tap a load arrow to apply or remove it, or drag it along the members. Switch between bending moment, shear and axial force, and open any structure for sliders, reactions and textbook hand checks.

The idea started from Awatif's [Push it. Pull it. Watch it deflect.](https://awatif.co/examples/interactive/), a sheet of eight draggable structures. This project takes the same idea much further. It has eight times as many structures, each with notes and checks, a solver you can read, and a test suite that holds it to the textbook.

## What you can do

**Five sheets, 66 structures**

| Sheet | Structures | Includes |
|---|---|---|
| Single spans | 14 | Cantilevers, simple spans, propped and fixed-ended beams, settlement, sliding clamp |
| Continuous & Gerber | 14 | Overhangs, two- and three-span beams, pattern loading, Gerber hinges, spring supports, moving load |
| Portals & gables | 14 | Fixed, pinned and three-pinned portals under gravity and wind, stiffness ratios, ties, pitched portals |
| Frames & bracing | 14 | Bent cantilevers, multi-bay and multi-storey frames, braced, X-braced and chevron frames, Vierendeel, sloping site |
| Trusses & arches | 10 | Pratt, Howe, Warren, king post, wall bracket, parabolic, three-pinned, semicircular and tied arches |

**On every sheet**

- **Pull a structure.** The pointer holds the structure with a spring tuned to that point's softest direction. Where the structure is flexible it follows you; where it is stiff (along a member, say) it hardly moves. The force you are applying is shown as you drag.
- **Let go and it springs back.** The structure vibrates back to equilibrium using real dynamics: consistent mass, Newmark time stepping and Rayleigh damping, slowed down so one period lasts about a second.
- **Loads.** Tap an arrow to apply or remove a load (it ramps on dynamically). Drag point loads and couples anywhere along the members. There are also Apply all, Remove all and Reset buttons.
- **Diagrams.** Bending moment is drawn on the tension side with hand-style hatching. Shear is also available. Axial force is drawn as tension and compression bands.
- **Show** reactions with their values, peak values, the largest deflection, and points of contraflexure.
- **Same scale** draws every structure on a sheet at one deflection and force scale, so a braced frame really does look stiffer than an unbraced one.
- **Sketch first** hides the answers. You sketch the deflected shape and bending moment yourself, then reveal and watch the loads drop on.
- **Themes**: a green computation pad by day and a blueprint by night. The layout also works on a phone.

**Open any structure** (click its title) for:

- Sliders for span, height, load, stiffness ratio, hinge position, spring stiffness, settlement and so on, depending on the structure.
- Load toggles.
- A reactions table and peak values, with their locations.
- **Hand checks**: textbook formulas next to the model's answer, with the percentage difference.
- Shear, moment and deflection diagrams plotted along the beam (for beams).
- The degree of indeterminacy (3m + r − 3j − c), an equilibrium check, the element count and the natural period.

Links go straight to a sheet or a structure: `#portals`, `#portal-fixed-sway`, `#arch-three-pin-half` and so on.

## The engine

The solver is small and dependency-free, in `src/engine/`.

- **Elements.** Euler–Bernoulli plane frame elements with three DOFs per node. Each member is split into up to 14 elements so it can be grabbed anywhere and bends smoothly.
- **Hinges and pin-jointed bars** use static condensation. Joints with no rotational stiffness (pure truss joints) are restrained automatically.
- **Loads.** Point loads, couples, and uniform, triangular, partial, projected and normal (wind) distributed loads, plus support settlement and spring supports. Fixed-end forces are exact: they are work-equivalent loads integrated with Gauss quadrature over the Hermite shape functions.
- **Solver.** A banded LDLᵀ factorisation after reverse Cuthill–McKee ordering. A zero pivot is reported as a mechanism instead of producing nonsense.
- **Results.** Internal forces are found by exact statics along each element, and the deflected shape by Hermite interpolation. Reactions, extremes, contraflexure points and equilibrium residuals are reported too.
- **Dynamics.** Consistent mass matrices, Newmark average-acceleration time stepping and 10% Rayleigh damping. The fundamental period comes from inverse iteration.

Units are kN, m and mm throughout. The default section is steel with E = 200 GPa, I = 2.0 × 10⁻⁴ m⁴ and A = 8.0 × 10⁻³ m², giving EI = 40,000 kN·m².

## Verification

`npm test` runs 275 checks.

- **25 engine tests** compare the solver with closed-form results. They cover simply supported, cantilever, propped and fixed-ended beams under point, uniform, triangular and couple loads, plus settlement, inclined members, continuous beams, Gerber beams, spring supports, Kleinlogel's portal-frame formulas, a pin-jointed truss, and the pull, spring-back and mechanism behaviour.
- **Every one of the 66 examples** is checked to solve without a mechanism, satisfy global equilibrium, match its own hand checks and spring back to its static position after a pull.

Where a hand formula ignores axial shortening, the detail view says so, and the difference is usually under 1.5%.

## Getting started

```bash
npm install
npm run dev            # local development server
npm test               # the 275 checks
npm run build          # static site in dist/
npm run build:single   # one self-contained HTML file in dist-single/
npm run build:artifact # the same file without <html>/<head>/<body>, for hosts that add their own
```

Requires Node 20 or newer. The only runtime dependency is Google Fonts (Barlow, Barlow Condensed and IBM Plex Mono). If they cannot load, the page falls back to system fonts.

## Project layout

```
src/
  engine/       finite element core: types, banded solver, element, model, dynamics, results, determinacy
  examples/     the 66 structures, one file per sheet, plus builders and hand-check helpers
  ui/           canvas renderer and interaction, cards, sheets, detail view, charts, settings, theme
  main.ts       page shell: title block, sheet tabs, toolbar, routing
  styles.css
tests/
  engine.test.ts     solver against closed-form results
  examples.test.ts   every example: solves, balances, matches its checks, springs back
scripts/
  artifact.mjs
```

## Adding a structure

Add an entry to the sheet file in `src/examples/`. Geometry comes from `build(params)`, and hand checks are optional.

```ts
{
  id: 'ss-udl',
  sheet: 'spans',
  title: 'Simply supported, uniform load',
  blurb: 'The most common beam in practice.',
  notes: ['Shear crosses zero at mid-span, where the moment peaks at wL²/8.'],
  params: [range('L', 'Span', 3, 10, 0.5, 6, 'm'), range('w', 'Load', 2, 30, 1, 10, 'kN/m')],
  build: (p) => ({
    ...beamLine([0, num(p, 'L')]),
    supports: [sup(0, 'pin'), sup(1, 'roller')],
    loads: [udl([0], num(p, 'w'))],
  }),
  checks: (c) => [chk('Mid-span moment', 'wL²/8', (num(c.p, 'w') * num(c.p, 'L') ** 2) / 8, c.M(0, 0.5), 'kNm')],
}
```

The test suite picks the new structure up automatically.

## Conventions

- Global axes: x to the right, y up. Anticlockwise moments are positive.
- Bending moment is positive when sagging, meaning tension on the member's local −y face. Diagrams are always drawn on the tension side.
- Axial force is positive in tension.
- Reactions are the forces the supports apply to the structure.

## Deployment

Every push to `main` runs the tests and publishes `dist/` to GitHub Pages (`.github/workflows/pages.yml`). In the repository settings, set **Pages → Source** to **GitHub Actions** once.

## License

MIT. See [LICENSE](LICENSE).
