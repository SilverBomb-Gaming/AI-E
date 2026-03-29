import os
import sys


EXPECTED = r"E:\AI projects 2025\AI-E\.venv\Scripts\python.exe"


def enforce_python():
    current = os.path.abspath(sys.executable)

    if current.lower() != EXPECTED.lower():
        raise RuntimeError(
            f"[AI-E ENV ERROR]\n"
            f"Wrong interpreter detected.\n\n"
            f"Expected: {EXPECTED}\n"
            f"Actual:   {current}\n\n"
            f"Execution halted."
        )