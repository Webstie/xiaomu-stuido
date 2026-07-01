#!/bin/bash
set -eux

LOG=/boot/firmware/restore-yahboom.log
exec >>"$LOG" 2>&1

date
echo "Starting Yahboom restore"

mount -o remount,rw / || true
mount -o remount,rw /boot/firmware || true

systemctl disable --now xiaomu-robot.service || true
systemctl disable --now xiaomu-brain.service || true

if [ -f /etc/rc.local.xiaomu-bak ]; then
  cp /etc/rc.local.xiaomu-bak /etc/rc.local
  chmod +x /etc/rc.local || true
fi

systemctl enable xgo_script.service || true

if [ -f /boot/firmware/cmdline.before-xiaomu-restore.txt ]; then
  cp /boot/firmware/cmdline.before-xiaomu-restore.txt /boot/firmware/cmdline.txt
fi

touch /boot/firmware/RESTORE_YAHBOOM_DONE
sync
echo "Yahboom restore complete"
