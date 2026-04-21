# Chromatography

A field tool for building colour palettes from photographs. The application performs perceptually-uniform clustering on uploaded imagery, exposes a sub-pixel accurate eyedropper with a zooming loupe, and provides interactive adjustment of extracted swatches in OKLCH space. Contrast readouts use APCA, the algorithm drafted for WCAG 3.

All computation is performed client-side; no image or palette data is transmitted to any server.

## Features

- **Automatic extraction** via k-means++ clustering in OKLab space, with pixel-weighted centroid initialisation
- **Sub-pixel eyedropper** with zoomed 11×11 loupe, showing colour at cursor in sRGB, RGB integer triplet, and OKLCH coordinates
- **Manual sampling** by clicking any point on the source image
- **Source markers** displaying cluster centroid positions on the image canvas
- **Adjustment in OKLCH** with live gamut feedback; out-of-gamut colours are flagged but displayed in their clamped approximation
- **APCA contrast readouts** against cream page, white, and black, in both text and background polarities
- **Palette reordering** via drag-and-drop, or by one of four sort criteria (hue, lightness, chroma, pixel weight)
- **Revert** to each swatch's original sampled colour after adjustment
- **Export** to CSS custom properties, JSON, R (with ggplot2 example), GIMP Palette (GPL), Markdown, or standalone HTML with embedded source image
- **Project save/load** via JSON file containing the source image (as data URL) and all swatch state

## Local development

Requires Node.js 18 or later.

```bash
npm install
npm run dev
```

The development server will start at `http://localhost:5173`.

## Production build

```bash
npm run build
```

Output is written to `dist/`. This directory can be served by any static file host.

## Deployment

The project is configured for zero-configuration deployment to Cloudflare Pages, Netlify, Vercel, or any comparable static-site host. The build command is `npm run build` and the output directory is `dist/`.

## Technical notes

The palette extraction pipeline proceeds as follows. The source image is first downsampled to a maximum dimension of 200 pixels to bound the computational cost of clustering, which is otherwise quadratic in pixel count. Each pixel is then converted from sRGB through linear RGB into OKLab, a colour space whose coordinates approximate perceptual uniformity — that is, equal Euclidean distances in the space correspond, to a good approximation, to equal perceived colour differences. Clustering proceeds via k-means++ initialisation (which selects initial centroids probabilistically weighted by their squared distance from the existing centroid set, substantially reducing the probability of poor local minima) followed by standard Lloyd iteration to convergence or a fixed iteration cap. The resulting centroids are converted back to sRGB for display and to OKLCH for user-facing adjustment.

Slider adjustments operate in OKLCH (Lightness, Chroma, Hue), which is the polar representation of OKLab. This yields a more intuitive manual editing experience than operating on the Cartesian OKLab axes: hue rotates around the achromatic axis without altering perceived lightness, and chroma scales saturation without shifting hue. Edits can push a colour outside the sRGB gamut (the representable colour volume for standard displays); when this occurs, the colour is flagged and its displayed approximation is produced by component-wise clamping. A more sophisticated gamut-mapping strategy (e.g., reducing chroma while preserving lightness and hue until the colour re-enters the gamut) is a plausible future refinement.

Contrast scoring uses APCA rather than the WCAG 2.x ratio. APCA — the Accessible Perceptual Contrast Algorithm — is polarity-aware and perceptually motivated, whereas the older ratio is based on a crude luminance division that systematically misestimates perceived contrast for mid-tone pairs and dark-on-dark combinations. APCA has been drafted for inclusion in WCAG 3.

## Licence

MIT.

## Acknowledgements

OKLab and OKLCH are due to [Björn Ottosson](https://bottosson.github.io/posts/oklab/). APCA is due to [Andrew Somers](https://git.myndex.com/). The aesthetic register of the interface — cream paper, slate rule, rust accent — is a deliberate homage to the typographic tradition of the field notebook.
