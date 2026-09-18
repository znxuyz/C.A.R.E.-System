/**
 * Firestore 安全規則測試
 *
 * 規則是本架構最主要的防線（業務寫入一律禁止、讀取依角色縮限），
 * 因此以模擬器實際驗證，而非只靠人工審閱。
 *
 * 執行：npm run test:rules --workspace functions
 *      （等同 firebase emulators:exec --only firestore "vitest run --config vitest.emulator.config.ts"）
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let testEnv: RulesTestEnvironment;

const OFFICE = { roles: ['DISCIPLINE_STAFF'], name: '王淑芬' };
const TEACHER_701 = { roles: ['HOMEROOM_TEACHER'], name: '陳怡君' };
const TEACHER_702 = { roles: ['HOMEROOM_TEACHER'], name: '林志偉' };
const PATROL = { roles: ['PATROL'], name: '張家豪' };
const STUDENT_A = { roles: ['STUDENT'], studentId: 'stu_701_01', name: '王小明' };
const STUDENT_B = { roles: ['STUDENT'], studentId: 'stu_701_02', name: '李小華' };

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-care-rules',
    firestore: {
      rules: readFileSync(resolve(process.cwd(), '../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // 以 Admin 權限（繞過規則）建立基礎資料
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'classes/cls_701'), {
      name: '七年一班',
      homeroomTeacherUid: 'uid_teacher_701',
    });
    await setDoc(doc(db, 'classes/cls_702'), {
      name: '七年二班',
      homeroomTeacherUid: 'uid_teacher_702',
    });
    await setDoc(doc(db, 'students/stu_701_01'), {
      studentNo: '1140101',
      name: '王小明',
      classId: 'cls_701',
      className: '七年一班',
    });
    await setDoc(doc(db, 'infractions/inf_1'), {
      studentId: 'stu_701_01',
      classId: 'cls_701',
      status: 'OPEN',
    });
    await setDoc(doc(db, 'reflectionCards/card_1'), {
      studentId: 'stu_701_01',
      classId: 'cls_701',
      status: 'DRAFT',
      countOn: '2026-09-18',
      countsTowardRecidivism: true,
      consumedByAlertId: null,
      answers: {},
    });
    await setDoc(doc(db, 'reflectionCards/card_signed'), {
      studentId: 'stu_701_01',
      classId: 'cls_701',
      status: 'PENDING_OFFICE',
      answers: { what_happened: '已送出' },
    });
    await setDoc(doc(db, 'recessRestrictions/stu_701_01_2026-09-18'), {
      studentId: 'stu_701_01',
      date: '2026-09-18',
      status: 'ACTIVE',
    });
    await setDoc(doc(db, 'recidivismAlerts/alert_1'), {
      studentId: 'stu_701_01',
      classId: 'cls_701',
      status: 'OPEN',
    });
    await setDoc(doc(db, 'mail/mail_1'), { to: 'a@b.c' });
    await setDoc(doc(db, 'auditLogs/log_1'), { action: 'X' });
    await setDoc(doc(db, 'settings/system'), { recidivismThreshold: 3 });
  });
});

const as = (uid: string, claims: object) =>
  testEnv.authenticatedContext(uid, claims as never).firestore();

describe('未登入者', () => {
  it('不可讀取任何業務資料', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'students/stu_701_01')));
    await assertFails(getDoc(doc(db, 'reflectionCards/card_1')));
    await assertFails(getDoc(doc(db, 'settings/system')));
  });
});

describe('生教組', () => {
  it('可讀取全校違規、反思卡、管制與警示', async () => {
    const db = as('uid_office_01', OFFICE);
    await assertSucceeds(getDoc(doc(db, 'infractions/inf_1')));
    await assertSucceeds(getDoc(doc(db, 'reflectionCards/card_1')));
    await assertSucceeds(getDoc(doc(db, 'recessRestrictions/stu_701_01_2026-09-18')));
    await assertSucceeds(getDoc(doc(db, 'recidivismAlerts/alert_1')));
  });

  it('仍不可直接寫入業務集合（必須經 Cloud Functions）', async () => {
    const db = as('uid_office_01', OFFICE);
    await assertFails(updateDoc(doc(db, 'reflectionCards/card_signed'), { status: 'COMPLETED' }));
    await assertFails(setDoc(doc(db, 'infractions/inf_new'), { studentId: 'stu_701_01' }));
    await assertFails(
      updateDoc(doc(db, 'recessRestrictions/stu_701_01_2026-09-18'), { status: 'LIFTED' }),
    );
  });
});

describe('班導師', () => {
  it('可讀本班案件', async () => {
    const db = as('uid_teacher_701', TEACHER_701);
    await assertSucceeds(getDoc(doc(db, 'reflectionCards/card_1')));
    await assertSucceeds(getDoc(doc(db, 'infractions/inf_1')));
  });

  it('不可讀他班案件', async () => {
    const db = as('uid_teacher_702', TEACHER_702);
    await assertFails(getDoc(doc(db, 'reflectionCards/card_1')));
    await assertFails(getDoc(doc(db, 'infractions/inf_1')));
    await assertFails(getDoc(doc(db, 'recidivismAlerts/alert_1')));
  });

  it('不可自行簽章（改狀態）', async () => {
    const db = as('uid_teacher_701', TEACHER_701);
    await assertFails(updateDoc(doc(db, 'reflectionCards/card_1'), { status: 'PENDING_OFFICE' }));
  });
});

describe('糾察隊', () => {
  it('不可讀取學生歷程，也不可自行建立違規文件', async () => {
    const db = as('uid_patrol_01', PATROL);
    await assertFails(getDoc(doc(db, 'reflectionCards/card_1')));
    await assertFails(setDoc(doc(db, 'infractions/inf_new'), { studentId: 'stu_701_01' }));
  });
});

describe('學生', () => {
  it('可讀自己的卡片與管制狀態', async () => {
    const db = as('uid_stu_a', STUDENT_A);
    await assertSucceeds(getDoc(doc(db, 'reflectionCards/card_1')));
    await assertSucceeds(getDoc(doc(db, 'recessRestrictions/stu_701_01_2026-09-18')));
    await assertSucceeds(getDoc(doc(db, 'students/stu_701_01')));
  });

  it('不可讀他人的卡片', async () => {
    const db = as('uid_stu_b', STUDENT_B);
    await assertFails(getDoc(doc(db, 'reflectionCards/card_1')));
    await assertFails(getDoc(doc(db, 'students/stu_701_01')));
  });

  it('可暫存自己 DRAFT 卡片的 answers', async () => {
    const db = as('uid_stu_a', STUDENT_A);
    await assertSucceeds(
      updateDoc(doc(db, 'reflectionCards/card_1'), {
        answers: { what_happened: '第二節下課我在走廊奔跑' },
        updatedAt: '2026-09-18T03:00:00.000Z',
      }),
    );
  });

  it('不可藉暫存夾帶狀態或累犯欄位', async () => {
    const db = as('uid_stu_a', STUDENT_A);
    await assertFails(
      updateDoc(doc(db, 'reflectionCards/card_1'), { answers: {}, status: 'COMPLETED' }),
    );
    await assertFails(
      updateDoc(doc(db, 'reflectionCards/card_1'), { answers: {}, countsTowardRecidivism: false }),
    );
    await assertFails(
      updateDoc(doc(db, 'reflectionCards/card_1'), { answers: {}, consumedByAlertId: 'x' }),
    );
  });

  it('已送出（PENDING_OFFICE）後不可再改作答', async () => {
    const db = as('uid_stu_a', STUDENT_A);
    await assertFails(
      updateDoc(doc(db, 'reflectionCards/card_signed'), { answers: { what_happened: '改了' } }),
    );
  });

  it('不可修改他人卡片', async () => {
    const db = as('uid_stu_b', STUDENT_B);
    await assertFails(updateDoc(doc(db, 'reflectionCards/card_1'), { answers: {} }));
  });

  it('不可自行解除下課管制', async () => {
    const db = as('uid_stu_a', STUDENT_A);
    await assertFails(
      updateDoc(doc(db, 'recessRestrictions/stu_701_01_2026-09-18'), { status: 'LIFTED' }),
    );
  });
});

describe('敏感集合', () => {
  it('寄信佇列與稽核軌跡對一般角色完全關閉', async () => {
    const office = as('uid_office_01', OFFICE);
    await assertFails(getDoc(doc(office, 'mail/mail_1')));
    await assertFails(getDoc(doc(office, 'auditLogs/log_1')));

    const student = as('uid_stu_a', STUDENT_A);
    await assertFails(getDoc(doc(student, 'mail/mail_1')));
  });

  it('系統設定可讀但不可寫', async () => {
    const db = as('uid_office_01', OFFICE);
    await assertSucceeds(getDoc(doc(db, 'settings/system')));
    await assertFails(updateDoc(doc(db, 'settings/system'), { recidivismThreshold: 99 }));
  });
});
