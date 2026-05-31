export const KHR_PER_USD = 4100;

export const formatUsd = (usd: number): string => `$${usd.toFixed(2)}`;

export const formatKhr = (usd: number): string => {
  const khr = Math.round(usd * KHR_PER_USD);
  return `${khr.toLocaleString('en-US')} ៛`;
};

export const formatDualCurrency = (usd: number): string => {
  const safe = Number.isFinite(usd) ? usd : 0;
  return `${formatUsd(safe)}  (${formatKhr(safe)})`;
};
