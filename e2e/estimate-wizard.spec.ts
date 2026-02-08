import { expect, test, type Page } from '@playwright/test';

async function mockEstimateCreate(page: Page): Promise<void> {
  // Playwright rule: selectors must use page.getByTestId(...) (no text selectors, no nth-child).
  await page.route('**/api/estimate-create', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        record: {
          id: 'test-record',
          quoteNumber: 'SZ-260208-ABCD',
          createdAt: new Date().toISOString(),
          serviceType: 'window',
          postalCode: 'R5G 2X3',
          zone: 'zoneA',
          contact: {
            fullName: 'Jane Test',
            address: '120 Parkside Crescent, Mitchell',
            phone: '(431) 205-3909',
            email: 'colinunger@gmail.com',
            consentToContact: true,
          },
          answers: {},
          result: {
            serviceType: 'window',
            subtotal: 350,
            estimateLow: 280,
            estimateHigh: 430,
            durationLowHours: 2.5,
            durationHighHours: 4.0,
            confidence: 'green',
            bookingMode: 'instant_book',
            complexityScore: 0,
            estimatedSqft: 0,
            redFlags: [],
            includedItems: ['Test include'],
            notes: ['Test note'],
          },
          pricingVersion: 2,
          utm: {},
        },
        email: {
          success: true,
          message: 'Estimate captured and sent to Steam Zone inbox for follow-up.',
          deliveryMode: 'internal',
        },
      }),
    });
  });
}

async function fillContact(page: Page): Promise<void> {
  await page.getByTestId('estimate__contact__name').fill('Jane Test');
  await page.getByTestId('estimate__contact__phone').fill('(431) 205-3909');
  await page.getByTestId('estimate__contact__email').fill('colinunger@gmail.com');
  await page.getByTestId('estimate__contact__address').fill('120 Parkside Crescent, Mitchell');
  await page.getByTestId('estimate__contact__consent').check();
}

async function submitAndAssertConfirmation(page: Page): Promise<void> {
  await expect(page.getByTestId('estimate__contact__submit')).toBeEnabled();
  await page.getByTestId('estimate__contact__submit').click();

  await expect(page.getByTestId('estimate__status_message')).toContainText('Quote');
  await expect(page.getByTestId('estimate__confirmation__quoteId')).toHaveText(/Quote:\s*SZ-\d{6}-[A-Z0-9]{4}/);
  await expect(page.getByTestId('estimate__confirmation__range')).toHaveText(/\$\d/);
}

test('residential windows wizard (window)', async ({ page }) => {
  await mockEstimateCreate(page);
  await page.goto('/estimate');

  await page.getByTestId('estimate__service__window').click();

  const continueButton = page.getByTestId('estimate__continue');
  await expect(page.getByTestId('estimate__step_heading')).toContainText('Step 1 of 5');
  await expect(continueButton).toBeDisabled();

  await page.getByTestId('estimate__window__step_1__postal_code').fill('R5G 2X3');
  await page.getByTestId('estimate__window__step_1__storey').selectOption('two');
  await expect(continueButton).toBeEnabled();
  await continueButton.click();

  await expect(page.getByTestId('estimate__step_heading')).toContainText('Step 2 of 5');
  await page.getByTestId('estimate__window__step_2__size_bracket').selectOption('1500to2000');
  await continueButton.click();

  await expect(page.getByTestId('estimate__step_heading')).toContainText('Step 3 of 5');
  await page.getByTestId('estimate__window__step_3__scope').selectOption('both');
  await page.getByTestId('estimate__window__step_3__screens').selectOption('some');
  await page.getByTestId('estimate__window__step_3__tracks_sills').selectOption('detailed');
  await page.getByTestId('estimate__window__step_3__hard_to_reach').check();
  await continueButton.click();

  await expect(page.getByTestId('estimate__step_heading')).toContainText('Step 4 of 5');
  await page.getByTestId('estimate__window__step_4__sliding_removal').selectOption('threePanel');
  await page.getByTestId('estimate__window__step_4__sliding_quantity').fill('2');
  await page.getByTestId('estimate__window__step_4__patio_type').selectOption('slideOnly');
  await page.getByTestId('estimate__window__step_4__patio_quantity').fill('1');
  await page.getByTestId('estimate__window__step_4__skylight_type').selectOption('both');
  await page.getByTestId('estimate__window__step_4__skylight_quantity').fill('1');
  await page.getByTestId('estimate__window__step_4__sunroom').check();
  await continueButton.click();

  await expect(page.getByTestId('estimate__step_heading')).toContainText('Step 5 of 5');
  await fillContact(page);
  await submitAndAssertConfirmation(page);
});

test('commercial windows wizard (commercialWindow)', async ({ page }) => {
  await mockEstimateCreate(page);
  await page.goto('/estimate');

  await page.getByTestId('estimate__service__commercialWindow').click();

  const continueButton = page.getByTestId('estimate__continue');
  await expect(page.getByTestId('estimate__step_heading')).toContainText('Step 1 of 5');
  await page.getByTestId('estimate__commercialWindow__step_1__postal_code').fill('R5G 2X3');
  await page.getByTestId('estimate__commercialWindow__step_1__building_type').selectOption('storefront');
  await page.getByTestId('estimate__commercialWindow__step_1__storeys').selectOption('ground');
  await continueButton.click();

  await expect(page.getByTestId('estimate__step_heading')).toContainText('Step 2 of 5');
  await page.getByTestId('estimate__commercialWindow__step_2__size_mode').selectOption('paneCount');
  await page.getByTestId('estimate__commercialWindow__step_2__pane_count').fill('12');
  await page.getByTestId('estimate__commercialWindow__step_2__glass_door_count').fill('2');
  await continueButton.click();

  await expect(page.getByTestId('estimate__step_heading')).toContainText('Step 3 of 5');
  await page.getByTestId('estimate__commercialWindow__step_3__scope').selectOption('both');
  await page.getByTestId('estimate__commercialWindow__step_3__frequency').selectOption('monthly');
  await continueButton.click();

  await expect(page.getByTestId('estimate__step_heading')).toContainText('Step 4 of 5');
  await page.getByTestId('estimate__commercialWindow__step_4__after_hours').check();
  await continueButton.click();

  await expect(page.getByTestId('estimate__step_heading')).toContainText('Step 5 of 5');
  await fillContact(page);
  await submitAndAssertConfirmation(page);
});

test('carpet cleaning wizard (carpet)', async ({ page }) => {
  await mockEstimateCreate(page);
  await page.goto('/estimate');

  await page.getByTestId('estimate__service__carpet').click();

  const continueButton = page.getByTestId('estimate__continue');
  await expect(page.getByTestId('estimate__step_heading')).toContainText('Step 1 of 5');
  await page.getByTestId('estimate__carpet__step_1__postal_code').fill('R5G 2X3');
  await page.getByTestId('estimate__carpet__step_1__estimate_method').selectOption('rooms');
  await continueButton.click();

  await expect(page.getByTestId('estimate__step_heading')).toContainText('Step 2 of 5');
  await page.getByTestId('estimate__carpet__step_2__room_count').fill('3');
  await continueButton.click();

  await expect(page.getByTestId('estimate__step_heading')).toContainText('Step 3 of 5');
  await page.getByTestId('estimate__carpet__step_3__condition').selectOption('moderate');
  await continueButton.click();

  await expect(page.getByTestId('estimate__step_heading')).toContainText('Step 4 of 5');
  await page.getByTestId('estimate__carpet__step_4__stairs_steps').fill('12');
  await page.getByTestId('estimate__carpet__step_4__hallways').fill('1');
  await page.getByTestId('estimate__carpet__step_4__furniture_moving').selectOption('light');
  await page.getByTestId('estimate__carpet__step_4__pet_treatment').check();
  await continueButton.click();

  await expect(page.getByTestId('estimate__step_heading')).toContainText('Step 5 of 5');
  await page.getByTestId('estimate__contact__preferred_timeline').selectOption('asap');
  await fillContact(page);
  await submitAndAssertConfirmation(page);
});

test('post-construction wizard (postConstruction)', async ({ page }) => {
  await mockEstimateCreate(page);
  await page.goto('/estimate');

  await page.getByTestId('estimate__service__postConstruction').click();

  const continueButton = page.getByTestId('estimate__continue');
  await expect(page.getByTestId('estimate__step_heading')).toContainText('Step 1 of 5');
  await page.getByTestId('estimate__postConstruction__step_1__postal_code').fill('R5G 2X3');
  await page.getByTestId('estimate__postConstruction__step_1__project_type').selectOption('residential');
  await page.getByTestId('estimate__postConstruction__step_1__build_type').selectOption('newBuild');
  await continueButton.click();

  await expect(page.getByTestId('estimate__step_heading')).toContainText('Step 2 of 5');
  await page.getByTestId('estimate__postConstruction__step_2__square_footage_bracket').selectOption('1000to2500');
  await page.getByTestId('estimate__postConstruction__step_2__floors_levels').fill('2');
  await continueButton.click();

  await expect(page.getByTestId('estimate__step_heading')).toContainText('Step 3 of 5');
  await page.getByTestId('estimate__postConstruction__step_3__cleaning_stage').selectOption('final');
  await page.getByTestId('estimate__postConstruction__step_3__dust_load').selectOption('medium');
  await continueButton.click();

  await expect(page.getByTestId('estimate__step_heading')).toContainText('Step 4 of 5');
  await page.getByTestId('estimate__postConstruction__step_4__interior_windows').selectOption('medium');
  await page.getByTestId('estimate__postConstruction__step_4__scraping').selectOption('some');
  await page.getByTestId('estimate__postConstruction__step_4__floor_detailing').selectOption('medium');
  await page.getByTestId('estimate__postConstruction__step_4__inside_cabinets').check();
  await continueButton.click();

  await expect(page.getByTestId('estimate__step_heading')).toContainText('Step 5 of 5');
  await page.getByTestId('estimate__contact__preferred_timeline').selectOption('asap');
  await fillContact(page);
  await submitAndAssertConfirmation(page);
});
