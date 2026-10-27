# Deploy do backend FitOS na VPS

Servidor: `saturno.rbsconsulting.com.br` · IP `31.97.91.192` · Ubuntu 24.04.3 LTS
API: `https://fitos.rbsconsulting.com.br`
Repositório: `https://github.com/rbsconsultoriaemti/fitos.git`

## Como a produção roda

O backend em produção roda **somente em Docker** (container `fitos-fitos-api-1`), roteado pelo **Traefik** em
`fitos.rbsconsulting.com.br`. O **PM2 foi desativado** — não use `pm2`, Nginx do host nem `npm ci`/build no host.

```
/var/www/fitos            ← clone do repositório (docker-compose.yml da VPS)
fitos-fitos-api-1         ← container da API Node
fitos-ai-service-1        ← container do microserviço de IA (foto→calorias)
Traefik                   ← proxy reverso + HTTPS
PostgreSQL 16 (host)      ← banco "fitos", usuário "fitos", 127.0.0.1:5432
/root/fitos_db_pass.txt   ← senha do banco (só root, chmod 600)
```

## Fluxo único de deploy

```bash
ssh root@31.97.91.192

cd /var/www/fitos && git pull

# só se houver migration nova:
DATABASE_URL="postgres://fitos:$(cat /root/fitos_db_pass.txt)@127.0.0.1:5432/fitos" npm run --prefix backend migrate:up

docker compose up -d --build
```

Conferir depois do deploy:

```bash
curl -s https://fitos.rbsconsulting.com.br/health   # {"status":"ok","db":"up"}
```

Se um deploy quebrar: `git log --oneline | head`, `git checkout <hash>` e `docker compose up -d --build`.
As migrations não têm reversão automática neste fluxo.

## Logs

```bash
docker logs fitos-fitos-api-1 --tail 50
docker logs fitos-ai-service-1 --tail 50
```

## App mobile em produção

O app em produção é um **APK release gerado localmente** (o projeto agora vive em `C:\fx`):

```powershell
cd C:\fx\mobile\android
.\gradlew.bat assembleRelease
```

A URL da API vem de `mobile/.env` (`EXPO_PUBLIC_API_URL=https://fitos.rbsconsulting.com.br`).

## Comandos úteis

| O que | Comando |
|---|---|
| Status dos containers | `docker compose ps` |
| Reiniciar a API | `docker compose restart fitos-api` |
| Status do banco | `systemctl status postgresql` |

---

## Reconstruir o servidor do zero

Adaptado do guia antigo (Node/PM2/Nginx, no histórico do git: `git show 2e3968d:DEPLOY_VPS.md`). Agora a API e o
`ai-service` rodam em containers e o Traefik faz proxy e SSL; no host ficam só Docker, PostgreSQL e firewall.

> Os trechos marcados com **(confirmar)** dependem do `docker-compose.yml` da VPS, que ainda não está versionado.

### 1. DNS (Cloudflare)

Zona `rbsconsulting.com.br` → **DNS** → registro **A · `fitos` · `31.97.91.192`**.
Deixe a nuvem **cinza (DNS only)** até o Traefik emitir o certificado; depois pode voltar para laranja com **SSL/TLS → Full (strict)**.

```bash
nslookup fitos.rbsconsulting.com.br   # deve responder 31.97.91.192
```

### 2. Sistema e firewall

```bash
ssh root@31.97.91.192
apt update && apt upgrade -y
apt install -y curl git ca-certificates gnupg ufw openssl
timedatectl set-timezone America/Sao_Paulo

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow from 172.18.0.0/16 to any port 5432 proto tcp   # containers Docker -> PostgreSQL do host (confirmar)
ufw --force enable
```

As portas 3000 e 5432 **não** ficam abertas para a internet (a 5432 só para a rede Docker acima).

### 3. Docker

```bash
curl -fsSL https://get.docker.com | sh
docker compose version
```

### 4. PostgreSQL 16 no host

```bash
apt install -y postgresql postgresql-contrib   # contrib: as migrations usam pg_trgm e unaccent
systemctl enable --now postgresql

DB_PASS=$(openssl rand -hex 24)
echo "$DB_PASS" > /root/fitos_db_pass.txt && chmod 600 /root/fitos_db_pass.txt
sudo -u postgres psql <<SQL
CREATE USER fitos WITH PASSWORD '$DB_PASS';
CREATE DATABASE fitos OWNER fitos ENCODING 'UTF8';
SQL
```

Os containers acessam o banco pela rede Docker (`172.18.0.0/16`), então o PostgreSQL precisa escutar nela e aceitar a sub-rede:

```bash
# /etc/postgresql/16/main/postgresql.conf  (confirmar o IP do gateway com: docker network inspect <rede>)
listen_addresses = 'localhost,172.18.0.1'

# /etc/postgresql/16/main/pg_hba.conf
host    fitos    fitos    172.18.0.0/16    scram-sha-256

systemctl restart postgresql
```

### 5. Repositório e `.env`

```bash
git clone https://github.com/rbsconsultoriaemti/fitos.git /var/www/fitos
cd /var/www/fitos
```

Gere os segredos e crie o `.env` (lido pelo `docker compose`; fica fora do git, `chmod 600`). O nome do arquivo
e as variáveis exatas dependem do compose **(confirmar)**; o conjunto usado pela API é:

```bash
DB_PASS=$(cat /root/fitos_db_pass.txt)
cat > /var/www/fitos/.env <<ENV
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://fitos:${DB_PASS}@172.18.0.1:5432/fitos
JWT_ACCESS_SECRET=$(openssl rand -hex 48)
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL_DAYS=30
APP_TIMEZONE=America/Sao_Paulo
AI_SERVICE_TOKEN=$(openssl rand -hex 32)
ENV
chmod 600 /var/www/fitos/.env
```

- Em produção a API recusa subir se `JWT_ACCESS_SECRET` tiver menos de 32 caracteres.
- Nunca commite o `.env`. Guarde um backup num gerenciador de senhas: perder o `JWT_ACCESS_SECRET` desloga todos os usuários.
- O `ai-service` também precisa da chave da Claude API **(confirmar o nome da variável no compose)**.

### 6. Traefik e SSL

O Traefik roda como container, escuta em 80/443, roteia `fitos.rbsconsulting.com.br` para o container da API e emite o
certificado Let's Encrypt (resolver ACME com o e-mail do dono). As labels do roteador e o armazenamento do `acme.json`
estão no `docker-compose.yml` **(confirmar — será documentado quando o arquivo for versionado)**.

### 7. Migrations, seeds e primeiro `up`

```bash
cd /var/www/fitos
export DATABASE_URL="postgres://fitos:$(cat /root/fitos_db_pass.txt)@127.0.0.1:5432/fitos"

# requer Node 20 no host só para rodar as migrations/seeds (ou rode dentro de um container node:20)
npm ci --prefix backend
npm run --prefix backend migrate:up
npm run --prefix backend seed:taco                                           # 590 alimentos da TACO
npm run --prefix backend seed:portions                                       # porções caseiras
(cd backend && npx tsx src/database/seeds/run-sql.ts exercises.sql)          # 41 exercícios

docker compose up -d --build
```

Os seeds são idempotentes, mas só precisam rodar uma vez. Conferência:

```bash
curl -i https://fitos.rbsconsulting.com.br/health   # 200 · {"status":"ok","db":"up"}
PGPASSWORD=$(cat /root/fitos_db_pass.txt) psql -h 127.0.0.1 -U fitos -d fitos \
  -c "SELECT count(*) FROM foods;" -c "SELECT count(*) FROM exercises;"   # 590 e 41
```

Se `db` vier `"down"`, veja `docker logs fitos-fitos-api-1 --tail 50` (provável causa: `pg_hba.conf`, `listen_addresses` ou `ufw`).

---

## Backup do banco (recomendado)

```bash
# [root]
mkdir -p /var/backups/fitos
cat > /etc/cron.d/fitos-backup <<'CRON'
0 3 * * * root sudo -u postgres pg_dump fitos | gzip > /var/backups/fitos/fitos-$(date +\%F).sql.gz && find /var/backups/fitos -name '*.sql.gz' -mtime +14 -delete
CRON
```

Mantém 14 dias de backup local. Copie periodicamente para fora do servidor (dados de saúde: LGPD).

## Segurança (checklist rápido)

- Entrar por **chave SSH** e desativar login por senha do root (`PermitRootLogin prohibit-password` em `/etc/ssh/sshd_config`, depois `systemctl restart ssh`) — só depois de confirmar que a chave funciona.
- `apt install -y fail2ban` para barrar tentativas de força bruta no SSH.
- A API usa `cors()` aberto: restringir as origens antes do lançamento.
- Porta 3000 e 5432 não estão abertas no `ufw` — confirme com `ufw status`.
