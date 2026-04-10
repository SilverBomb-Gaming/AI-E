"""Deterministic node bootstrap for multi-machine AI-E installs."""
from __future__ import annotations

import argparse
from pathlib import Path

from ..controller.node_config import NodeConfigStore, NodeLocalConfig, generate_node_id
from ..controller.profile_store import ControllerConfigStore


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Bootstrap an AI-E node config and controller config.")
    parser.add_argument("--config-dir", default="", help="Directory that will contain controller_config.json and node_config.json.")
    parser.add_argument("--registry-root", required=True, help="Shared registry directory visible to the controller and node workers.")
    parser.add_argument("--role", choices=("controller", "executor", "validator", "sandbox"), required=True)
    parser.add_argument("--display-name", default="", help="Human-readable node display name.")
    parser.add_argument("--node-id", default="", help="Explicit node id. Generated from role and display name if omitted.")
    parser.add_argument("--repo-root", required=True, help="Absolute repository root on this machine.")
    parser.add_argument("--allowed-root", action="append", default=[], help="Additional allowed root. Repeat as needed.")
    parser.add_argument("--capability", action="append", default=[], help="Declared bounded command label such as /run or /test.")
    parser.add_argument("--disable-node", action="store_true", help="Create the node config in a disabled state.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    config_dir = Path(args.config_dir).resolve() if args.config_dir else None
    controller_store = ControllerConfigStore(config_path=(config_dir / "controller_config.json") if config_dir else None)
    node_store = NodeConfigStore(config_path=(config_dir / "node_config.json") if config_dir else None)

    controller_config = controller_store.load()
    repo_root = str(Path(args.repo_root).resolve())
    allowed_roots = tuple(str(Path(root).resolve()) for root in ([repo_root] + list(args.allowed_root)))
    controller_config.repo_root = repo_root
    controller_config.file_allowed_roots = allowed_roots
    controller_store.save(controller_config)

    display_name = args.display_name.strip() or f"AI-E {args.role.title()} Node"
    capabilities = tuple(dict.fromkeys([label.strip() for label in (args.capability or ["/run", "/test"]) if label.strip()]))
    node_id = args.node_id.strip().lower() or generate_node_id(role=args.role, display_name=display_name, machine_label="")
    node_config = NodeLocalConfig(
        node_id=node_id,
        display_name=display_name,
        role=args.role,
        registry_root=str(Path(args.registry_root).resolve()),
        enabled=not args.disable_node,
        declared_capabilities=capabilities,
    )
    node_store.save(node_config)

    print("[NODE BOOTSTRAP]")
    print(f"Node id: {node_config.node_id}")
    print(f"Display name: {node_config.display_name}")
    print(f"Role: {node_config.role}")
    print(f"Registry root: {node_config.registry_root}")
    print(f"Repo root: {controller_config.repo_root}")
    print(f"Allowed roots: {', '.join(controller_config.file_allowed_roots)}")
    print(f"Capabilities: {' '.join(node_config.declared_capabilities) if node_config.declared_capabilities else 'none'}")
    print("Next:")
    print("1. Start the node worker with python -m app.node.worker --once or --loop.")
    print("2. Point the controller at the same registry root, then use /nodes to verify registration.")
    print("3. Use /dispatch <node-or-role> <bounded command> from the controller to queue work.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())