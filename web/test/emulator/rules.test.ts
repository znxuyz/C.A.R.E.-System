/**
 * Firestore 安全規則測試
 *
 * 本系統不使用 Cloud Functions，所有寫入都來自前端，
 * 因此**安全規則是唯一防線**：除了權限判定，也負責驗證資料形狀、
 * 時間戳是否由伺服器決定、以及使用者能否自行提權。
 *
 * 執行：npm run test:rules
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, serverTimestamp, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let testEnv: RulesTestEnvironment;

const ADMIN_UID = 'uid_admin';
const STAFF_UID = 'uid_staff';
const STRANGER_UID = 'uid_stranger';
const GRANTED_UID = 'uid_granted';

const ADMIN_EMAIL = 'admin@example.edu.tw';
const STAFF_EMAIL = 'discipline@example.edu.tw';
const STRANGER_EMAIL = 'stranger@example.edu.tw';
const GRANTED_EMAIL = 'newstaff@example.edu.tw';

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
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    // 既有使用者
    await setDoc(doc(db, 'staff', ADMIN_UID), {
      uid: ADMIN_UID, email: ADMIN_EMAIL, name: '資訊組', roles: ['ADMIN', 'DISCIPLINE_STAFF'], active: true,
    });
    await setDoc(doc(db, 'staff', STAFF_UID), {
      uid: STAFF_UID, email: STAFF_EMAIL, name: '王淑芬', roles: ['DISCIPLINE_STAFF'], active: true,
    });
    await setDoc(doc(db, 'accessGrants', ADMIN_EMAIL), {
      email: ADMIN_EMAIL, roles: ['ADMIN', 'DISCIPLINE_STAFF'], active: true,
    });
    await setDoc(doc(db, 'accessGrants', STAFF_EMAIL), {
      email: STAFF_EMAIL, roles: ['DISCIPLINE_STAFF'], active: true,
    });
    // 已預先授權、但尚未登入過的人
    await setDoc(doc(db, 'accessGrants', GRANTED_EMAIL), {
      email: GRANTED_EMAIL, roles: ['DISCIPLINE_STAFF'], active: true,
    });

    await setDoc(doc(db, 'publicBoard', 'today'), { date: '2026-09-21', stats: { restrictedCount: 1 } });
    await setDoc(doc(db, 'settings', 'system'), {
      recidivismWindowDays: 15, recidivismThreshold: 3, observerPeriods: 5,
    });
    await setDoc(doc(db, 'students', 'stu_1'), {
      studentNo: '1140101', name: '王小明', classId: 'cls_701', className: '七年一班', seatNo: 1,
      recidivismWindow: [],
    });
    await setDoc(doc(db, 'infractions', 'inf_1'), {
      studentId: 'stu_1', studentNo: '1140101', studentName: '王小明', classId: 'cls_701',
      typeCode: 'RUN_IN_CORRIDOR', occurredOn: '2026-09-21', status: 'OPEN',
      countsTowardRecidivism: true, consumedByAlertId: null,
      recordedBy: { uid: STAFF_UID, name: '王淑芬' },
    });
    await setDoc(doc(db, 'auditLogs', 'log_1'), { actorUid: STAFF_UID, action: 'X' });
  });
});

const as = (uid: string, email: string) =>
  testEnv.authenticatedContext(uid, { email, email_verified: true }).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();

/* ------------------------------------------------------------------ */

describe('公開看板（匿名）', () => {
  it('任何人都可讀取去識別化摘要', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'publicBoard', 'today')));
  });

  it('匿名者讀不到任何業務資料', async () => {
    const db = anon();
    await assertFails(getDoc(doc(db, 'students', 'stu_1')));
    await assertFails(getDoc(doc(db, 'infractions', 'inf_1')));
    await assertFails(getDoc(doc(db, 'settings', 'system')));
    await assertFails(getDoc(doc(db, 'accessGrants', STAFF_EMAIL)));
  });

  it('匿名者不可竄改看板', async () => {
    await assertFails(setDoc(doc(anon(), 'publicBoard', 'today'), { stats: { restrictedCount: 0 } }));
  });
});

describe('登入但未授權者', () => {
  it('讀不到業務資料', async () => {
    const db = as(STRANGER_UID, STRANGER_EMAIL);
    await assertFails(getDoc(doc(db, 'infractions', 'inf_1')));
    await assertFails(getDoc(doc(db, 'students', 'stu_1')));
  });

  it('沒有授權就無法建立自己的 staff 文件（無法自行提權）', async () => {
    const db = as(STRANGER_UID, STRANGER_EMAIL);
    await assertFails(
      setDoc(doc(db, 'staff', STRANGER_UID), {
        uid: STRANGER_UID, email: STRANGER_EMAIL, name: '路人', roles: ['ADMIN'], active: true,
      }),
    );
  });

  it('讀不到別人的授權，也不能列出授權名單', async () => {
    const db = as(STRANGER_UID, STRANGER_EMAIL);
    await assertFails(getDoc(doc(db, 'accessGrants', STAFF_EMAIL)));
    await assertFails(getDocs(collection(db, 'accessGrants')));
  });
});

describe('已被預先授權、首次登入者', () => {
  it('可讀自己那一筆授權', async () => {
    const db = as(GRANTED_UID, GRANTED_EMAIL);
    await assertSucceeds(getDoc(doc(db, 'accessGrants', GRANTED_EMAIL)));
  });

  it('可依授權建立自己的 staff 文件', async () => {
    const db = as(GRANTED_UID, GRANTED_EMAIL);
    await assertSucceeds(
      setDoc(doc(db, 'staff', GRANTED_UID), {
        uid: GRANTED_UID, email: GRANTED_EMAIL, name: '新同仁',
        roles: ['DISCIPLINE_STAFF'], active: true,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }),
    );
  });

  it('不可寫入超出授權的角色（提權防線）', async () => {
    const db = as(GRANTED_UID, GRANTED_EMAIL);
    await assertFails(
      setDoc(doc(db, 'staff', GRANTED_UID), {
        uid: GRANTED_UID, email: GRANTED_EMAIL, name: '新同仁',
        roles: ['ADMIN', 'DISCIPLINE_STAFF'], active: true,
      }),
    );
  });

  it('不可冒用他人 uid 建立 staff 文件', async () => {
    const db = as(GRANTED_UID, GRANTED_EMAIL);
    await assertFails(
      setDoc(doc(db, 'staff', 'uid_someone_else'), {
        uid: 'uid_someone_else', email: GRANTED_EMAIL, roles: ['DISCIPLINE_STAFF'], active: true,
      }),
    );
  });
});

describe('生教組長', () => {
  it('可讀業務資料', async () => {
    const db = as(STAFF_UID, STAFF_EMAIL);
    await assertSucceeds(getDoc(doc(db, 'students', 'stu_1')));
    await assertSucceeds(getDoc(doc(db, 'infractions', 'inf_1')));
    await assertSucceeds(getDoc(doc(db, 'settings', 'system')));
  });

  it('可登錄違規（形狀正確、時間由伺服器決定、登錄者為本人）', async () => {
    const db = as(STAFF_UID, STAFF_EMAIL);
    await assertSucceeds(
      setDoc(doc(db, 'infractions', 'inf_new'), {
        studentId: 'stu_1', studentNo: '1140101', studentName: '王小明',
        classId: 'cls_701', className: '七年一班',
        typeCode: 'RUN_IN_CORRIDOR', typeName: '走廊奔跑', paperCard: 'SAFETY',
        occurredOn: '2026-09-21', occurredAt: '2026-09-21T02:00:00.000Z', periodNo: 2,
        locationCode: 'CORRIDOR_2F', locationName: '二樓走廊',
        recordedBy: { uid: STAFF_UID, name: '王淑芬' },
        status: 'OPEN', countsTowardRecidivism: true, consumedByAlertId: null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }),
    );
  });

  it('期間內第一次只記錄勸導：可直接以 DONE 建立（沒有紙本要回收）', async () => {
    const db = as(STAFF_UID, STAFF_EMAIL);
    const base = {
      studentId: 'stu_1', studentNo: '1140101', studentName: '王小明',
      classId: 'cls_701', className: '七年一班',
      typeCode: 'RUN_IN_CORRIDOR', typeName: '走廊奔跑', paperCard: 'SAFETY',
      occurredOn: '2026-09-21', occurredAt: '2026-09-21T02:00:00.000Z', periodNo: 2,
      locationCode: 'CORRIDOR_2F', locationName: '二樓走廊',
      recordedBy: { uid: STAFF_UID, name: '王淑芬' },
      countsTowardRecidivism: true, consumedByAlertId: null,
    };
    await assertSucceeds(
      setDoc(doc(db, 'infractions', 'inf_advice'), {
        ...base, status: 'DONE', cardIssued: false, paperCardLabel: null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }),
    );
    // 已發卡卻一開始就標記結案 → 拒絕（不得略過回收流程）
    await assertFails(
      setDoc(doc(db, 'infractions', 'inf_skip'), {
        ...base, status: 'DONE', cardIssued: true,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }),
    );
    // 免記／撤銷不可作為建立時的狀態
    await assertFails(
      setDoc(doc(db, 'infractions', 'inf_exempt'), {
        ...base, status: 'EXEMPTED', cardIssued: false,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }),
    );
  });

  it('不可偽造登錄者', async () => {
    const db = as(STAFF_UID, STAFF_EMAIL);
    await assertFails(
      setDoc(doc(db, 'infractions', 'inf_fake'), {
        studentId: 'stu_1', occurredOn: '2026-09-21', status: 'OPEN',
        countsTowardRecidivism: true, consumedByAlertId: null,
        recordedBy: { uid: ADMIN_UID, name: '別人' },
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }),
    );
  });

  it('不可用自訂時間戳（必須是伺服器時間）', async () => {
    const db = as(STAFF_UID, STAFF_EMAIL);
    await assertFails(
      setDoc(doc(db, 'infractions', 'inf_time'), {
        studentId: 'stu_1', occurredOn: '2026-09-21', status: 'OPEN',
        countsTowardRecidivism: true, consumedByAlertId: null,
        recordedBy: { uid: STAFF_UID, name: '王淑芬' },
        createdAt: '2020-01-01T00:00:00.000Z', updatedAt: serverTimestamp(),
      }),
    );
  });

  it('不可竄改違規的學生或發生日（事後無法改寫歷史）', async () => {
    const db = as(STAFF_UID, STAFF_EMAIL);
    await assertFails(updateDoc(doc(db, 'infractions', 'inf_1'), { studentId: 'stu_other', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db, 'infractions', 'inf_1'), { occurredOn: '2026-08-01', updatedAt: serverTimestamp() }));
  });

  it('不可刪除違規（誤報請用撤銷，保留軌跡）', async () => {
    const db = as(STAFF_UID, STAFF_EMAIL);
    await assertFails(deleteDoc(doc(db, 'infractions', 'inf_1')));
  });

  it('學生主檔只能更新再犯視窗快取', async () => {
    const db = as(STAFF_UID, STAFF_EMAIL);
    await assertSucceeds(
      updateDoc(doc(db, 'students', 'stu_1'), {
        recidivismWindow: [{ infractionId: 'inf_1', occurredOn: '2026-09-21' }],
      }),
    );
    await assertFails(updateDoc(doc(db, 'students', 'stu_1'), { name: '改名字' }));
  });

  it('管制帳必須保留「可正常飲水與如廁」', async () => {
    const db = as(STAFF_UID, STAFF_EMAIL);
    await assertFails(
      setDoc(doc(db, 'recessRestrictions', 'stu_1_2026-09-21'), {
        studentId: 'stu_1', date: '2026-09-21', status: 'ACTIVE',
        allowWaterAndRestroom: false, updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      setDoc(doc(db, 'recessRestrictions', 'stu_1_2026-09-21'), {
        studentId: 'stu_1', date: '2026-09-21', status: 'ACTIVE',
        allowWaterAndRestroom: true, updatedAt: serverTimestamp(),
      }),
    );
  });

  it('不可修改系統設定（僅管理者）', async () => {
    const db = as(STAFF_UID, STAFF_EMAIL);
    await assertFails(
      setDoc(doc(db, 'settings', 'system'), {
        recidivismWindowDays: 1, recidivismThreshold: 1, observerPeriods: 1,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('不可自行授權他人或提升自己的角色', async () => {
    const db = as(STAFF_UID, STAFF_EMAIL);
    await assertFails(
      setDoc(doc(db, 'accessGrants', 'friend@example.edu.tw'), {
        email: 'friend@example.edu.tw', roles: ['ADMIN'], active: true,
      }),
    );
    await assertFails(updateDoc(doc(db, 'staff', STAFF_UID), { roles: ['ADMIN', 'DISCIPLINE_STAFF'] }));
  });

  it('稽核軌跡只能新增本人的紀錄，且不可修改或刪除', async () => {
    const db = as(STAFF_UID, STAFF_EMAIL);
    await assertSucceeds(
      setDoc(doc(db, 'auditLogs', 'log_new'), {
        actorUid: STAFF_UID, actorName: '王淑芬', action: 'INFRACTION_LOGGED',
        entityType: 'infractions', entityId: 'inf_1', createdAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(db, 'auditLogs', 'log_fake'), {
        actorUid: ADMIN_UID, action: 'X', createdAt: serverTimestamp(),
      }),
    );
    await assertFails(updateDoc(doc(db, 'auditLogs', 'log_1'), { action: 'Y' }));
    await assertFails(deleteDoc(doc(db, 'auditLogs', 'log_1')));
    // 生教組長讀不到稽核軌跡（僅管理者）
    await assertFails(getDoc(doc(db, 'auditLogs', 'log_1')));
  });
});

describe('系統管理者', () => {
  it('可授權他人並讀取授權名單', async () => {
    const db = as(ADMIN_UID, ADMIN_EMAIL);
    await assertSucceeds(
      setDoc(doc(db, 'accessGrants', 'newbie@example.edu.tw'), {
        email: 'newbie@example.edu.tw', roles: ['DISCIPLINE_STAFF'], active: true,
      }),
    );
    await assertSucceeds(getDocs(collection(db, 'accessGrants')));
  });

  it('不可授權未定義的角色', async () => {
    const db = as(ADMIN_UID, ADMIN_EMAIL);
    await assertFails(
      setDoc(doc(db, 'accessGrants', 'x@example.edu.tw'), {
        email: 'x@example.edu.tw', roles: ['SUPERUSER'], active: true,
      }),
    );
  });

  it('可重建名冊索引（管理者），且時間戳必須由伺服器產生', async () => {
    const db = as(ADMIN_UID, ADMIN_EMAIL);
    await assertSucceeds(
      setDoc(doc(db, 'rosterIndex', 'chunk_0'), {
        students: [{ id: 'stu_1', studentNo: '1140101', name: '王小明', className: '七年一班', seatNo: 1, active: true }],
        count: 1,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(db, 'rosterIndex', 'chunk_0'), {
        students: [],
        count: 0,
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
  });

  it('可調整系統設定，但超出合理範圍會被拒絕', async () => {
    const db = as(ADMIN_UID, ADMIN_EMAIL);
    await assertSucceeds(
      setDoc(doc(db, 'settings', 'system'), {
        recidivismWindowDays: 20, recidivismThreshold: 4, observerPeriods: 5,
        updatedAt: serverTimestamp(),
      }),
    );
    // 一學年（365 天）在容許範圍內
    await assertSucceeds(
      setDoc(doc(db, 'settings', 'system'), {
        recidivismWindowDays: 365, recidivismThreshold: 3, observerPeriods: 5,
        updatedAt: serverTimestamp(),
      }),
    );
    // 發卡起算次數：範圍內可存、超出範圍被拒
    await assertSucceeds(
      setDoc(doc(db, 'settings', 'system'), {
        recidivismWindowDays: 15, recidivismThreshold: 3, observerPeriods: 5,
        cardFromOffense: 2, updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(db, 'settings', 'system'), {
        recidivismWindowDays: 15, recidivismThreshold: 3, observerPeriods: 5,
        cardFromOffense: 0, updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(db, 'settings', 'system'), {
        recidivismWindowDays: 999, recidivismThreshold: 3, observerPeriods: 5,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('可讀稽核軌跡，但同樣不可修改', async () => {
    const db = as(ADMIN_UID, ADMIN_EMAIL);
    await assertSucceeds(getDoc(doc(db, 'auditLogs', 'log_1')));
    await assertFails(updateDoc(doc(db, 'auditLogs', 'log_1'), { action: 'Y' }));
  });

  it('可維護學生與班級主檔', async () => {
    const db = as(ADMIN_UID, ADMIN_EMAIL);
    await assertSucceeds(
      setDoc(doc(db, 'students', 'stu_2'), {
        studentNo: '1140102', name: '李小華', classId: 'cls_701', className: '七年一班', seatNo: 2,
      }),
    );
    await assertSucceeds(setDoc(doc(db, 'classes', 'cls_701'), { name: '七年一班' }));
  });
});

describe('停用帳號', () => {
  it('staff.active 為 false 時立即失去權限（不必等 token 過期）', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'staff', STAFF_UID), {
        uid: STAFF_UID, email: STAFF_EMAIL, name: '王淑芬', roles: [], active: false,
      });
    });
    const db = as(STAFF_UID, STAFF_EMAIL);
    await assertFails(getDoc(doc(db, 'infractions', 'inf_1')));
  });
});
