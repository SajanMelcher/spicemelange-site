---
day: 2
title: The guards, the walls of the sietch
subject: "Day 2 of 14: The guards, the walls of the sietch"
preview: Six rules stand between your bot and a bad day. None of them can loosen themselves.
read_minutes: 3
---
# Day 2 · The guards, the walls of the sietch

In *Dune*, the Fremen live in sietches: hidden rock shelters that keep water in and the desert out. Your bot has its own walls. We call them **guards**, and they run in training *and* in live mode, exactly the same way.

## The six guards
| Rule | What it stops |
|---|---|
| **R1 · No loss sales** | Any sell that would net less than what the coins cost you, fees included. There is no override. (Day 3 is all about this one.) |
| **R2 · Daily loss cap** | New buys, once today's realized losses reach the cap you set. |
| **R3 · No leverage** | Margin, borrowing, shorting and market orders. Every buy must be fully paid for with cash you already have. |
| **R4 · Rung cap** | More resting buy orders in one pool than the cap you set. |
| **R5 · Size cap** | Any single order larger than the limit you set. |
| **R6 · Maker only** | Any order that would cross the book and take liquidity at once. |

## Three things to know about guards
**1. They only block.** A guard never places an order, never moves money and never "helps" by loosening itself. It can only say no.

**2. Unset means no.** Every guard number starts as `<SET ME>`. Until you fill it in with a valid value, the guard refuses every order. A missing setting is treated as the strictest possible setting, never the loosest.

**3. They fail closed.** If the guard's heartbeat is missing, stale or failed, if prices are stale, or if errors repeat, the bot stops placing orders. A crash writes a `HALT` file. You remove it, and your bot is told never to remove it.

## Why a daily loss cap and no leverage?
Bad days happen to every trader. A daily cap turns a bad day into a *small* bad day: the bot stops buying, waits for tomorrow, and you get time to look. Leverage does the opposite. With borrowed money, a dip can trigger a forced sale (a liquidation) at the worst moment, and you can lose more than you put in. So your bot simply doesn't use it.

## Choosing your numbers
Start small. Pick a daily loss cap you would shrug at losing, a size cap smaller than you think you need, and only a couple of rungs at first. You can always raise a number later, deliberately, after training shows you how the bot behaves. I never suggest your numbers. They're your decisions.

## A refusal is good news
When your report shows a `guard_refusal` line, the system worked: an order was stopped before it was placed. Read which rule fired. Don't loosen a guard just to make a refusal go away. Ask why it fired first.

## Today's practice task for your bot
> Run the HALT check. List each guard (R1 to R6) with the value I set in `desk-kit.json`, and tell me any that are still `<SET ME>`. Then show me any guard refusals from your paper reports so far, and which rule fired. Don't change any setting.

## Remember
- Guards block; they never act or loosen themselves.
- Unset means refuse.
- A refusal is the wall doing its job.

*Education only, not financial advice. No returns are promised or implied.*
