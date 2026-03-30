# Hybrid Controls UX Fixes (2026-03-28)

## Goal
Resolve usability issues in the hybrid controls panel:
1. Inputs must stay inside their containers and not overlap nearby elements.
2. Each advanced control should have a concise help explainer available via hover/click.
3. Make control application obvious with a clear action button where users edit controls.

## Plan
1. CSS containment/layout fixes
- Ensure all numeric inputs in editor panels are width-constrained and container-safe.
- Add `min-width: 0`, `width: 100%`, and tighter grid behavior for pair/triple input rows.
- Prevent selection chips and control rows from forcing overflow.

2. Add per-control help bubbles
- Add a small reusable help indicator component next to each control label.
- Support hover and click/focus behavior with brief plain-language descriptions.
- Cover all controls currently shown in Hybrid Analyze Controls + Game Beat Selector.

3. Add explicit apply/update button near controls
- Add button text like: `Apply Controls + Re-Run Hybrid Analysis` inside the controls fieldset.
- Hook to existing analysis rerun logic so the visible hybrid timeline updates after completion.
- Keep top action as-is, but make the local action the primary obvious path.

4. Verify
- Build (`npm run build`) and quick UI sanity pass for desktop/mobile wrapping.
