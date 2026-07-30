# Publisher brand kit prototype — OK! Magazine

A single self-contained page that renders a mock publisher article and
recommendation widget **entirely from an extracted brand kit**, so you can see what
the kit actually produces before it reaches a live widget.

- `ok-magazine.html` — the prototype. No build step, no network calls. Open it directly.
- `ok-magazine.brandkit.json` — the extracted kit it is driven by.

Source page analysed: `https://www.ok.co.uk/tv/love-island-finalist-reveals-sad-37458508`

## What it shows

| Control | What it does |
| --- | --- |
| **Brand kit applied / No kit** | Flips the same markup between the extracted tokens and generic widget defaults. The gap is the value of the kit. |
| **Flag substituted tokens** | Outlines every element whose style came from a fallback rather than a measurement. |
| **Dim everything but the selected token** | Click any token in the left rail to locate every element it drives. |

## How it is built

Brand tokens are CSS custom properties scoped to `.canvas` and prefixed `--b-`.
Switching to *No kit* just redefines that same set under
`.canvas[data-mode="plain"]` — nothing in the markup changes, which is what makes
the comparison honest. The surrounding tool chrome deliberately uses cool,
low-chroma neutrals so the publisher's `#BE1F24` is the only saturated colour on
the page.

Open Sans and Signika Negative are embedded as base64 woff2 `@font-face` rules.
That is required, not an optimisation: a CDN link would be blocked by the artifact
CSP and the type would silently fall back to a system sans, which would make a
typography preview lie.

## Findings worth acting on

Surfaced in the page itself, repeated here because they affect whether this kit
should ship:

1. **`article_body` and `section_headings` resolve identically** — Open Sans
   16px / 600 / 25.6px. A 600-weight running text suggests the extractor sampled a
   teaser or card rather than article prose.
2. **The display face rests on one observation** — `Signika Negative` has
   `usage_count: 1` against Open Sans' 909, yet carries the entire hero treatment.
3. **Both fallback tokens land on the recommendation card** —
   `article_title_card` and `article_lead` are the two gaps, so the headline 89%
   coverage figure understates the risk for widget rendering specifically.
4. **`#0000EE` is in the colour sample on 30 elements** — that is the browser
   default link colour, not a brand decision, and should be excluded.
5. **`0px` radius is consistent** across buttons and thumbnails, so squared corners
   are load-bearing for this brand.

## Caveat on content

The source page is not reachable from the environment this was built in, so **no
text, image or quote from the real article is reproduced.** Every headline, name and
paragraph is invented placeholder copy and the image slots are CSS gradients. Only
the styling is real.
