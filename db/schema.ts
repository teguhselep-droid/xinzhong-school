import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
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
});
export const editHistory = sqliteTable('edit_history', {
  id: integer('id').primaryKey({ autoIncrement: true }), editedAt: text('edited_at').notNull(),
  userId: text('user_id').notNull(), username: text('username').notNull(),
  page: text('page').notNull(), recordId: text('record_id').notNull(),
  field: text('field').notNull(), fromValue: text('from_value').notNull(), toValue: text('to_value').notNull(),
});
