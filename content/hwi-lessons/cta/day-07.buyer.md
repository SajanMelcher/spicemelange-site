## Apply this on the desk

A ladder should fit the way a market actually swings, not the way we hope it does. Ask your bot to compare your `buyStepsPct` with the last week's daily ranges for each pool, and tell you how many rungs would have filled. If the answer is "all of them, every day", your steps may be too tight for a falling market. If it's "none", they may be too wide.

For a longer look back, your agent can pull candles for any pool through The Spice Melange Trading Desk connector. The Spice Melange Trading Desk connector is free to run locally (`npx -y plumbline-mcp`); hosted, it gives 100 free calls a day per client, then 0.002 USDC a call (0.01 USDC minimum payment). It holds no keys. It can't place trades or touch your funds.

*Education only, not financial advice. Trading can lose money, including all of it. No returns are promised.*
