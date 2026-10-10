---
day: 7
title: Ladders and rungs
subject: "Day 7 of 14: Ladders and rungs"
preview: Halfway there. How your bot spreads buys below the price, and why three rungs is a guide, not dogma.
read_minutes: 3
---
# Day 7 · Ladders and rungs

Halfway through. Today's lesson is the heart of how your bot buys.

## A ladder
Instead of one big buy, the bot places a **ladder**: a few small buy orders resting at different prices below the mid. Each order is a **rung**. If the price dips a little, the top rung fills. If it dips further, the next one fills, at a better price.

Why? Because nobody knows tomorrow's price. A ladder doesn't need to guess. It buys a little on a small dip and a little more on a bigger one, so your average cost improves when the market is weak, and nothing is lost if it never dips.

## Spacing
The gap between rungs is set by `buyStepsPct` in your settings: percentages below the mid. Tight spacing fills more often with smaller discounts. Wide spacing fills less often with deeper discounts. Thin books usually need wider spacing than deep ones. The desk likes **golden-ratio spacing** (each gap a little wider than the last), but the numbers are always yours.

## How many rungs?
The desk rhythm's guidance is:
- **Three rungs by default.**
- **Up to five on a wide swing**: when the recent range is clearly wider than usual.
- Three is a guide, not dogma.

Two hard facts sit above that guidance:
1. **Your rung cap (R4) wins.** If you set a cap of two, the bot uses two, whatever the rhythm says.
2. **Every rung must be fully funded (R3).** No rung is placed with money you don't have.

## Exits
When a rung fills, it becomes a lot, and the bot rests a **sell** above it: at least cost plus fees (R1), and usually at your `sellTargetMultiplier`. Fill low, sell higher, repeat. Each round trip is small. The value comes from many patient repeats, not from one big win.

## Re-centering
Prices drift. Every so often (often during the rhythm's ladder windows) the bot moves unfilled rungs to follow the mid. It leaves rungs alone if they're within your `keepTolerancePct`, so it doesn't churn orders for tiny moves.

## Today's practice task for your bot
> Run the HALT check. Show me our current paper ladder for each pool: each rung's price, its distance below the mid in percent, its size, and whether it's funded. Tell me my rung cap, and whether this week's rhythm counts as a wide swing for any pool. Don't add or move any rung.

## Remember
- A ladder buys a little on small dips and more on bigger ones.
- Three rungs by default, up to five on wide swings, never above your cap.
- Every filled rung gets an exit at or above cost plus fees.

*Education only, not financial advice. No returns are promised or implied.*
