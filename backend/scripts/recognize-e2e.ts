/**
 * Teste do POST /nutrition/recognize: envia uma imagem como o app (JSON base64) e como bytes crus, e confere que o
 * backend repassa ao ai-service exatamente os mesmos bytes (multipart). O ai-service é SIMULADO aqui (sem Claude).
 *
 *   npm run test:recognize
 */
import 'dotenv/config';
import { execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { Pool } from 'pg';

const PORT = 3997;
const AI_PORT = 4012;
const API = `http://localhost:${PORT}`;

// PNG 1x1 válido, repetido com bytes extras para passar de 100 kb (limite padrão do express.json).
const png = Buffer.concat([
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  Buffer.alloc(300_000, 7),
]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

let received: { mime: string; hash: string; token: string; hints: string | null } | null = null;
const ai = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    // Reaproveita o parser de multipart do runtime (Response.formData) em vez de escrever um.
    const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': req.headers['content-type'] ?? '' } }).formData();
    const file = form.get('image') as File;
    received = { mime: file.type, hash: sha(Buffer.from(await file.arrayBuffer())), token: String(req.headers['x-service-token']), hints: form.has('hints') ? String(form.get('hints')) : null };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ foods: [{ name: 'Arroz, cozido', quantity_g: 150, kcal: 190, protein_g: 4, carb_g: 41, fat_g: 0.4, confidence: 0.9 }] }));
  });
});

let failures = 0;
const check = (ok: boolean, what: string, extra?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✘'} ${what}${!ok && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`);
};
const killPort = (port: number) => {
  if (process.platform === 'win32') {
    try {
      execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"`, { stdio: 'ignore' });
    } catch {
      /* nada a encerrar */
    }
  }
};

async function post(path: string, init: { body: BodyInit; type: string }, token: string) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': init.type, Authorization: `Bearer ${token}` }, body: init.body });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

async function main() {
  await new Promise<void>((r) => ai.listen(AI_PORT, r));
  const server = spawn('npx', ['tsx', 'src/server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'development', AI_SERVICE_URL: `http://localhost:${AI_PORT}`, AI_SERVICE_TOKEN: 'token-de-teste' },
    shell: true,
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${API}/health`)).ok) break;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const email = `rec-e2e-${Date.now()}@teste.local`;
  try {
    const reg = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Teste Foto', email, password: 'SenhaTeste123!', role: 'student' }),
    });
    const token = ((await reg.json()) as { accessToken: string }).accessToken;

    // 1) como o app: JSON com base64
    received = null;
    let r = await post('/nutrition/recognize', { type: 'application/json', body: JSON.stringify({ imageBase64: png.toString('base64'), mimeType: 'image/png' }) }, token);
    check(r.status === 200 && r.body.items?.length === 1, `JSON base64 (${Math.round(png.length / 1024)} KB): 200 com itens`, r);
    check(received?.hash === sha(png) && received?.mime === 'image/png', 'ai-service recebeu os mesmos bytes e o mesmo tipo', received);
    check(received?.token === 'token-de-teste', 'ai-service recebeu o X-Service-Token');

    // 2) com prefixo data URL
    r = await post('/nutrition/recognize', { type: 'application/json', body: JSON.stringify({ imageBase64: `data:image/png;base64,${png.toString('base64')}`, mimeType: 'image/png' }) }, token);
    check(r.status === 200, 'JSON base64 com prefixo data:', r);

    // 2b) ingredientes opcionais (hints)
    received = null;
    r = await post('/nutrition/recognize', { type: 'application/json', body: JSON.stringify({ imageBase64: png.toString('base64'), mimeType: 'image/png', hints: 'frango, arroz, feijão' }) }, token);
    check(r.status === 200 && received?.hints === 'frango, arroz, feijão', 'hints chegam ao ai-service como campo do multipart', received?.hints);
    received = null;
    await post('/nutrition/recognize', { type: 'application/json', body: JSON.stringify({ imageBase64: png.toString('base64'), mimeType: 'image/png', hints: '   ' }) }, token);
    check(received?.hints === null, 'hints vazio não é enviado ao ai-service', received?.hints);
    r = await post('/nutrition/recognize', { type: 'application/json', body: JSON.stringify({ imageBase64: 'AAAA', hints: 'x'.repeat(201) }) }, token);
    check(r.status === 400, 'hints acima de 200 caracteres => 400', r);

    // 3) bytes crus (APK antigo)
    received = null;
    r = await post('/nutrition/recognize', { type: 'image/png', body: new Uint8Array(png) }, token);
    check(r.status === 200 && received?.hash === sha(png), 'bytes crus (compatível com versões antigas do app)', r);

    // 4) erros
    r = await post('/nutrition/recognize', { type: 'application/json', body: JSON.stringify({ imageBase64: '' }) }, token);
    check(r.status === 400, 'base64 vazio => 400', r);
    r = await post('/nutrition/recognize', { type: 'text/plain', body: 'oi' }, token);
    check(r.status === 415, 'tipo não suportado => 415', r);
    r = await post('/nutrition/recognize', { type: 'application/json', body: JSON.stringify({ imageBase64: 'AAAA', mimeType: 'image/gif' }) }, token);
    check(r.status === 400, 'mimeType inválido => 400', r);
  } finally {
    await pool.query('DELETE FROM users WHERE email = $1', [email]).catch(() => undefined);
    await pool.end();
    server.kill();
    killPort(PORT);
    ai.close();
  }
  console.log(failures === 0 ? '\nTUDO OK' : `\n${failures} VERIFICAÇÃO(ÕES) FALHARAM`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().then(() => process.exit(), (err) => {
  console.error(err);
  killPort(PORT);
  process.exit(1);
});
