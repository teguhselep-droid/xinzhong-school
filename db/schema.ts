import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, check, foreignKey } from 'drizzle-orm/sqlite-core';
export const users = sqliteTable('users', {
  id: text('id').primaryKey(), username: text('username').notNull().unique(),
  name: text('name').notNull(), role: text('role').notNull(),
  passwordHash: text('password_hash').notNull(), active: integer('active').notNull().default(1),
  createdAt: text('created_at').notNull(), lastLogin: text('last_login'),
});
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(), userId: text('user_id').notNull().references(() => users.id),
  expiresAt: integer('expires_at').notNull(),
});
export const loginLimits = sqliteTable('login_limits', {
  key: text('key').primaryKey(), attempts: integer('attempts').notNull(), resetAt: integer('reset_at').notNull(),
});
export const students = sqliteTable('students', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  registrationNumber:text('registration_number').unique(),
  nameId: text('name_id').notNull(), nameZh: text('name_zh').notNull().default(''),
  nik: text('nik').notNull().default(''), birthdate: text('birthdate').notNull().default(''),
  phone: text('phone').notNull().default(''), address: text('address').notNull().default(''),
  city: text('city').notNull().default(''), parentName: text('parent_name').notNull().default(''),
  parentPhone: text('parent_phone').notNull().default(''),
  registeredDate: text('registered_date').notNull(),
  currentClass: text('current_class').notNull().default(''),
  lastAttendanceDate: text('last_attendance_date'),
  notes: text('notes').notNull().default(''), revision: integer('revision').notNull().default(0),
  updateToken: text('update_token'),
  registrationToken: text('registration_token').unique(),
  favCharCiphertext:text('fav_char_ciphertext'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  loginStatus:text('login_status').notNull().default('active'),
  failedLoginAttempts:integer('failed_login_attempts').notNull().default(0),
  lastFailedLoginAt:text('last_failed_login_at'),loginLockedAt:text('login_locked_at'),
  loginVersion:integer('login_version').notNull().default(0),
  loginAccessVersion:integer('login_access_version').notNull().default(0),
});
export const editHistory = sqliteTable('edit_history', {
  id: integer('id').primaryKey({ autoIncrement: true }), editedAt: text('edited_at').notNull(),
  userId: text('user_id').notNull(), username: text('username').notNull(),
  page: text('page').notNull(), recordId: text('record_id').notNull(),
  field: text('field').notNull(), fromValue: text('from_value').notNull(), toValue: text('to_value').notNull(),
});
// Durable reference records for the upcoming class and transaction modules.
// Retain these when an assignment ends or a transaction is voided.
export const studentClassAssignments = sqliteTable('student_class_assignments', {
  id: text('id').primaryKey(),
  studentId: integer('student_id').notNull().references(()=>students.id,{onDelete:'restrict'}),
  createdAt: text('created_at').notNull(),
  classId: text('class_id').references(() => classes.id, { onDelete: 'restrict' }),
  removedAt: text('removed_at'),
},table=>[
  index('student_class_assignments_student_idx').on(table.studentId),
  uniqueIndex('class_enrollment_unique').on(table.classId, table.studentId),
]);
export const studentTransactions = sqliteTable('student_transactions', {
  id: text('id').primaryKey(),
  studentId: integer('student_id').notNull().references(()=>students.id,{onDelete:'restrict'}),
  createdAt: text('created_at').notNull(),
},table=>[index('student_transactions_student_idx').on(table.studentId)]);
export const studentSessions = sqliteTable('student_sessions', {
  tokenHash:text('token_hash').primaryKey(),
  studentId:integer('student_id').notNull().references(()=>students.id,{onDelete:'cascade'}),
  identityHash:text('identity_hash').notNull(),expiresAt:integer('expires_at').notNull(),
},table=>[index('student_sessions_student_idx').on(table.studentId)]);
export const studentRegistrationSequences=sqliteTable('student_registration_sequences',{
  period:text('period').primaryKey(),lastSequence:integer('last_sequence').notNull().default(110),
});
export const teachers = sqliteTable('teachers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  nameId: text('name_id').notNull(),
  nameZh: text('name_zh').notNull().default(''),
  nik: text('nik').notNull().default(''),
  birthdate: text('birthdate').notNull().default(''),
  phone: text('phone').notNull().default(''),
  address: text('address').notNull().default(''),
  city: text('city').notNull().default(''),
  registeredDate: text('registered_date').notNull(),
  recordedBy: text('recorded_by'),
  revision: integer('revision').notNull().default(0),
  updateToken: text('update_token'),
});
export const classes = sqliteTable('classes', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  teacherId: integer('teacher_id').notNull().references(() => teachers.id, { onDelete: 'restrict' }),
  location: text('location').notNull(),
  createdAt: text('created_at'),
  recordedBy: text('recorded_by'),
  revision: integer('revision').notNull().default(0),
  updateToken: text('update_token'),
});

export const classDays = sqliteTable('class_days', {
  id: text('id').primaryKey(),
  classId: text('class_id').notNull().references(() => classes.id, { onDelete: 'restrict' }),
  dayNumber: integer('day_number').notNull(),
  date: text('date').notNull(),
  time: text('time').notNull(),
  minutes: integer('minutes').notNull(),
  teacherId: integer('teacher_id').references(() => teachers.id, { onDelete: 'restrict' }),
  location: text('location'),
  recordedAt: text('recorded_at'),
  recorderId: text('recorder_id').references(() => users.id, { onDelete: 'restrict' }),
  revision: integer('revision').notNull().default(0),
  updateToken: text('update_token'),
}, table => [
  uniqueIndex('class_day_number_unique').on(table.classId, table.dayNumber),
  index('class_day_teacher_idx').on(table.teacherId),
]);

export const classAttendance = sqliteTable('class_attendance', {
  dayId: text('day_id').notNull().references(() => classDays.id, { onDelete: 'restrict' }),
  assignmentId: text('assignment_id').notNull().references(() => studentClassAssignments.id, { onDelete: 'restrict' }),
  present: integer('present', { mode: 'boolean' }).notNull(),
  onLeave: integer('on_leave', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes').notNull().default(''),
}, table => [
  primaryKey({ columns: [table.dayId, table.assignmentId] }),
  index('class_attendance_assignment_idx').on(table.assignmentId),
]);

export const classLeaves = sqliteTable('class_leaves', {
  id: text('id').primaryKey(),
  assignmentId: text('assignment_id').notNull().references(() => studentClassAssignments.id, { onDelete: 'restrict' }),
  startsOn: text('starts_on').notNull(),
  endsOn: text('ends_on').notNull(),
  reason: text('reason').notNull(),
  recordedAt: text('recorded_at').notNull(),
  recordedBy: text('recorded_by').notNull(),
}, table => [
  index('class_leaves_assignment_idx').on(table.assignmentId, table.startsOn, table.endsOn),
  check('class_leave_dates', sql`${table.startsOn} <= ${table.endsOn}`),
]);

export const inventoryCategories = sqliteTable('inventory_categories', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  revision: integer('revision').notNull().default(1),
  updateToken: text('update_token'),
});

export const inventoryProducts = sqliteTable('inventory_products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  categoryId: integer('category_id').notNull().references(() => inventoryCategories.id, { onDelete: 'restrict' }),
  salesPrice: integer('sales_price').notNull(),
  quantity: integer('quantity').notNull(),
  createdAt: text('created_at'),
  recordedBy: text('recorded_by'),
  creationToken: text('creation_token').notNull().unique(),
}, table => [index('inventory_product_category_idx').on(table.categoryId)]);

export const accountingAccounts = sqliteTable('accounting_accounts', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['bank', 'income', 'expense'] }).notNull(),
}, table => [
  uniqueIndex('accounting_account_name_unique').on(sql`lower(${table.name})`),
  check('accounting_account_kind', sql`${table.kind} in ('bank', 'income', 'expense')`),
]);

// A simple posting always has one debit and one credit of the same amount.
export const accountingEntries = sqliteTable('accounting_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  token: text('token').notNull().unique(),
  transactionDate: text('transaction_date').notNull(),
  recordedAt: text('recorded_at').notNull(),
  recordedBy: text('recorded_by').notNull(),
  notes: text('notes').notNull(),
  amount: integer('amount').notNull(),
  debitAccountId: text('debit_account_id').notNull().references(() => accountingAccounts.id, { onDelete: 'restrict' }),
  creditAccountId: text('credit_account_id').notNull().references(() => accountingAccounts.id, { onDelete: 'restrict' }),
}, table => [
  index('accounting_entries_debit_date_idx').on(table.debitAccountId, table.transactionDate, table.id),
  index('accounting_entries_credit_date_idx').on(table.creditAccountId, table.transactionDate, table.id),
  check('accounting_entry_positive_amount', sql`${table.amount} > 0`),
  check('accounting_entry_distinct_accounts', sql`${table.debitAccountId} <> ${table.creditAccountId}`),
]);

export const inventoryMovements = sqliteTable('inventory_movements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  token: text('token').notNull().unique(),
  direction: text('direction', { enum: ['in', 'out'] }).notNull(),
  productId: integer('product_id').notNull().references(() => inventoryProducts.id, { onDelete: 'restrict' }),
  quantity: integer('quantity').notNull(),
  payment: integer('payment').notNull(),
  bankId: text('bank_id').notNull().references(() => accountingAccounts.id, { onDelete: 'restrict' }),
  recordedAt: text('recorded_at').notNull(),
  recordedBy: text('recorded_by').notNull(),
}, table => [
  check('inventory_movement_direction', sql`${table.direction} in ('in', 'out')`),
  check('inventory_movement_positive_quantity', sql`${table.quantity} > 0`),
  check('inventory_movement_positive_payment', sql`${table.payment} > 0`),
]);

export const schoolPayments = sqliteTable('school_payments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  token: text('token').notNull().unique(),
  requestHash: text('request_hash').notNull(),
  kind: text('kind', { enum: ['tuition', 'purchase', 'expense'] }).notNull(),
  paymentDate: text('payment_date').notNull(),
  bankId: text('bank_id').notNull().references(() => accountingAccounts.id, { onDelete: 'restrict' }),
  categoryId: text('category_id').notNull().references(() => accountingAccounts.id, { onDelete: 'restrict' }),
  studentId: integer('student_id').references(() => students.id, { onDelete: 'restrict' }),
  studentTransactionId: text('student_transaction_id').references(() => studentTransactions.id, { onDelete: 'restrict' }),
  classId: text('class_id').references(() => classes.id, { onDelete: 'restrict' }),
  studentNumber: text('student_number'),
  studentName: text('student_name'),
  classCode: text('class_code'),
  className: text('class_name'),
  tuitionMonth: text('tuition_month'),
  monthlyFee: integer('monthly_fee'),
  total: integer('total').notNull(),
  memo: text('memo').notNull(),
  detail: text('detail').notNull().default('[]'),
  photoMime: text('photo_mime'),
  photoData: text('photo_data'),
  recordedAt: text('recorded_at').notNull(),
  recordedBy: text('recorded_by').notNull(),
  voidedAt: text('voided_at'),
  voidedBy: text('voided_by'),
}, table => [
  index('school_payment_kind_idx').on(table.kind, table.id),
  index('school_payment_tuition_month_idx').on(table.tuitionMonth, table.studentId, table.classId),
  check('school_payment_positive_total', sql`${table.total} > 0`),
]);

export const tuitionBills = sqliteTable('tuition_bills', {
  studentId: integer('student_id').notNull().references(() => students.id, { onDelete: 'restrict' }),
  classId: text('class_id').notNull().references(() => classes.id, { onDelete: 'restrict' }),
  month: text('month').notNull(),
  fee: integer('fee').notNull(),
}, table => [
  primaryKey({ columns: [table.studentId, table.classId, table.month] }),
  index('tuition_bill_month_idx').on(table.month),
  check('tuition_bill_positive_fee', sql`${table.fee} > 0`),
]);

export const tuitionWaivers = sqliteTable('tuition_waivers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  token: text('token').notNull().unique(),
  studentId: integer('student_id').notNull(),
  classId: text('class_id').notNull(),
  month: text('month').notNull(),
  amount: integer('amount').notNull(),
  reason: text('reason').notNull(),
  recordedAt: text('recorded_at').notNull(),
  recordedBy: text('recorded_by').notNull(),
}, table => [
  foreignKey({ columns: [table.studentId, table.classId, table.month],
    foreignColumns: [tuitionBills.studentId, tuitionBills.classId, tuitionBills.month] }).onDelete('restrict'),
  index('tuition_waiver_bill_idx').on(table.month, table.studentId, table.classId),
  check('tuition_waiver_positive_amount', sql`${table.amount} > 0`),
]);

export const tuitionCoverage = sqliteTable('tuition_coverage', {
  paymentId: integer('payment_id').notNull().references(() => schoolPayments.id, { onDelete: 'restrict' }),
  studentId: integer('student_id').notNull().references(() => students.id, { onDelete: 'restrict' }),
  dayId: text('day_id').notNull(),
  released: integer('released', { mode: 'boolean' }).notNull().default(false),
}, table => [
  primaryKey({ columns: [table.paymentId, table.dayId] }),
  uniqueIndex('tuition_coverage_current_unique').on(table.studentId, table.dayId).where(sql`${table.released} = 0`),
  index('tuition_coverage_day_idx').on(table.dayId),
]);
