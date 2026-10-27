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
