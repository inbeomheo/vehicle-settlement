import { fieldKeys, fieldModes } from '../../shared/form-settings';
import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  numeric,
  jsonb,
  uniqueIndex,
  index,
  check,
  customType,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
export const evidenceBlobs = pgTable(
  'evidence_blobs',
  {
    storage_key: text().primaryKey(),
    bytes: bytea().notNull(),
    size: integer().notNull(),
    sha256: text().notNull(),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'evidence_blobs_size_check',
      sql`${table.size} >= 0 AND octet_length(${table.bytes}) = ${table.size}`,
    ),
    check('evidence_blobs_hash_check', sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const roleEnum = pgEnum('user_role', ['DRIVER', 'SITE_MANAGER', 'SETTLEMENT_MANAGER', 'ADMIN']);
export const userStatusEnum = pgEnum('user_status', ['ACTIVE', 'DISABLED']);
export const evidencePolicyEnum = pgEnum('evidence_policy', [
  'PHOTO_REQUIRED',
  'PHOTO_OR_ALTERNATIVE',
  'NONE',
]);
export const counterpartyKindEnum = pgEnum('counterparty_kind', ['CARRIER', 'DRIVER_BUSINESS', 'CUSTOMER']);
export const directionEnum = pgEnum('direction', ['PAYABLE', 'RECEIVABLE']);
export const billingUnitEnum = pgEnum('billing_unit', [
  'PER_TRIP',
  'PER_DAY',
  'HALF_DAY',
  'MONTHLY',
  'PER_HOUR',
  'PER_TON',
  'PER_M3',
  'LUMP_SUM',
]);
export const taxModeEnum = pgEnum('tax_mode', ['VAT_EXCLUDED', 'VAT_INCLUDED', 'TAX_EXEMPT']);
export const roundingEnum = pgEnum('rounding', ['HALF_UP', 'DOWN', 'UP']);
export const operationStatusEnum = pgEnum('operation_status', [
  'PLANNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELED',
]);
export const reviewStatusEnum = pgEnum('review_status', ['DRAFT', 'SUBMITTED', 'NEEDS_FIX', 'APPROVED']);
export const enteredAsEnum = pgEnum('entered_as', ['DRIVER_SELF', 'PROXY']);
export const chargeTypeEnum = pgEnum('charge_type', [
  'BASE',
  'WAITING',
  'TOLL',
  'EXTRA_STOP',
  'CANCEL_FEE',
  'EXPENSE',
  'OTHER',
  'ADJUSTMENT',
]);
export const priceStatusEnum = pgEnum('price_status', ['PENDING', 'CONFIRMED']);
export const lineReviewStatusEnum = pgEnum('line_review_status', ['PENDING', 'APPROVED', 'HELD', 'REJECTED']);
export const evidenceKindEnum = pgEnum('evidence_kind', [
  'PHOTO',
  'RECEIPT',
  'WEIGH_TICKET',
  'CONFIRMATION',
  'SLIP_NO',
  'OTHER',
]);
export const uploadStatusEnum = pgEnum('upload_status', ['PENDING', 'UPLOADED', 'FAILED']);
export const decisionEnum = pgEnum('revision_decision', ['PENDING', 'APPROVED', 'NEEDS_FIX', 'SUPERSEDED']);
export const statementStatusEnum = pgEnum('statement_status', ['DRAFT', 'CONFIRMED', 'CANCELED']);
export const inclusionEnum = pgEnum('inclusion', ['INCLUDED', 'HELD']);
export const paymentKindEnum = pgEnum('payment_kind', ['PAYMENT', 'RECEIPT']);
export const importStatusEnum = pgEnum('import_status', ['PREVIEW', 'COMMITTED', 'FAILED']);
const id = () => uuid('id').primaryKey().defaultRandom();
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const time = (name: string) => timestamp(name, { withTimezone: true });
const qty = (name: string) => numeric(name, { precision: 12, scale: 3 });
const version = () => integer('version').notNull().default(1);

export const projects = pgTable('projects', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  evidence_policy: evidencePolicyEnum('evidence_policy').notNull().default('PHOTO_REQUIRED'),
  created_at: created(),
  updated_at: updated(),
});
export const workTypes = pgTable('work_types', {
  id: id(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  created_at: created(),
  updated_at: updated(),
});
export const counterparties = pgTable('counterparties', {
  id: id(),
  name: text('name').notNull(),
  biz_no: text('biz_no'),
  kind: counterpartyKindEnum('kind').notNull(),
  contact_name: text('contact_name'),
  phone: text('phone'),
  bank_account: text('bank_account'),
  active: boolean('active').notNull().default(true),
  created_at: created(),
  updated_at: updated(),
});
export const vehicles = pgTable('vehicles', {
  id: id(),
  plate_no: text('plate_no').notNull().unique(),
  vehicle_type: text('vehicle_type').notNull(),
  tonnage: qty('tonnage').notNull(),
  active: boolean('active').notNull().default(true),
  created_at: created(),
  updated_at: updated(),
});
export const drivers = pgTable('drivers', {
  id: id(),
  name: text('name').notNull(),
  phone: text('phone'),
  default_vehicle_id: uuid('default_vehicle_id').references(() => vehicles.id),
  active: boolean('active').notNull().default(true),
  created_at: created(),
  updated_at: updated(),
});
export const driverAffiliations = pgTable(
  'driver_affiliations',
  {
    id: id(),
    driver_id: uuid('driver_id')
      .notNull()
      .references(() => drivers.id),
    counterparty_id: uuid('counterparty_id')
      .notNull()
      .references(() => counterparties.id),
    valid_from: date('valid_from').notNull(),
    valid_to: date('valid_to'),
    created_at: created(),
    updated_at: updated(),
  },
  (t) => [
    index('affiliation_driver_dates_idx').on(t.driver_id, t.valid_from),
    check('affiliation_dates_check', sql`${t.valid_to} IS NULL OR ${t.valid_to} >= ${t.valid_from}`),
  ],
);
export const users = pgTable(
  'users',
  {
    id: id(),
    login_id: text('login_id').notNull().unique(),
    password_hash: text('password_hash').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    role: roleEnum('role').notNull(),
    driver_id: uuid('driver_id').references(() => drivers.id),
    all_projects: boolean('all_projects').notNull().default(false),
    status: userStatusEnum('status').notNull().default('ACTIVE'),
    version: version(),
    created_at: created(),
    updated_at: updated(),
  },
  (t) => [check('driver_user_link_check', sql`${t.role} <> 'DRIVER' OR ${t.driver_id} IS NOT NULL`)],
);
export const sessions = pgTable('sessions', {
  id: id(),
  user_id: uuid('user_id')
    .notNull()
    .references(() => users.id),
  token_hash: text('token_hash').notNull().unique(),
  expires_at: time('expires_at').notNull(),
  revoked_at: time('revoked_at'),
  last_seen_at: time('last_seen_at'),
  created_at: created(),
  updated_at: updated(),
});
export const projectAssignments = pgTable(
  'project_assignments',
  {
    id: id(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id),
    project_id: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    valid_from: date('valid_from').notNull(),
    valid_to: date('valid_to'),
    revoked_at: time('revoked_at'),
    created_at: created(),
    updated_at: updated(),
  },
  (t) => [
    index('assignment_user_idx').on(t.user_id),
    check('assignment_dates_check', sql`${t.valid_to} IS NULL OR ${t.valid_to} >= ${t.valid_from}`),
  ],
);
export const invites = pgTable('invites', {
  id: id(),
  token_hash: text('token_hash').notNull().unique(),
  role: roleEnum('role').notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  driver_id: uuid('driver_id').references(() => drivers.id),
  project_ids: jsonb('project_ids').$type<string[]>().notNull().default([]),
  expires_at: time('expires_at').notNull(),
  used_at: time('used_at'),
  used_by_user_id: uuid('used_by_user_id').references(() => users.id),
  revoked_at: time('revoked_at'),
  created_by: uuid('created_by')
    .notNull()
    .references(() => users.id),
  created_at: created(),
  updated_at: updated(),
});
export const passwordResets = pgTable(
  'password_resets',
  {
    id: id(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id),
    token_hash: text('token_hash').notNull().unique(),
    expires_at: time('expires_at').notNull(),
    used_at: time('used_at'),
    revoked_at: time('revoked_at'),
    created_by: uuid('created_by')
      .notNull()
      .references(() => users.id),
    created_at: created(),
  },
  (t) => [index('password_resets_user_idx').on(t.user_id)],
);
export const rateAgreements = pgTable(
  'rate_agreements',
  {
    id: id(),
    name: text('name').notNull(),
    direction: directionEnum('direction').notNull(),
    counterparty_id: uuid('counterparty_id')
      .notNull()
      .references(() => counterparties.id),
    project_id: uuid('project_id').references(() => projects.id),
    vehicle_type: text('vehicle_type'),
    tonnage: qty('tonnage'),
    billing_unit: billingUnitEnum('billing_unit').notNull(),
    unit_price: integer('unit_price').notNull(),
    valid_from: date('valid_from').notNull(),
    valid_to: date('valid_to'),
    tax_mode: taxModeEnum('tax_mode').notNull().default('VAT_EXCLUDED'),
    rounding: roundingEnum('rounding').notNull().default('HALF_UP'),
    min_charge: integer('min_charge'),
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
    version: version(),
    created_at: created(),
    updated_at: updated(),
  },
  (t) => [
    check('rate_dates_check', sql`${t.valid_to} IS NULL OR ${t.valid_to} >= ${t.valid_from}`),
    check(
      'rate_amounts_check',
      sql`${t.unit_price} >= 0 AND (${t.min_charge} IS NULL OR ${t.min_charge} >= 0)`,
    ),
  ],
);
export const vehicleUses = pgTable(
  'vehicle_uses',
  {
    id: id(),
    use_no: text('use_no').notNull().unique(),
    client_request_id: text('client_request_id').unique(),
    create_request_hash: text('create_request_hash'),
    use_date: date('use_date').notNull(),
    end_date: date('end_date'),
    project_id: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    work_type_id: uuid('work_type_id').references(() => workTypes.id),
    requester: text('requester'),
    driver_id: uuid('driver_id')
      .notNull()
      .references(() => drivers.id),
    vehicle_id: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    payee_counterparty_id: uuid('payee_counterparty_id')
      .notNull()
      .references(() => counterparties.id),
    customer_counterparty_id: uuid('customer_counterparty_id').references(() => counterparties.id),
    cargo_desc: text('cargo_desc'),
    notes: text('notes'),
    /** 기사가 고른 검수 담당자. 고르지 않으면 현장 담당자 누구나 검수한다. */
    reviewer_user_id: uuid('reviewer_user_id').references((): AnyPgColumn => users.id),
    /** 이번 운행 적재용량(톤). 차량 톤수와 달리 운행마다 다르다. */
    load_tonnage: numeric('load_tonnage', { precision: 10, scale: 3 }),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    operation_status: operationStatusEnum('operation_status').notNull().default('PLANNED'),
    review_status: reviewStatusEnum('review_status').notNull().default('DRAFT'),
    current_revision_no: integer('current_revision_no').notNull().default(0),
    approved_revision_id: uuid('approved_revision_id').references((): AnyPgColumn => useRevisions.id),
    created_by_user_id: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    entered_as: enteredAsEnum('entered_as').notNull(),
    driver_confirmed_at: time('driver_confirmed_at'),
    source_row_hash: text('source_row_hash').unique(),
    import_job_id: uuid('import_job_id').references(() => importJobs.id),
    version: version(),
    created_at: created(),
    updated_at: updated(),
  },
  (t) => [
    index('uses_project_date_idx').on(t.project_id, t.use_date),
    index('uses_driver_idx').on(t.driver_id),
    index('uses_reviewer_idx').on(t.reviewer_user_id, t.review_status),
    check('use_dates_check', sql`${t.end_date} IS NULL OR ${t.end_date} >= ${t.use_date}`),
  ],
);
export const trips = pgTable(
  'trips',
  {
    id: id(),
    vehicle_use_id: uuid('vehicle_use_id')
      .notNull()
      .references(() => vehicleUses.id),
    seq: integer('seq').notNull(),
    status: operationStatusEnum('status').notNull().default('COMPLETED'),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    via: text('via').array(),
    depart_at: time('depart_at'),
    arrive_at: time('arrive_at'),
    cargo_desc: text('cargo_desc'),
    quantity: qty('quantity'),
    quantity_unit: text('quantity_unit'),
    hours: qty('hours'),
    is_empty_return: boolean('is_empty_return').notNull().default(false),
    notes: text('notes'),
    client_row_id: text('client_row_id'),
    created_at: created(),
    updated_at: updated(),
  },
  (t) => [
    uniqueIndex('trips_use_seq_unique').on(t.vehicle_use_id, t.seq),
    uniqueIndex('trips_use_client_row_unique').on(t.vehicle_use_id, t.client_row_id),
  ],
);
export const chargeLines = pgTable(
  'charge_lines',
  {
    id: id(),
    vehicle_use_id: uuid('vehicle_use_id')
      .notNull()
      .references(() => vehicleUses.id),
    trip_id: uuid('trip_id').references(() => trips.id),
    direction: directionEnum('direction').notNull(),
    counterparty_id: uuid('counterparty_id')
      .notNull()
      .references(() => counterparties.id),
    charge_type: chargeTypeEnum('charge_type').notNull(),
    billing_unit: billingUnitEnum('billing_unit').notNull(),
    quantity: qty('quantity'),
    unit_price: integer('unit_price'),
    rate_agreement_id: uuid('rate_agreement_id').references(() => rateAgreements.id),
    rate_basis_date: date('rate_basis_date').notNull(),
    agreement_snapshot: jsonb('agreement_snapshot').$type<Record<string, unknown>>(),
    tax_mode: taxModeEnum('tax_mode').notNull(),
    rounding: roundingEnum('rounding').notNull(),
    computed_amount: integer('computed_amount'),
    requested_amount: integer('requested_amount'),
    approved_amount: integer('approved_amount'),
    tax_amount: integer('tax_amount'),
    price_status: priceStatusEnum('price_status').notNull().default('PENDING'),
    line_review_status: lineReviewStatusEnum('line_review_status').notNull().default('PENDING'),
    reason: text('reason'),
    included_in_base: boolean('included_in_base').notNull().default(false),
    adjusts_statement_id: uuid('adjusts_statement_id').references((): AnyPgColumn => statements.id),
    locked_statement_id: uuid('locked_statement_id').references((): AnyPgColumn => statements.id),
    deleted_at: time('deleted_at'),
    version: version(),
    created_at: created(),
    updated_at: updated(),
  },
  (t) => [index('charge_use_idx').on(t.vehicle_use_id)],
);
export const evidence = pgTable(
  'evidence',
  {
    id: id(),
    vehicle_use_id: uuid('vehicle_use_id')
      .notNull()
      .references(() => vehicleUses.id),
    owner_driver_id: uuid('owner_driver_id').references(() => drivers.id),
    trip_id: uuid('trip_id').references(() => trips.id),
    kind: evidenceKindEnum('kind').notNull(),
    client_upload_id: text('client_upload_id').notNull().unique(),
    storage_key: text('storage_key'),
    original_name: text('original_name'),
    mime: text('mime'),
    size: integer('size'),
    sha256: text('sha256'),
    text_value: text('text_value'),
    upload_status: uploadStatusEnum('upload_status').notNull().default('PENDING'),
    uploaded_by: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    uploaded_at: time('uploaded_at'),
    replaced_by_id: uuid('replaced_by_id').references((): AnyPgColumn => evidence.id),
    replace_reason: text('replace_reason'),
    deleted_at: time('deleted_at'),
    created_at: created(),
    updated_at: updated(),
  },
  (t) => [index('evidence_use_idx').on(t.vehicle_use_id)],
);
export const useRevisions = pgTable(
  'use_revisions',
  {
    id: id(),
    vehicle_use_id: uuid('vehicle_use_id')
      .notNull()
      .references((): AnyPgColumn => vehicleUses.id),
    revision_no: integer('revision_no').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    submitted_by: uuid('submitted_by')
      .notNull()
      .references(() => users.id),
    submitted_at: time('submitted_at').notNull().defaultNow(),
    decision: decisionEnum('decision').notNull().default('PENDING'),
    decided_by: uuid('decided_by').references(() => users.id),
    decided_at: time('decided_at'),
    comment: text('comment'),
    fix_items: jsonb('fix_items').$type<{ target: string; message: string }[]>().notNull().default([]),
    created_at: created(),
    updated_at: updated(),
  },
  (t) => [uniqueIndex('revision_use_no_unique').on(t.vehicle_use_id, t.revision_no)],
);
export const statements = pgTable('statements', {
  id: id(),
  statement_no: text('statement_no').unique(),
  direction: directionEnum('direction').notNull(),
  counterparty_id: uuid('counterparty_id')
    .notNull()
    .references(() => counterparties.id),
  period_start: date('period_start').notNull(),
  period_end: date('period_end').notNull(),
  title: text('title'),
  status: statementStatusEnum('status').notNull().default('DRAFT'),
  counterparty_snapshot: jsonb('counterparty_snapshot').$type<Record<string, unknown>>(),
  issuer_snapshot: jsonb('issuer_snapshot').$type<Record<string, unknown>>(),
  supply_total: integer('supply_total').notNull().default(0),
  tax_total: integer('tax_total').notNull().default(0),
  grand_total: integer('grand_total').notNull().default(0),
  due_date: date('due_date'),
  confirmed_at: time('confirmed_at'),
  confirmed_by: uuid('confirmed_by').references(() => users.id),
  canceled_at: time('canceled_at'),
  canceled_by: uuid('canceled_by').references(() => users.id),
  cancel_reason: text('cancel_reason'),
  created_by: uuid('created_by')
    .notNull()
    .references(() => users.id),
  client_request_id: text('client_request_id').unique(),
  version: version(),
  replaces_statement_id: uuid('replaces_statement_id').references((): AnyPgColumn => statements.id),
  created_at: created(),
  updated_at: updated(),
});
export const statementItems = pgTable(
  'statement_items',
  {
    id: id(),
    statement_id: uuid('statement_id')
      .notNull()
      .references(() => statements.id),
    charge_line_id: uuid('charge_line_id')
      .notNull()
      .references(() => chargeLines.id),
    inclusion: inclusionEnum('inclusion').notNull().default('INCLUDED'),
    hold_reason: text('hold_reason'),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>(),
    supply_amount: integer('supply_amount'),
    tax_amount: integer('tax_amount'),
    is_active_lock: boolean('is_active_lock').notNull().default(false),
    created_at: created(),
    updated_at: updated(),
  },
  (t) => [
    uniqueIndex('statement_item_unique').on(t.statement_id, t.charge_line_id),
    uniqueIndex('statement_item_active_lock_unique')
      .on(t.charge_line_id)
      .where(sql`${t.is_active_lock}`),
  ],
);
export const paymentRecords = pgTable(
  'payment_records',
  {
    id: id(),
    statement_id: uuid('statement_id')
      .notNull()
      .references(() => statements.id),
    kind: paymentKindEnum('kind').notNull(),
    amount: integer('amount').notNull(),
    paid_on: date('paid_on').notNull(),
    method: text('method').notNull(),
    reference: text('reference'),
    memo: text('memo'),
    recorded_by: uuid('recorded_by')
      .notNull()
      .references(() => users.id),
    recorded_at: time('recorded_at').notNull().defaultNow(),
    voided_at: time('voided_at'),
    voided_by: uuid('voided_by').references(() => users.id),
    void_reason: text('void_reason'),
    client_request_id: text('client_request_id').unique(),
    created_at: created(),
    updated_at: updated(),
  },
  (t) => [
    uniqueIndex('payment_active_statement_unique')
      .on(t.statement_id)
      .where(sql`${t.voided_at} IS NULL`),
  ],
);
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    at: time('at').notNull().defaultNow(),
    user_id: uuid('user_id').references(() => users.id),
    action: text('action').notNull(),
    entity_type: text('entity_type').notNull(),
    entity_id: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    request_id: text('request_id').notNull(),
    created_at: created(),
  },
  (t) => [index('audit_entity_idx').on(t.entity_type, t.entity_id)],
);
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: id(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id),
    key: text('key').notNull(),
    route: text('route').notNull(),
    request_hash: text('request_hash').notNull(),
    status_code: integer('status_code').notNull(),
    response_body: jsonb('response_body').notNull(),
    created_at: created(),
  },
  (t) => [uniqueIndex('idempotency_user_key_unique').on(t.user_id, t.key)],
);
export const importJobs = pgTable('import_jobs', {
  id: id(),
  file_name: text('file_name').notNull(),
  status: importStatusEnum('status').notNull().default('PREVIEW'),
  mapping: jsonb('mapping'),
  summary: jsonb('summary'),
  rows: jsonb('rows'),
  created_by: uuid('created_by')
    .notNull()
    .references(() => users.id),
  committed_at: time('committed_at'),
  created_at: created(),
  updated_at: updated(),
});
export const importPresets = pgTable(
  'import_presets',
  {
    id: id(),
    name: text('name').notNull(),
    mapping: jsonb('mapping').notNull(),
    created_by: uuid('created_by')
      .notNull()
      .references(() => users.id),
    created_at: created(),
  },
  (t) => [uniqueIndex('import_presets_owner_name').on(t.created_by, t.name)],
);
export const companySettings = pgTable(
  'company_settings',
  {
    id: id(),
    name: text('name').notNull(),
    biz_no: text('biz_no'),
    address: text('address'),
    representative: text('representative'),
    default_tax_mode: taxModeEnum('default_tax_mode').notNull().default('VAT_EXCLUDED'),
    settlement_contact: text('settlement_contact'),
    created_at: created(),
    updated_at: updated(),
  },
  () => [uniqueIndex('company_singleton_unique').on(sql`(true)`)],
);

export const formFieldModeEnum = pgEnum('form_field_mode', fieldModes);
export const formFieldSettings = pgTable(
  'form_field_settings',
  {
    id: id(),
    project_id: uuid('project_id').references(() => projects.id),
    field_key: text('field_key', { enum: fieldKeys }).notNull(),
    driver_mode: formFieldModeEnum('driver_mode'),
    manager_mode: formFieldModeEnum('manager_mode'),
    updated_by: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    version: version(),
    created_at: created(),
    updated_at: updated(),
  },
  (t) => [
    uniqueIndex('form_field_settings_company_unique')
      .on(t.field_key)
      .where(sql`${t.project_id} IS NULL`),
    uniqueIndex('form_field_settings_project_unique')
      .on(t.project_id, t.field_key)
      .where(sql`${t.project_id} IS NOT NULL`),
    check('form_field_settings_version_check', sql`${t.version} > 0`),
    check(
      'form_field_settings_field_key_check',
      sql`${t.field_key} IN (${sql.join(
        fieldKeys.map((key) => sql.raw("'" + key + "'")),
        sql`, `,
      )})`,
    ),
  ],
);

export const loginThrottles = pgTable(
  'login_throttles',
  {
    id: id(),
    key: text('key').notNull().unique(),
    scope: text('scope').$type<'ACCOUNT' | 'IP'>().notNull(),
    failures: integer('failures').notNull().default(0),
    window_started_at: time('window_started_at').notNull().defaultNow(),
    locked_until: time('locked_until'),
    created_at: created(),
    updated_at: updated(),
  },
  (t) => [
    check('login_throttles_scope_check', sql`${t.scope} IN ('ACCOUNT', 'IP')`),
    check('login_throttles_failures_check', sql`${t.failures} >= 0`),
    index('login_throttles_updated_idx').on(t.updated_at),
  ],
);

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    keys: jsonb('keys').$type<{ p256dh: string; auth: string }>().notNull(),
    user_agent: text('user_agent'),
    created_at: created(),
    updated_at: updated(),
    last_success_at: time('last_success_at'),
    failure_count: integer('failure_count').notNull().default(0),
  },
  (table) => [
    index('push_subscriptions_user_idx').on(table.user_id),
    check('push_subscriptions_failure_count_check', sql`${table.failure_count} >= 0`),
  ],
);

export const driverJoinLinks = pgTable('driver_join_links', {
  id: id(),
  token_hash: text('token_hash').notNull().unique(),
  project_ids: jsonb('project_ids').$type<string[]>().notNull(),
  expires_at: time('expires_at').notNull(),
  revoked_at: time('revoked_at'),
  created_by: uuid('created_by')
    .notNull()
    .references(() => users.id),
  version: version(),
  created_at: created(),
  updated_at: updated(),
});
export const driverRegistrations = pgTable(
  'driver_registrations',
  {
    id: id(),
    client_request_id: uuid('client_request_id').notNull().unique(),
    request_hash: text('request_hash').notNull(),
    link_id: uuid('link_id').references(() => driverJoinLinks.id),
    invite_id: uuid('invite_id').references(() => invites.id),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id),
    created_at: created(),
  },
  (table) => [
    check(
      'driver_registration_source_check',
      sql`(${table.link_id} IS NULL) <> (${table.invite_id} IS NULL)`,
    ),
    index('driver_registrations_link_idx').on(table.link_id),
  ],
);
