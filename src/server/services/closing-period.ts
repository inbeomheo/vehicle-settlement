import { assertActive } from '../authz';
import type { Context } from '../context';
import { seoulDate } from '../../shared/closing-period';
import { companySettings } from '../db/schema';

/** 로그인한 사용자에게 기간 선택에 필요한 설정만 제공한다. 회사 개인정보는 포함하지 않는다. */
export async function getClosingPeriodSettings(ctx: Context) {
  await assertActive(ctx);
  const [company] = await ctx.db
    .select({ closing_start_day: companySettings.closing_start_day })
    .from(companySettings)
    .limit(1);
  return { today: seoulDate(new Date()), closing_start_day: company?.closing_start_day ?? 19 };
}
