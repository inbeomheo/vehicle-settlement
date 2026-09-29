import Decimal from 'decimal.js';

// Presentation only: retain exact database/snapshot decimals for calculations.
export function formatQuantity(value: string | number | null | undefined) {
  if (value == null || value === '') return '—';
  const [whole, fraction] = new Decimal(value).toFixed().split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
}
