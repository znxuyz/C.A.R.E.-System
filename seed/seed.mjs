/**
 * 初始化 / 示範資料匯入
 *
 * 用法：
 *   # 匯入到本機模擬器（建議先跑這個看效果）
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=care-system-dev node seed/seed.mjs --demo
 *
 *   # 匯入到正式專案（需 GOOGLE_APPLICATION_CREDENTIALS 指向服務帳號金鑰）
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json node seed/seed.mjs
 *
 * 參數：
 *   --demo   額外建立示範班級/學生/違規紀錄（含「已累計 2 張、再 1 張即觸發」的情境）
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const here = dirname(fileURLToPath(import.meta.url));
const templates = JSON.parse(readFileSync(join(here, 'templates.json'), 'utf8'));
const withDemo = process.argv.includes('--demo');

initializeApp(
  process.env.FIRESTORE_EMULATOR_HOST
    ? { projectId: process.env.GCLOUD_PROJECT ?? 'care-system-dev' }
    : { credential: applicationDefault() },
);
const db = getFirestore();

/** 台北日期字串 */
const taipeiDate = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
};
const nowIso = () => new Date().toISOString();

async function seedSettings() {
  await db.doc('settings/system').set({
    recidivismWindowDays: 15,
    recidivismThreshold: 3,
    observerPeriods: 5,
    observerPeriodNumbers: [1, 2, 3, 4, 5],
    timezone: 'Asia/Taipei',
    notifications: { push: true, email: true },
    updatedAt: nowIso(),
  });
  console.log('✓ settings/system（15 天 / 3 張 / 5 節）');
}

async function seedTemplates() {
  const batch = db.batch();
  for (const [id, data] of Object.entries(templates)) {
    batch.set(db.doc(`formTemplates/${id}`), { ...data, updatedAt: nowIso() });
  }
  await batch.commit();
  console.log(`✓ formTemplates × ${Object.keys(templates).length}`);
}

async function seedInfractionTypes() {
  const types = [
    {
      code: 'RUN_IN_CORRIDOR',
      name: '走廊奔跑',
      category: 'SAFETY',
      formTemplateId: 'SAFETY_REFLECTION_V1',
      formKind: 'SAFETY_REFLECTION',
      countsTowardRecidivism: true,
      active: true,
      order: 1,
      colorToken: 'amber',
    },
    {
      code: 'FOUL_LANGUAGE',
      name: '口出穢言',
      category: 'SPEECH',
      formTemplateId: 'KIND_WORDS_REFLECTION_V1',
      formKind: 'KIND_WORDS_REFLECTION',
      countsTowardRecidivism: true,
      active: true,
      order: 2,
      colorToken: 'violet',
    },
  ];
  const batch = db.batch();
  for (const type of types) {
    batch.set(db.doc(`infractionTypes/${type.code}`), { ...type, updatedAt: nowIso() });
  }
  await batch.commit();
  console.log(`✓ infractionTypes × ${types.length}`);
}

async function seedLocations() {
  const locations = [
    { code: 'CORRIDOR_2F', name: '二樓走廊', zone: '教學區', isHotspot: true },
    { code: 'CORRIDOR_3F', name: '三樓走廊', zone: '教學區', isHotspot: true },
    { code: 'STAIRS_A', name: 'A 棟樓梯', zone: '教學區', isHotspot: true },
    { code: 'LOBBY', name: '川堂', zone: '公共區', isHotspot: false },
    { code: 'PLAYGROUND', name: '操場', zone: '運動區', isHotspot: false },
    { code: 'CAFETERIA', name: '餐廳', zone: '公共區', isHotspot: false },
    { code: 'RESTROOM_AREA', name: '廁所周邊', zone: '公共區', isHotspot: false },
  ];
  const batch = db.batch();
  for (const loc of locations) {
    batch.set(db.doc(`locations/${loc.code}`), { ...loc, active: true });
  }
  await batch.commit();
  console.log(`✓ locations × ${locations.length}`);
}

async function seedCalendar() {
  // 範例：國定假日與補課日（實務上由教務處匯入整學期）
  const days = [
    { date: taipeiDate(3), isSchoolDay: false, note: '示範：校慶補假' },
  ];
  const batch = db.batch();
  for (const day of days) {
    batch.set(db.doc(`schoolCalendar/${day.date}`), day);
  }
  await batch.commit();
  console.log(`✓ schoolCalendar × ${days.length}`);
}

async function seedDemo() {
  const classes = [
    { id: 'cls_701', grade: 7, classNo: 1, name: '七年一班', homeroomTeacherUid: 'uid_teacher_701', homeroomTeacherName: '陳怡君', semesterId: '114-1' },
    { id: 'cls_702', grade: 7, classNo: 2, name: '七年二班', homeroomTeacherUid: 'uid_teacher_702', homeroomTeacherName: '林志偉', semesterId: '114-1' },
  ];
  const staff = [
    { uid: 'uid_office_01', name: '王淑芬', roles: ['DISCIPLINE_STAFF'], title: '生活教育組長', email: 'discipline@example.edu.tw', active: true, fcmTokens: [] },
    { uid: 'uid_teacher_701', name: '陳怡君', roles: ['HOMEROOM_TEACHER'], classIds: ['cls_701'], email: 'teacher701@example.edu.tw', active: true, fcmTokens: [] },
    { uid: 'uid_teacher_702', name: '林志偉', roles: ['HOMEROOM_TEACHER'], classIds: ['cls_702'], email: 'teacher702@example.edu.tw', active: true, fcmTokens: [] },
    { uid: 'uid_patrol_01', name: '張家豪', roles: ['PATROL'], title: '糾察隊', active: true, fcmTokens: [] },
  ];
  const students = [
    { id: 'stu_701_01', studentNo: '1140101', name: '王小明', classId: 'cls_701', className: '七年一班', seatNo: 1, guardianName: '王大同', guardianEmail: 'guardian1@example.com', uid: 'uid_stu_701_01', status: 'ENROLLED' },
    { id: 'stu_701_02', studentNo: '1140102', name: '李小華', classId: 'cls_701', className: '七年一班', seatNo: 2, guardianEmail: 'guardian2@example.com', uid: 'uid_stu_701_02', status: 'ENROLLED' },
    { id: 'stu_702_01', studentNo: '1140201', name: '陳小美', classId: 'cls_702', className: '七年二班', seatNo: 1, guardianEmail: 'guardian3@example.com', uid: 'uid_stu_702_01', status: 'ENROLLED' },
  ];

  const batch = db.batch();
  for (const c of classes) batch.set(db.doc(`classes/${c.id}`), { ...c, updatedAt: nowIso() });
  for (const s of staff) batch.set(db.doc(`staff/${s.uid}`), { ...s, updatedAt: nowIso() });
  for (const s of students) batch.set(db.doc(`students/${s.id}`), { ...s, fcmTokens: [], updatedAt: nowIso() });
  await batch.commit();
  console.log(`✓ 示範班級 ${classes.length}、教職員 ${staff.length}、學生 ${students.length}`);

  // 示範情境：王小明 15 天內已完成 2 張反思卡 → 再 1 張即觸發累犯警示
  const scenario = [
    { day: -9, type: 'RUN_IN_CORRIDOR', typeName: '走廊奔跑', template: 'SAFETY_REFLECTION_V1', kind: 'SAFETY_REFLECTION', location: 'CORRIDOR_3F', locationName: '三樓走廊', period: 2 },
    { day: -4, type: 'FOUL_LANGUAGE', typeName: '口出穢言', template: 'KIND_WORDS_REFLECTION_V1', kind: 'KIND_WORDS_REFLECTION', location: 'LOBBY', locationName: '川堂', period: 4 },
  ];

  for (const item of scenario) {
    const occurredOn = taipeiDate(item.day);
    const infractionRef = db.collection('infractions').doc();
    const cardRef = db.collection('reflectionCards').doc();
    const iso = new Date(Date.now() + item.day * 86400000).toISOString();

    const batch2 = db.batch();
    batch2.set(infractionRef, {
      studentId: 'stu_701_01', studentNo: '1140101', studentName: '王小明',
      classId: 'cls_701', className: '七年一班',
      typeCode: item.type, typeName: item.typeName, formKind: item.kind,
      occurredAt: iso, occurredOn, periodNo: item.period,
      locationCode: item.location, locationName: item.locationName,
      description: '示範資料',
      reporter: { uid: 'uid_patrol_01', name: '張家豪', role: 'PATROL' },
      status: 'RESOLVED', reflectionCardId: cardRef.id,
      createdAt: iso, updatedAt: iso,
    });
    batch2.set(cardRef, {
      infractionId: infractionRef.id,
      studentId: 'stu_701_01', studentNo: '1140101', studentName: '王小明',
      classId: 'cls_701',
      templateId: item.template, templateVersion: 1, formKind: item.kind,
      status: 'COMPLETED',
      countOn: occurredOn,
      countsTowardRecidivism: true,
      consumedByAlertId: null,
      answers: { what_happened: '（示範）已完成填寫', next_time: '（示範）我會提早出門、在走廊改成快走。' },
      submittedAt: iso,
      approvals: [
        { stage: 'HOMEROOM_TEACHER', decision: 'SIGNED', actorUid: 'uid_teacher_701', actorName: '陳怡君', actedAt: iso },
        { stage: 'DISCIPLINE_OFFICE', decision: 'SIGNED', actorUid: 'uid_office_01', actorName: '王淑芬', actedAt: iso },
      ],
      teacherSignedAt: iso, officeStampedAt: iso, completedAt: iso,
      returnCount: 0, createdAt: iso, updatedAt: iso,
    });
    batch2.set(db.doc(`recessRestrictions/stu_701_01_${occurredOn}`), {
      studentId: 'stu_701_01', studentNo: '1140101', studentName: '王小明',
      classId: 'cls_701', className: '七年一班',
      date: occurredOn,
      reasons: [], sourceRefs: [{ reason: 'INFRACTION_REFLECTION', infractionId: infractionRef.id, assignmentId: null }],
      status: 'LIFTED', allowWaterAndRestroom: true, periods: [],
      liftedAt: iso, liftReason: '反思卡已完成雙重審核', createdAt: iso, updatedAt: iso,
    });
    await batch2.commit();
  }
  console.log('✓ 示範情境：王小明 15 天內已累計 2 張（再 1 張即觸發累犯警示）');

  // 示範：今日待生教組蓋章 1 件（李小華）
  const today = taipeiDate(0);
  const todayIso = nowIso();
  const infractionRef = db.collection('infractions').doc();
  const cardRef = db.collection('reflectionCards').doc();
  const batch3 = db.batch();
  batch3.set(infractionRef, {
    studentId: 'stu_701_02', studentNo: '1140102', studentName: '李小華',
    classId: 'cls_701', className: '七年一班',
    typeCode: 'RUN_IN_CORRIDOR', typeName: '走廊奔跑', formKind: 'SAFETY_REFLECTION',
    occurredAt: todayIso, occurredOn: today, periodNo: 2,
    locationCode: 'CORRIDOR_2F', locationName: '二樓走廊',
    reporter: { uid: 'uid_office_01', name: '王淑芬', role: 'DISCIPLINE_STAFF' },
    status: 'OPEN', reflectionCardId: cardRef.id,
    createdAt: todayIso, updatedAt: todayIso,
  });
  batch3.set(cardRef, {
    infractionId: infractionRef.id,
    studentId: 'stu_701_02', studentNo: '1140102', studentName: '李小華',
    classId: 'cls_701',
    templateId: 'SAFETY_REFLECTION_V1', templateVersion: 1, formKind: 'SAFETY_REFLECTION',
    status: 'PENDING_OFFICE', countOn: today,
    countsTowardRecidivism: true, consumedByAlertId: null,
    answers: { what_happened: '第二節下課在二樓走廊追同學。', next_time: '下次我會走路，並提醒自己先看有沒有人。' },
    submittedAt: todayIso,
    approvals: [
      { stage: 'HOMEROOM_TEACHER', decision: 'SIGNED', actorUid: 'uid_teacher_701', actorName: '陳怡君', actedAt: todayIso },
    ],
    teacherSignedAt: todayIso, returnCount: 0, createdAt: todayIso, updatedAt: todayIso,
  });
  batch3.set(db.doc(`recessRestrictions/stu_701_02_${today}`), {
    studentId: 'stu_701_02', studentNo: '1140102', studentName: '李小華',
    classId: 'cls_701', className: '七年一班', date: today,
    reasons: ['INFRACTION_REFLECTION'],
    sourceRefs: [{ reason: 'INFRACTION_REFLECTION', infractionId: infractionRef.id, assignmentId: null }],
    status: 'ACTIVE', allowWaterAndRestroom: true, periods: [],
    note: '走廊奔跑｜待完成校園安全反思卡', createdAt: todayIso, updatedAt: todayIso,
  });
  await batch3.commit();
  console.log('✓ 示範情境：今日 1 件待生教組蓋章、1 位學生管制中');
}

async function main() {
  await seedSettings();
  await seedTemplates();
  await seedInfractionTypes();
  await seedLocations();
  await seedCalendar();
  if (withDemo) await seedDemo();
  console.log('\n完成。可執行 `npm run emulators` 於 http://localhost:4000 檢視資料。');
}

main().catch((error) => {
  console.error('匯入失敗：', error);
  process.exit(1);
});
