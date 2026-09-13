import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export const hashBytes = (bytes) => bytesToHex(sha256(bytes));
export const canonical = (value) => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
};
export const digest = (value) =>
  hashBytes(new TextEncoder().encode(canonical(value)));
