/**
 * 通知發送器：App 推播（FCM）+ Email
 *
 *  - 推播：讀取 staff/{uid}.fcmTokens[] 或 students/{id}.fcmTokens[]，
 *          以 sendEachForMulticast 發送；失效 token 自動清除。
 *  - Email：寫入 `mail` 集合，由 Firebase「Trigger Email from Firestore」
 *          擴充套件實際寄送（不需自建 SMTP 憑證於程式碼中）。
 *  - 每則通知皆落地 `notifications` 集合，供生教組查核「是否已通知導師」。
 */
import type { Firestore } from 'firebase-admin/firestore';
import { messaging } from '../lib/firebase.js';
import { COLLECTIONS, col } from '../data/collections.js';
import { renderTemplate, type NotificationContext } from './templates.js';
import type { IsoTimestamp } from '../domain/types.js';

export type Audience = 'HOMEROOM_TEACHER' | 'DISCIPLINE_OFFICE' | 'STUDENT' | 'GUARDIAN';

export interface Recipient {
  /** staff uid 或 student docId */
  id: string;
  kind: 'STAFF' | 'STUDENT';
  name?: string;
  email?: string;
}

export interface NotifyRequest {
  templateCode: string;
  audience: Audience;
  recipients: Recipient[];
  context: NotificationContext;
  relatedRef?: { kind: string; id: string };
  now: IsoTimestamp;
  channels?: { push: boolean; email: boolean };
}

export async function notify(firestore: Firestore, request: NotifyRequest): Promise<void> {
  const { push = true, email = true } = request.channels ?? {};
  const rendered = renderTemplate(request.templateCode, request.context);

  await Promise.all(
    request.recipients.map(async (recipient) => {
      // 1) 通知紀錄（不論管道成功與否皆留存，供稽核）
      const logRef = col(firestore, COLLECTIONS.notifications).doc();
      await logRef.set({
        recipientId: recipient.id,
        recipientKind: recipient.kind,
        audience: request.audience,
        templateCode: request.templateCode,
        title: rendered.title,
        body: rendered.body,
        context: request.context,
        relatedRef: request.relatedRef ?? null,
        channels: { push, email: email && Boolean(recipient.email) },
        status: 'PENDING',
        createdAt: request.now,
      });

      const results: Record<string, unknown> = {};

      // 2) App 推播
      if (push) {
        try {
          results.push = await sendPush(firestore, recipient, rendered.title, rendered.body, {
            templateCode: request.templateCode,
            relatedKind: request.relatedRef?.kind ?? '',
            relatedId: request.relatedRef?.id ?? '',
          });
        } catch (error) {
          results.pushError = String(error);
        }
      }

      // 3) Email（交由 Trigger Email 擴充套件寄送）
      if (email && recipient.email) {
        try {
          await col(firestore, COLLECTIONS.mail).add({
            to: recipient.email,
            message: { subject: rendered.emailSubject, html: rendered.emailHtml },
            createdAt: request.now,
          });
          results.email = 'QUEUED';
        } catch (error) {
          results.emailError = String(error);
        }
      }

      await logRef.update({
        status: results.pushError || results.emailError ? 'PARTIAL' : 'SENT',
        results,
        sentAt: request.now,
      });
    }),
  );
}

async function sendPush(
  firestore: Firestore,
  recipient: Recipient,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<string> {
  const collection = recipient.kind === 'STAFF' ? COLLECTIONS.staff : COLLECTIONS.students;
  const snap = await col(firestore, collection).doc(recipient.id).get();
  const tokens = (snap.get('fcmTokens') as string[] | undefined) ?? [];
  if (tokens.length === 0) return 'NO_TOKEN';

  const response = await messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    data,
    android: { priority: 'high' },
    apns: { payload: { aps: { sound: 'default' } } },
  });

  // 清除失效 token，避免配額浪費
  const invalid = response.responses
    .map((r, index) => (r.success ? null : tokens[index]))
    .filter((token): token is string => Boolean(token));
  if (invalid.length > 0) {
    const remaining = tokens.filter((token) => !invalid.includes(token));
    await snap.ref.update({ fcmTokens: remaining });
  }

  return `${response.successCount}/${tokens.length}`;
}

/** 解析通知對象：導師（由班級取得）、生教組（roles 含 DISCIPLINE_STAFF）、學生本人、家長 */
export async function resolveRecipients(
  firestore: Firestore,
  audience: Audience,
  params: { classId?: string; studentId?: string },
): Promise<Recipient[]> {
  if (audience === 'HOMEROOM_TEACHER') {
    if (!params.classId) return [];
    const classSnap = await col(firestore, COLLECTIONS.classes).doc(params.classId).get();
    const uid = classSnap.get('homeroomTeacherUid') as string | undefined;
    if (!uid) return [];
    const staffSnap = await col(firestore, COLLECTIONS.staff).doc(uid).get();
    return [
      {
        id: uid,
        kind: 'STAFF',
        name: (staffSnap.get('name') as string) ?? '',
        email: staffSnap.get('email') as string | undefined,
      },
    ];
  }

  if (audience === 'DISCIPLINE_OFFICE') {
    const snap = await col(firestore, COLLECTIONS.staff)
      .where('roles', 'array-contains', 'DISCIPLINE_STAFF')
      .where('active', '==', true)
      .get();
    return snap.docs.map((doc) => ({
      id: doc.id,
      kind: 'STAFF' as const,
      name: doc.get('name') as string,
      email: doc.get('email') as string | undefined,
    }));
  }

  if (!params.studentId) return [];
  const studentSnap = await col(firestore, COLLECTIONS.students).doc(params.studentId).get();
  if (!studentSnap.exists) return [];
  return [
    {
      id: studentSnap.id,
      kind: 'STUDENT',
      name: studentSnap.get('name') as string,
      email:
        audience === 'GUARDIAN'
          ? (studentSnap.get('guardianEmail') as string | undefined)
          : (studentSnap.get('email') as string | undefined),
    },
  ];
}
