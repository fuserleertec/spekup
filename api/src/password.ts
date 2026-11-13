import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

function scrypt(password: string, salt: Buffer, keylen: number, options: { cost: number; blockSize: number; parallelization: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived as Buffer);
    });
  });
}

const COST = 16384;
const BLOCK = 8;
const PARALLEL = 1;
const KEYLEN = 32;

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, {
    cost: COST,
    blockSize: BLOCK,
    parallelization: PARALLEL,
  });
  return `scrypt$${COST}$${BLOCK}$${PARALLEL}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelization = Number(parts[3]);
  if (![cost, blockSize, parallelization].every((n) => Number.isInteger(n) && n > 0)) return false;
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (salt.length < 8 || expected.length < 16) return false;
  const actual = await scrypt(password, salt, expected.length, {
    cost,
    blockSize,
    parallelization,
  });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
