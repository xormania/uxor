"""Operation journal for a single Composer lifecycle process and its live observers."""
from __future__ import annotations

from contextlib import contextmanager
from functools import lru_cache
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import time


_NAME = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}\Z")


class _Journal:
    def __init__(self, path: str):
        self.path = path
        self.seq = 0
        self.active: list[int] = []
        self.disabled = False

    def emit(self, event: str, name: str, operation_id: int, parent_id: int | None) -> None:
        if self.disabled:
            return
        self.seq += 1
        data = {"seq": self.seq, "event": event, "name": name, "operation_id": operation_id,
                "parent_id": parent_id, "timestamp": time.time(), "monotonic": time.monotonic()}
        try:
            flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK
            with os.fdopen(os.open(self.path, flags, 0o600), "ab", buffering=0) as out:
                info = os.fstat(out.fileno())
                if not stat.S_ISREG(info.st_mode) or (self.seq == 1 and info.st_size):
                    raise OSError("expected a fresh regular journal")
                line = (json.dumps(data, separators=(",", ":")) + "\n").encode()
                if out.write(line) != len(line):
                    raise OSError("incomplete event write")
        except OSError:
            self.disabled = True
            print("Lifecycle telemetry: cannot append operation events; see the run transcript.", file=sys.stderr)


# Every suite invocation has its own process and fresh journal. Keep the sequence shared by all its helpers.
_journal = lru_cache(maxsize=1)(_Journal)


@contextmanager
def operation(name: str):
    """Record a fixed operation name. Command arguments, output and exception text stay out of the journal."""
    path = os.environ.get("UXOR_LIFECYCLE_EVENTS")
    if not path:
        yield
        return
    if not _NAME.fullmatch(name):
        raise ValueError("Use a static lifecycle operation identifier.")
    journal = _journal(path)
    operation_id = journal.seq + 1
    parent_id = journal.active[-1] if journal.active else None
    journal.emit("started", name, operation_id, parent_id)
    journal.active.append(operation_id)
    try:
        yield
    except BaseException:
        journal.emit("failed", name, operation_id, parent_id)
        raise
    else:
        journal.emit("succeeded", name, operation_id, parent_id)
    finally:
        journal.active.pop()


def _number(value) -> bool:
    return type(value) in (float, int) and math.isfinite(value)


def progress(path: Path, *, finished: float | None = None, finished_monotonic: float | None = None,
             terminal_state: str | None = None, timeline: bool = False) -> dict:
    """Project a readable prefix in sequence order, also while the writer is appending its next line."""
    rows = {}
    active = []
    last_success = None
    error = None
    seq = 1
    previous_clock = None
    try:
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW), "rb") as source:
            if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                raise OSError("expected a regular journal")
            while line := source.readline(4097):
                if len(line) > 4096:
                    raise ValueError("oversized record")
                if not line.endswith(b"\n"):
                    if finished is not None or terminal_state not in (None, "running"):
                        raise ValueError("truncated final record")
                    break
                data = json.loads(line)
                operation_id, parent_id, name = data["operation_id"], data["parent_id"], data["name"]
                event, timestamp, clock = data["event"], data["timestamp"], data["monotonic"]
                if (type(data["seq"]) is not int or data["seq"] != seq or type(operation_id) is not int
                        or (parent_id is not None and type(parent_id) is not int) or not _NAME.fullmatch(name)
                        or not _number(timestamp) or not _number(clock)
                        or (previous_clock is not None and clock < previous_clock)):
                    raise ValueError("invalid record")
                if event == "started":
                    if operation_id != seq or parent_id != (active[-1] if active else None):
                        raise ValueError("invalid operation start")
                    rows[operation_id] = {"operation_id": operation_id, "parent_id": parent_id, "name": name,
                                          "state": "running", "started_at": timestamp, "finished_at": None,
                                          "_clock": clock}
                    active.append(operation_id)
                elif event in ("succeeded", "failed"):
                    if not active or active[-1] != operation_id:
                        raise ValueError("unmatched operation end")
                    row = rows[operation_id]
                    if row["name"] != name or row["parent_id"] != parent_id:
                        raise ValueError("mismatched operation end")
                    row.update(state=event, finished_at=timestamp, elapsed_seconds=clock - row.pop("_clock"))
                    active.pop()
                    if event == "succeeded":
                        last_success = row
                else:
                    raise ValueError("unknown event")
                seq += 1
                previous_clock = clock
    except FileNotFoundError:
        pass  # Receipts from before operation telemetry remain readable.
    except OSError:
        error = "Cannot read the operation journal."
    except (KeyError, TypeError, ValueError, OverflowError, RecursionError):
        error = f"Invalid operation journal record at line {seq}."

    missing_end = bool(active) and terminal_state in ("passed", "failed", "skipped", "launch_failed")
    if missing_end and not error:
        error = "The operation journal is missing a completion record."
    now = time.monotonic()
    for operation_id in active:
        row = rows[operation_id]
        start_clock = row.pop("_clock")
        if terminal_state == "interrupted" or missing_end:
            # A later observation cannot establish an unrecorded end. Only the last event proves activity.
            row.update(state="incomplete" if missing_end else "interrupted", elapsed_seconds=None, elapsed_basis="last_event",
                       elapsed_at_least_seconds=previous_clock - start_clock)
            continue
        if finished is None:
            elapsed = now - start_clock
        else:
            row.update(state="interrupted", elapsed_basis="run_end")
            elapsed = finished_monotonic - start_clock if finished_monotonic is not None else finished - row["started_at"]
        row["elapsed_seconds"] = max(0.0, elapsed)
    result = {"current_operation": rows[active[-1]] if active else None,
              "active_operations": [rows[operation_id] for operation_id in active],
              "last_successful_operation": last_success}
    if timeline:
        result["timeline"] = list(rows.values())
    if error:
        result["telemetry_error"] = error
    return result
