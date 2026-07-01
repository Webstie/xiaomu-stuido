#!/bin/bash
# Make the robot boot into Xiaomu instead of the Yahboom demo (S7 autostart).
# REVERSIBLE: see restore-demo.sh. Run on the Pi (has passwordless sudo).
set -e
echo "== installing xiaomu-robot.service =="
sudo cp /home/pi/xiaomu/deploy/xiaomu-brain.service /etc/systemd/system/
sudo cp /home/pi/xiaomu/deploy/xiaomu-robot.service /etc/systemd/system/
sudo systemctl daemon-reload

echo "== disabling the Yahboom demo autostart =="
sudo systemctl disable --now xgo_script.service 2>/dev/null || true
# rc.local launches the CM5 demo too — back it up and comment that line out
if [ -f /etc/rc.local ] && ! [ -f /etc/rc.local.xiaomu-bak ]; then
  sudo cp /etc/rc.local /etc/rc.local.xiaomu-bak
  sudo sed -i '/RaspberryPi-CM5.*main.py/s/^/# xiaomu-disabled: /' /etc/rc.local || true
fi
# stop any running demo now
sudo pkill -f "RaspberryPi-CM5/[m]ain.py" 2>/dev/null || true

echo "== enabling + starting the runtime =="
sudo systemctl enable --now xiaomu-brain.service
sudo systemctl enable --now xiaomu-robot.service
sleep 4
echo "brain:   $(systemctl is-active xiaomu-brain)"
echo "runtime: $(systemctl is-active xiaomu-robot)"
echo "Done. The robot now boots into Xiaomu. To revert: bash deploy/restore-demo.sh"
