# Penpot — GOD CRM design instance

Self-hosted [Penpot](https://penpot.app) with **"Login with GOD CRM"** SSO. One instance
on PROD `.128` serves both design domains:

| Domain             | Path to penpot                                             |
| ------------------ | --------------------------------------------------------- |
| `design.godcrm.ai` | `.128` nginx → `127.0.0.1:9011` (direct)                  |
| `design.hltrn.cc`  | `.72` nginx → proxy to `.128` (Host rewritten to `design.godcrm.ai`) |

Live copy runs from `/root/penpot` on `.128`; this dir is the version-controlled source.

## SSO (OIDC via GOD CRM)

- CRM side: `oidc_clients` row `client_id=penpot`, `is_active=1`, with **both** redirect URIs
  registered so login works from either domain:
  - `https://design.hltrn.cc/api/auth/oidc/callback`
  - `https://design.godcrm.ai/api/auth/oidc/callback`
- Penpot side: all OIDC endpoints are set explicitly (see compose) so penpot **skips
  discovery** and always talks to `godcrm.ai` (valid cert + live user DB). Same pattern as
  WorkAdventure (ADR-063 / `penpot-oidc-sso-via-crm`).
- `PENPOT_PUBLIC_URI=https://design.hltrn.cc`, so the OIDC callback lands on
  `design.hltrn.cc` regardless of which domain starts the flow — both callbacks are
  whitelisted, so login completes either way.
- Verify a domain is live (should return HTTP 200 + a `redirect-uri` to
  `godcrm.ai/oauth/authorize`):
  ```
  curl -sS -X POST 'https://design.godcrm.ai/api/auth/oidc?provider=oidc'
  curl -sS -X POST 'https://design.hltrn.cc/api/auth/oidc?provider=oidc'
  ```

## Deploy

```
cp penpot.env.example penpot.env    # fill real secrets
docker compose --env-file penpot.env up -d
```

Secrets live only in `penpot.env` (gitignored). Never inline them in the compose.
