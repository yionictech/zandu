// Outils communs aux parcours de bout en bout (API de développement + Chromium au format téléphone).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

export const API = process.env.API_URL ?? 'http://localhost:3998';
export const WEB = process.env.WEB_URL ?? 'http://localhost:8081';
export const SHOTS = process.env.SHOTS ?? './captures';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Un numéro neuf à chaque exécution (la limite anti-fraude autorise un code par minute).
 * `prefix` : les 3 premiers chiffres, ex. « 05 5 » → « 05 5xx xx xx ».
 */
export function freshPhone(prefix) {
  const n = String(Date.now());
  return `${prefix}${n.slice(-6, -4)} ${n.slice(-4, -2)} ${n.slice(-2)}`;
}
export const e164 = (phone) => `+242${phone.replace(/\s/g, '')}`;

export async function json(method, path, token, body, headers = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

/** Dernier message reçu par un numéro (boîte de réception de développement). */
export async function lastMessage(recipient, template, after = 0) {
  for (let i = 0; i < 40; i++) {
    const { items } = await json('GET', `/dev/messages?recipient=${encodeURIComponent(recipient)}`);
    const found = items.find((m) => m.template === template && Date.parse(m.sentAt) >= after);
    if (found) return found;
    await sleep(500);
  }
  throw new Error(`Aucun message ${template} pour ${recipient}`);
}

// Sessions réutilisées d'une exécution à l'autre : la limite anti-fraude n'autorise que
// 5 codes par heure et par numéro.
const SESSIONS_FILE = `${tmpdir()}/zandu-e2e-sessions.json`;

export async function apiLogin(phone) {
  const cache = JSON.parse(await readFile(SESSIONS_FILE, 'utf8').catch(() => '{}'));
  if (cache[phone]) {
    const res = await fetch(`${API}/v1/me`, {
      headers: { authorization: `Bearer ${cache[phone]}` },
    });
    if (res.ok) return cache[phone];
  }
  const since = Date.now() - 1000;
  const { challengeId } = await json('POST', '/v1/auth/otp/request', null, { phone });
  const { variables } = await lastMessage(phone, 'otp_code', since);
  const { token } = await json('POST', '/v1/auth/otp/verify', null, {
    challengeId,
    code: variables.code,
  });
  await writeFile(SESSIONS_FILE, JSON.stringify({ ...cache, [phone]: token }));
  return token;
}

export async function launchBrowser() {
  await mkdir(SHOTS, { recursive: true });
  return chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  });
}

/**
 * Un « téléphone » : contexte isolé (sa propre session) au format Android 360 × 780.
 * `token` : session déjà ouverte, déposée là où l'application web la range.
 */
export async function phone(browser, token) {
  const context = await browser.newContext({
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'fr-FR',
  });
  if (token) {
    await context.addInitScript((value) => {
      if (!localStorage.getItem('zandu.session')) localStorage.setItem('zandu.session', value);
    }, token);
  }
  const page = await context.newPage();
  const shot = async (name) => {
    await sleep(400);
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
    console.log(`📸 ${name}`);
  };
  return { page, shot };
}
