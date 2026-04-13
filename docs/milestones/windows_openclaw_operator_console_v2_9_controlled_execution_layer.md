# Windows OpenClaw Operator Console v2.9 - Controlled Execution Layer

v2.9 closes the next practical operator gap after controlled file mutation by adding bounded local execution from Telegram without introducing autonomy.

What shipped:

- confirmation-gated `/run <command>` for a narrow bounded execution surface
- confirmation-gated `/test [target]` as a safe test wrapper over repo-local Python unittest execution
- repository-root-only execution scope with no arbitrary working-directory hopping
- blocked shell chaining and redirection operators in first-pass `/run`
- bounded command allowlist for `/run`: Python unittest/pytest invocations plus approved repo-local smoke scripts
- exact-once confirmation handling for execution, including duplicate-confirm prevention and stale confirmation rejection
- timeout enforcement with concise Telegram-facing timeout replies
- compact execution audit entries with command summary, scope, exit code, output summary, and duration

What did not ship:

- autonomous edit-run-fix loops
- detached/background task management
- package-manager/install automation
- broad shell parity or arbitrary command execution
- workflow-authored execution steps beyond deterministic interaction regression coverage

This remains a controlled operator layer. Execution still flows through capability, evaluator, confirmation, scope, execution, and audit.