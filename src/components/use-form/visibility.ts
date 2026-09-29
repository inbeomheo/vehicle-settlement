import type { Draft } from '@/client/offline/store';
import { tripFieldKeys, type FieldModes } from '@/shared/form-settings';
import type { FormCharge, FormTrip } from './model';

export function hasFieldValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
}

// Sequence numbers change when rows move; visibility belongs to the row itself.
export function tripRevealTarget(trip: FormTrip, property: string) {
  return `trip:${trip.client_row_id}.${property}`;
}

export function tripLayout(settings: FieldModes, billingUnits: FormCharge['billing_unit'][] = []) {
  const showQuantity =
    settings.quantity === 'REQUIRED' || billingUnits.some((unit) => unit === 'PER_TON' || unit === 'PER_M3');
  const showHours = settings.hours === 'REQUIRED' || billingUnits.includes('PER_HOUR');
  const detailKeys = (
    [
      'via',
      'quantity',
      'quantity_unit',
      'hours',
      'depart_at',
      'arrive_at',
      'is_empty_return',
      'trip_notes',
    ] as const
  ).filter((key) => !(key === 'quantity' && showQuantity) && !(key === 'hours' && showHours));
  return { showQuantity, showHours, detailKeys };
}

export function revealDraftFields(draft: Draft, modes: FieldModes): Draft {
  const revealed = new Set(draft.revealedFields);
  const fixes =
    draft.server?.review_status === 'NEEDS_FIX'
      ? (draft.server.revisions.find((revision) => revision.decision === 'NEEDS_FIX')?.fix_items ?? [])
      : [];
  for (const key of [
    'end_date',
    'work_type',
    'requester',
    'cargo_desc',
    'operation_status',
    'notes',
  ] as const) {
    const target = key === 'work_type' ? 'work_type_id' : key;
    const hasValue =
      key === 'operation_status'
        ? !!draft.server || draft.form.operation_status !== 'COMPLETED'
        : hasFieldValue(draft.form[target]);
    if (
      modes[key] !== 'HIDDEN' ||
      hasValue ||
      fixes.some((fix) => [target, `use.${target}`].includes(fix.target))
    )
      revealed.add(target);
  }
  const { detailKeys } = tripLayout(
    modes,
    draft.form.charges.filter((charge) => charge.charge_type === 'BASE').map((charge) => charge.billing_unit),
  );
  draft.form.trips.forEach((trip, index) => {
    for (const [property, key] of Object.entries(tripFieldKeys)) {
      if (!key) continue;
      const hasValue =
        property === 'status'
          ? !!trip.id || trip.status !== 'COMPLETED'
          : property === 'is_empty_return'
            ? !!trip.id || trip.is_empty_return
            : hasFieldValue(trip[property as keyof FormTrip]);
      const hasFix = fixes.some((fix) => fix.target === `trip:${index + 1}.${property}`);
      if (modes[key] !== 'HIDDEN' || hasValue || hasFix) revealed.add(tripRevealTarget(trip, property));
      // Keep an automatically opened disclosure open after its last value is cleared.
      if (
        detailKeys.some((detailKey) => detailKey === key) &&
        (hasValue || hasFix || modes[key] === 'REQUIRED')
      )
        revealed.add(tripRevealTarget(trip, 'details'));
    }
  });
  return revealed.size === (draft.revealedFields?.length ?? 0)
    ? draft
    : { ...draft, revealedFields: [...revealed] };
}
