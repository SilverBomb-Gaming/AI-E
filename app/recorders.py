"""Input and microphone recording helpers for AI-E."""
from __future__ import annotations

import json
import threading
import time
import wave
from pathlib import Path
from typing import Dict, Optional, TextIO

try:
    from pynput import keyboard, mouse
except ImportError:  # pragma: no cover - handled at runtime
    keyboard = None  # type: ignore[assignment]
    mouse = None  # type: ignore[assignment]

try:
    import sounddevice as sd
except ImportError:  # pragma: no cover - handled at runtime
    sd = None  # type: ignore[assignment]


class InputRecorder:
    """Capture keyboard and mouse activity into a JSONL stream."""

    def __init__(self) -> None:
        self._file: Optional[TextIO] = None
        self._keyboard_listener: Optional[keyboard.Listener] = None  # type: ignore[name-defined]
        self._mouse_listener: Optional[mouse.Listener] = None  # type: ignore[name-defined]
        self._lock = threading.Lock()
        self._event_count = 0
        self.last_error: str = ""

    def start(self, run_dir: Path) -> bool:
        if keyboard is None or mouse is None:  # type: ignore[truthy-bool]
            self.last_error = "pynput is not available"
            return False
        try:
            self._file = (run_dir / "input_events.jsonl").open("a", encoding="utf-8")
        except OSError as exc:
            self.last_error = str(exc)
            return False

        self._event_count = 0
        self._keyboard_listener = keyboard.Listener(on_press=self._on_key_press, on_release=self._on_key_release)
        self._mouse_listener = mouse.Listener(
            on_move=self._on_mouse_move,
            on_click=self._on_mouse_click,
            on_scroll=self._on_mouse_scroll,
        )
        try:
            self._keyboard_listener.start()
            self._mouse_listener.start()
        except RuntimeError as exc:
            self.last_error = str(exc)
            self.stop()
            return False
        return True

    def stop(self) -> None:
        if self._keyboard_listener:
            self._keyboard_listener.stop()
            self._keyboard_listener = None
        if self._mouse_listener:
            self._mouse_listener.stop()
            self._mouse_listener = None
        if self._file:
            self._file.close()
            self._file = None

    @property
    def event_count(self) -> int:
        return self._event_count

    def _record(self, event: str, payload: Dict[str, object]) -> None:
        if not self._file:
            return
        entry = {"ts": time.time(), "event": event, **payload}
        with self._lock:
            self._file.write(json.dumps(entry) + "\n")
            self._file.flush()
            self._event_count += 1

    @staticmethod
    def _fmt_key(key: object) -> str:
        try:
            value = key.char  # type: ignore[attr-defined]
            if value:
                return value
        except AttributeError:
            pass
        return str(key)

    # -------- keyboard callbacks --------
    def _on_key_press(self, key: object) -> None:
        self._record("key_press", {"key": self._fmt_key(key)})

    def _on_key_release(self, key: object) -> None:
        self._record("key_release", {"key": self._fmt_key(key)})

    # -------- mouse callbacks --------
    def _on_mouse_move(self, x: float, y: float) -> None:
        self._record("mouse_move", {"x": x, "y": y})

    def _on_mouse_click(self, x: float, y: float, button: object, pressed: bool) -> None:
        state = "down" if pressed else "up"
        self._record("mouse_click", {"x": x, "y": y, "button": str(button), "state": state})

    def _on_mouse_scroll(self, x: float, y: float, dx: float, dy: float) -> None:
        self._record("mouse_scroll", {"x": x, "y": y, "dx": dx, "dy": dy})


class MicRecorder:
    """Capture microphone audio (optionally gated by push-to-talk)."""

    def __init__(self, samplerate: int = 44100, channels: int = 1) -> None:
        self._samplerate = samplerate
        self._channels = channels
        self._stream: Optional[sd.RawInputStream] = None  # type: ignore[name-defined]
        self._wave_handle: Optional[wave.Wave_write] = None
        self._run_dir: Optional[Path] = None
        self._start_time: Optional[float] = None
        self._device_info: Dict[str, object] = {}
        self._push_to_talk_enabled = False
        self._push_active = True
        self._keyboard_listener: Optional[keyboard.Listener] = None  # type: ignore[name-defined]
        self._frames_recorded = 0
        self.last_error: str = ""

    def start(self, run_dir: Path, *, push_to_talk: bool = False) -> bool:
        if sd is None:  # type: ignore[truthy-bool]
            self.last_error = "sounddevice is not available"
            return False
        if push_to_talk and keyboard is None:  # type: ignore[truthy-bool]
            self.last_error = "pynput (keyboard) is required for push-to-talk"
            return False
        audio_path = run_dir / "mic.wav"
        try:
            self._wave_handle = wave.open(str(audio_path), "wb")
            self._wave_handle.setnchannels(self._channels)
            self._wave_handle.setsampwidth(2)
            self._wave_handle.setframerate(self._samplerate)
        except OSError as exc:
            self.last_error = str(exc)
            self._wave_handle = None
            return False

        self._push_to_talk_enabled = push_to_talk
        self._push_active = not push_to_talk
        self._start_time = time.time()
        self._frames_recorded = 0
        try:
            self._stream = sd.RawInputStream(
                samplerate=self._samplerate,
                channels=self._channels,
                dtype="int16",
                callback=self._on_audio_chunk,
            )
            self._stream.start()
            self._device_info = sd.query_devices(self._stream.device)
        except Exception as exc:  # noqa: BLE001
            self.last_error = str(exc)
            if audio_path.exists():
                audio_path.unlink(missing_ok=True)
            self.stop()
            return False

        self._run_dir = run_dir
        if push_to_talk:
            self._keyboard_listener = keyboard.Listener(
                on_press=self._on_push_key_press,
                on_release=self._on_push_key_release,
            )
            try:
                self._keyboard_listener.start()
            except RuntimeError as exc:
                self.last_error = str(exc)
                self.stop()
                return False
        return True

    def stop(self) -> Dict[str, object]:
        if self._keyboard_listener:
            self._keyboard_listener.stop()
            self._keyboard_listener = None
        if self._stream:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:  # noqa: BLE001 - best effort shutdown
                pass
            self._stream = None
        if self._wave_handle:
            try:
                self._wave_handle.close()
            except Exception:  # noqa: BLE001
                pass
            self._wave_handle = None

        end_time = time.time()
        duration = 0.0
        if self._start_time:
            duration = max(0.0, end_time - self._start_time)
        recorded = self._frames_recorded / self._samplerate if self._samplerate else 0.0
        meta = {
            "enabled": self._run_dir is not None,
            "sample_rate": self._samplerate,
            "channels": self._channels,
            "push_to_talk": self._push_to_talk_enabled,
            "duration_seconds": round(duration, 2),
            "recorded_seconds": round(recorded, 2),
            "device": self._device_info.get("name", "unknown"),
            "started_at": self._start_time,
            "ended_at": end_time,
        }
        if self._run_dir and (self._run_dir / "mic.wav").exists():
            (self._run_dir / "mic_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        return meta

    # ------------- callbacks -------------
    def _on_audio_chunk(self, data: bytes, frames: int, *_: object) -> None:
        if not self._wave_handle or not self._push_active:
            return
        self._wave_handle.writeframes(data)
        self._frames_recorded += frames

    def _on_push_key_press(self, key: object) -> None:
        if getattr(key, "char", None) == " " or str(key) == "Key.space":
            self._push_active = True

    def _on_push_key_release(self, key: object) -> None:
        if getattr(key, "char", None) == " " or str(key) == "Key.space":
            self._push_active = False
