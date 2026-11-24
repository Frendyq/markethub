const SYMBOL: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', KZT: '₸' };

/** "1283.99", "EUR" -> "€1,283.99". Money stays a string until it is displayed. */
export function money(amount: string | null, currency: string | null = 'EUR'): string {
  if (amount === null) {
    return '—';
  }
  const [whole, fraction = '00'] = amount.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${SYMBOL[currency ?? ''] ?? `${currency} `}${grouped}.${fraction.padEnd(2, '0')}`;
}

export function dateTime(value: string | null): string {
  if (!value) {
    return '—';
  }
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const MARKETPLACE_NAMES: Record<string, string> = {
  amazon: 'Amazon',
  ebay: 'eBay',
  otto: 'OTTO',
  kaufland: 'Kaufland',
};

export function marketplaceName(code: string | null): string {
  return code ? (MARKETPLACE_NAMES[code] ?? code) : '—';
}
