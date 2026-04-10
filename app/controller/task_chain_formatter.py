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
            f"Status: {chain.status}",
        ]
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
            f"Objective: {chain.objective}",
            f"Steps completed: {chain.steps_completed}/{chain.max_steps}",
            f"Successes: {chain.success_count}",
            f"Failures: {chain.failure_count}",
            f"No progress count: {chain.no_progress_count}/{chain.max_no_progress}",
            f"Last step: {last_step.family if last_step is not None else '-'}",
            f"Last result: {last_step.status if last_step is not None else '-'}",
        ]
        if chain.stop_reason:
            lines.append(f"Stop reason: {chain.stop_reason}")
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
                    f"  Summary: {step.result_summary}",
                )
            )
        return "\n".join(lines)