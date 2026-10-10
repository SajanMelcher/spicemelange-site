---
day: 6
title: DeepBook basics
subject: "Day 6 of 14: DeepBook basics"
preview: Where your bot actually trades. An order book, makers and takers, and why your bot waits.
read_minutes: 3
---
# Day 6 · DeepBook basics

The desert of Arrakis looks empty until you learn to read it. An order book is the same. Today we learn to read the one your bot uses: **DeepBook**, the order book built into the Sui blockchain.

## The order book
A **pool** is one market, named by its two coins joined with an underscore: a SUI pool trades SUI against a dollar stablecoin, for example. Each pool keeps two lists:
- **Bids**: offers to buy, sorted from highest price down.
- **Asks**: offers to sell, sorted from lowest price up.

The gap between the best bid and the best ask is the **spread**. The **mid** is halfway between them. A deep book has many orders near the mid and a narrow spread. A thin book has few orders and a wide spread, so prices can jump.

## Makers and takers
- A **maker** order rests on the book at a price that doesn't match anything yet. It *adds* liquidity and waits.
- A **taker** order matches immediately against resting orders. It *removes* liquidity.

Your bot is a maker only (guard R6). It places **limit orders**, never market orders, and it posts them "post-only": if an order would cross the book and fill at once, it's refused instead. Makers usually pay lower fees than takers, and they never buy at a surprise price.

## Fills
A resting bid fills when sellers trade down to its price. In training, your paper order counts as filled only when real trades print *strictly through* its price, and only up to the volume that traded. So a paper fill means a real order very likely would have filled too.

## Where your coins sit
On DeepBook, trading funds live in a **BalanceManager**, an on-chain account you own. When you go live, the bot can trade from it using a **TradeCap**: a permission that can place and cancel orders but **cannot withdraw**. That's a good boundary. The bot can work the book, but it can't move your money out.

## Why patience pays the bills
Because your bot waits at its own price, some orders never fill. That's the cost of never chasing. An unfilled order costs nothing but time, and on a quiet day "nothing filled" is a perfectly good result.

## Today's practice task for your bot
> Run the HALT check. For each pool we paper-trade, show me the best bid, best ask, mid and spread right now, and say whether the book looks deep or thin. Then show where our resting paper bids sit compared to the mid. Read-only; don't change anything.

## Remember
- Bids buy, asks sell; the spread is the gap; the mid is the middle.
- Your bot is maker-only: limit, post-only, never market.
- A TradeCap can trade but can't withdraw.

*Education only, not financial advice. No returns are promised or implied.*
