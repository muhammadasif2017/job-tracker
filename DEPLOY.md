# Deploying to Oracle Cloud (Always-Free A1) with DuckDNS + Caddy

A single Arm VM runs the app via `docker-compose.prod.yml`: the NestJS backend, the Next.js
frontend, and Caddy (which terminates HTTPS for two DuckDNS subdomains). **Postgres is hosted
on [Neon](https://neon.tech)** (managed, free tier) — keeping the database off the VM means a
reclaimed/recreated VM never loses data, and Neon handles backups for you.

> **Staying $0 after the 30-day trial.** When the trial ends, the account converts to
> **Always Free** and anything inside these limits keeps running for free; resources beyond
> them are stopped/reclaimed. This stack uses **one** VM plus Neon's free tier, so it stays
> free as long as you keep within:
>
> - **Compute:** ≤ **4 OCPU / 24 GB** total Ampere A1 (one VM here).
> - **Storage:** ≤ **200 GB** total block/boot volume on the VM.
> - **Public IP:** use the **ephemeral** IP attached to the running VM. A _reserved_ IP left
>   **unattached** is billed.
> - **Neon:** the free project (0.5 GB storage) is plenty for this app and never touches your
>   Oracle budget.
> - **Don't** create a second VM/extra block volumes during the trial and forget them.
>
> Do **not** upgrade to Pay As You Go unless you accept that it removes these guardrails and
> can bill for anything beyond Always Free.

## 1. Create the VM

Oracle's console layout and field labels change regularly, so for the exact click-path follow
Oracle's own current walkthrough — [**Creating an Instance**](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/launchinginstance.htm) —
and apply the project-specific choices below. These choices (not the button labels) are what
actually matter for this stack:

- **Shape:** **Ampere → VM.Standard.A1.Flex** (the Always-Free Arm shape). You can use up to the
  full Always-Free max of **4 OCPU / 24 GB RAM** for free. A1.Flex is resizable later, so it's
  fine to start smaller (e.g. **1 OCPU / 6 GB**) — that also dodges capacity errors (see below).
- **Image:** a **Canonical Ubuntu aarch64/Arm build** (e.g. Ubuntu 24.04). The Arm image is
  required — the default x86 image won't boot on A1.
- **Networking:** a VCN with a **public subnet**, and make sure a **public IPv4 address** is
  assigned to the instance.
- **SSH keys:** upload your **public** key — or let Oracle generate a pair and **download the
  private key immediately** (it can't be retrieved later).
- **Capacity type:** **on-demand** (not preemptible) so the VM isn't stopped under load.
- **Boot volume (optional):** raise to **200 GB** to use the full Always-Free block-storage
  quota (the default is smaller).

Then note the instance's **public IPv4** address.

> **Always-Free limits** (verified against Oracle's [Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
> doc): ≤ **4 OCPU / 24 GB** total Ampere A1 (splittable across up to 4 instances), ≤ **200 GB**
> total block/boot volume, and the **ephemeral** public IP of a running VM (a _reserved_ IP left
> **unattached** is billed). Neon hosts the database off-VM on its own free tier, so it never
> touches your Oracle budget. Don't upgrade to Pay-As-You-Go unless you accept that it removes
> these guardrails and can bill for anything beyond Always Free.

### "Out of host capacity" / "Ampere A1 instance is not available"

A1 is heavily oversubscribed, so free-tier creation frequently fails with this error. It is
**not** a misconfiguration on your side — Oracle is simply out of free Arm capacity in your home
region at that moment. What actually works (see Oracle's [Resolving Out of Host Capacity error](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/troubleshooting-out-of-host-capacity.htm)):

- **Ask for less.** A **1 OCPU / 6 GB** A1 instance succeeds far more often than the full
  4 OCPU / 24 GB. A1.Flex is resizable, so grab a small one now and scale it up once it exists.
- **Try every Availability Domain** (AD-1/2/3) and don't pin a fault domain — capacity is
  per-AD, and letting Oracle auto-pick the fault domain helps.
- **Retry in a loop, not by hand.** Capacity frees for seconds when others release it, so
  whoever is retrying at that instant wins. The reliable approach is a script that calls the
  `LaunchInstance` API on an interval until it succeeds; ready-made tools wrap the OCI CLI/API in
  exactly this loop (e.g. [hitrov/oci-arm-host-capacity](https://github.com/hitrov/oci-arm-host-capacity)).
- **Vary the time of day** — capacity churns, so spread retries across different hours.
- Pay-As-You-Go grants provisioning priority (which is why it's often suggested), but only do it
  if you accept losing the Always-Free guardrails above.

> **Idle-reclaim caveat:** on Always Free, an instance under ~20% CPU/network/RAM for 7 days can
> be reclaimed. A low-traffic portfolio can trip this; if it happens, just restart the VM (the
> stack auto-starts via `restart: unless-stopped`), or keep one VM well within limits so a
> reclaim is painless.

## 2. Open the firewall — BOTH layers (the classic gotcha)

**a) Oracle cloud firewall** — in the VCN, add stateful ingress rules to the subnet's
[Security List](https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/securitylists.htm)
(or an NSG). The rules you need:

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

## 5. Create the Neon database

1. Sign up at <https://neon.tech> and create a project (pick a region near your VM).
2. Copy the **connection string** from _Connection Details_ — it ends with `?sslmode=require`.
   For one long-running server, the **direct** (non-pooled) string is fine.
3. You'll paste it as `DATABASE_URL` in the next step.

Neon takes automatic backups and supports point-in-time restore, so there's no backup cron to
run. The backend applies the schema itself via `prisma migrate deploy` on startup.

## 6. Configure and launch

```bash
git clone <your-repo-url> job-tracker && cd job-tracker
cp .env.deploy.example .env
nano .env        # fill in DATABASE_URL (Neon), secrets, and your DuckDNS domains (see notes below)

docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

The backend runs `prisma migrate deploy` automatically on startup, so the schema is
applied to your Neon database on first boot. Watch logs with:

```bash
docker compose -f docker-compose.prod.yml logs -f
```

### `.env` notes

- `DATABASE_URL` — the Neon connection string, ending in `?sslmode=require`.
- `FRONTEND_DOMAIN` / `BACKEND_DOMAIN` — hostnames only, **no** `https://` (Caddy uses these).
- `FRONTEND_URL` / `NEXT_PUBLIC_API_URL` — full URLs **with** `https://`.
- Generate secrets with `openssl rand -hex 32`.
- `NEXT_PUBLIC_API_URL` is **baked into the frontend at build time**. If you change it later,
  rebuild: `docker compose -f docker-compose.prod.yml up -d --build frontend`.

## 7. OAuth (optional)

If using Google/GitHub login, set the provider callback URLs to:

- `https://yourname-api.duckdns.org/auth/google/callback`
- `https://yourname-api.duckdns.org/auth/github/callback`

and put the client IDs/secrets in `.env`. Left as `placeholder`, the server still boots
with OAuth disabled.

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
