# 3D Printer reverse-tunnel — recovery after server migration

The CRM reaches the printer's **Moonraker** API at `http://localhost:7125`
(`backend/services/agent-tools/printer-tools.js`). That port is fed by a
**reverse SSH tunnel initiated from the MKS Pi** — the printer dials out to the
CRM box and forwards its local Moonraker. The CRM box cannot reach the printer
directly, so the tunnel always starts on the printer side.

Slicing uses the `prusa-slicer` CLI on the CRM box (profile:
`backend/services/agent-tools/printer/slicer-profile.ini`).

## What broke

The CRM migrated to **<PROD_HOST> / `<PROD_IP>`**.
The MKS Pi's autossh still dials the old (dead) address, so 7125 is empty and
every `printer_*` MCP tool returns `fetch failed`.

## Server side — DONE (this box)

- `prusa-slicer` 2.7.2 installed; headless slice verified against our profile.
- Locked-down ingress user `printer` created. Its `authorized_keys` is
  restricted to **reverse-forward of `localhost:7125` only** — no shell, no
  other ports (`restrict,port-forwarding,permitlisten="localhost:7125",command=...`).
- Keypair `mkspi_tunnel` generated at `/home/printer/.ssh/`. Validated
  end-to-end with a stub Moonraker.

## Printer side — TODO (run on the MKS Pi)

1. Install autossh: `sudo apt-get install -y autossh`
2. Drop the private key (provided separately — never committed) at
   `/home/pi/.ssh/mkspi_tunnel`, `chmod 600`.
3. Install the unit and start it:
   ```
   sudo cp moonraker-tunnel.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now moonraker-tunnel
   ```
4. If the MKS Pi user is not `pi`, edit `User=` and the key path in the unit.

## Verify (on the CRM box, after the printer is up)

```
ss -tlnp | grep 7125                       # tunnel bound
curl -s http://localhost:7125/printer/info # Moonraker answers
```
Then `printer_status` MCP tool should return live state.

## Future migrations

Change ONLY the IP in `moonraker-tunnel.service` `ExecStart` and restart the
unit on the MKS Pi. Server-side ingress + slicer survive untouched.
