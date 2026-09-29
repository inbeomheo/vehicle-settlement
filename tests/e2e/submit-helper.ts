import type { Page } from '@playwright/test';

/**
 * 기사 화면의 제출 버튼을 누르고, 확인 시트("이대로 보낼까요?")가 뜨면 "보내기"를 누른다.
 * 입력 오류로 시트가 뜨지 않으면 아무것도 하지 않고 false 를 돌려준다.
 */
export async function submitDriverForm(page: Page, name = '담당자에게 보내기') {
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
