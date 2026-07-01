"""Motion-safe QR Wi-Fi setup.

This replaces Yahboom's demos/network.py for Xiaomu. It deliberately avoids
uiutils.py and xgolib, because importing those initializes the XGO motion stack.
Left-bottom button (GPIO23) exits.
"""
from __future__ import annotations

import os
import subprocess
import time

import cv2
import numpy as np
import pyzbar.pyzbar as pyzbar
from picamera2 import Picamera2
from PIL import Image, ImageDraw, ImageFont

import xgoscreen.LCD_2inch as LCD_2inch

LCD_W, LCD_H = 320, 240
EXIT_PIN = "23"  # physical bottom-left key in this project mapping
FONT = os.environ.get("XIAOMU_CJK_FONT", "/home/pi/RaspberryPi-CM5/model/msyh.ttc")


def _font(size: int):
    try:
        return ImageFont.truetype(FONT, size)
    except Exception:
        return ImageFont.load_default()


def _button_pressed(pin: str = EXIT_PIN) -> bool:
    try:
        out = subprocess.check_output(
            ["pinctrl", "level", pin], text=True, stderr=subprocess.DEVNULL, timeout=0.2
        ).strip()
        return out.startswith("0")
    except Exception:
        return False


def _wait_release(pin: str = EXIT_PIN) -> None:
    while _button_pressed(pin):
        time.sleep(0.03)


def _draw_text(img: np.ndarray, text: str, xy: tuple[int, int], size: int = 16,
               fill: tuple[int, int, int] = (255, 255, 255)) -> np.ndarray:
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil)
    draw.text(xy, text, font=_font(size), fill=fill)
    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


def _show(display, img: np.ndarray) -> None:
    display.ShowImage(Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB)))


def _connect_wifi(ssid: str, password: str) -> bool:
    cmd = ["sudo", "nmcli", "dev", "wifi", "connect", ssid, "password", password]
    return subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def _parse_wifi_qr(data: str) -> tuple[str, str] | None:
    if not data.startswith("WIFI:"):
        return None
    wifi: dict[str, str] = {}
    for part in data[5:].split(";"):
        if ":" in part:
            key, value = part.split(":", 1)
            wifi[key] = value
    ssid, password = wifi.get("S", ""), wifi.get("P", "")
    return (ssid, password) if ssid and password else None


def main() -> None:
    for pin in ("17", "22", "23", "24"):
        subprocess.run(["pinctrl", "set", pin, "ip"], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, check=False)

    display = LCD_2inch.LCD_2inch()
    display.Init()
    display.clear()

    picam2 = Picamera2()
    picam2.configure(picam2.create_preview_configuration(main={"format": "RGB888", "size": (LCD_W, LCD_H)}))
    picam2.start()
    _wait_release()

    try:
        while True:
            if _button_pressed():
                _wait_release()
                break

            img = cv2.flip(picam2.capture_array(), 1)
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            barcodes = pyzbar.decode(gray)

            img = _draw_text(img, "扫描 XGO-APP Wi-Fi 二维码", (8, 8), 16)
            img = _draw_text(img, "左下退出", (8, LCD_H - 24), 14, (180, 180, 200))

            if not barcodes:
                img = _draw_text(img, "未识别到二维码", (8, 32), 20, (255, 80, 80))
            for barcode in barcodes:
                x, y, w, h = barcode.rect
                cv2.rectangle(img, (x, y), (x + w, y + h), (0, 0, 255), 2)
                parsed = _parse_wifi_qr(barcode.data.decode("utf-8", "replace"))
                if not parsed:
                    img = _draw_text(img, "二维码格式不支持", (8, 32), 20, (255, 210, 0))
                    continue
                ssid, password = parsed
                img = _draw_text(img, f"正在连接 {ssid}", (8, 32), 18, (0, 255, 255))
                _show(display, img)
                ok = _connect_wifi(ssid, password)
                img = cv2.flip(picam2.capture_array(), 1)
                msg = "连接成功" if ok else "连接失败"
                color = (0, 255, 0) if ok else (255, 210, 0)
                img = _draw_text(img, msg, (8, 32), 22, color)
                img = _draw_text(img, "左下退出", (8, LCD_H - 24), 14, (180, 180, 200))
                _show(display, img)
                time.sleep(2.0)
                if ok:
                    return

            _show(display, img)
            time.sleep(0.03)
    finally:
        try:
            picam2.stop()
        finally:
            display.clear()


if __name__ == "__main__":
    main()
