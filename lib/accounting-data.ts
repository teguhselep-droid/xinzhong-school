import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { ledgerPageSize, type AccountingAccount, type LedgerPage, type LedgerRow, type MonthlyAccountingReport } from '@/lib/accounting-fields';

type DB = ReturnType<typeof getDb>;

export function chartOfAccounts(db: DB) {
  return db.all<AccountingAccount>(sql`
    select a.id, a.name, a.kind, cast(
      (case when a.kind = 'income' then -1 else 1 end) * (
        coalesce((select sum(amount) from accounting_entries where debit_account_id = a.id), 0) -
        coalesce((select sum(amount) from accounting_entries where credit_account_id = a.id), 0)
      ) as text
    ) as balance
    from accounting_accounts a order by a.rowid
  `);
}

export async function monthlyAccountingReport(db: DB, month: string): Promise<MonthlyAccountingReport> {
  const start = month + '-01';
  const [year, monthNumber] = month.split('-').map(Number);
  const endDate = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  const rows = await db.all<AccountingAccount>(sql`
    with movements as (
      select debit_account_id as account_id, transaction_date, amount as movement
      from accounting_entries where transaction_date <= ${endDate}
      union all
      select credit_account_id as account_id, transaction_date, -amount as movement
      from accounting_entries where transaction_date <= ${endDate}
    ), totals as (
      select account_id, sum(movement) as ending_balance,
        sum(case when transaction_date >= ${start} then movement else 0 end) as monthly_movement
      from movements group by account_id
    )
    select a.id, a.name, a.kind, cast(case a.kind
      when 'bank' then coalesce(t.ending_balance, 0)
      when 'income' then -coalesce(t.monthly_movement, 0)
      else coalesce(t.monthly_movement, 0)
    end as text) as balance
    from accounting_accounts a left join totals t on t.account_id = a.id
    order by a.rowid
  `);
  const income = rows.filter(account => account.kind === 'income');
  const expenses = rows.filter(account => account.kind === 'expense');
  const banks = rows.filter(account => account.kind === 'bank');
  const sum = (accounts: AccountingAccount[]) => accounts.reduce((total, account) => total + BigInt(account.balance), BigInt(0));
  const incomeTotal = sum(income), expenseTotal = sum(expenses);
  return {
    endDate, income, expenses, banks,
    totalIncome: String(incomeTotal),
    totalExpenses: String(expenseTotal),
    net: String(incomeTotal - expenseTotal),
    totalBankBalance: String(sum(banks)),
  };
}

export async function accountLedger(db: DB, account: { id: string; kind: AccountingAccount['kind'] },
  from: string | undefined, to: string | undefined, requestedPage: number): Promise<LedgerPage> {
  const debit = account.kind === 'income' ? sql`-amount` : sql`amount`;
  const credit = account.kind === 'income' ? sql`amount` : sql`-amount`;
  const entries = sql`
    select id, transaction_date, recorded_at, recorded_by, notes, ${debit} as movement
    from accounting_entries where debit_account_id = ${account.id}
    union all
    select id, transaction_date, recorded_at, recorded_by, notes, ${credit} as movement
    from accounting_entries where credit_account_id = ${account.id}
  `;
  const filter = sql`where 1 = 1
    ${from ? sql`and transaction_date >= ${from}` : sql.empty()}
    ${to ? sql`and transaction_date <= ${to}` : sql.empty()}`;
  const [{ total }] = await db.all<{ total: number }>(sql`select count(*) as total from (${entries}) ${filter}`);
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / ledgerPageSize)));
  // Keep earlier entries inside the window, even if the visible ledger starts later.
  const rows = await db.all<LedgerRow>(sql`
    with movements as (${entries}), running as (
      select *, sum(movement) over (
        order by transaction_date, id rows between unbounded preceding and current row
      ) as balance
      from movements
    )
    select id, transaction_date as transactionDate, recorded_at as recordedAt, recorded_by as recordedBy,
      notes, cast(movement as text) as amount, cast(balance as text) as balance
    from running ${filter}
    order by transaction_date desc, id desc
    limit ${ledgerPageSize} offset ${(page - 1) * ledgerPageSize}
  `);
  return { rows, total, page };
}
