# Deploying to Oracle Cloud (Always-Free A1) with DuckDNS + Caddy

A single Arm VM runs the whole stack via `docker-compose.prod.yml`: Postgres, the NestJS
backend, the Next.js frontend, and Caddy (which terminates HTTPS for two DuckDNS subdomains).

> **Staying $0 after the 30-day trial.** When the trial ends, the account converts to
> **Always Free** and anything inside these limits keeps running for free; resources beyond
> them are stopped/reclaimed. This whole stack runs on **one** VM with no managed services, so
> it stays free as long as you keep within:
>
> - **Compute:** ≤ **4 OCPU / 24 GB** total Ampere A1 (one VM here).
> - **Storage:** ≤ **200 GB** total block/boot volume; **no volume backups** (they bill — the
>   `db-backup.sh` script does a local `pg_dump`, which is free).
> - **Public IP:** use the **ephemeral** IP attached to the running VM. A _reserved_ IP left
>   **unattached** is billed.
> - **Don't** create a second VM/extra block volumes during the trial and forget them.
>
> Do **not** upgrade to Pay As You Go unless you accept that it removes these guardrails and
> can bill for anything beyond Always Free.

## 1. Create the VM

Compute → **Instances** → **Create instance**, then set:

- **Image:** _Change image_ → **Canonical Ubuntu 24.04 Minimal — aarch64**. The `aarch64`/Arm
  build is required for the A1 shape (the default x86 image won't boot on it).
- **Shape:** _Change shape_ → **Ampere** → **VM.Standard.A1.Flex**. Always-Free max is
  **4 OCPU / 24 GB RAM** — allocate the full amount (it's free), or 1–2 OCPU if you plan to
  split across multiple instances later.
- **Capacity type:** choose **On-demand** (not _Preemptible_) so the VM isn't stopped under load.
- **Security:** leave _Shielded instance_ and _Confidential computing_ **off** — they complicate
  Arm shapes and aren't needed here.
- **Networking:** _Create new VCN_ with a **public subnet**, and ensure **Assign a public IPv4
  address** is **On**.
- **SSH keys:** paste your own public key, **or** pick _Generate a key pair for me_ and
  **download the private key now** — you can't retrieve it after creation.
- **Boot volume (optional):** tick _Specify a custom boot volume size_ and set **200 GB** to use
  the full free storage quota (default is ~47 GB).
- Click **Create**, then note the **public IPv4** address.

> **"Out of host capacity"?** A1 is in high demand. Try a different **Availability Domain**
> (AD-1/2/3) in the _Placement_ section, or retry over a few hours / different times of day —
> capacity frees up. (Upgrading to Pay As You Go also gets provisioning priority, but see the
> cost warning above — it removes the Always-Free guardrails, so only do it if you accept that.)
>
> **Idle-reclaim caveat:** on Always Free, an instance under ~20% CPU/network/RAM for 7 days can
> be reclaimed. A low-traffic portfolio can trip this; if it happens, just restart the VM (the
> stack auto-starts via `restart: unless-stopped`), or keep one VM well within limits so a
> reclaim is painless.

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
# On the Minimal image, install the persistence tool if it's missing:
command -v netfilter-persistent >/dev/null || sudo apt-get update && sudo apt-get install -y iptables-persistent
sudo netfilter-persistent save
```

If you skip (b), the cloud firewall looks open but connections still hang.

## 3. Point DuckDNS at the VM

1. Sign in at <https://www.duckdns.org> and create **two** subdomains, e.g.
   `yourname` and `yourname-api`.
2. Set the **current IP** of both to the VM's public IPv4.

## 4. Install Docker

```bash
# The Minimal image may lack git/curl — install them first.
sudo apt-get update && sudo apt-get install -y git curl
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
