"""4-button input for the Rider-Pi.

Physical buttons (GPIO BCM, active-low with pull-ups), confirmed via the Yahboom
key.py: key1=24, key2=23, key3=17, key4=22. Logical roles confirmed with user:
  START_STOP (key1) · TALK / push-to-talk (key2) · NEXT (key3) · REPEAT (key4)

GpioButtons runs on the Pi; KeyboardButtons is a dev stand-in. Both expose:
  poll()        -> list[Btn] pressed since the last poll (momentary: start/next/repeat)
  is_held(b)    -> bool currently held (used for TALK push-to-talk)
"""
from __future__ import annotations

from enum import Enum


class Btn(str, Enum):
    START_STOP = "start_stop"  # key1 / GPIO24
    TALK = "talk"              # key2 / GPIO23
    NEXT = "next"              # key3 / GPIO17
    REPEAT = "repeat"          # key4 / GPIO22


# Physical layout (confirmed on-device 2026-06-25): the 4 buttons are at the screen
# corners. Map GPIO→function so each corner matches its on-screen label:
#   top-left  GPIO17 = START_STOP   top-right GPIO22 = TALK
#   bot-left  GPIO23 = NEXT         bot-right GPIO24 = REPEAT
PIN_MAP = {17: Btn.START_STOP, 22: Btn.TALK, 23: Btn.NEXT, 24: Btn.REPEAT}


class Buttons:
    def poll(self) -> list[Btn]:
        raise NotImplementedError

    def is_held(self, b: Btn) -> bool:
        return False


class GpioButtons(Buttons):
    def __init__(self) -> None:
        import RPi.GPIO as GPIO  # noqa: WPS433 (device-only import)
        self._GPIO = GPIO
        GPIO.setwarnings(False)
        GPIO.setmode(GPIO.BCM)
        for pin in PIN_MAP:
            GPIO.setup(pin, GPIO.IN, pull_up_down=GPIO.PUD_UP)
        # True = released (pull-up high); False = pressed (to ground)
        self._last = {pin: True for pin in PIN_MAP}

    def poll(self) -> list[Btn]:
        events: list[Btn] = []
        for pin, btn in PIN_MAP.items():
            state = bool(self._GPIO.input(pin))
            if self._last[pin] and not state:  # falling edge = press
                events.append(btn)
            self._last[pin] = state
        return events

    def is_held(self, b: Btn) -> bool:
        for pin, btn in PIN_MAP.items():
            if btn == b:
                return not bool(self._GPIO.input(pin))
        return False


class KeyboardButtons(Buttons):
    """Dev: feed typed lines; keys 1/2/3/4 map to the four buttons."""

    _KEYS = {"1": Btn.START_STOP, "2": Btn.TALK, "3": Btn.NEXT, "4": Btn.REPEAT}

    def __init__(self) -> None:
        self._queue: list[Btn] = []

    def feed(self, line: str) -> None:
        for ch in line.strip():
            if ch in self._KEYS:
                self._queue.append(self._KEYS[ch])

    def poll(self) -> list[Btn]:
        q, self._queue = self._queue, []
        return q
