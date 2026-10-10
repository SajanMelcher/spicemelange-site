---
day: 8
title: Reading your paper results
subject: "Day 8 of 14: Reading your paper results"
preview: A week of practice is on the page. Here's how to read it without fooling yourself.
read_minutes: 3
---
# Day 8 · Reading your paper results

A week of training is in the books. In *Dune*, Mentats are human thinkers who calculate coolly, without hope or fear. Today, be a Mentat about your paper report.

## Where to look
- **`reports/paper-latest.md`**: today's summary, in plain words.
- **`reports/paper-<day>.md`**: one per training day, so you can compare.
- **`ledger/paper.jsonl`**: every event, one line each: orders placed, fills, exits, refusals. The report is built from this.

## Five things to read, in order
1. **Refusals.** Which guard said no, and how often? A few are normal. Many from the same rule means a setting and a strategy are fighting. Find out why before you change anything.
2. **Fills.** How many rungs filled, at which depths? If nothing ever fills, your spacing may be wider than this market moves. If everything fills at once, it may be too tight for a falling market.
3. **Round trips.** How many lots were bought *and* sold? Each completed round trip shows realized profit after fees.
4. **Open lots.** What's still waiting, at what cost, and how far under or over the mid? Remember day 3: waiting is allowed.
5. **Realized vs. unrealized.** *Realized* is locked-in profit from completed sells. *Unrealized* is what open lots would be worth at today's mid. The first is history. The second is a snapshot that changes every minute.

## Don't fool yourself
- **One week is a tiny sample.** A calm week and a wild week can tell opposite stories. Don't extrapolate seven days into a year.
- **Paper is honest, not perfect.** Fills here require real trades through your price, which is strict. But live trading adds gas, and real orders can change the book a little. Expect live to be slightly worse, never better.
- **No percentages per year.** Turning a good week into an "annual return" is a guess dressed up as math. This desk doesn't make that guess, and you shouldn't either.

## What good looks like
"Good" in training isn't a big number. It's a bot that did what you expected: refused what it should, filled where you'd guess, rested exits above cost, and stayed quiet when nothing happened. Surprises are what you're hunting for. Each surprise is a question to ask now, while it's free.

## Today's practice task for your bot
> Run the HALT check. Read the paper reports from the last seven days. Give me, per pool: rungs placed, rungs filled, round trips completed, realized result after fees, open lots and their cost, and every guard refusal by rule. Then tell me the one thing that surprised you most. Plain words, no yearly percentages, change nothing.

## Remember
- Read refusals, fills, round trips, open lots, then realized vs unrealized.
- A week is a small sample; paper is strict, live is a little worse.
- Hunt for surprises now, while practice is free.

*Education only, not financial advice. Past and paper results don't predict future results. No returns are promised or implied.*
