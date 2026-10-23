# Cost log

Blended $ per 1M tokens, used by the brain for estimates. Fill in from
https://www.anthropic.com/pricing (a blend of input/output/cache; rough is fine):

| Model | $/1M tokens (blended) |
|---|---|
| opus | 7.20 |
| sonnet | 3.60 |
| haiku | 0.18 |

<!-- The brain appends one dated entry per /task below, newest on top:
     a per-sub-agent table and a per-model table. -->

## 2026-10-23 — Mailpit for local VS Code debugging (S)

| Agent | Model | Runs | Tool uses | Tokens | Duration | Est. cost |
|---|---|---|---|---|---|---|
| devops | sonnet | 1 | 4 | 35,915 | 26s | $0.13 |
| **Sub-agents total** | | | | **35,915** | **26s** | **$0.13** |

| Model | Agents | Runs | Tokens | Share of tokens | Est. cost |
|---|---|---|---|---|---|
| sonnet | devops | 1 | 35,915 | 100% | $0.13 |
| **Total** | | **1** | **35,915** | 100% | **$0.13** |

## 2026-10-23 — Project init (init)

| Agent | Model | Runs | Tool uses | Tokens | Duration | Est. cost |
|---|---|---|---|---|---|---|
| devops | sonnet | 1 | 11 | 25,452 | 1m 39s | $0.09 |
| **Sub-agents total** | | | | **25,452** | **1m 39s** | **$0.09** |

| Model | Agents | Runs | Tokens | Share of tokens | Est. cost |
|---|---|---|---|---|---|
| sonnet | devops | 1 | 25,452 | 100% | $0.09 |
| **Total** | | **1** | **25,452** | 100% | **$0.09** |
