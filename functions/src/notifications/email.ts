/**
 * 導師 Email 通知（選用，預設關閉）
 *
 * 單人操作的系統不需要多角色推播；但原始規格要求「通知該班導師」，
 * 因此保留一條最小路徑：若 `settings.emailHomeroom = true` 且該班
 * `classes/{id}.homeroomEmail` 有值，就把信件寫入 `mail` 集合，
 * 由 Firebase「Trigger Email from Firestore」擴充套件實際寄出
 * （SMTP 憑證由擴充套件保管，不落地於程式碼）。
 */
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, col } from '../data/collections.js';
import type { StudentRecord } from '../data/repositories.js';

export interface HomeroomEmailInput {
  to: string;
  student: StudentRecord;
  typeName: string;
  paperCardLabel: string;
  locationName: string;
  occurredAt: string;
  periodNo: number;
  recidivismCount: number;
  threshold: number;
  now: string;
}

export async function queueHomeroomEmail(
  firestore: Firestore,
  input: HomeroomEmailInput,
): Promise<void> {
  const when = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(input.occurredAt));

  const lines = [
    '導師您好：',
    `貴班學生 <strong>${input.student.name}</strong>（學號 ${input.student.studentNo}）於 ${when}` +
      `${input.periodNo ? `、第 ${input.periodNo} 節下課` : ''}在 <strong>${input.locationName}</strong>` +
      ` 發生「<strong>${input.typeName}</strong>」情形，已由生活教育組登錄。`,
    `該生當日自由下課暫停，待完成並繳回<strong>${input.paperCardLabel}</strong>後，當日即解除。` +
      `反思期間學生可正常飲水與如廁。`,
    input.recidivismCount >= input.threshold
      ? `⚠️ 該生 15 天內已累計 <strong>${input.recidivismCount}</strong> 次，已達再犯門檻，` +
        `將安排擔任安全觀察員，屆時另行通知。`
      : `該生 15 天內累計 <strong>${input.recidivismCount}</strong> 次（門檻 ${input.threshold} 次）。`,
    '若該時段為班級活動優先安排，請與生活教育組聯繫，可登記免記。',
  ];

  await col(firestore, COLLECTIONS.mail).add({
    to: input.to,
    message: {
      subject: `[C.A.R.E.] 違規通報：${input.student.className} ${input.student.name}（${input.typeName}）`,
      html: [
        '<div style="font-family:system-ui,-apple-system,\'Noto Sans TC\',sans-serif;line-height:1.7;color:#1f2933">',
        ...lines.map((line) => `<p style="margin:0 0 10px">${line}</p>`),
        '<hr style="border:none;border-top:1px solid #e4e7eb;margin:16px 0">',
        '<p style="margin:0;font-size:12px;color:#7b8794">C.A.R.E. System（本信件由系統自動發送）</p>',
        '</div>',
      ].join(''),
    },
    createdAt: input.now,
  });
}
