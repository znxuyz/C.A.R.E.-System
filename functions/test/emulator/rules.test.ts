/**
 * Firestore 安全規則測試（單人操作版）
 *
 * 重點驗證兩件事：
 *  ① 未登入者只能讀到 publicBoard/today（去識別化摘要），其餘一律拒絕
 *  ② 即使是生教組長本人，也不能從前端直接寫入任何業務集合
 *
 * 執行：npm run test:rules --workspace functions
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

const STAFF = { roles: ['DISCIPLINE_STAFF'], name: '王淑芬' };
const ADMIN = { roles: ['ADMIN'], name: '資訊組' };
const OUTSIDER = { roles: [], name: '其他老師' };

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
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'publicBoard/today'), {
      date: '2026-09-18',
      stats: { restrictedCount: 3, openAlerts: 1 },
      trend: [],
      hotspots: [],
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
      occurredOn: '2026-09-18',
      countsTowardRecidivism: true,
      consumedByAlertId: null,
    });
    await setDoc(doc(db, 'recessRestrictions/stu_701_01_2026-09-18'), {
      studentId: 'stu_701_01',
      date: '2026-09-18',
      status: 'ACTIVE',
    });
    await setDoc(doc(db, 'recidivismAlerts/alert_1'), { studentId: 'stu_701_01', status: 'OPEN' });
    await setDoc(doc(db, 'observerAssignments/asg_1'), {
      studentId: 'stu_701_01',
      dutyOn: '2026-09-19',
      status: 'SCHEDULED',
    });
    await setDoc(doc(db, 'settings/system'), { recidivismThreshold: 3 });
    await setDoc(doc(db, 'mail/mail_1'), { to: 'a@b.c' });
    await setDoc(doc(db, 'auditLogs/log_1'), { action: 'X' });
  });
});

const as = (uid: string, claims: object) =>
  testEnv.authenticatedContext(uid, claims as never).firestore();

describe('未登入者（公開看板的觀眾）', () => {
  it('可讀取去識別化的公開看板', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, 'publicBoard/today')));
  });

  it('不可讀取任何業務資料（學生、違規、管制、警示）', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'students/stu_701_01')));
    await assertFails(getDoc(doc(db, 'infractions/inf_1')));
    await assertFails(getDoc(doc(db, 'recessRestrictions/stu_701_01_2026-09-18')));
    await assertFails(getDoc(doc(db, 'recidivismAlerts/alert_1')));
    await assertFails(getDoc(doc(db, 'settings/system')));
  });

  it('不可竄改公開看板', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(updateDoc(doc(db, 'publicBoard/today'), { stats: { restrictedCount: 0 } }));
  });
});

describe('已登入但無角色（其他老師誤入）', () => {
  it('讀不到任何業務資料', async () => {
    const db = as('uid_other', OUTSIDER);
    await assertFails(getDoc(doc(db, 'infractions/inf_1')));
    await assertFails(getDoc(doc(db, 'students/stu_701_01')));
  });

  it('仍可看公開看板', async () => {
    const db = as('uid_other', OUTSIDER);
    await assertSucceeds(getDoc(doc(db, 'publicBoard/today')));
  });
});

describe('生活教育組長', () => {
  it('可讀取全部業務資料', async () => {
    const db = as('uid_office', STAFF);
    await assertSucceeds(getDoc(doc(db, 'students/stu_701_01')));
    await assertSucceeds(getDoc(doc(db, 'infractions/inf_1')));
    await assertSucceeds(getDoc(doc(db, 'recessRestrictions/stu_701_01_2026-09-18')));
    await assertSucceeds(getDoc(doc(db, 'recidivismAlerts/alert_1')));
    await assertSucceeds(getDoc(doc(db, 'observerAssignments/asg_1')));
    await assertSucceeds(getDoc(doc(db, 'settings/system')));
  });

  it('不可從前端直接寫入業務集合（必須經 Cloud Functions）', async () => {
    const db = as('uid_office', STAFF);
    await assertFails(setDoc(doc(db, 'infractions/inf_new'), { studentId: 'stu_701_01' }));
    await assertFails(updateDoc(doc(db, 'infractions/inf_1'), { status: 'DONE' }));
    await assertFails(
      updateDoc(doc(db, 'infractions/inf_1'), { consumedByAlertId: null, countsTowardRecidivism: false }),
    );
    await assertFails(
      updateDoc(doc(db, 'recessRestrictions/stu_701_01_2026-09-18'), { status: 'LIFTED' }),
    );
    await assertFails(updateDoc(doc(db, 'recidivismAlerts/alert_1'), { status: 'DISMISSED' }));
    await assertFails(updateDoc(doc(db, 'settings/system'), { recidivismThreshold: 99 }));
  });

  it('不可讀寄信佇列，也不可讀稽核軌跡', async () => {
    const db = as('uid_office', STAFF);
    await assertFails(getDoc(doc(db, 'mail/mail_1')));
    await assertFails(getDoc(doc(db, 'auditLogs/log_1')));
  });
});

describe('系統管理者', () => {
  it('可讀稽核軌跡，但同樣不可直接寫入', async () => {
    const db = as('uid_admin', ADMIN);
    await assertSucceeds(getDoc(doc(db, 'auditLogs/log_1')));
    await assertFails(setDoc(doc(db, 'auditLogs/log_new'), { action: 'Y' }));
    await assertFails(updateDoc(doc(db, 'settings/system'), { recidivismThreshold: 1 }));
  });
});
