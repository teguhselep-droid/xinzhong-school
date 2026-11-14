"use client";

import { useEffect, useState } from 'react';

export const transactionEndpoint = '/api/transactions';
export async function transactionRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Terjadi kesalahan / 发生错误');
  return body;
}

export function useTransactionData<T>(params: Record<string, string> | null, reload = 0) {
  const query = params ? new URLSearchParams(params).toString() : '';
  const [result, setResult] = useState<{ query: string; reload: number; data: T | null; error: string }>();
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      transactionRequest<T>(transactionEndpoint + '?' + query, { signal: controller.signal })
        .then(data => { if (!controller.signal.aborted) setResult({ query, reload, data, error: '' }); })
        .catch(error => { if (!controller.signal.aborted) setResult({ query, reload, data: null, error: error.message }); });
    }, 120);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, reload]);
  return result?.query === query && result.reload === reload
    ? { ...result, loading: false } : { data: null, error: '', loading: !!query };
}

const money = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const day = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' });
const timestamp = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
export const paymentMoney = (amount: number) => money.format(amount);
export const paymentDay = (value: string) => day.format(new Date(value + 'T00:00:00+07:00'));
export const paymentTime = (value: string) => timestamp.format(new Date(value));
