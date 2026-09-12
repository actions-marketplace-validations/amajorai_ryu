# pstack in Ryu

This directory vendors the `skills/` tree from Cursor's `pstack` plugin as
Ryu built-in Agent Skills. The source snapshot is upstream commit
[`df3fb154fb982fb83f649de8646d4af6a0cb16b3`](https://github.com/cursor/plugins/tree/df3fb154fb982fb83f649de8646d4af6a0cb16b3/pstack),
version 0.15.0.

Ryu embeds all 47 skill directories and their resource files. The separate
Cursor agent definitions, automation pack, guide images, and plugin metadata
are intentionally not part of the built-in Agent Skills surface because they
use Cursor-specific host contracts. The upstream MIT license is kept in
`LICENSE`.
