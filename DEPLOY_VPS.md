# Deploy do backend FitOS na VPS

Servidor: `saturno.rbsconsulting.com.br` · IP `31.97.91.192` · Ubuntu 24.04.3 LTS
API: `https://fitos.rbsconsulting.com.br`
Repositório: `https://github.com/rbsconsultoriaemti/fitos.git`

Estrutura final no servidor:

```
/var/www/fitos            ← clone do repositório (dono: usuário "fitos")
/var/www/fitos/backend    ← API Node (PM2: processo "fitos", porta 3000, só acessível via Nginx)
PostgreSQL 16             ← banco "fitos", usuário "fitos"
Nginx :80/:443            ← proxy reverso + SSL Let's Encrypt
```

> Os blocos marcados `# [root]` rodam como root; os marcados `# [fitos]` rodam como o usuário `fitos`
> (`sudo -iu fitos`). A API **não** roda como root.
> O backend usa PostgreSQL + a API Node. Redis e o `ai-service` (foto→calorias) **não** fazem parte deste deploy:
> a API sobe sem eles e só a foto→calorias fica indisponível.

---

## 0. Antes de começar — DNS (na Cloudflare)

Hoje `fitos.rbsconsulting.com.br` já resolve, mas para IPs da **Cloudflare** (proxy ligado), não para a VPS.

1. Na Cloudflare, abra a zona `rbsconsulting.com.br` → **DNS**.
2. Crie/edite o registro: **Tipo A · Nome `fitos` · Conteúdo `31.97.91.192`**.
3. Deixe a nuvem **cinza (DNS only)** até o passo 12 terminar (emissão do certificado).
4. Depois do SSL funcionando você pode voltar para laranja (proxy), desde que em **SSL/TLS → Full (strict)**.

Confirme a propagação antes do passo 12:

```bash
nslookup fitos.rbsconsulting.com.br   # deve responder 31.97.91.192
```

---

## 1. Atualizar o sistema

```bash
ssh root@31.97.91.192

# [root]
apt update && apt upgrade -y
apt install -y curl git ca-certificates gnupg ufw openssl
timedatectl set-timezone America/Sao_Paulo
```

Se o `apt upgrade` pedir reinício (kernel novo): `reboot`, aguarde 1 minuto e entre de novo.

Firewall (libera só SSH e web; a porta 3000 fica fechada para fora):

```bash
# [root]
ufw allow OpenSSH
ufw allow 'Nginx Full'   # se der "perfil não encontrado", rode o passo 4 antes e repita
ufw --force enable
ufw status
```

---

## 2. Node.js 20 (NodeSource)

```bash
# [root]
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v   # v20.x
npm -v
```

---

## 3. PostgreSQL 16

O Ubuntu 24.04 já traz o PostgreSQL 16 nos repositórios padrão.

```bash
# [root]
apt install -y postgresql postgresql-contrib
systemctl enable --now postgresql
psql --version                         # psql (PostgreSQL) 16.x
sudo -u postgres psql -c "SELECT version();"
```

`postgresql-contrib` é necessário: as migrations usam as extensões `pg_trgm` e `unaccent`.

---

## 4. PM2, Nginx e Certbot

```bash
# [root]
npm install -g pm2
apt install -y nginx certbot python3-certbot-nginx
systemctl enable --now nginx
pm2 -v
nginx -v
certbot --version
```

Agora que o Nginx existe, se o passo do `ufw allow 'Nginx Full'` falhou, rode-o de novo.

---

## 5. Usuário do sistema, usuário e banco PostgreSQL

### 5.1 Usuário Linux que roda a API

```bash
# [root]
adduser --disabled-password --gecos "" fitos
mkdir -p /var/www
```

### 5.2 Usuário e banco no PostgreSQL

Gera a senha do banco **uma vez** e guarda num arquivo só do root (hex evita caracteres que quebrariam a URL):

```bash
# [root]
DB_PASS=$(openssl rand -hex 24)
echo "$DB_PASS" > /root/fitos_db_pass.txt && chmod 600 /root/fitos_db_pass.txt

sudo -u postgres psql <<SQL
CREATE USER fitos WITH PASSWORD '$DB_PASS';
CREATE DATABASE fitos OWNER fitos ENCODING 'UTF8';
SQL

# teste de login (deve listar as tabelas vazias / "Did not find any relations")
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U fitos -d fitos -c "\dt"
```

`pg_trgm` e `unaccent` são extensões "trusted" no PostgreSQL 13+: o dono do banco (`fitos`) consegue criá-las nas migrations sem ser superusuário.
O PostgreSQL já escuta só em `localhost` por padrão — não exponha a porta 5432.

---

## 6. Clonar o repositório em /var/www/fitos

```bash
# [root]
mkdir -p /var/www/fitos && chown fitos:fitos /var/www/fitos

# [fitos]
sudo -iu fitos
git clone https://github.com/rbsconsultoriaemti/fitos.git /var/www/fitos
cd /var/www/fitos && git log --oneline | head -3
exit   # volta para root
```

Se o repositório for privado, o `git clone` pede credenciais: use um *Personal Access Token* (somente leitura) como senha, ou configure uma *deploy key* SSH.

---

## 7. `.env` de produção

```bash
# [root] — gera os segredos e cria o arquivo já com as permissões certas
DB_PASS=$(cat /root/fitos_db_pass.txt)
JWT=$(openssl rand -hex 48)
AI_TOKEN=$(openssl rand -hex 32)

cat > /var/www/fitos/backend/.env <<ENV
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://fitos:${DB_PASS}@127.0.0.1:5432/fitos
JWT_ACCESS_SECRET=${JWT}
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL_DAYS=30
APP_TIMEZONE=America/Sao_Paulo
AI_SERVICE_TOKEN=${AI_TOKEN}
ENV

chown fitos:fitos /var/www/fitos/backend/.env
chmod 600 /var/www/fitos/backend/.env
```

Notas:
- Em produção a API **recusa subir** se `JWT_ACCESS_SECRET` tiver menos de 32 caracteres (o gerado tem 96).
- O `.env` está no `.gitignore` e **nunca** deve ser commitado. Faça backup dele num gerenciador de senhas: se perder o `JWT_ACCESS_SECRET`, todos os usuários precisam logar de novo.
- Sem `AI_SERVICE_URL`, a foto→calorias fica desligada (o resto funciona).

---

## 8. Instalar dependências e fazer o build

```bash
# [fitos]
sudo -iu fitos
cd /var/www/fitos/backend
npm ci          # inclui devDependencies (typescript, tsx, node-pg-migrate), necessárias ao build e às migrations
npm run build   # gera backend/dist
ls dist/server.js
```

---

## 9. Migrations e seeds

O `node-pg-migrate` lê `DATABASE_URL` do ambiente (não do `.env`), por isso carregamos o `.env` antes:

```bash
# [fitos] — ainda em /var/www/fitos/backend
set -a; . ./.env; set +a

npm run migrate:up                                     # 10 migrations
npm run seed:taco                                      # 590 alimentos da TACO
npm run seed:portions                                  # porções caseiras
npx tsx src/database/seeds/run-sql.ts exercises.sql    # 41 exercícios
```

Conferência:

```bash
# [root] (o usuário fitos não lê /root; volte com "exit")
PGPASSWORD=$(cat /root/fitos_db_pass.txt) psql -h 127.0.0.1 -U fitos -d fitos \
  -c "SELECT count(*) AS alimentos FROM foods;" -c "SELECT count(*) AS exercicios FROM exercises;"
```

Esperado: 590 alimentos e 41 exercícios.

Os seeds são idempotentes, mas **só rode uma vez** (ou ao adicionar dados novos).

---

## 10. PM2 sobe a API na porta 3000

```bash
# [fitos]
cd /var/www/fitos/backend
pm2 start dist/server.js --name fitos --time
pm2 save
pm2 logs fitos --lines 20 --nostream     # deve mostrar "FitOS API rodando na porta 3000"
curl -s localhost:3000/health            # {"status":"ok","db":"up"}
exit   # volta para root
```

Iniciar junto com o servidor (precisa do root; o comando abaixo registra o PM2 do usuário `fitos` no systemd):

```bash
# [root]
env PATH=$PATH:/usr/bin pm2 startup systemd -u fitos --hp /home/fitos
sudo -iu fitos pm2 save
systemctl status pm2-fitos --no-pager | head -5
```

---

## 11. Nginx como proxy para `fitos.rbsconsulting.com.br`

```bash
# [root]
cat > /etc/nginx/sites-available/fitos <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name fitos.rbsconsulting.com.br;

    # fotos de refeição (foto→calorias) podem passar de 1 MB
    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/fitos /etc/nginx/sites-enabled/fitos
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

curl -s -H "Host: fitos.rbsconsulting.com.br" http://127.0.0.1/health   # {"status":"ok","db":"up"}
```

Se já houver outros sites nesta VPS, **não** remova o `default` sem conferir: rode `ls /etc/nginx/sites-enabled/` antes.

---

## 12. SSL com Let's Encrypt

Pré-requisitos: DNS do passo 0 apontando para `31.97.91.192` (nuvem cinza) e portas 80/443 liberadas.

```bash
# [root]
certbot --nginx -d fitos.rbsconsulting.com.br \
  -m SEU_EMAIL@exemplo.com --agree-tos --no-eff-email --redirect

systemctl list-timers | grep certbot     # renovação automática ativa
certbot renew --dry-run                  # simula a renovação
```

O Certbot edita o arquivo do Nginx, adiciona o bloco `443` e redireciona `http → https`.

Se o certbot falhar com "Timeout during connect" / "unauthorized": o DNS ainda aponta para a Cloudflare (nuvem laranja) ou o `ufw` bloqueia a porta 80.

---

## 13. Testar

Do seu PC ou da própria VPS:

```bash
curl -i https://fitos.rbsconsulting.com.br/health
# HTTP/2 200  ·  {"status":"ok","db":"up"}
```

Teste ponta a ponta (cria uma conta de teste):

```bash
curl -s -X POST https://fitos.rbsconsulting.com.br/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Teste","email":"teste@example.com","password":"SenhaForte123","role":"student"}'
```

Se o `/health` retornar `db: "down"`, o motivo detalhado está no log (`[health] falha ao conectar no PostgreSQL`):

```bash
sudo -iu fitos pm2 logs fitos --lines 50 --nostream
```

Agora, se quiser, volte a nuvem da Cloudflare para laranja (proxy) com **SSL/TLS → Full (strict)**.

### Apontar o app mobile

Em `mobile/.env`:

```
EXPO_PUBLIC_API_URL=https://fitos.rbsconsulting.com.br
```

e reinicie com `npx expo start -c`.

---

## Atualizações futuras

O comando `git pull && npm run build && pm2 restart fitos` só funciona dentro de `backend/` e não instala dependências novas nem roda migrations. Versão completa:

```bash
# [fitos]
sudo -iu fitos
cd /var/www/fitos && git pull
cd backend && npm ci && npm run build
set -a; . ./.env; set +a
npm run migrate:up
pm2 restart fitos --update-env
pm2 logs fitos --lines 20 --nostream
curl -s https://fitos.rbsconsulting.com.br/health
```

Versão curta, quando não houve mudança de dependências nem de banco:

```bash
cd /var/www/fitos && git pull && cd backend && npm run build && pm2 restart fitos
```

Se um deploy quebrar, volte ao commit anterior: `git log --oneline | head`, depois `git checkout <hash>`, `npm run build` e `pm2 restart fitos`. As migrations não têm reversão automática neste fluxo.

---

## Comandos úteis

| O que | Comando |
|---|---|
| Ver logs | `sudo -iu fitos pm2 logs fitos` |
| Status | `sudo -iu fitos pm2 status` |
| Reiniciar | `sudo -iu fitos pm2 restart fitos` |
| Logs do Nginx | `tail -f /var/log/nginx/error.log` |
| Status do banco | `systemctl status postgresql` |
| Renovar SSL na mão | `certbot renew` |

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
