import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const APP = 'http://localhost:5173';
const DIR = new URL('./screens/', import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });

const b = await chromium.launch({ headless: true, channel: 'chrome' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage();

await p.goto(APP + '/', { waitUntil: 'networkidle' });
await p.screenshot({ path: DIR + 'n1-login.png' });

await p.fill('input[type=password]', 'password123');
await p.locator('input').first().fill('owner@toddle.test');
await p.getByRole('button', { name: 'Sign in' }).click();
await p.getByText('Choose a workspace').waitFor({ timeout: 15000 });
await p.waitForTimeout(700);
await p.screenshot({ path: DIR + 'n2-chooser-owner.png', fullPage: true });

await p.getByRole('button', { name: 'Admin console' }).first().click();
await p.waitForTimeout(500);
await p.screenshot({ path: DIR + 'n3-admin-workspaces.png', fullPage: true });
await p.getByRole('button', { name: 'Realm members' }).click();
await p.waitForTimeout(500);
await p.screenshot({ path: DIR + 'n4-admin-members.png', fullPage: true });

await b.close();
console.log('shots saved');
