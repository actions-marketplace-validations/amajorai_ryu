# Engine artwork

Official upstream artwork is vendored here for identification in Marketplace, engine details,
and Library. `sources.json` records source URLs (pinned to upstream commits when available)
and SHA-256 hashes. Existing bundled Docker, Apple, and Ryu marks retain their original bytes.
Marks remain the property of their respective projects.

`../engine-logos.ts` is the single UI mapping. Static `new URL` expressions let Vite bundle
these assets for Desktop and Webapp without depending on remote image hosts or duplicated
public directories. Artwork is contained without an added tile, background, ring, or shadow. Monochrome
marks render dark on light surfaces and white on dark surfaces; multicolor artwork retains
its colors. The oMLX asset is its bare official glyph, not its rounded app-icon tile.

MLX-VLM uses the MLX family mark; Docker Model Runner uses Docker; Apple Intelligence uses
the Apple platform mark. Ryu Audio uses Ryu's existing mark rather than its upstream vendor.
Whisper.cpp's README wordmark and stable-diffusion.cpp's project artwork are contained intact.

The current 23 built-in catalog engine entries have 20 logo mappings. The following have no dedicated artwork
in their official source/README and retain the shared generated fallback:

- audio.cpp: https://github.com/0xShug0/audio.cpp
- OuteTTS: https://github.com/edwko/OuteTTS
- Wasmtime: https://github.com/bytecodealliance/wasmtime and https://wasmtime.dev

Do not substitute unrelated company or model logos for missing project artwork.

llama-swap uses its upstream favicon’s unmodified embedded light and dark PNGs.
The app theme selects the matching variant, independent of the operating-system theme.

FreeToken uses its official light/dark wordmarks, selected by the app theme without a tile.
