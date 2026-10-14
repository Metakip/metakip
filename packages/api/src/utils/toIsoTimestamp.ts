export function toIsoTimestamp(value: Date | string): string;
export function toIsoTimestamp(value: Date | string | null): string | null;
export function toIsoTimestamp(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
