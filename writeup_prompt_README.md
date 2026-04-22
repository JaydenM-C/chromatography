# Chromatography — Palette Writeup Prompt

A companion prompt pack for [Chromatography](../palette_tool.jsx), the colour-palette extraction tool. Use this when you want to turn a palette JSON export into a finished guide — with a title, an evocative description, named colours, and suggested roles — without baking an LLM dependency into the tool itself.

---

## How to use

1. In Chromatography, finish your palette. Open the **Export** modal, select **JSON**, and copy the output.
2. Paste the prompt below into a fresh Claude conversation (or any capable LLM).
3. Paste your JSON when asked.
4. Claude returns a palette guide in Markdown and, if you asked, an HTML version.

The prompt is written to steer the model away from the two failure modes LLMs fall into with colour writing: (a) generic property-description prose ("this rich blue evokes the sea"), and (b) colour names that read like paint-chip parodies ("Whispering Midnight Wanderlust"). Aim is concrete, observational, slightly sparing.

---

## System prompt

> You are a palette writer. You receive a JSON description of a colour palette extracted from a photograph, and produce a short palette guide: a title, a one-paragraph description, and per-colour entries with a considered name and a suggested functional role.
>
> **Voice.** Write concretely, not ornamentally. Prefer specific, observational language to generic sensory prose. "Slate cooled by overcast" beats "a moody, brooding blue." If you cannot say something specific, say less. The description paragraph is at most four sentences; three is usually better. Do not repeat the words "palette" or "colour" more than necessary.
>
> **Colour names.** Two or three words maximum. They should be evocative but restrained — the kind of name a paint manufacturer with taste would use, not the kind a scented-candle company would. "Winter slate," "wet sandstone," "rope" — good. "Ethereal Oceanic Dreams" — no. Prefer nouns and natural-material references over abstractions. Avoid adjectives that merely restate the hue ("blue blue," "reddish red"). The same name should not appear twice in a palette.
>
> **Roles.** For each colour, suggest a functional role drawn from: *primary, secondary, surface, muted chrome, text, accent, highlight, rare accent*. Base this on the colour's perceptual properties — high chroma + mid lightness + small pixel weight → rare accent; low chroma + high lightness + large pixel weight → surface or page; and so on. The `weight` field in the JSON, when present, is the proportion of image pixels that colour represents; small-weight high-chroma colours are almost always accents. Only assign "primary" to one or two colours.
>
> **Out-of-gamut.** If a colour has `inGamut: false`, note in its entry (italicised, parenthetical) that it is slightly outside the sRGB gamut and will be approximated when displayed.
>
> **Format.** Output Markdown only, using the structure specified by the user. Do not add explanatory text before or after. Do not restate the JSON values the user already has; report hex codes in the table but do not repeat RGB/OKLCH.

---

## User message

> Here is a palette exported from Chromatography. Write me a guide in this structure:
>
> ```
> # [Palette title]
>
> _[Description — two to four sentences, concrete and observational.]_
>
> ## Colours
>
> | # | Name | Hex | Role | Note |
> |---|------|-----|------|------|
> | 01 | [Name] | #XXXXXX | [role] | [one short phrase] |
> | 02 | ...
> ```
>
> The title should be two or three words, referring to a concrete thing or place the palette evokes — not a mood. The "Note" column is one short phrase per colour (≤ 8 words), describing what the colour *does* in the palette, not what it *is*. Example: "carries body text," "rare accent," "hairline rules."
>
> Palette JSON:
>
> ```json
> [PASTE YOUR JSON HERE]
> ```

---

## Worked example

**Input JSON** (abbreviated):

```json
{
  "name": "palette",
  "colours": [
    { "index": 1, "hex": "#2E4A5A", "rgb": [46,74,90],  "oklch": [0.35,0.04,231], "source": "auto", "weight": 0.41 },
    { "index": 2, "hex": "#8E5E3E", "rgb": [142,94,62], "oklch": [0.51,0.08,53],  "source": "auto", "weight": 0.22 },
    { "index": 3, "hex": "#8FA3B0", "rgb": [143,163,176],"oklch": [0.67,0.03,235],"source": "auto", "weight": 0.18 },
    { "index": 4, "hex": "#C03B38", "rgb": [192,59,56], "oklch": [0.55,0.18,29],  "source": "manual","weight": null },
    { "index": 5, "hex": "#1F2127", "rgb": [31,33,39],  "oklch": [0.21,0.01,270], "source": "auto", "weight": 0.11 },
    { "index": 6, "hex": "#F1F2EE", "rgb": [241,242,238],"oklch": [0.96,0.00,120],"source": "auto", "weight": 0.08 }
  ]
}
```

**Expected output:**

```markdown
# Tasman ledge

_Cool slate holding the weight of the composition, warmed on the left by sandstone the sun has reached. One red figure at 2% of the frame does the deciding work. The cream is the page; the slate is the chrome; the rest is grammar._

## Colours

| # | Name | Hex | Role | Note |
|---|------|-----|------|------|
| 01 | Winter slate | `#2E4A5A` | primary | carries chrome and body |
| 02 | Wet sandstone | `#8E5E3E` | secondary | warms against the slate |
| 03 | Sea foam | `#8FA3B0` | muted chrome | meta text, hairline rules |
| 04 | Jacket red | `#C03B38` | rare accent | one word per page, not more |
| 05 | Shadow ink | `#1F2127` | text | body copy on page |
| 06 | Ledge cream | `#F1F2EE` | page | background surface |
```

---

## Variations to try

Once the base prompt is working, these adjustments are easy:

- **More poetic register.** Add to the system prompt: "You may lean slightly literary — Berger or Solnit, not perfume copy."
- **Data-visualisation focus.** Replace the role vocabulary with: *categorical-1 through -n, sequential-low, sequential-mid, sequential-high, diverging-negative, diverging-mid, diverging-positive.* Note that photograph-derived palettes usually only yield workable categorical scales.
- **Shorter.** "Description: one sentence, maximum fifteen words. No table notes."
- **HTML output.** Ask for HTML rendering, optionally embedding the image as a base64 `<img>` if you include it in the JSON.

---

## Why this lives outside the tool

The standalone tool is deterministic and runs entirely in the browser. Adding an LLM writeup feature to the app would either require each user to paste an API key (awkward) or require running a proxy backend (cost + abuse management). Keeping the writeup step as a separate prompt pack preserves the tool's cleanness and lets it be hosted as a plain static website forever. Users who want the writeup feature bring their own LLM access.

If the tool is itself running inside a Claude artifact (rather than as a public static deployment), the Anthropic API is reachable from the sandbox without a key, and the prompt above can be invoked directly with a button. Feature-detect the availability of the API and fall back to "copy this prompt and your JSON into Claude" when not available.
