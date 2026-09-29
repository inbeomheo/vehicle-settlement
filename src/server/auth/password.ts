import { AppError } from '../errors';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
export const passwordWithinByteLimit = (password: string) => Buffer.byteLength(password, 'utf8') <= 72;
function assertPasswordLength(password: string) {
  if (!passwordWithinByteLimit(password)) throw new AppError('VALIDATION_FAILED', '비밀번호가 너무 깁니다');
}
export async function hashPassword(password: string) {
  assertPasswordLength(password);
  if (password.length < 8) throw new AppError('VALIDATION_FAILED', '비밀번호는 8자 이상 입력하세요.');
  return bcrypt.hash(password, 12);
}
export async function verifyPassword(password: string, hash: string) {
  assertPasswordLength(password);
  return bcrypt.compare(password, hash);
}
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
