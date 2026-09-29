// Plays whole runs through the real UI with a simple policy, then exports the telemetry log.
// PLAYTHROUGH=1 npx playwright test playthrough   (writes test-results/telemetry.json)

import { expect, test, type Page } from '@playwright/test';

const RUNS = process.env.RUNS_ONE
  ? [{ sector: process.env.RUNS_ONE, seed: process.env.SEED ?? 'play-x' }]
  : [
      { sector: 's01', seed: 'play-1' },
      { sector: 's08', seed: 'play-2' },
      { sector: 's10', seed: 'play-3' },
    ];

async function fuel(page: Page): Promise<number> {
  return Number.parseFloat((await page.getByTestId('hud-fuel').textContent()) ?? '0');
}

async function clickFirst(page: Page, name: RegExp): Promise<boolean> {
  const b = page.locator('.side').getByRole('button', { name, disabled: false }).first();
  if (await b.count()) {
    await b.click();
    return true;
  }
  return false;
}

async function playOne(page: Page): Promise<string> {
  for (let step = 0; step < 900; step++) {
    if (step % 25 === 0)
      console.log(
        `${new Date().toISOString().slice(14, 19)} step ${step} turn ${await page.getByTestId('turn').textContent()} fuel ${await fuel(page)}`,
      );
    if (await page.getByTestId('end-screen').isVisible()) {
      return (await page.getByTestId('end-screen').locator('p').first().textContent()) ?? '';
    }
    const dialog = page.getByTestId('event-dialog');
    if (await dialog.isVisible()) {
      await dialog.getByRole('button', { disabled: false }).first().click();
      continue;
    }
    // Survey first (free); refuel when low; otherwise jump toward the goal.
    if (await clickFirst(page, /^Survey$/)) continue;
    if ((await fuel(page)) < 12) {
      if (await clickFirst(page, /^(Skim|Mine) \+.*\d+f/)) continue;
      const fuelWorld = page
        .locator('.world', { hasText: /fuel [1-9]/ })
        .getByRole('button', { name: /^Land$/, disabled: false });
      if (await fuelWorld.count()) {
        await fuelWorld.first().click();
        continue;
      }
    }
    const targets = page.getByTestId('jump-targets').getByRole('button', { disabled: false });
    const toward = targets.filter({ hasText: '▲' });
    const pick = (await toward.count()) ? toward.first() : targets.first();
    if (!(await pick.count())) {
      if (await clickFirst(page, /^Stay/)) continue;
      break;
    }
    await pick.click();
    await page.getByTestId('confirm-jump').click();
    await page.waitForTimeout(120);
  }
  return 'unfinished';
}

test('three full runs through the UI', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const outcomes: string[] = [];
  await page.goto('/');
  for (const run of RUNS) {
    await page.getByTestId('sector-select').selectOption(run.sector);
    await page.getByTestId('seed-input').fill(run.seed);
    await page.getByTestId('begin').click();
    await expect(page.getByTestId('turn')).toHaveText('0');
    outcomes.push(`${run.sector}/${run.seed}: ${await playOne(page)}`);
    // Back to the title screen (clears the finished run's autosave).
    await page.getByRole('button', { name: 'New run' }).click();
    await expect(page.getByTestId('sector-select')).toBeVisible();
  }
  console.log(outcomes.join('\n'));
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'export telemetry' }).click();
  await (await download).saveAs('test-results/telemetry.json');
  expect(outcomes.every((o) => o !== 'unfinished')).toBe(true);
});
