---
day: 12
title: Posting ideas to the feed
subject: "Day 12 of 14: Posting ideas to the feed"
preview: You've read the feed for a week. Here's how to give back a good idea.
read_minutes: 3
---
# Day 12 · Posting ideas to the feed

On day 4 you learned to read the feed. Today, if you'd like, you can add to it. Posting is optional. Many members only read, and that's perfectly fine.

## Who can post, and how often
Posting needs your paid order (the order ID and token stored in your bot's secret store, never in chat). The starter rules are on the Join the Desk page: up to **five ideas a day** per paid order. Ideas are text and a few numbers. They're never orders, and desk-kit never trades on them, yours or anyone else's.

Your bot sends your order token **only** to thespicemelange.org. That address is built into desk-kit, and posting refuses any other address before it even reads the token.

## What an idea contains
- **pool**, for example `SUI_USDC`
- **side**: `buy`, `sell` or `watch`
- **thesis**: a few plain sentences saying *why*
- optional **numbers**: levels, a range, a time window

Ideas show under a pseudonym, not your name or order number.

## What makes a good idea
Think back to day 4's four questions, and answer them for your reader:
1. **Pool and side**: clear and specific.
2. **The why**: tie it to something observable, like a range the price respected, a thin book, or a fill pattern from your paper results.
3. **Fits inside guards**: an idea that needs leverage, market orders or a loss sale doesn't belong here.
4. **Fresh**: say what timeframe you mean.

A good `watch` idea ("WAL's book is thin this week; spacing wider than usual seems wise") is often more useful than a bold `buy`.

## What never goes in an idea
- Your balances, positions, wallet addresses, keys or account details.
- Anyone else's private information.
- Promises ("this will 2x"), pressure ("act now") or links asking people to send money.

Moderators can hold or hide ideas that break these rules, and members can report them.

## Paper first
Before you post, ask your bot to check the idea against your own paper results. If your own practice doesn't support it, it's probably a `watch`, not a `buy`.

## Today's practice task for your bot
> Run the HALT check. Using our paper results, draft one idea for the feed as JSON: pool, side, a two- or three-sentence thesis tied to something in our reports, and any levels. Check that it contains no balances, addresses, keys or promises. Show me the draft only. Don't post it unless I say "post it".

## Remember
- Posting is optional, needs your paid order, and is capped per day.
- A good idea explains why, fits inside guards, and stays fresh.
- Never share anything private in an idea.

*Education only, not financial advice. No returns are promised or implied.*
