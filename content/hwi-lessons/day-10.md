---
day: 10
title: Fees and gas
subject: "Day 10 of 14: Fees and gas"
preview: The quiet costs. Small trades only work when you count every one of them.
read_minutes: 3
---
# Day 10 · Fees and gas

On Arrakis, every drop of water is counted, because small losses add up to death in the desert. Fees are the water of trading. Count them all.

## Two kinds of cost
**1. Trading fees.** DeepBook charges a fee when an order fills. Makers (orders that rest on the book, like your bot's) usually pay a lower rate than takers. Fee rates are set per pool and can change, so check the pool's current settings rather than trusting a number from last month. Some pools let you pay fees in the DEEP token, and staking DEEP can lower them; read the current DeepBook docs before relying on either.

**2. Gas.** Every transaction on Sui (placing, cancelling or moving an order) costs a little SUI as gas, whether or not anything fills. Gas is usually small, but a bot that re-centers too often can spend more on gas than it earns on fills.

## Where fees show up on your desk
- **In the lot's cost.** The buy fee is added to the lot's cost. That's why "no loss sales" (R1) already includes fees: the floor is cost plus all fees, so a "break-even" sale really is break-even.
- **In your paper settings.** `paper.makerFeeBps` sets the fee your training uses, in basis points (1 bp = 0.01%). Set it to match or slightly exceed the real maker fee, so practice isn't kinder than reality.
- **In live gas limits.** `live.maxGasBudgetMist` caps gas per transaction (in MIST; 1 SUI = 1,000,000,000 MIST). Unset means refuse, as always.

## The small-trade trap
Say a round trip earns a small spread. Subtract the buy fee, the sell fee, and the gas to place, re-center and cancel. If what's left is tiny or negative, the trade wasn't worth doing. Two habits help:
- **Leave enough room** between buy and sell for fees, with room to spare.
- **Don't churn.** Use your `keepTolerancePct` so the bot doesn't cancel and re-place orders for tiny moves. Fewer transactions, less gas.

## Keep a gas cushion
When you go live, your bot's key needs a little SUI in its account for gas. If gas runs low, orders can't be placed or cancelled. That's another good reason the bot halts on repeated errors instead of retrying forever.

## Today's practice task for your bot
> Run the HALT check. For our paper round trips so far, show me the gross spread, buy fee, sell fee and net result for each, using our paper fee setting. Then estimate how many order transactions per day we'd send live (places, re-centers, cancels), so I can think about gas. Read-only; change nothing.

## Remember
- Fees and gas are real costs; count every one.
- R1's floor already includes fees.
- Churn burns gas; set tolerances and leave room.

*Education only, not financial advice. Fee rates change; check current DeepBook and Sui documentation. No returns are promised or implied.*
