export const KH_PREFIX = '+855';

export const sanitizeKhDigits = (raw: string): string => {
  const digits = (raw || '').replace(/\D/g, '');
  return digits.startsWith('0') ? digits.slice(1) : digits;
};

export const formatKhMask = (digits: string): string => {
  const d = sanitizeKhDigits(digits);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)} ${d.slice(2)}`;
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 12)}`;
};

export const composeKhPhone = (digits: string): string => {
  const d = sanitizeKhDigits(digits);
  return d ? `${KH_PREFIX}${d}` : '';
};

export const isValidKhPhone = (digits: string): boolean => {
  const d = sanitizeKhDigits(digits);
  return d.length >= 8 && d.length <= 9;
};
