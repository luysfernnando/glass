# Third-party notices

Glass 0.19.0 ports rendering features from two MIT-licensed projects.

## prismantis 0.40.0

GitHub alerts, mermaid and figure blocks and the per-block copy button follow
prismantis. `hooks/charts.ts` is a port of its `charts.ts`; `hooks/diagram.ts`
adapts its `mermaid.tsx` and `figure.tsx`. Recolored with glass's palette.

Copyright (c) 2026 Nahum Litvin

## beautiful-mermaid (as patched by prismantis)

`hooks/vendor/mermaid-text.js` is the text renderer of beautiful-mermaid, with
the patches prismantis ships, escaped to ASCII.

## MIT License (both)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
