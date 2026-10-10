---
day: 3
title: Why there are no loss sales
subject: "Day 3 of 14: Why there are no loss sales"
preview: The one rule with no exception, and what it asks of you in return.
read_minutes: 3
---
# Day 3 · Why there are no loss sales

Most rules on this desk have a number you choose. One has no number and no exception: **your bot never sells a lot for less than it cost**, fees included. In desk-kit this is rule R1.

## How it works
Every buy creates a **lot**: how much you bought and what it cost you, including the buy fee. When the bot wants to sell that lot, it checks the sell price against:

> lot cost × your sell-floor multiplier, after the sell fee

The multiplier can't be set below 1. So the smallest possible sell is "get back what you paid, plus a little". A loss sale simply can't be built. There's no override switch, no "just this once", and no human-yes exception.

## Why be so strict?
Fear sells at the bottom. In *Dune*, a famous litany warns that fear wrecks clear thinking, and in trading that is close to literal. Many painful losses come less from the buy than from selling in a panic, sometimes just before the price comes back.

Removing the loss sale removes that whole path. A dip becomes a waiting room, not an exit.

## What it asks of you in return
A no-loss rule isn't free. It works only if the things around it are also true:

- **No leverage.** If borrowed money could force a sale, "never sell at a loss" would be a promise you couldn't keep. That's why R1 and R3 (no leverage) travel together.
- **Only money that can wait.** The rule may hold a lot for a long time. Trade only with funds you won't need soon. Cash for bills or debt payments stays untouchable.
- **Patience with small sizes.** Small rungs mean a stuck lot is an inconvenience, not a crisis.
- **Pick what you'd hold.** If a lot never recovers, you hold it. Only trade assets you'd be content to keep for years.

## What the rule does *not* mean
It doesn't mean you can't lose money. A held lot can be worth less than it cost for a long time, or forever, and the total value of your account can fall. The rule stops the bot from *locking in* a loss through a sale. It doesn't stop prices from moving. Be clear-eyed about that.

## In your paper reports
During training you'll sometimes see a lot sitting "under water" with its sell resting above cost. That's normal. Look at how long lots wait, and how often they come back. That's exactly what training is for.

## Today's practice task for your bot
> Run the HALT check. From the paper ledger, list every open paper lot with its cost (fees included), the lowest sell price R1 allows for it, and today's mid price. Tell me which lots are waiting under water and for how long. Don't change anything.

## Remember
- No loss sales, ever: lot cost plus fees is the floor.
- It only works with no leverage and money that can wait.
- Holding through a dip is the plan, not a failure.

*Education only, not financial advice. No returns are promised or implied.*
