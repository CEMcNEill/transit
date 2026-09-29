import { expect, test } from '@playwright/test';

test('start a seeded run, jump once, reload, and continue from the autosave', async ({ page }) => {
  await page.goto('/?sector=s01&seed=smoke');
  const turn = page.getByTestId('turn');
  await expect(turn).toHaveText('0');
  await expect(page.getByTestId('sector-map')).toBeVisible();

  // Plot the first listed jump and confirm it.
  await page.getByTestId('jump-targets').getByRole('button').first().click();
  await expect(page.getByTestId('jump-preview')).toBeVisible();
  await page.getByTestId('confirm-jump').click();

  // An arrival event may open; answer it with the first available option.
  const dialog = page.getByTestId('event-dialog');
  if (await dialog.isVisible())
    await dialog.getByRole('button', { disabled: false }).first().click();

  await expect(turn).toHaveText('1');
  const fuelAfterJump = await page.getByTestId('hud-fuel').textContent();

  await page.reload();
  await expect(page.getByTestId('turn')).toHaveText('1');
  await expect(page.getByTestId('hud-fuel')).toHaveText(fuelAfterJump ?? '');
});
