/** Existing driver list wording, shared with settlement views. Trips must be in sequence order. */
export function routeSummary(trips: { origin: string; destination: string }[]) {
  return trips.length
    ? `${trips[0].origin} → ${trips[0].destination}${trips.length > 1 ? ` 외 ${trips.length - 1}회` : ''}`
    : null;
}
