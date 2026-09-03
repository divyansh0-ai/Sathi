const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function newId(prefix: string): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `${prefix}_${s}`;
}

export const nowISO = () => new Date().toISOString();
