/** Never serialize arbitrary errors: even message/stack/detail can contain SQL values. */
export function safeError(error: unknown) {
  let current = error;
  let code: string | undefined;
  let name = 'Error';
  const seen = new Set<unknown>();
  for (let depth = 0; current && typeof current === 'object' && depth < 8 && !seen.has(current); depth++) {
    seen.add(current);
    if (
      'name' in current &&
      typeof current.name === 'string' &&
      ['Error', 'TypeError', 'RangeError', 'DrizzleQueryError', 'DatabaseError', 'AggregateError'].includes(
        current.name,
      )
    )
      name = current.name;
    if (
      'code' in current &&
      typeof current.code === 'string' &&
      (/^[0-9A-Z]{5}$/.test(current.code) ||
        ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND'].includes(current.code))
    )
      code = current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  const sqlstate = code && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
  return { name, code, sqlstate, message: sqlstate ? '데이터베이스 요청 실패' : '서버 처리 실패' };
}
/** Routes can contain tokens and names. Preserve static segments only. */
export function safeRoute(request: Request) {
  const staticSegments = new Set([
    'api',
    'auth',
    'login',
    'logout',
    'me',
    'uses',
    'submit',
    'approve',
    'request-fix',
    'confirm-by-driver',
    'copy',
    'cancel',
    'evidence',
    'content',
    'file',
    'replace',
    'charge-lines',
    'review',
    'rates',
    'lookup',
    'lookups',
    'recent-routes',
    'reviewers',
    'dashboard',
    'ledger',
    'export.xlsx',
    'export.pdf',
    'report.pdf',
    'admin',
    'projects',
    'work-types',
    'counterparties',
    'drivers',
    'affiliations',
    'vehicles',
    'users',
    'assignments',
    'company',
    'audit',
    'statements',
    'candidates',
    'items',
    'confirm',
    'payments',
    'void',
    'overview',
    'adjustments',
    'import',
    'upload',
    'preview',
    'commit',
    'presets',
    'errors.xlsx',
    'push',
    'subscriptions',
    'invites',
    'accept',
    'join',
    'driver-join-links',
    'driver-profile',
    'form-settings',
    'form-fields',
    'password',
    'password-reset',
    'reset',
    'summary',
    'approvals',
    'mine',
  ]);
  return `${request.method} ${new URL(request.url).pathname
    .split('/')
    .map((segment) => (!segment || staticSegments.has(segment) ? segment : ':id'))
    .join('/')}`;
}
