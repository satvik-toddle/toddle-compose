import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const APP = 'http://localhost:5173';
const DIR = new URL('./screens/', import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const nav = (p, n) => p.locator('nav').getByRole('button', { name: n, exact: true });
const mainB = (p, n) => p.locator('main').getByRole('button', { name: n, exact: true });

const b = await chromium.launch({ headless: true, channel: 'chrome' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage();

await p.goto(APP, { waitUntil: 'networkidle' });
await p.screenshot({ path: DIR + 'ui-1-login.png' });

await p.fill('input[type=password]', 'password123');
await p.locator('input').first().fill('owner@toddle.test');
await p.getByRole('button', { name: 'Sign in' }).click();
await nav(p, 'Workspaces').waitFor({ timeout: 15000 });
await p.waitForTimeout(500);
await p.screenshot({ path: DIR + 'ui-2-launcher.png' });

await nav(p, 'Request access').click(); await p.waitForTimeout(400);
await p.screenshot({ path: DIR + 'ui-3-request-access.png' });

await nav(p, 'Admin console').click(); await p.waitForTimeout(400);
await p.screenshot({ path: DIR + 'ui-4-admin-workspaces.png' });
await mainB(p, 'Realm members').click(); await p.waitForTimeout(400);
await p.screenshot({ path: DIR + 'ui-5-admin-members.png' });

// enter a workspace and open docs
await nav(p, 'Workspaces').click();
await p.locator('tr').filter({ hasText: /priv-|pub-|PW-WS|QA|E2E/ }).first().getByRole('button', { name: /Enter|Re-enter/ }).click();
await mainB(p, 'Docs').waitFor({ timeout: 10000 }); await p.waitForTimeout(500);
await p.screenshot({ path: DIR + 'ui-6-inside-docs.png' });

await b.close();
console.log('shots saved to', DIR);
