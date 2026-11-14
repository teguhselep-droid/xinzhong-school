export const canAccessAccounting = (role: string) => role === 'accounting' || role === 'supervisor';
export const ledgerPageSize = 10;
export const maxTransactionAmount = 999_999_999_999;
export const accountingTitle = 'Akuntansi / 会计';

export type AccountingAccount = {
  id: string;
  name: string;
  kind: 'bank' | 'income' | 'expense';
  balance: string;
};

export type LedgerRow = {
  id: number;
  transactionDate: string;
  recordedAt: string;
  recordedBy: string;
  notes: string;
  amount: string;
  balance: string;
};

export type LedgerPage = { rows: LedgerRow[]; total: number; page: number };

export type MonthlyAccountingReport = {
  endDate: string;
  income: AccountingAccount[];
  expenses: AccountingAccount[];
  banks: AccountingAccount[];
  totalIncome: string;
  totalExpenses: string;
  net: string;
  totalBankBalance: string;
};

const translations: Record<string, string> = {
  'tuition-income': 'Pendapatan kursus / 学费收入',
  'other-income': 'Pendapatan lain / 其他收入',
  'payroll-expenses': 'Beban gaji / 工资费用',
  'purchase-expenses': 'Beban pembelian / 采购费用',
  'office-expenses': 'Beban kantor / 办公费用',
  'other-expenses': 'Beban lain / 其他费用',
};

export function accountLabel(account: AccountingAccount) {
  return translations[account.id] ?? account.name;
}
