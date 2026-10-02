// One-time Google sign-in for the labeler.
// Usage: npm run auth -- ~/Downloads/client_secret_XXXX.json
//
// Runs the OAuth loopback flow for a Desktop OAuth client, then pipes the
// client ID, client secret, and refresh token straight into
// `wrangler secret put` (and .dev.vars for local runs). Nothing is printed.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

const clientFile = process.argv[2];
if (!clientFile) {
  console.error('Usage: npm run auth -- <path to Desktop OAuth client JSON>');
  process.exit(1);
}
const { installed } = JSON.parse(readFileSync(clientFile, 'utf8'));
if (!installed) throw new Error('Expected a Desktop app OAuth client JSON (top-level "installed" key).');
const { client_id, client_secret } = installed;
const state = randomBytes(16).toString('hex');

const putSecret = (name, value) => {
  const res = spawnSync('npx', ['wrangler', 'secret', 'put', name], { input: value, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`wrangler secret put ${name} failed:\n${res.stderr}`);
  console.log(`set secret ${name}`);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/') return res.writeHead(404).end();

  try {
    if (url.searchParams.get('state') !== state) throw new Error('state mismatch');
    const code = url.searchParams.get('code');
    if (!code) throw new Error(url.searchParams.get('error') ?? 'no code returned');

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({ code, client_id, client_secret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
    const { access_token, refresh_token } = await tokenRes.json();
    if (!refresh_token) throw new Error('Google returned no refresh token');

    const profile = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${access_token}` },
    }).then((r) => r.json());

    const secrets = {
      GOOGLE_CLIENT_ID: client_id,
      GOOGLE_CLIENT_SECRET: client_secret,
      GOOGLE_REFRESH_TOKEN: refresh_token,
    };
    for (const [name, value] of Object.entries(secrets)) putSecret(name, value);
    writeFileSync(
      '.dev.vars',
      Object.entries(secrets).map(([k, v]) => `${k}=${v}`).join('\n') + '\n',
      { mode: 0o600 }
    );

    console.log(`Authorized ${profile.emailAddress}. Wrote .dev.vars.`);
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end(`Authorized ${profile.emailAddress}. You can close this tab.`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end(`Setup failed: ${err.message}`);
  } finally {
    server.close();
  }
});

let redirectUri;
server.listen(0, '127.0.0.1', () => {
  redirectUri = `http://127.0.0.1:${server.address().port}`;
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  })}`;
  console.log(`Opening Google sign-in. If nothing opens, visit:\n${authUrl}`);
  spawn('open', [authUrl], { stdio: 'ignore' });
});
