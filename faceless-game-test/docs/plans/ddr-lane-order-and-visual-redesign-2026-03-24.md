# Plan: DDR Lane Order + DDR-Style Visual Redesign

Date: 2026-03-24

## Goal
1. Change gameplay lane order to: left, down, up, right.
2. Redesign the game area to a DDR-style look:
- dark background
- bright receptor arrows
- matching note size to receptor size
- color palette similar to classic DDR direction colors
- stronger contrast/glow and cleaner lane rails

## Constraints
- Keep existing timing/judgement logic intact.
- Keep keyboard controls on arrow keys.
- Avoid using copyrighted game assets directly; implement an original CSS/SVG-like style inspired by DDR visual language.

## Changes
1. `src/lib/game/melodyChartService.ts`
- update lane generation order to `[left, down, up, right]`.

2. `src/components/GameView.tsx`
- update lane order and receptor rendering order.
- ensure note horizontal positioning follows new order.
- keep note glyphs aligned to receptor glyphs and dimensions.

3. `src/styles.css`
- redesign `.game-*` styles:
  - dark cabinet-like panel
  - lane rails with depth/gradients
  - receptor row with stronger borders and glow
  - note arrows with per-lane colors and highlights
  - make note size match receptor footprint
  - improve readability for score HUD on dark surface

## Validation
- `npm run build`
- manual verify:
  - lane order displayed `left down up right`
  - notes spawn in matching lanes
  - visual style is dark and DDR-like with clear colored arrows.
