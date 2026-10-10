---
day: 14
title: Going live safely on day 15
subject: "Day 14 of 14: Going live safely on day 15"
preview: Training ends tomorrow. Live is optional, small and fully yours. Here's the checklist.
read_minutes: 3
---
# Day 14 · Going live safely on day 15

Fourteen days ago you started on paper. Tomorrow your training window is complete. Going live is **optional**: plenty of people keep training longer, and that's a good choice too. If you do go live, go small and go slowly.

## The three switches (all yours)
Your bot will never flip these for you:
1. **Training complete**: paper cycles on at least your `trainingDays` different days. `desk-kit status` shows your progress.
2. **`"mode": "live"`** in `desk-kit.json`, plus `live.maxGasBudgetMist` filled in.
3. **An `APPROVE_LIVE` file** in the desk-kit folder containing the words `approve live`.

If any one is missing, the bot stays on paper.

## Before you flip them: the checklist
- [ ] **Read back every guard.** Loss cap, size cap, rung cap, sell floor, heartbeat and feed ages, error streak. Nothing should still be `<SET ME>`.
- [ ] **Go smaller than training.** Lower your size cap and daily loss cap for the first live week. You can raise them later, deliberately.
- [ ] **Use a dedicated bot key**, never the key to your main account, and keep it in your environment (`DESK_KIT_SUI_SECRET_KEY`), never in a file in the folder and never in chat.
- [ ] **Use a TradeCap** for your BalanceManager. It can place and cancel orders but can't withdraw.
- [ ] **Fund only what can wait, and what you could lose.** Start with an amount you could lose entirely without real harm. Bills, debt payments, borrowed money and savings you need stay out of the BalanceManager.
- [ ] **Keep a little SUI for gas.**
- [ ] **Simulate first**: `desk-kit cycle --simulate` runs the live path without signing anything.
- [ ] **Know your stop.** Create `HALT` to stop new orders. Delete `APPROVE_LIVE` or set `"mode": "training"` to return to paper.

## Your first live days
- Watch the first few cycles yourself.
- Compare live fills with what your paper results led you to expect. Live is usually a little worse, because of gas and real market impact.
- Keep writing lessons. Keep reading the rhythm, inside your guards.
- If anything surprises you, HALT first, ask second.

## What hasn't changed
The guards that protected your paper account protect your live one, exactly the same: no loss sales, a daily loss cap, no leverage, rung and size caps, maker-only, fail-closed. And the honest truth hasn't changed either: live trading can lose money. No one, including this desk, can promise a return.

## Today's practice task for your bot
> Run the HALT check. Run `desk-kit status` and walk me through the go-live checklist one item at a time, telling me which items are done and which are still open. Don't flip any switch, don't create APPROVE_LIVE, and don't change mode. Those are mine.

## Remember
- Live needs three switches, all yours. Staying on paper is fine.
- Go smaller than training, with a dedicated key and a TradeCap.
- Same guards, same honesty: losses are possible, returns are never promised.

## Thank you
It's been a pleasure practicing with you. My lessons stop here, but the desk doesn't: weekly rhythm notes, the feed, lessons in template updates, and your own notebook. Reply any time with a question.

With patience,
Hwi Noree

*Education only, not financial advice. No returns are promised or implied. You are responsible for every order your bot places.*
