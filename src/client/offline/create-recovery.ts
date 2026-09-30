import Decimal from 'decimal.js';
import type { FormValues } from '../../components/use-form/model';
import type { UseDetail } from '../types';

// A create response introduces server row IDs. Bind them to the original local
// keys before PATCH so later edits retain the saved rate calculation basis.
export function bindCreatedRows(current: FormValues, original: FormValues, server: UseDetail): FormValues {
  const available = [...server.charge_lines];
  const ids = new Map<string, string>();
  for (const charge of original.charges) {
    const index = available.findIndex(
      (line) =>
        line.direction === (charge.direction ?? 'PAYABLE') &&
        line.charge_type === charge.charge_type &&
        (!charge.billing_unit || line.billing_unit === charge.billing_unit) &&
        (!charge.quantity || (line.quantity !== null && new Decimal(line.quantity).eq(charge.quantity))) &&
        (line.reason ?? '') === (charge.reason ?? '') &&
        line.requested_amount ===
          (charge.charge_type === 'BASE' && charge.requested_amount === ''
            ? null
            : Number(charge.requested_amount)),
    );
    if (index >= 0) ids.set(charge.key, available.splice(index, 1)[0].id);
  }
  return {
    ...current,
    trips: current.trips.map((trip) => ({
      ...trip,
      id: server.trips.find((saved) => saved.client_row_id === trip.client_row_id)?.id ?? trip.id,
    })),
    charges: current.charges.map((charge) => {
      const before = original.charges.find((saved) => saved.key === charge.key);
      return {
        ...charge,
        id:
          before?.direction === charge.direction && before?.charge_type === charge.charge_type
            ? (ids.get(charge.key) ?? charge.id)
            : charge.id,
      };
    }),
  };
}
