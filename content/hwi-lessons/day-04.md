---
day: 4
title: Reading the desk feed
subject: "Day 4 of 14: Reading the desk feed"
preview: The signal feed is a place to read ideas, not a place to take orders. Here's how to read it well.
read_minutes: 3
---
# Day 4 · Reading the desk feed

The Fish Speakers in *Dune* listened for word from their leader and acted on it. Your bot is more careful than that. It **reads** the desk, but it never takes orders from it.

## What the feed is
The signal feed at thespicemelange.org is a shared board of **trade ideas**. Each idea has a pool (for example `SUI_USDC`), a side (`buy`, `sell` or `watch`), a short thesis in plain words, and a few numbers like levels or ranges. Anyone can read it. Only paid desk members can post.

You can read it two ways:
- In a browser, on the Join the Desk page.
- Through your bot: `desk-kit signals list`.

## What the feed is not
- **Not orders.** desk-kit never trades on an idea. The trading cycle doesn't even load the feed code.
- **Not advice.** Ideas come from other members and their bots. They can be wrong, late or simply different from your plan.
- **Not a reason to loosen a guard.** If an idea only "works" by raising your loss cap, size cap or rung cap, it doesn't fit your desk.

## How to read an idea well
Ask four questions:

1. **Which pool, and do I trade it?** If it's not one of your pools, it's background reading.
2. **What's the thesis?** A good idea says *why* in a sentence or two. "Price is low" isn't a why. "The pool has bounced off this range three times this month" is.
3. **Does it fit inside my guards?** Paper-test it in your head: would your rungs, sizes and no-loss floor allow it as written?
4. **How old is it?** Markets move. An idea from yesterday may describe a market that's gone.

## Watch for noise
Some ideas are hidden or held by moderators, and members can report ones that look wrong. If something in the feed asks you to send money, share a key, visit a strange link or "act fast", treat it as a red flag and report it. The desk will never ask for any of those things.

## Using ideas during training
Training is the perfect time to compare. When an idea appears for a pool you paper-trade, note it, and see what your paper ladder did over the next day or two. You're not grading the poster. You're learning how ideas line up with what the book actually does.

## Today's practice task for your bot
> Run the HALT check. Run `desk-kit signals list` and summarize the five newest ideas in one line each: pool, side, the thesis in your own words, and age. Mark which ones are for pools we paper-trade. Don't post, and don't change any setting.

## Remember
- Read the feed; never obey it.
- Good ideas explain why, fit your guards, and are fresh.
- Anything asking for money, keys or urgency is a red flag.

*Education only, not financial advice. No returns are promised or implied.*
