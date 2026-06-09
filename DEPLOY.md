# Deploying to Oracle Cloud (Always-Free A1) with DuckDNS + Caddy

A single Arm VM runs the whole stack via `docker-compose.prod.yml`: Postgres, the NestJS
backend, the Next.js frontend, and Caddy (which terminates HTTPS for two DuckDNS subdomains).

## 1. Create the VM

- Compute → Instances → **Create instance**.
- Shape: **Ampere (Arm) — VM.Standard.A1.Flex**. 1–2 OCPU / 6–12 GB RAM is plenty.
  (If you hit **"Out of host capacity"**, retry later or try another availability domain — A1 is in high demand.)
- Image: **Canonical Ubuntu 22.04** (or 24.04).
- Add your **SSH public key** during creation (you can't easily add it later).
- Note the **public IPv4** address.

## 2. Open the firewall — BOTH layers (the classic gotcha)

**a) Oracle cloud firewall** — VCN → Security List (or an NSG) → add ingress rules:

| Source CIDR | Protocol | Dest port |
|---|---|---|
| 0.0.0.0/0 | TCP | 80 |
| 0.0.0.0/0 | TCP | 443 |

**b) OS firewall** — Oracle's Ubuntu image ships `iptables` rules that block everything but SSH.
SSH in and run:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

If you skip (b), the cloud firewall looks open but connections still hang.

## 3. Point DuckDNS at the VM

1. Sign in at <https://www.duckdns.org> and create **two** subdomains, e.g.
   `yourname` and `yourname-api`.
2. Set the **current IP** of both to the VM's public IPv4.

## 4. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker   # or log out / back in
```

## 5. Configure and launch

```bash
git clone <your-repo-url> job-tracker && cd job-tracker
cp .env.deploy.example .env
nano .env        # fill in secrets + your DuckDNS domains (see notes below)

docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

The backend runs `prisma migrate deploy` automatically on startup, so the schema is
applied on first boot. Watch logs with:

```bash
docker compose -f docker-compose.prod.yml logs -f
```

### `.env` notes

- `FRONTEND_DOMAIN` / `BACKEND_DOMAIN` — hostnames only, **no** `https://` (Caddy uses these).
- `FRONTEND_URL` / `NEXT_PUBLIC_API_URL` — full URLs **with** `https://`.
- Generate secrets with `openssl rand -hex 32`.
- `NEXT_PUBLIC_API_URL` is **baked into the frontend at build time**. If you change it later,
  rebuild: `docker compose -f docker-compose.prod.yml up -d --build frontend`.

## 6. OAuth (optional)

If using Google/GitHub login, set the provider callback URLs to:

- `https://yourname-api.duckdns.org/auth/google/callback`
- `https://yourname-api.duckdns.org/auth/github/callback`

and put the client IDs/secrets in `.env`. Left as `placeholder`, the server still boots
with OAuth disabled.

## 7. Backups (Oracle does NOT back up your data)

Postgres lives on the named volume `postgres_data` — it survives `docker compose down`
(but **not** `down -v`). For real safety, schedule the dump script:

```bash
chmod +x scripts/db-backup.sh
crontab -e
# Daily at 03:30, keep 7 days (writes to ~/job-tracker-backups):
30 3 * * * /home/ubuntu/job-tracker/scripts/db-backup.sh >> /home/ubuntu/backup.log 2>&1
```

Restore a dump with:

```bash
gunzip -c ~/job-tracker-backups/job_tracker-YYYYMMDD-HHMMSS.sql.gz \
  | docker compose -f docker-compose.prod.yml exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

For off-box durability, sync `~/job-tracker-backups` to **Oracle Object Storage**
(also Always-Free) with the `oci` CLI.

## Updating after a code change

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

## Automated deploys (GitHub Actions)

`.github/workflows/deploy.yml` SSHes into the VM on every push to `main` and runs the
same pull + rebuild. The image build happens **on the VM** (which is Arm64), so CI only
needs SSH access — no registry or cross-arch build.

**One-time setup:**

1. Make sure the repo is already cloned at the deploy path on the VM (default
   `~/job-tracker`) with `.env` in place — the workflow updates an existing checkout, it
   does not bootstrap a fresh one.

2. Create a dedicated deploy key on the VM and authorize it:

   ```bash
   ssh-keygen -t ed25519 -f ~/deploy_key -N ""
   cat ~/deploy_key.pub >> ~/.ssh/authorized_keys
   cat ~/deploy_key            # copy this PRIVATE key into the secret below
   ```

3. In GitHub → Settings → Secrets and variables → Actions, add:

   | Kind | Name | Value |
   |---|---|---|
   | Secret | `SSH_HOST` | VM public IPv4 |
   | Secret | `SSH_USER` | `ubuntu` |
   | Secret | `SSH_PRIVATE_KEY` | contents of `~/deploy_key` |
   | Secret | `SSH_PORT` | `22` (optional; defaults to 22) |
   | Variable | `DEPLOY_PATH` | repo path on the VM (optional; defaults to `~/job-tracker`) |

Trigger manually anytime from the **Actions** tab (workflow_dispatch) or just push to `main`.
