---
day: 5
title: The God Emperor rhythm
subject: "Day 5 of 14: The God Emperor rhythm"
preview: Once a week the desk publishes a signed rhythm. Your bot adapts to it, inside your walls.
read_minutes: 3
---
# Day 5 · The God Emperor rhythm

In *Dune*, the God Emperor thinks in long cycles and sets the pace for everyone. Our version is much humbler: a short, signed weekly note called the **rhythm**, published at `thespicemelange.org/rhythm.json`.

## What's in the rhythm
- **Focus pools**, with a one-line reason each (for example, the deepest book on DeepBook, or a thinner book that needs wider spacing).
- **Ladder windows**: times of the week when re-centering ladders makes sense, and times to sit back and let resting orders work (weekends, overnight).
- **Rung guidance**: three rungs by default, up to five on wide swings. More on that on day 7.
- **Rebalance ranges**, **desk projects** and **lessons** from the week.
- A short **daily note**, like "Weekend: favor wider spacing and patience. Nothing needs to fill today."

## What's *not* in it
No orders. No dollar sizes. No account balances. No return promises. The rhythm is guidance, the way a weather report is guidance: it tells you what kind of day it is, not what to do with your money.

## Signed, or ignored
Each rhythm comes with a signature made by the store's release key, the same key that signs template updates. Your bot checks that signature before reading a single line. If the signature is missing, wrong or made by a different key, the bot **ignores the rhythm** and keeps running on your own settings. It fails closed: a bad rhythm can never steer it.

## How your bot uses it
Your bot reads two things: the desk rhythm and your own local settings. Then it adapts **within its guards**:
- It may choose to re-center ladders during a suggested window.
- It may use fewer rungs on a quiet week, or more on a wide swing, but never more than your rung cap.
- It never raises a loss cap, a size cap or a rung cap because the rhythm "said so". It can't. Only you edit those.

In training, every adaptation is on paper, and the bot logs each one: what the rhythm suggested, what it did, and why. That log is how you learn whether the rhythm fits your style.

## You can say no
If the rhythm doesn't suit you, tell your bot to ignore it. Your desk, your rules.

## Today's practice task for your bot
> Run the HALT check. Fetch this week's rhythm and check its signature. If it verifies, tell me in plain words: the focus pools, this week's ladder windows in my timezone, the rung guidance, and today's daily note. Then tell me which of my own guards would limit any of it. If it doesn't verify, say so and stop. Change nothing.

## Remember
- The rhythm is weekly guidance, never orders.
- Bad or missing signature means it's ignored.
- Your bot adapts only inside your guards, and logs every adaptation.

*Education only, not financial advice. No returns are promised or implied.*
