---
day: 11
title: When to stop: HALT
subject: "Day 11 of 14: When to stop (HALT)"
preview: The most important command on your desk is one empty file. Here's when to use it.
read_minutes: 3
---
# Day 11 · When to stop: HALT

Every desk needs a way to stop instantly, without discussion. Ours is the plainest tool imaginable: an empty file named **`HALT`**.

## How it works
- Create a file named `HALT` in your desk-kit folder (or at the root of your desk folder for your other bots).
- From that moment, the bot places **no new orders**. Every routine starts with the HALT check, sees the file, tells you once that HALT is set, and stops.
- Only **you** remove it. The bot never deletes or renames it.

One thing HALT does *not* do: it doesn't cancel orders already resting on the book. That's deliberate. Cancelling is also an action, and in a fast market you may want to choose. If you want them gone, cancel them yourself, or tell your bot "cancel all resting orders" and confirm.

## The bot halts itself too
You're not the only one who can pull the cord. desk-kit writes `HALT` on its own when:
- the guard process crashes,
- errors repeat past your `maxErrorStreak`,
- or something else fails in a way it can't safely explain.

And even without the file, it refuses new orders when the guard heartbeat is missing or stale, or prices are older than your `feedMaxAgeMinutes`. It fails *closed*: when in doubt, it stops.

## When should *you* use HALT?
You don't need a reason. But here are good ones:
- **You don't understand what the bot just did.** Stop first, then ask.
- **Something changed outside the bot**: you need the cash, you're traveling and can't check, there's big news, or the exchange or network is having trouble.
- **A setting may be wrong.** Halt, fix the setting, read it back, then resume.
- **Anything feels off**: a strange message, a request for keys, a sudden flurry of activity.

Stopping costs almost nothing. Not stopping when you should can cost a lot.

## Resuming
Before you delete `HALT`, ask your bot for a short read-back: mode, guards, open orders, and the reason HALT was set. Fix the cause, then remove the file. If the bot set HALT itself, read its note first.

## Practice it now
The best time to learn the emergency stop is when there's no emergency. During training, nothing is at risk, so today you'll actually try it.

## Today's practice task for your bot
> I'm creating a HALT file now as a drill. Run your HALT check and confirm you see it and will place no new paper orders. Tell me what's still resting on the paper book. Then wait. When I delete the file, give me a read-back of mode, guards and open orders before your next cycle.

## Remember
- One empty `HALT` file stops all new orders.
- It doesn't cancel resting orders; you decide that.
- Only you remove it. Practice it now, while nothing is at stake.

*Education only, not financial advice. No returns are promised or implied.*
