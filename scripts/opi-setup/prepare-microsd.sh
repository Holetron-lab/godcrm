#!/bin/bash
# =============================================================================
# Prepare microSD for Orange Pi first-boot
# Mounts the rootfs partition, injects SSH keys and first-boot script
#
# Usage (on your PC/Mac):
#   sudo bash prepare-microsd.sh /dev/sdX
#   (where /dev/sdX is the microSD card device)
#
# After flashing Ubuntu image to microSD with balenaEtcher:
#   1. Flash the image normally
#   2. Run this script to inject configs
#   3. Insert microSD into Orange Pi, boot
#   4. SSH in as root, run: /root/first-boot.sh opi1-home 10.66.66.6 home
# =============================================================================

set -euo pipefail

DEVICE="${1:-}"
[[ -z "$DEVICE" ]] && { echo "Usage: $0 /dev/sdX"; exit 1; }
[[ ! -b "$DEVICE" ]] && { echo "Not a block device: $DEVICE"; exit 1; }

MOUNT_POINT="/tmp/opi-rootfs"

# Find the rootfs partition (usually partition 1 or 2)
ROOTFS_PART=""
for p in "${DEVICE}p2" "${DEVICE}2" "${DEVICE}p1" "${DEVICE}1"; do
  if [[ -b "$p" ]]; then
    ROOTFS_PART="$p"
    break
  fi
done
[[ -z "$ROOTFS_PART" ]] && { echo "Cannot find rootfs partition on $DEVICE"; exit 1; }

echo "[+] Mounting $ROOTFS_PART → $MOUNT_POINT"
mkdir -p "$MOUNT_POINT"
mount "$ROOTFS_PART" "$MOUNT_POINT"

# Verify it's a Linux rootfs
[[ ! -d "$MOUNT_POINT/etc" ]] && { umount "$MOUNT_POINT"; echo "Not a valid rootfs"; exit 1; }

# ── 1. SSH keys ───────────────────────────────────────────────────────────────
echo "[+] Injecting SSH keys..."
mkdir -p "$MOUNT_POINT/root/.ssh"
cat > "$MOUNT_POINT/root/.ssh/authorized_keys" << 'KEYS'
# CRM Server (orchestrator access)
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBppUKrYwTExkgChP1LA+is99MWsFotoquCnF2rgtUfd root@v527836.hosted-by-vdsina.com
# Add more keys below (e.g. Geratron's key)
KEYS
chmod 700 "$MOUNT_POINT/root/.ssh"
chmod 600 "$MOUNT_POINT/root/.ssh/authorized_keys"

# ── 2. Enable SSH root login ─────────────────────────────────────────────────
echo "[+] Enabling SSH root login with key..."
SSHD_CONF="$MOUNT_POINT/etc/ssh/sshd_config"
if [[ -f "$SSHD_CONF" ]]; then
  sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' "$SSHD_CONF"
  sed -i 's/^#*PubkeyAuthentication.*/PubkeyAuthentication yes/' "$SSHD_CONF"
fi

# ── 3. Set root password (orangepi) for local console access ─────────────────
echo "[+] Setting root password..."
# Generate hash for password "orangepi"
ROOT_HASH=$(python3 -c "import crypt; print(crypt.crypt('orangepi', crypt.mksalt(crypt.METHOD_SHA512)))")
sed -i "s|^root:[^:]*:|root:${ROOT_HASH}:|" "$MOUNT_POINT/etc/shadow"

# ── 4. Copy first-boot script ────────────────────────────────────────────────
echo "[+] Installing first-boot script..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/setup-node.sh" "$MOUNT_POINT/root/first-boot.sh"
chmod +x "$MOUNT_POINT/root/first-boot.sh"

# ── 5. Copy AWG private keys ─────────────────────────────────────────────────
echo "[+] Copying AWG keys..."
mkdir -p "$MOUNT_POINT/root/awg-keys"
cat > "$MOUNT_POINT/root/awg-keys/opi1-home.key" << 'K1'
WA/FRkcCKdJFvWNHf1zmI7Pu+nB+NFZ5sGtZOAM+TXw=
K1
cat > "$MOUNT_POINT/root/awg-keys/opi2-store.key" << 'K2'
8PFTe4B/hDY8OteV/RxEo3Gl8MbC/RAVG1+g2KLhC0Y=
K2
chmod 600 "$MOUNT_POINT/root/awg-keys/"*

# ── 6. Create quick-start README ─────────────────────────────────────────────
cat > "$MOUNT_POINT/root/README.txt" << 'README'
====================================
  Orange Pi Node — Quick Start
====================================

After first boot, run ONE of these:

  For OPi1 (home, 24/7):
    bash /root/first-boot.sh --name opi1-home --ip 10.66.66.6 --role home \
      --key "$(cat /root/awg-keys/opi1-home.key)"

  For OPi2 (store, 22:00-09:00 MSK):
    bash /root/first-boot.sh --name opi2-store --ip 10.66.66.10 --role store \
      --key "$(cat /root/awg-keys/opi2-store.key)"

SSH access:
  - root / orangepi (console only)
  - SSH key auth from CRM server (pre-configured)

After setup, CRM server can connect via AWG tunnel:
  ssh root@10.66.66.6   (OPi1)
  ssh root@10.66.66.10  (OPi2)
====================================
README

# ── 7. Enable auto-DHCP on all interfaces ────────────────────────────────────
echo "[+] Ensuring DHCP on all interfaces..."
cat > "$MOUNT_POINT/etc/network/interfaces.d/auto-dhcp" << 'NETEOF'
auto eth0
iface eth0 inet dhcp

auto eth1
iface eth1 inet dhcp
NETEOF

# ── Done ──────────────────────────────────────────────────────────────────────
echo "[+] Unmounting..."
sync
umount "$MOUNT_POINT"

echo ""
echo "======================================"
echo "  microSD ready!"
echo "======================================"
echo "  1. Insert into Orange Pi"
echo "  2. Boot (connect ethernet)"
echo "  3. SSH in or use console (root/orangepi)"
echo "  4. Run: bash /root/first-boot.sh --name <name> --ip <ip> --role <role> --key \"\$(cat /root/awg-keys/<key>.key)\""
echo "======================================"
