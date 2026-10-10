---
day: 9
title: Keeping lessons
subject: "Day 9 of 14: Keeping lessons"
preview: Your bot keeps a notebook. Lessons inform, they never steer.
read_minutes: 3
---
# Day 9 · Keeping lessons

The Fremen kept careful memory of every journey across the sand: where water was found, where the worms ran. A good desk does the same. Ours keeps **lessons**.

## What a lesson is
A lesson is a short note about something learned, written in a fixed format so a bot can read it:

```
## L-0001: Thin books fill slowly
- applies: buy, training
- since: 2026-10-10
- source: my training week
On quiet pools a bid far below the mid may rest for hours. Check fills
before widening or tightening steps.
```

Each has an id, what it applies to (buys, sells, a pool, training or live), when it started, where it came from, and a few plain sentences.

## Where lessons live
- **`lessons.md`** in your desk-kit folder: your own notes. Copy `lessons.example.md` to start.
- **`lessons.d/`**: lessons that arrive with template updates from the desk. You can read them, keep them, or delete them.

## The one rule: lessons are advisory
Lessons appear in your daily report as **text only**. They never change `desk-kit.json`, never touch a guard, and never place an order. If a lesson suggests a setting and you agree, *you* edit the setting. That keeps a clear line between "something we noticed" and "something we decided".

## What makes a good lesson
- **It came from evidence.** "Three rungs on WAL all filled within an hour during Monday's drop" beats "WAL is risky".
- **It's specific.** Name the pool, the side and the situation.
- **It's testable.** Can you check next week whether it still holds?
- **It's dated.** Markets change. A lesson from a different season may expire.

## A habit for the rest of training
Once a day, ask: *Did anything happen that I'd want to remember in a month?* If yes, write one lesson. If no, write nothing. Five good lessons are worth more than fifty vague ones.

## Promotion, slowly
On the desk, a lesson becomes a rule only after it has held up over time and a human has agreed to change a setting. Your desk can work the same way: note it, watch it, and only then decide.

## Today's practice task for your bot
> Run the HALT check. Look at our first eight days of paper results and draft up to two lessons in the lessons format (id, applies, since, source, two or three sentences), each tied to something that actually happened in the reports. Show them to me as drafts. Don't write to lessons.md until I say yes, and don't change any setting.

## Remember
- Lessons are notes, in a fixed format, with evidence and a date.
- Lessons inform; they never change settings or guards.
- You decide which lessons become settings.

*Education only, not financial advice. No returns are promised or implied.*
