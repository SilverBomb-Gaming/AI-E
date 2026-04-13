"""Formatting helpers for operator-visible task chains."""
from __future__ import annotations

from .task_chain_models import TaskChainRecord, TaskChainStepRecord


class TaskChainFormatter:
    @staticmethod
    def format_chain_preview(*, chain: TaskChainRecord) -> str:
        lines = [
            "[TASK CHAIN]",
            f"Chain: {chain.title}",
            f"ID: {chain.chain_id}",
            f"Type: {chain.chain_type}",
            f"Objective: {chain.objective}",
            f"Command: {chain.command_label} {chain.command_argument}".strip(),
            f"Primary target: {chain.primary_target_display}",
            f"Fallback: {chain.fallback_target_display or chain.fallback_policy}",
            f"Allowed: {', '.join(chain.allowed_step_families)}",
            f"Limits: steps={chain.max_steps} failures={chain.max_failures} no_progress={chain.max_no_progress}",
            f"Policy: {chain.chain_policy_version}",
            f"Status: {chain.status}",
        ]
        if chain.branch_rules:
            lines.append(f"Branch rules: {len(chain.branch_rules)}")
        if chain.fallback_actions:
            lines.append(f"Fallback actions: {', '.join(action.action_id for action in chain.fallback_actions)}")
        if not chain.approved_at:
            lines.append("Approval required before start")
        return "\n".join(lines)

    @staticmethod
    def format_chain_list(*, chains: tuple[TaskChainRecord, ...]) -> str:
        lines = ["[TASK CHAINS]"]
        if not chains:
            lines.append("No task chain is recorded yet.")
            return "\n".join(lines)
        for chain in chains:
            lines.extend(
                (
                    f"- {chain.chain_id}",
                    f"  Title: {chain.title}",
                    f"  Type: {chain.chain_type}",
                    f"  Status: {chain.status}",
                    f"  Steps: {chain.steps_completed}/{chain.max_steps}",
                    f"  Progress: {chain.progress_state}",
                    f"  Summary: {chain.latest_summary or chain.final_summary or '-'}",
                )
            )
        return "\n".join(lines)

    @staticmethod
    def format_chain_status(*, chain: TaskChainRecord, steps: tuple[TaskChainStepRecord, ...]) -> str:
        last_step = steps[-1] if steps else None
        lines = [
            "[TASK CHAIN STATUS]",
            f"Chain: {chain.title}",
            f"ID: {chain.chain_id}",
            f"Type: {chain.chain_type}",
            f"Status: {chain.status}",
            f"Policy version: {chain.chain_policy_version}",
            f"Objective: {chain.objective}",
            f"Steps completed: {chain.steps_completed}/{chain.max_steps}",
            f"Successes: {chain.success_count}",
            f"Failures: {chain.failure_count}",
            f"No progress count: {chain.no_progress_count}/{chain.max_no_progress}",
            f"Progress state: {chain.progress_state}",
            f"Resume count: {chain.resume_count}",
            f"Last step: {last_step.family if last_step is not None else '-'}",
            f"Last result: {last_step.status if last_step is not None else '-'}",
        ]
        if chain.pause_reason:
            lines.append(f"Pause reason: {chain.pause_reason}")
        if chain.stop_reason:
            lines.append(f"Stop reason: {chain.stop_reason}")
        if chain.last_decision_summary:
            lines.append(f"Last decision: {chain.last_decision_summary}")
        lines.append(f"Summary: {chain.final_summary or chain.latest_summary or '-'}")
        return "\n".join(lines)

    @staticmethod
    def format_chain_steps(*, chain: TaskChainRecord, steps: tuple[TaskChainStepRecord, ...]) -> str:
        lines = ["[TASK CHAIN STEPS]", f"Chain: {chain.title}", f"ID: {chain.chain_id}"]
        if not steps:
            lines.append("No recorded steps yet.")
            return "\n".join(lines)
        for step in steps:
            lines.extend(
                (
                    f"- Step {step.step_number}: {step.step_id}",
                    f"  Family: {step.family}",
                    f"  Status: {step.status}",
                    f"  Progress: {'yes' if step.progress_made else 'no'}",
                    f"  Progress state: {step.progress_state}",
                    f"  Decision: {step.decision_summary or '-'}",
                    f"  Reason: {step.transition_reason or '-'}",
                    f"  Rule: {step.matched_rule_id or '-'}",
                    f"  Next: {step.next_action or '-'}",
                    f"  Summary: {step.result_summary}",
                )
            )
        return "\n".join(lines)

    @staticmethod
    def format_chain_decision(*, chain: TaskChainRecord, steps: tuple[TaskChainStepRecord, ...]) -> str:
        last_step = steps[-1] if steps else None
        lines = [
            "[TASK CHAIN DECISION]",
            f"Chain: {chain.title}",
            f"ID: {chain.chain_id}",
            f"Status: {chain.status}",
            f"Stage: {chain.metadata.get('stage', '-') or '-'}",
            f"Progress state: {chain.progress_state}",
            f"Decision summary: {chain.last_decision_summary or '-'}",
            f"Pause reason: {chain.pause_reason or '-'}",
            f"Allowed reasons: {', '.join(chain.allowed_transition_reasons) or '-'}",
        ]
        if last_step is not None:
            lines.extend(
                (
                    f"Last rule: {last_step.matched_rule_id or '-'}",
                    f"Last transition: {last_step.transition_reason or '-'}",
                    f"Previous stage: {last_step.previous_stage or '-'}",
                    f"Next stage: {last_step.next_stage or '-'}",
                    f"Next action: {last_step.next_action or '-'}",
                    f"Fallback used: {'yes' if last_step.fallback_used else 'no'}",
                )
            )
        return "\n".join(lines)