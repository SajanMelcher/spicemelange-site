---
day: 1
title: The Golden Path, and why Bitcoin is the spice
subject: "Day 1 of 14: The Golden Path, and why Bitcoin is the spice"
preview: Two weeks of practice, one small lesson a day. Here is the long view your bot is built around.
read_minutes: 3
---
# Day 1 · The Golden Path, and why Bitcoin is the spice

Welcome, and thank you for joining me. I'm Hwi Noree, the desk's teacher. I'm an AI assistant for The Spice Melange, not a person and not a financial adviser. For the next fourteen days your Fish Speakers bot trains on paper: it watches real prices and real trades, but it spends no real money. Each day I'll send one short lesson and one small task for your bot. By day 15 you'll know what it does, why it does it, and when it should stop.

## A little Dune, explained
In Frank Herbert's *Dune*, the spice melange is the scarce substance everything depends on. On this desk we borrow the image: **Bitcoin is the spice**. We think of it as a scarce, long-horizon savings asset. That's a way of thinking, not a promise. Bitcoin's price swings hard, and it has fallen by more than half more than once. Short trades are the harvest that feeds the store of spice. They never replace it.

The **Golden Path** in the novels is a plan that only makes sense over a very long time. Ours is plainer:

1. **Keep the base safe first.** Cash you need, cash set aside for a bill or a debt payment, and anything borrowed are untouchable. Your bot treats them as walls, not as fuel.
2. **Keep trades small and patient.** Buy below the price, sell above your full cost, and repeat. Most days nothing dramatic happens, and that's fine.
3. **Judge by years, not by hours.** One good day proves nothing, and neither does one quiet day.

## What "training" means
Your bot starts in **training mode**. It paper-trades DeepBook pools against live prices. A paper order only counts as filled when real trades print *through* its price, and only for the volume that actually traded. That keeps the practice honest: no imaginary fills.

Training lasts fourteen days, and nothing turns it off by accident. Going live takes three switches. Only you should flip them, and your bot is told never to. We'll walk through them on day 14.

## What I will and won't do
- I teach. I never give financial advice and I never promise returns. Trading can lose money, including all of it.
- I never ask for your keys, recovery phrase, passwords or account numbers. If anyone, including someone using my name, asks for them, don't share them.
- I never change your settings. Your guards are yours.

## How these lessons work
Each lesson takes about three minutes. At the end there is **one practice task** you hand to your bot. The tasks are read-only or paper-only. If your bot started training a few days before you joined these lessons, that's fine: keep going at your own pace.

## Today's practice task for your bot
Paste this to your Fish Speakers bot:

> Run the HALT check. Then run `desk-kit status` and tell me in plain words: which mode we're in, which day of training this is, and which pools you are watching. Don't change anything.

(In these lessons, `desk-kit status` is short for running `npx tsx src/cli.ts status` from your desk-kit folder. Your bot knows the long form.)

Write down the training day it reports. That's your day 1.

## Remember
- Bitcoin is the spice: the long-horizon store. Trades feed it.
- Training is paper, with honest fills only.
- Only you should switch to live, and your bot is told never to.

I'm glad you're here. See you tomorrow.

Hwi

*Education only, not financial advice. No returns are promised or implied. Reply any time with a question.*
