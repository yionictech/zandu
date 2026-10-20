/**
 * Comptes du personnel dans le back-office, de bout en bout, contre une API chargée avec
 * `pnpm db:seed:demo` (voir parcours-support.mjs pour les variables d'environnement).
 *
 *   API_URL=… BO_URL=… SHOTS=./captures DATABASE_URL=… node e2e/parcours-personnel.mjs
 *
 * Un nouvel administrateur ajoute un agent du support. L'agent reçoit un SMS, se connecte et
 * configure son second facteur ; il ne voit pas les pages des administrateurs. Promu, il est
 * déconnecté. Son accès est ensuite retiré : le back-office lui est fermé.
 */
import { execFileSync } from 'node:child_process';
import {
  e164,
  freshPhone,
  inbox,
  lastMessage,
  launchBrowser,
  SHOTS,
  sleep,
  totp,
} from '../../mobile/e2e/lib.mjs';

const BO = process.env.BO_URL ?? 'http://localhost:3100';
const psql = (sql) =>
  execFileSync('psql', [process.env.DATABASE_URL, '-tAc', sql]).toString().trim();

const browser = await launchBrowser();
async function openPage() {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    locale: 'fr-FR',
  });
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.accept());
  return page;
}
const shot = async (page, name) => {
  await sleep(300);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  console.log(`📸 ${name}`);
};

/** Code SMS ; à la première connexion, configuration du second facteur. */
async function signIn(page, phone) {
  await page.goto(`${BO}/connexion`);
  await page.getByLabel('Numéro de téléphone').fill(phone);
  const since = Date.now() - 1000;
  await page.getByRole('button', { name: 'Recevoir le code par SMS' }).click();
  const otp = await lastMessage(e164(phone), 'otp_code', since);
  await page.getByLabel(/Code reçu par SMS/).fill(otp.variables.code);
  await page.getByRole('button', { name: 'Valider' }).click();
}
async function enrol(page) {
  await page.getByTestId('totp-secret').waitFor();
  const secret = (await page.getByTestId('totp-secret').innerText()).replace(/\s/g, '');
  await page.getByLabel("Code affiché par l'application").fill(totp(secret));
  await page.getByRole('button', { name: 'Activer et continuer' }).click();
  await page.getByRole('heading', { name: 'Vue d’ensemble' }).waitFor();
}

// 1. Un nouvel administrateur se connecte.
const adminPhone = freshPhone('06 6');
psql(
  `INSERT INTO users (phone, full_name, roles) VALUES ('${e164(adminPhone)}', 'Administrateur essai', '{buyer,admin}')`,
);
const admin = await openPage();
await signIn(admin, adminPhone);
await enrol(admin);

// 2. Il ajoute un agent du support.
const agentPhone = freshPhone('06 7');
const agentName = `Grâce Mavoungou ${agentPhone.slice(-5).replace(' ', '')}`;
await admin.getByRole('link', { name: 'Personnel' }).click();
await admin.getByTestId('add-staff').getByLabel('Nom complet').fill(agentName);
await admin.getByTestId('add-staff').getByLabel('Numéro de téléphone').fill(agentPhone);
await admin.getByRole('button', { name: 'Ajouter' }).click();
await admin.getByText('Membre ajouté').waitFor();
await admin.getByTestId('staff').getByText(agentName).waitFor();
await shot(admin, '01-personnel');

let welcome;
for (let i = 0; i < 40 && !welcome; i++) {
  welcome = (await inbox(e164(agentPhone))).find((m) => m.template === 'staff_access');
  if (!welcome) await sleep(500); // le worker distribue les messages en quelques secondes
}
if (!welcome) throw new Error("L'agent n'a pas reçu de SMS d'accès");
console.log(`SMS à l'agent : ${welcome.variables.message}`);

// 3. L'agent se connecte : files de travail, mais pas les pages des administrateurs.
const agent = await openPage();
await signIn(agent, agentPhone);
await enrol(agent);
for (const forbidden of ['Personnel', 'Rapports', 'Rapprochement']) {
  if (await agent.getByRole('link', { name: forbidden }).count())
    throw new Error(`L'agent voit « ${forbidden} »`);
}

// 4. Promu administrateur : ses sessions sont fermées, il doit se reconnecter.
await admin.reload();
await admin.getByTestId('staff').getByRole('link', { name: agentName }).click();
await admin.getByRole('button', { name: 'Nommer administrateur' }).click();
await admin.getByText('Rôle changé').waitFor();
await agent.reload();
await agent.waitForURL(/\/connexion/);
await shot(admin, '02-membre');

// 5. Accès retiré : la connexion au back-office lui est refusée.
await admin
  .getByTestId('revoke')
  .getByLabel("Motif du retrait (journal d'audit)")
  .fill('Essai de recette : fin de mission');
await admin.getByRole('button', { name: "Retirer l'accès" }).click();
await admin.getByText('Accès retiré').waitFor();
if (await admin.getByTestId('staff').getByText(agentName).count())
  throw new Error("L'agent figure encore dans le personnel");
await sleep(61_000); // un code SMS par minute et par numéro
await signIn(agent, agentPhone);
await agent.getByText("Ce compte n'a pas accès au back-office.").waitFor();
await shot(agent, '03-acces-retire');

const audit = psql(
  `SELECT string_agg(a.action, ',' ORDER BY a.id) FROM audit_logs a JOIN users u ON u.id = a.actor_id
   WHERE u.phone = '${e164(adminPhone)}' AND a.action LIKE 'staff.%'`,
);
if (audit !== 'staff.added,staff.role_changed,staff.revoked') throw new Error(`Journal : ${audit}`);
await browser.close();
console.log('Parcours personnel : OK');
