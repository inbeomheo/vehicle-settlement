import type { Page } from '@playwright/test';

/**
 * 기사 화면의 제출 버튼을 누르고, 확인 시트("이대로 보낼까요?")가 뜨면 "보내기"를 누른다.
 * 입력 오류로 시트가 뜨지 않으면 아무것도 하지 않고 false 를 돌려준다.
 */
export async function submitDriverForm(page: Page, name = '담당자에게 보내기') {
  await fillFlowFields(page);
  await page.getByRole('button', { name, exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '이대로 보낼까요?' });
  try {
    await sheet.waitFor({ state: 'visible', timeout: 3000 });
  } catch {
    return false;
  }
  await sheet.getByRole('button', { name: '보내기', exact: true }).click();
  return true;
}

/** Existing journeys now supply the two required FLOW fields through the visible controls. */
export async function fillFlowFields(page: Page) {
  const reviewers = page.getByRole('radiogroup', { name: '담당자', exact: false });
  if (await reviewers.isVisible()) {
    const selected = reviewers.locator('input:checked');
    if (!(await selected.count()) || !(await selected.inputValue()))
      await reviewers.locator('input:not([value=""])').first().check();
  }
  const load = page.getByLabel('적재용량 (톤)', { exact: false });
  if ((await load.isVisible()) && !(await load.inputValue())) await load.fill('1');
}
