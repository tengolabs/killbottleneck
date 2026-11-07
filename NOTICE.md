# Third-party notices

killBottleneck itself is open source under the [MIT License](./LICENSE). The name "killBottleneck"
and the logo are not part of that license — see [TRADEMARKS.md](./TRADEMARKS.md).
Third-party components keep their own licenses, which continue to apply to them.

**The complete, generated list** — every production npm package of `frontend/` and `mcp/`
with the full license text, plus PocketBase, fonts and shadcn/ui — is in
[THIRD-PARTY-LICENSES.md](./THIRD-PARTY-LICENSES.md) (regenerate with
`node scripts/gen-third-party-licenses.mjs` after any dependency change; a license outside
the permissive allowlist stops the generator). The same file ships inside the Docker image
and every instance serves it at `/THIRD-PARTY-LICENSES.txt` (linked from the About dialog).

Nothing here is copyleft — every dependency is permissive (MIT, ISC, Apache-2.0, BSD, Zlib,
0BSD, CC0, SIL OFL for fonts). Dual-licensed packages (e.g. jszip: MIT or GPL-3.0) are used
under their permissive option.

## Fonts (bundled in `frontend/public/fonts/`, served from your own instance on purpose —
killBottleneck must not send your users' IP addresses to a third-party font CDN)

| Font | Author | License | Text |
| --- | --- | --- | --- |
| Inter | Rasmus Andersson | SIL Open Font License 1.1 | https://github.com/rsms/inter |
| Plus Jakarta Sans | Tokotype | SIL Open Font License 1.1 | `fonts/LICENSE-OFL.txt` |
| KB Sans, KB Serif (`fonts/pdf/`) — Latin subsets of Liberation Sans / Liberation Serif, renamed as the OFL requires for modified versions | Red Hat / Google (Arimo, Tinos) | SIL Open Font License 1.1 | `fonts/pdf/LICENSE-OFL.txt`, `fonts/pdf/README.md` |

## Runtime, backend

| Component | License |
| --- | --- |
| PocketBase | MIT |

## Adapted code

| What | From | License |
| --- | --- | --- |
| UI primitives in `frontend/src/components/ui/` | [shadcn/ui](https://github.com/shadcn-ui/ui) (toast hook inspired by react-hot-toast) | MIT |
| `frontend/src/lib/skinValidator.js` (and its server copy) | our own code, released under CC0 on 8 Aug 2026 so the skin editor can reuse it without conditions | CC0 |

## Templates

The Business Model Canvas (Alexander Osterwalder, Strategyzer) and Lean Canvas (Ash Maurya)
frameworks are published under CC BY-SA 3.0. killBottleneck ships the block names of these
frameworks with its own wording of the block descriptions and credits the authors in the
template description.
