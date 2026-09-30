import { sumMoney } from '../domain/money';

type UseSummary = {
  id: string;
  use_date: string;
  project_id: string;
  project_name: string;
  operation_status: string;
  trip_count: number;
  approved_supply: number;
  pending_supply: number;
  unpriced_count: number;
};
function totals<T extends UseSummary>(uses: T[]) {
  const active = uses.filter((use) => use.operation_status !== 'CANCELED');
  return {
    count: active.length,
    trip_count: active.reduce((sum, use) => sum + use.trip_count, 0),
    approved_supply: sumMoney(active.map((use) => use.approved_supply)),
    pending_supply: sumMoney(active.map((use) => use.pending_supply)),
    unpriced_count: active.reduce((sum, use) => sum + use.unpriced_count, 0),
    canceled_count: uses.length - active.length,
  };
}
export function groupDriverUses<T extends UseSummary>(uses: T[]) {
  const newest = [...uses].sort((a, b) => b.use_date.localeCompare(a.use_date) || a.id.localeCompare(b.id));
  const projects = [...Map.groupBy(newest, (use) => use.project_id)]
    .map(([project_id, rows]) => ({
      project_id,
      project_name: rows[0].project_name,
      ...totals(rows),
      uses: rows,
    }))
    .sort(
      (a, b) =>
        b.approved_supply - a.approved_supply ||
        b.pending_supply - a.pending_supply ||
        a.project_id.localeCompare(b.project_id),
    );
  const dates = [...Map.groupBy(newest, (use) => use.use_date)].map(([date, rows]) => ({
    date,
    ...totals(rows),
    uses: rows,
  }));
  return { period_totals: totals(uses), projects, dates };
}
