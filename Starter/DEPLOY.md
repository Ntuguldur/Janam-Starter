`# Deploy on a Namecheap VPS Spark server

This app runs in Docker and stores its SQLite database in `./data`. Spark is suitable for a small, low-traffic store; it has 1 vCPU, 1 GB RAM, and 20 GB SSD. The Compose setup caps the app container at 384 MB and keeps port 3000 private to the server.

## 1. Prepare the VPS

Use Ubuntu 24.04 LTS (or another supported Ubuntu LTS) with root access. Point the domain's `A` record (and `www` if desired) at the VPS IPv4 address. Allow inbound SSH, HTTP (80), and HTTPS (443) in the VPS firewall/security group. Do not expose port 3000 publicly.

Install Docker Engine with Docker Compose v2 and Nginx on the VPS. Then copy/clone this project to `/opt/oyu-store` and enter that directory. For example, when the project is available in a Git remote:

```sh
sudo apt update
sudo apt install -y docker.io docker-compose-v2 nginx certbot python3-certbot-nginx
sudo systemctl enable --now docker nginx
sudo mkdir -p /opt/oyu-store
sudo chown "$USER":"$USER" /opt/oyu-store
```

Clone or copy the project files into `/opt/oyu-store`. Do not copy `node_modules`.

## 2. Configure and start the app

From `/opt/oyu-store`:

```sh
cp .env.example .env
```

Edit `.env` and set `ADMIN_PASSWORD` to a unique, long secret. Keep `.env` private. If bringing an existing catalog, copy its database into `/opt/oyu-store/data/oyu.db` before starting; keep a backup of the original. If no database is copied, the app creates a fresh database and categories.

```sh
mkdir -p data
docker compose up -d --build
docker compose logs -f store
```

The service should answer locally at `http://127.0.0.1:3000/` on the VPS.

## 3. Put Nginx and HTTPS in front

Create `/etc/nginx/sites-available/oyu-store` and replace `shop.example.com` with the domain:

```nginx
server {
    listen 80;
    server_name shop.example.com www.shop.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 7m;
    }
}
```

Enable the site and request a certificate:

```sh
sudo ln -s /etc/nginx/sites-available/oyu-store /etc/nginx/sites-enabled/oyu-store
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d shop.example.com -d www.shop.example.com
```

Omit `www.shop.example.com` in both places if that DNS name is not configured. Certbot configures HTTPS and renewal.

## Operations

- Update: pull/copy the new project version, then run `docker compose up -d --build`.
- Logs: `docker compose logs -f store`.
- Back up: stop the app briefly, archive `data/oyu.db*`, then start it again. SQLite uses WAL files, so back up the database consistently rather than copying only `oyu.db` while writes are active.
- Admin: use the configured private path from `ADMIN_PATH` (the default is documented in `README.md`) and the `ADMIN_PASSWORD` from `.env`.

The repository does not contain VPS credentials, an IP address, or a domain, so the commands above prepare the project but do not perform the remote provisioning or DNS cutover.
`