/**
 * 電子簽章雜湊
 *
 * 紙本簽章數位化後，須留存可驗證的憑據：
 * 以「案件 ID + 關卡 + 簽核者 uid + 伺服器時戳 + 決定」計算 SHA-256，
 * 任一欄位事後被改動皆可由雜湊比對發現。
 */
import { createHash } from 'node:crypto';

export function signatureHash(input: {
  documentId: string;
  stage: string;
  actorUid: string;
  decision: string;
  actedAt: string;
}): string {
  return createHash('sha256')
    .update(
      [input.documentId, input.stage, input.actorUid, input.decision, input.actedAt].join('|'),
      'utf8',
    )
    .digest('hex');
}

export function verifySignature(hash: string, input: Parameters<typeof signatureHash>[0]): boolean {
  return signatureHash(input) === hash;
}
