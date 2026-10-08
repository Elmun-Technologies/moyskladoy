import { expect, test } from '@playwright/test';

const TG = 830001 + Math.floor(Math.random() * 1000);

test('sayt formasi -> t.me linki -> bot demo funnel -> ariza', async ({ page }) => {
  test.skip(!process.env.E2E_ALLOW_NETWORK, 'E2E_ALLOW_NETWORK=1 bo\'lsa ishlaydi (mahalliy serverlar kerak)');
  await page.goto('/');
  await page.fill('input[name="name"]', 'Test Ali');
  await page.fill('input[name="phone"]', '+998901234567');
  await page.check('#c1');
  await page.click('button[type=submit]');
  const out = page.locator('#out');
  await expect(out).toContainText('https://t.me/', { timeout: 8000 });
  // Bot simulator: start -> sinov darsi yo'li -> taklif -> sessiya oxiri roziligi -> yuborish
  await page.fill('#tg', String(TG));
  await page.click('#rst');
  await expect(page.locator('#log')).toContainText('Xush kelibsiz');
  const actions = ['goto:LESSON_INTRO', 'lesson:watched', 'task:right', 'goto:AFTER_LESSON_VIDEO', 'goto:OFFERS', 'consent:grant_marketing', 'goto:OFFER_COURSE', 'goto:READINESS', 'consent:grant_contact', 'contact:telegram', 'submit:send'];
  for (const action of actions) {
    await page.evaluate(async (data) => {
      await fetch('/api/bot/simulate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ telegramId: TG, data }) });
    }, action);
  }
  await page.click('#rst'); // menyu orqali oxirgi xabarlarni ko'rish
  const txt = await page.locator('#log').innerText();
  expect(txt).toContain("sotuv bo'limiga uzatildi");
});

test('admin panel: kirish -> statistika', async ({ page }) => {
  test.skip(!process.env.E2E_ALLOW_NETWORK, 'E2E_ALLOW_NETWORK=1 bo\'lsa ishlaydi');
  const email = process.env.ADMIN_EMAIL ?? 'admin@example.uz';
  const pass = process.env.ADMIN_PASSWORD ?? '';
  test.skip(!pass, 'ADMIN_PASSWORD sozlanmagan');
  await page.goto('/');
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', pass);
  await page.click('button.pri');
  await expect(page.locator('h1')).toContainText('Statistika', { timeout: 8000 });
});
