#!/bin/bash
# Revert golive.sh — stop the Xiaomu runtime and bring the Yahboom demo back.
set -e
sudo systemctl disable --now xiaomu-robot.service 2>/dev/null || true
if [ -f /etc/rc.local.xiaomu-bak ]; then
  sudo cp /etc/rc.local.xiaomu-bak /etc/rc.local
fi
sudo systemctl enable xgo_script.service 2>/dev/null || true
echo "Reverted. Reboot to bring the Yahboom demo back: sudo reboot"
echo "(The xiaomu-brain.service stays — it's a harmless localhost service.)"
