# Windows OpenClaw Operator Console v1.8 - Capability Manifests & Trust Boundaries

This checkpoint makes each operator-console capability carry an explicit, inspectable trust boundary. The goal is not broader power. The goal is to make future power additions enter through a manifest-backed control layer instead of hidden assumptions in scattered command code.

## Manifest Schema Overview

Each capability is now declared through one manifest-backed definition that includes:

- identity and description: `capability_id`, `name`, `category`, and `short_description`
- execution and dependency: `execution_type`, `provider_dependency`, `network_requirement`, `requires_runtime`, and `requires_readiness`
- trust boundary classification: `access_kind`, `locality`, `data_scope`, `offline_safety`, `confirmation_sensitivity`, and `telegram_exposure`
- operational constraints: timeout support, confirmation support, degraded-mode support, default timeout, cooldown sensitivity, and visibility flags

## Trust-Boundary Behavior

- the capability registry now loads manifests as the source of truth instead of partial scattered capability metadata
- startup validation now rejects duplicate capability ids, missing required manifest fields, and a small set of clearly inconsistent trust-boundary combinations
- evaluator decisions now consume manifest trust fields directly, including offline/online safety, confirmation sensitivity, and Telegram exposure rules
- execution results now carry compact trust metadata so Telegram summaries and the desktop shell can show trust labels without dumping raw manifest data

## Telegram Exposure Rules

- `allowed` capabilities can execute normally through Telegram if other gates pass
- `limited` capabilities degrade into a Telegram-safe restricted path instead of being treated like a full unrestricted action
- `denied` capabilities are blocked from Telegram explicitly and predictably
- `/capabilities` now shows only user-visible, summary-visible capabilities and includes concise trust indicators such as `read-only`, `local`, and `online-sensitive`

## Verified

- current visible capabilities are declared through manifests: `help.read`, `status.read`, `mode.read`, `models.read`, `ask.provider_query`, and `capabilities.read`
- internal Telegram-safe command-handling capabilities are also manifested so execution results stay contract-safe even for parse failures or plain-text rejections
- `/capabilities` now returns trust-aware output instead of a simple availability list
- the desktop shell now exposes compact trust summaries for the most recent evaluated capability and the most recent execution result
- manifest validation, Telegram exposure enforcement, trust-aware `/capabilities` formatting, and execution/result trust summaries are covered by the controller test suite

## What This Enables Safely

- future capabilities such as `file.read`, `repo.status`, or `fetch.web` can be introduced with explicit trust boundaries instead of implicit assumptions
- stronger capabilities can now be reviewed for Telegram exposure, online sensitivity, and confirmation requirements before execution code exists
- registry, evaluator, executor, and UI surfaces now share one vocabulary for what a capability is trusted to do

## Not Added Yet

- new broad powers such as file access, repo execution, fetch, scraping, or orchestration
- a permissions dashboard, policy editor, or role-based access system
- multi-channel exposure control beyond the current Telegram surface
- speculative manifests for large sets of future tools that do not exist yet
