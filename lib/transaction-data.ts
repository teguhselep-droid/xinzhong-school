import { sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  transactionPageSize, type PayableDay, type PaymentBank, type PaymentClass, type PaymentHistory,
  type PaymentKind, type PaymentProduct, type PaymentStudent, type TransactionPage, type TuitionMonth, type TuitionStatusRow, type TuitionWaiver,
} from '@/lib/transaction-fields';

type DB = ReturnType<typeof getDb>;

export function paymentBanks(db: DB) {
  return db.all<PaymentBank>(sql`select id, name from accounting_accounts where kind = 'bank' order by name, id`);
}

export async function paymentStudent(db: DB, number: string) {
  const [student] = await db.all<PaymentStudent>(sql`
    select id, registration_number as number, trim(name_id || ' ' || name_zh) as name
    from students where registration_number = ${number}
  `);
  return student;
}

export function paymentStudentSuggestions(db: DB, search: string) {
  const match = '%' + search.replace(/[\\%_]/g, '\\$&') + '%';
  return db.all<Pick<PaymentStudent, 'number' | 'name'>>(sql`
    select registration_number as number, trim(name_id || ' ' || name_zh) as name
    from students where registration_number is not null and (
      registration_number like ${match} escape '\\' or name_id like ${match} escape '\\'
      or name_zh like ${match} escape '\\'
    )
    order by (registration_number = ${search}) desc, name_id collate nocase, registration_number limit 10
  `);
}

export function paymentClasses(db: DB, studentId: number) {
  return db.all<PaymentClass>(sql`
    select c.id, c.code, c.name from classes c join student_class_assignments a on a.class_id = c.id
    where a.student_id = ${studentId} order by c.code desc
  `);
}

export async function paymentClass(db: DB, studentId: number, code: string) {
  const [group] = await db.all<PaymentClass>(sql`
    select c.id, c.code, c.name from classes c join student_class_assignments a on a.class_id = c.id
    where a.student_id = ${studentId} and c.code = ${code}
  `);
  return group;
}

async function payableDays(db: DB, studentId: number, group: PaymentClass, month: string) {
  const rows = await db.all<Omit<PayableDay, 'paid' | 'onLeave'> & { paid: number; onLeave: number }>(sql`
    select d.id, ${group.code} || printf('%02d', d.day_number) as code, d.date, exists (
      select 1 from tuition_coverage t where t.day_id = d.id and t.student_id = ${studentId} and t.released = 0
    ) as paid, exists (
      select 1 from class_leave_days l where l.day_id = d.id and l.student_id = ${studentId}
    ) as onLeave from class_days d where d.class_id = ${group.id}
      and substr(d.date, 1, 7) = ${month} order by d.day_number
  `);
  return rows.map(row => ({ ...row, paid: !!row.paid, onLeave: !!row.onLeave }));
}

export async function tuitionMonthDetails(db: DB, studentId: number, group: PaymentClass, month: string): Promise<TuitionMonth> {
  const [[totals], days] = await Promise.all([
    db.all<{ fee: number | null; paid: number; waived: number }>(sql`
      select (select fee from tuition_bills where student_id = ${studentId} and class_id = ${group.id} and month = ${month}) as fee,
        coalesce((select sum(amount) from tuition_waivers
          where student_id = ${studentId} and class_id = ${group.id} and month = ${month}), 0) as waived,
        coalesce(sum(total), 0) as paid from school_payments
        where student_id = ${studentId} and class_id = ${group.id} and tuition_month = ${month} and voided_at is null
    `),
    payableDays(db, studentId, group, month),
  ]);
  const skipped = totals.fee === null && days.length > 0 && days.every(day => day.onLeave);
  return { ...totals, skipped, due: totals.fee === null ? (skipped ? 0 : null) : totals.fee - totals.paid - totals.waived, days };
}

export function paymentProducts(db: DB, search: string) {
  const match = '%' + search.trim().slice(0, 40) + '%';
  return db.all<PaymentProduct>(sql`
    select id, name, quantity, sales_price as price from inventory_products
    where name like ${match} or cast(id as text) like ${match}
    order by (quantity > 0) desc, name, id limit 30
  `);
}

export async function paymentHistory(db: DB, kind: PaymentKind, query: URLSearchParams): Promise<TransactionPage<PaymentHistory>> {
  const search = (query.get('search') ?? '').trim().slice(0, 40);
  const match = '%' + search + '%';
  const filter = sql`where p.kind = ${kind} ${search ? sql`and (
    'PAY-' || printf('%06d', p.id) like ${match} or p.student_number like ${match}
    or p.student_name like ${match} or p.class_code like ${match} or p.memo like ${match}
  )` : sql.empty()}`;
  const [{ total }] = await db.all<{ total: number }>(sql`select count(*) as total from school_payments p ${filter}`);
  const page = pageNumber(query, total);
  const rows = await db.all<Omit<PaymentHistory, 'detail' | 'hasPhoto'> & { detail: string; hasPhoto: number }>(sql`
    select p.id, p.kind, p.payment_date as paymentDate, a.name as bank, p.category_id as categoryId,
      p.student_number as studentNumber, p.student_name as studentName, p.class_code as classCode, p.class_name as className,
      p.tuition_month as tuitionMonth, p.monthly_fee as monthlyFee,
      p.total, p.memo, p.detail, p.photo_mime is not null as hasPhoto, p.recorded_at as recordedAt,
      p.recorded_by as recordedBy, p.voided_at as voidedAt, p.voided_by as voidedBy
    from school_payments p join accounting_accounts a on a.id = p.bank_id ${filter}
    order by p.payment_date desc, p.id desc limit ${transactionPageSize} offset ${(page - 1) * transactionPageSize}
  `);
  return { rows: rows.map(row => ({ ...row, detail: JSON.parse(row.detail), hasPhoto: !!row.hasPhoto })), total, page };
}

export async function tuitionStatus(db: DB, month: string, query: URLSearchParams): Promise<TransactionPage<TuitionStatusRow>> {
  const search = (query.get('search') ?? '').trim().slice(0, 40);
  const match = '%' + search + '%';
  const onlyUnpaid = query.get('onlyUnpaid') !== '0';
  const grouped: SQL = sql`
    with attended_days as (
      select e.student_id, d.class_id, count(*) as attended, count(t.payment_id) as referenced,
        json_group_array(json_object('code', c.code || printf('%02d', d.day_number), 'date', d.date))
          filter (where t.payment_id is null) as unreferencedDays
      from class_attendance a
      join student_class_assignments e on e.id = a.assignment_id
      join class_days d on d.id = a.day_id and d.class_id = e.class_id
      join classes c on c.id = d.class_id
      left join tuition_coverage t on t.student_id = e.student_id and t.day_id = d.id and t.released = 0
      where a.present = 1 and d.recorded_at is not null and substr(d.date, 1, 7) = ${month}
      group by e.student_id, d.class_id
    ), monthly_pairs as (
      select student_id, class_id from attended_days
      union select student_id, class_id from tuition_bills where month = ${month}
      union select e.student_id, e.class_id from student_class_assignments e
      join students s on s.id = e.student_id and s.active = 1
      where e.removed_at is null and exists (
        select 1 from class_days d where d.class_id = e.class_id and substr(d.date, 1, 7) = ${month}
      )
    ), monthly_payments as (
      select student_id, class_id, sum(total) as paid from school_payments
      where tuition_month = ${month} and voided_at is null group by student_id, class_id
    ), monthly_waivers as (
      select student_id, class_id, sum(amount) as waived from tuition_waivers
      where month = ${month} group by student_id, class_id
    )
    select s.registration_number as studentNumber, trim(s.name_id || ' ' || s.name_zh) as studentName,
      c.code as classCode, c.name as className, coalesce(a.attended, 0) as attended,
      coalesce(a.referenced, 0) as referenced, coalesce(a.unreferencedDays, '[]') as unreferencedDays,
      b.fee, coalesce(p.paid, 0) as paid, coalesce(w.waived, 0) as waived,
      b.fee is null and l.student_id is not null as skipped,
      case when b.fee is null and l.student_id is not null then 0
        else b.fee - coalesce(p.paid, 0) - coalesce(w.waived, 0) end as due
    from monthly_pairs m join students s on s.id = m.student_id join classes c on c.id = m.class_id
    left join attended_days a on a.student_id = m.student_id and a.class_id = m.class_id
    left join tuition_bills b on b.student_id = m.student_id and b.class_id = m.class_id and b.month = ${month}
    left join monthly_payments p on p.student_id = m.student_id and p.class_id = m.class_id
    left join monthly_waivers w on w.student_id = m.student_id and w.class_id = m.class_id
    left join tuition_leave_months l on l.student_id = m.student_id and l.class_id = m.class_id and l.month = ${month}
    where 1 = 1 ${onlyUnpaid ? sql`and ((b.fee is null and l.student_id is null) or b.fee > coalesce(p.paid, 0) + coalesce(w.waived, 0))` : sql.empty()}
    ${search ? sql`and (
      s.registration_number like ${match} or s.name_id like ${match} or s.name_zh like ${match}
      or c.code like ${match} or c.name like ${match}
    )` : sql.empty()}
  `;
  const [{ total }] = await db.all<{ total: number }>(sql`select count(*) as total from (${grouped})`);
  const page = pageNumber(query, total);
  const rows = await db.all<Omit<TuitionStatusRow, 'unreferencedDays' | 'skipped'> & { unreferencedDays: string; skipped: number }>(sql`
    ${grouped} order by due desc, studentName, classCode, studentNumber
    limit ${transactionPageSize} offset ${(page - 1) * transactionPageSize}
  `);
  return { rows: rows.map(row => ({
    ...row, skipped: !!row.skipped,
    unreferencedDays: (JSON.parse(row.unreferencedDays) as TuitionStatusRow['unreferencedDays']).sort((a, b) => a.code.localeCompare(b.code)),
  })), total, page };
}

export async function tuitionWaiverHistory(db: DB, query: URLSearchParams): Promise<TransactionPage<TuitionWaiver>> {
  const search = (query.get('search') ?? '').trim().slice(0, 40);
  const match = '%' + search + '%';
  const source = sql`from tuition_waivers w join students s on s.id = w.student_id join classes c on c.id = w.class_id
    ${search ? sql`where s.registration_number like ${match} or s.name_id like ${match} or s.name_zh like ${match}
      or c.code like ${match} or c.name like ${match} or w.reason like ${match}` : sql.empty()}`;
  const [{ total }] = await db.all<{ total: number }>(sql`select count(*) as total ${source}`);
  const page = pageNumber(query, total);
  const rows = await db.all<TuitionWaiver>(sql`
    select w.id, w.month, w.amount, w.reason, w.recorded_by as recordedBy, w.recorded_at as recordedAt,
      s.registration_number as studentNumber, trim(s.name_id || ' ' || s.name_zh) as studentName,
      c.code as classCode, c.name as className
    ${source} order by w.id desc limit ${transactionPageSize} offset ${(page - 1) * transactionPageSize}
  `);
  return { rows, total, page };
}

function pageNumber(query: URLSearchParams, total: number) {
  const requested = Math.max(1, Math.trunc(Number(query.get('page'))) || 1);
  return Math.min(requested, Math.max(1, Math.ceil(total / transactionPageSize)));
}
