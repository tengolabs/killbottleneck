# Third-party notices

killBottleneck itself is distributed under the [Sustainable Use License](./LICENSE) (fair-code).
This file lists the third-party components it ships and their own licenses, which continue to
apply to those components.

Nothing here is copyleft — every dependency below is a permissive license (MIT, ISC, Apache-2.0,
BSD, Zlib, 0BSD, MPL-2.0-or-Apache-2.0). Full license texts are inside each package under
`node_modules/`, and in the fonts' `OFL.txt` upstream.

## Fonts (bundled in `frontend/public/fonts/`)

| Font | Author | License |
| --- | --- | --- |
| Inter | Rasmus Andersson | SIL Open Font License 1.1 |
| Plus Jakarta Sans | Tokotype | SIL Open Font License 1.1 |

The fonts are served from your own instance on purpose — killBottleneck must not send your
users' IP addresses to a third-party font CDN.

## Runtime, backend

| Component | License |
| --- | --- |
| PocketBase | MIT |

## Runtime, frontend (252 packages)

| Package | Version | License |
| --- | --- | --- |
| `@alloc/quick-lru` | 5.2.0 | MIT |
| `@babel/runtime` | 7.29.7 | MIT |
| `@dnd-kit/accessibility` | 3.1.1 | MIT |
| `@dnd-kit/core` | 6.3.1 | MIT |
| `@dnd-kit/utilities` | 3.2.2 | MIT |
| `@floating-ui/core` | 1.7.5 | MIT |
| `@floating-ui/dom` | 1.7.6 | MIT |
| `@floating-ui/react-dom` | 2.1.8 | MIT |
| `@floating-ui/utils` | 0.2.11 | MIT |
| `@hookform/resolvers` | 4.1.3 | MIT |
| `@jridgewell/gen-mapping` | 0.3.13 | MIT |
| `@jridgewell/resolve-uri` | 3.1.2 | MIT |
| `@jridgewell/sourcemap-codec` | 1.5.5 | MIT |
| `@jridgewell/trace-mapping` | 0.3.31 | MIT |
| `@nodelib/fs.scandir` | 2.1.5 | MIT |
| `@nodelib/fs.stat` | 2.0.5 | MIT |
| `@nodelib/fs.walk` | 1.2.8 | MIT |
| `@radix-ui/number` | 1.1.2 | MIT |
| `@radix-ui/primitive` | 1.1.5 | MIT |
| `@radix-ui/react-accordion` | 1.2.16 | MIT |
| `@radix-ui/react-alert-dialog` | 1.1.19 | MIT |
| `@radix-ui/react-arrow` | 1.1.11 | MIT |
| `@radix-ui/react-aspect-ratio` | 1.1.11 | MIT |
| `@radix-ui/react-avatar` | 1.2.2 | MIT |
| `@radix-ui/react-checkbox` | 1.3.7 | MIT |
| `@radix-ui/react-collapsible` | 1.1.16 | MIT |
| `@radix-ui/react-collection` | 1.1.12 | MIT |
| `@radix-ui/react-compose-refs` | 1.1.3 | MIT |
| `@radix-ui/react-context` | 1.2.0 | MIT |
| `@radix-ui/react-context-menu` | 2.3.3 | MIT |
| `@radix-ui/react-dialog` | 1.1.19 | MIT |
| `@radix-ui/react-direction` | 1.1.2 | MIT |
| `@radix-ui/react-dismissable-layer` | 1.1.15 | MIT |
| `@radix-ui/react-dropdown-menu` | 2.1.20 | MIT |
| `@radix-ui/react-focus-guards` | 1.1.4 | MIT |
| `@radix-ui/react-focus-scope` | 1.1.12 | MIT |
| `@radix-ui/react-hover-card` | 1.1.19 | MIT |
| `@radix-ui/react-id` | 1.1.2 | MIT |
| `@radix-ui/react-label` | 2.1.11 | MIT |
| `@radix-ui/react-menu` | 2.1.20 | MIT |
| `@radix-ui/react-menubar` | 1.1.20 | MIT |
| `@radix-ui/react-navigation-menu` | 1.2.18 | MIT |
| `@radix-ui/react-popover` | 1.1.19 | MIT |
| `@radix-ui/react-popper` | 1.3.3 | MIT |
| `@radix-ui/react-portal` | 1.1.13 | MIT |
| `@radix-ui/react-presence` | 1.1.7 | MIT |
| `@radix-ui/react-primitive` | 2.1.7 | MIT |
| `@radix-ui/react-progress` | 1.1.12 | MIT |
| `@radix-ui/react-radio-group` | 1.4.3 | MIT |
| `@radix-ui/react-roving-focus` | 1.1.15 | MIT |
| `@radix-ui/react-scroll-area` | 1.2.14 | MIT |
| `@radix-ui/react-select` | 2.3.3 | MIT |
| `@radix-ui/react-separator` | 1.1.11 | MIT |
| `@radix-ui/react-slider` | 1.4.3 | MIT |
| `@radix-ui/react-slot` | 1.3.0 | MIT |
| `@radix-ui/react-switch` | 1.3.3 | MIT |
| `@radix-ui/react-tabs` | 1.1.17 | MIT |
| `@radix-ui/react-toast` | 1.2.19 | MIT |
| `@radix-ui/react-toggle` | 1.1.14 | MIT |
| `@radix-ui/react-toggle-group` | 1.1.15 | MIT |
| `@radix-ui/react-tooltip` | 1.2.12 | MIT |
| `@radix-ui/react-use-callback-ref` | 1.1.2 | MIT |
| `@radix-ui/react-use-controllable-state` | 1.2.3 | MIT |
| `@radix-ui/react-use-effect-event` | 0.0.3 | MIT |
| `@radix-ui/react-use-is-hydrated` | 0.1.1 | MIT |
| `@radix-ui/react-use-layout-effect` | 1.1.2 | MIT |
| `@radix-ui/react-use-previous` | 1.1.2 | MIT |
| `@radix-ui/react-use-rect` | 1.1.2 | MIT |
| `@radix-ui/react-use-size` | 1.1.2 | MIT |
| `@radix-ui/react-visually-hidden` | 1.2.7 | MIT |
| `@radix-ui/rect` | 1.1.2 | MIT |
| `@remix-run/router` | 1.23.3 | MIT |
| `@standard-schema/utils` | 0.3.0 | MIT |
| `@types/d3-array` | 3.2.2 | MIT |
| `@types/d3-color` | 3.1.3 | MIT |
| `@types/d3-drag` | 3.0.7 | MIT |
| `@types/d3-ease` | 3.0.2 | MIT |
| `@types/d3-interpolate` | 3.0.4 | MIT |
| `@types/d3-path` | 3.1.1 | MIT |
| `@types/d3-scale` | 4.0.9 | MIT |
| `@types/d3-selection` | 3.0.11 | MIT |
| `@types/d3-shape` | 3.1.8 | MIT |
| `@types/d3-time` | 3.0.4 | MIT |
| `@types/d3-timer` | 3.0.2 | MIT |
| `@types/d3-transition` | 3.0.9 | MIT |
| `@types/d3-zoom` | 3.0.8 | MIT |
| `@types/pako` | 2.0.4 | MIT |
| `@types/raf` | 3.4.3 | MIT |
| `@types/trusted-types` | 2.0.7 | MIT |
| `@xyflow/react` | 12.11.2 | MIT |
| `@xyflow/system` | 0.0.79 | MIT |
| `any-promise` | 1.3.0 | MIT |
| `anymatch` | 3.1.3 | ISC |
| `arg` | 5.0.2 | MIT |
| `aria-hidden` | 1.2.6 | MIT |
| `base64-arraybuffer` | 1.0.2 | MIT |
| `binary-extensions` | 2.3.0 | MIT |
| `braces` | 3.0.3 | MIT |
| `camelcase-css` | 2.0.1 | MIT |
| `canvg` | 3.0.11 | MIT |
| `chokidar` | 3.6.0 | MIT |
| `class-variance-authority` | 0.7.1 | Apache-2.0 |
| `classcat` | 5.0.5 | MIT |
| `clsx` | 2.1.1 | MIT |
| `cmdk` | 1.1.1 | MIT |
| `commander` | 4.1.1 | MIT |
| `core-js` | 3.49.0 | MIT |
| `css-line-break` | 2.1.0 | MIT |
| `cssesc` | 3.0.0 | MIT |
| `csstype` | 3.2.3 | MIT |
| `d3-array` | 3.2.4 | ISC |
| `d3-color` | 3.1.0 | ISC |
| `d3-dispatch` | 3.0.1 | ISC |
| `d3-drag` | 3.0.0 | ISC |
| `d3-ease` | 3.0.1 | BSD-3-Clause |
| `d3-format` | 3.1.2 | ISC |
| `d3-interpolate` | 3.0.1 | ISC |
| `d3-path` | 3.1.0 | ISC |
| `d3-scale` | 4.0.2 | ISC |
| `d3-selection` | 3.0.0 | ISC |
| `d3-shape` | 3.2.0 | ISC |
| `d3-time` | 3.1.0 | ISC |
| `d3-time-format` | 4.1.0 | ISC |
| `d3-timer` | 3.0.1 | ISC |
| `d3-transition` | 3.0.1 | ISC |
| `d3-zoom` | 3.0.0 | ISC |
| `date-fns` | 3.6.0 | MIT |
| `decimal.js-light` | 2.5.1 | MIT |
| `detect-node-es` | 1.1.0 | MIT |
| `didyoumean` | 1.2.2 | Apache-2.0 |
| `dlv` | 1.1.3 | MIT |
| `dom-helpers` | 5.2.1 | MIT |
| `dompurify` | 3.4.11 | (MPL-2.0 OR Apache-2.0) |
| `embla-carousel` | 8.6.0 | MIT |
| `embla-carousel-react` | 8.6.0 | MIT |
| `embla-carousel-reactive-utils` | 8.6.0 | MIT |
| `es-errors` | 1.3.0 | MIT |
| `eventemitter3` | 4.0.7 | MIT |
| `fast-equals` | 5.4.1 | MIT |
| `fast-glob` | 3.3.3 | MIT |
| `fast-png` | 6.4.0 | MIT |
| `fastq` | 1.20.1 | ISC |
| `fdir` | 6.5.0 | MIT |
| `fflate` | 0.8.3 | MIT |
| `fill-range` | 7.1.1 | MIT |
| `function-bind` | 1.1.2 | MIT |
| `get-nonce` | 1.0.1 | MIT |
| `glob-parent` | 5.1.2 | ISC |
| `glob-parent` | 5.1.2 | ISC |
| `glob-parent` | 6.0.2 | ISC |
| `goober` | 2.1.19 | MIT |
| `hasown` | 2.0.4 | MIT |
| `html-parse-stringify` | 4.0.1 | MIT |
| `html-to-image` | 1.11.13 | MIT |
| `html2canvas` | 1.4.1 | MIT |
| `i18next` | 26.3.6 | MIT |
| `input-otp` | 1.4.2 | MIT |
| `internmap` | 2.0.3 | ISC |
| `iobuffer` | 5.4.0 | MIT |
| `is-binary-path` | 2.1.0 | MIT |
| `is-core-module` | 2.16.2 | MIT |
| `is-extglob` | 2.1.1 | MIT |
| `is-glob` | 4.0.3 | MIT |
| `is-number` | 7.0.0 | MIT |
| `jiti` | 1.21.7 | MIT |
| `js-tokens` | 4.0.0 | MIT |
| `jspdf` | 4.2.1 | MIT |
| `lilconfig` | 3.1.3 | MIT |
| `lines-and-columns` | 1.2.4 | MIT |
| `lodash` | 4.18.1 | MIT |
| `loose-envify` | 1.4.0 | MIT |
| `lucide-react` | 0.475.0 | ISC |
| `merge2` | 1.4.1 | MIT |
| `micromatch` | 4.0.8 | MIT |
| `mz` | 2.7.0 | MIT |
| `nanoid` | 3.3.15 | MIT |
| `next-themes` | 0.4.6 | MIT |
| `normalize-path` | 3.0.0 | MIT |
| `object-assign` | 4.1.1 | MIT |
| `object-hash` | 3.0.0 | MIT |
| `pako` | 2.2.0 | (MIT AND Zlib) |
| `path-parse` | 1.0.7 | MIT |
| `performance-now` | 2.1.0 | MIT |
| `picocolors` | 1.1.1 | ISC |
| `picomatch` | 2.3.2 | MIT |
| `picomatch` | 4.0.5 | MIT |
| `pify` | 2.3.0 | MIT |
| `pirates` | 4.0.7 | MIT |
| `pocketbase` | 0.26.9 | MIT |
| `postcss` | 8.5.16 | MIT |
| `postcss-import` | 15.1.0 | MIT |
| `postcss-js` | 4.1.0 | MIT |
| `postcss-load-config` | 6.0.1 | MIT |
| `postcss-nested` | 6.2.0 | MIT |
| `postcss-selector-parser` | 6.1.4 | MIT |
| `postcss-value-parser` | 4.2.0 | MIT |
| `prop-types` | 15.8.1 | MIT |
| `queue-microtask` | 1.2.3 | MIT |
| `raf` | 3.4.1 | MIT |
| `react` | 18.3.1 | MIT |
| `react-day-picker` | 8.10.2 | MIT |
| `react-dom` | 18.3.1 | MIT |
| `react-hook-form` | 7.81.0 | MIT |
| `react-hot-toast` | 2.6.0 | MIT |
| `react-i18next` | 17.0.11 | MIT |
| `react-is` | 16.13.1 | MIT |
| `react-is` | 18.3.1 | MIT |
| `react-remove-scroll` | 2.7.2 | MIT |
| `react-remove-scroll-bar` | 2.3.8 | MIT |
| `react-resizable-panels` | 2.1.9 | MIT |
| `react-router` | 6.30.4 | MIT |
| `react-router-dom` | 6.30.4 | MIT |
| `react-smooth` | 4.0.4 | MIT |
| `react-style-singleton` | 2.2.3 | MIT |
| `react-transition-group` | 4.4.5 | BSD-3-Clause |
| `read-cache` | 1.0.0 | MIT |
| `readdirp` | 3.6.0 | MIT |
| `recharts` | 2.15.4 | MIT |
| `recharts-scale` | 0.4.5 | MIT |
| `regenerator-runtime` | 0.13.11 | MIT |
| `resolve` | 1.22.12 | MIT |
| `resolve` | 1.22.12 | MIT |
| `reusify` | 1.1.0 | MIT |
| `rgbcolor` | 1.0.1 | MIT OR SEE LICENSE IN FEEL-FREE.md |
| `run-parallel` | 1.2.0 | MIT |
| `scheduler` | 0.23.2 | MIT |
| `sonner` | 2.0.7 | MIT |
| `source-map-js` | 1.2.1 | BSD-3-Clause |
| `stackblur-canvas` | 2.7.0 | MIT |
| `sucrase` | 3.35.1 | MIT |
| `supports-preserve-symlinks-flag` | 1.0.0 | MIT |
| `svg-pathdata` | 6.0.3 | MIT |
| `tailwind-merge` | 3.6.0 | MIT |
| `tailwindcss` | 3.4.19 | MIT |
| `tailwindcss-animate` | 1.0.7 | MIT |
| `text-segmentation` | 1.0.3 | MIT |
| `thenify` | 3.3.1 | MIT |
| `thenify-all` | 1.6.0 | MIT |
| `tiny-invariant` | 1.3.3 | MIT |
| `tinyglobby` | 0.2.17 | MIT |
| `to-regex-range` | 5.0.1 | MIT |
| `ts-interface-checker` | 0.1.13 | Apache-2.0 |
| `tslib` | 2.8.1 | 0BSD |
| `use-callback-ref` | 1.3.3 | MIT |
| `use-sidecar` | 1.1.3 | MIT |
| `use-sync-external-store` | 1.6.0 | MIT |
| `util-deprecate` | 1.0.2 | MIT |
| `utrie` | 1.0.2 | MIT |
| `vaul` | 1.1.2 | MIT |
| `victory-vendor` | 36.9.2 | MIT AND ISC |
| `zod` | 3.25.76 | MIT |
| `zustand` | 4.5.7 | MIT |

## Summary

| License | Packages |
| --- | --- |
| MIT | 218 |
| ISC | 23 |
| Apache-2.0 | 3 |
| BSD-3-Clause | 3 |
| (MPL-2.0 OR Apache-2.0) | 1 |
| (MIT AND Zlib) | 1 |
| MIT OR SEE LICENSE IN FEEL-FREE.md | 1 |
| 0BSD | 1 |
| MIT AND ISC | 1 |
