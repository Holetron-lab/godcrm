=============================================
  Orange Pi Setup USB — Quick Start
=============================================

ПОДГОТОВКА ФЛЕШКИ:
  1. Отформатируй USB в FAT32 или ext4
  2. Скопируй всю папку opi-setup/ на флешку

СТРУКТУРА:
  /setup-orangepi.sh        — главный скрипт
  /keys/                    — SSH публичные ключи (.pub)
  /awg-keys/                — AWG приватные ключи (по hostname)
  /README.txt               — эта инструкция

ИСПОЛЬЗОВАНИЕ:
  1. Загрузи Orange Pi с microSD (любая рабочая Ubuntu/Armbian)
  2. Вставь USB-флешку
  3. Примонтируй:
       sudo mount /dev/sda1 /mnt/usb
     (или /dev/sdb1 — зависит от устройства, проверь: lsblk)
  4. Запусти:
       sudo bash /mnt/usb/opi-setup/setup-orangepi.sh <hostname> <awg-ip>

ПРИМЕРЫ:
  sudo bash /mnt/usb/opi-setup/setup-orangepi.sh opi1-office 10.66.66.6
  sudo bash /mnt/usb/opi-setup/setup-orangepi.sh opi2-office 10.66.66.10
  sudo bash /mnt/usb/opi-setup/setup-orangepi.sh opi3-hq 10.66.66.16

ЧТО ДЕЛАЕТ СКРИПТ:
  ✓ Ставит hostname и timezone (Moscow)
  ✓ Прописывает SSH ключи (root доступ)
  ✓ Устанавливает AmneziaWG + создаёт конфиг
  ✓ ВАЖНО: AllowedIPs = 10.66.66.0/24 (не 0.0.0.0/0!)
    → Интернет НЕ пропадёт если VPN упадёт
  ✓ Отключает старый WireGuard
  ✓ Создаёт swap 4GB
  ✓ Ставит fail2ban
  ✓ Включает IP forwarding
  ✓ Ставит htop, tmux, curl, rsync
  ✓ Опционально: клонирует систему на SSD/NVMe

ПОСЛЕ УСТАНОВКИ:
  1. Скрипт покажет AWG Public Key
  2. Добавь пир на VPS:
       ssh root@<HOST_IP>
       awg set awg0 peer <PUBLIC_KEY> allowed-ips <AWG_IP>/32
       awg-quick save awg0
  3. Проверь подключение:
       ping 10.66.66.1
  4. Перезагрузись: sudo reboot
