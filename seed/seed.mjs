/**
 * 初始化 / 示範資料匯入
 *
 * 用法：
 *   # 匯入到本機模擬器
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=care-system-dev node seed/seed.mjs --demo
 *
 *   # 匯入到正式專案
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json node seed/seed.mjs
 *
 * 參數：
 *   --demo   額外建立示範班級/學生/違規紀錄（含「已 2 次、再 1 次即觸發」的情境）
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const withDemo = process.argv.includes('--demo');

initializeApp(
  process.env.FIRESTORE_EMULATOR_HOST
    ? { projectId: process.env.GCLOUD_PROJECT ?? 'care-system-dev' }
    : { credential: applicationDefault() },
);
const db = getFirestore();

const taipeiDate = (offsetDays = 0) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86400000));
const nowIso = () => new Date().toISOString();

async function seedSettings() {
  await db.doc('settings/system').set({
    recidivismWindowDays: 15,
    recidivismThreshold: 3,
    observerPeriods: 5,
    observerPeriodNumbers: [1, 2, 3, 4, 5],
    timezone: 'Asia/Taipei',
    carryOverUnfinished: true,
    // 公開看板預設只顯示統計數字；showRoster 開啟後也只有班級＋座號，絕不含姓名
    publicBoard: { enabled: true, showRoster: false },
    emailHomeroom: false,
    updatedAt: nowIso(),
  });
  console.log('✓ settings/system（15 天 / 3 次 / 5 節，公開看板僅統計）');
}

async function seedInfractionTypes() {
  const types = [
    {
      code: 'RUN_IN_CORRIDOR',
      name: '走廊奔跑',
      paperCard: 'SAFETY',
      paperCardLabel: '校園安全反思卡',
      countsTowardRecidivism: true,
      active: true,
      order: 1,
      icon: '🏃',
    },
    {
      code: 'FOUL_LANGUAGE',
      name: '口出穢言',
      paperCard: 'KIND_WORDS',
      paperCardLabel: '口說好話反思卡',
      countsTowardRecidivism: true,
      active: true,
      order: 2,
      icon: '💬',
    },
  ];
  const batch = db.batch();
  for (const type of types) batch.set(db.doc(`infractionTypes/${type.code}`), { ...type, updatedAt: nowIso() });
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
  for (const loc of locations) batch.set(db.doc(`locations/${loc.code}`), { ...loc, active: true });
  await batch.commit();
  console.log(`✓ locations × ${locations.length}`);
}

async function seedCalendar() {
  const days = [{ date: taipeiDate(3), isSchoolDay: false, note: '示範：校慶補假' }];
  const batch = db.batch();
  for (const day of days) batch.set(db.doc(`schoolCalendar/${day.date}`), day);
  await batch.commit();
  console.log(`✓ schoolCalendar × ${days.length}`);
}

async function seedDemo() {
  const classes = [
    { id: 'cls_701', name: '七年一班', grade: 7, classNo: 1, homeroomTeacherName: '陳怡君' },
    { id: 'cls_702', name: '七年二班', grade: 7, classNo: 2, homeroomTeacherName: '林志偉' },
    { id: 'cls_802', name: '八年二班', grade: 8, classNo: 2, homeroomTeacherName: '黃美玲' },
  ];
  const students = [
    { id: 'stu_701_01', studentNo: '1140101', name: '王小明', classId: 'cls_701', className: '七年一班', seatNo: 1 },
    { id: 'stu_701_02', studentNo: '1140102', name: '李小華', classId: 'cls_701', className: '七年一班', seatNo: 2 },
    { id: 'stu_701_03', studentNo: '1140103', name: '吳承翰', classId: 'cls_701', className: '七年一班', seatNo: 3 },
    { id: 'stu_702_01', studentNo: '1140201', name: '陳小美', classId: 'cls_702', className: '七年二班', seatNo: 1 },
    { id: 'stu_802_05', studentNo: '1130205', name: '黃彥霖', classId: 'cls_802', className: '八年二班', seatNo: 5 },
  ];

  const batch = db.batch();
  for (const c of classes) batch.set(db.doc(`classes/${c.id}`), { ...c, updatedAt: nowIso() });
  for (const s of students) batch.set(db.doc(`students/${s.id}`), { ...s, updatedAt: nowIso() });
  await batch.commit();
  console.log(`✓ 示範班級 ${classes.length}、學生 ${students.length}`);

  // 王小明：15 天內已 2 次（再 1 次即觸發）
  const scenario = [
    { studentId: 'stu_701_01', day: -9, type: 'RUN_IN_CORRIDOR', typeName: '走廊奔跑', paperCard: 'SAFETY', loc: 'CORRIDOR_3F', locName: '三樓走廊', period: 2, status: 'DONE' },
    { studentId: 'stu_701_01', day: -4, type: 'FOUL_LANGUAGE', typeName: '口出穢言', paperCard: 'KIND_WORDS', loc: 'LOBBY', locName: '川堂', period: 4, status: 'DONE' },
    // 李小華：今日待回收紙本
    { studentId: 'stu_701_02', day: 0, type: 'RUN_IN_CORRIDOR', typeName: '走廊奔跑', paperCard: 'SAFETY', loc: 'CORRIDOR_2F', locName: '二樓走廊', period: 2, status: 'OPEN' },
    { studentId: 'stu_701_03', day: 0, type: 'FOUL_LANGUAGE', typeName: '口出穢言', paperCard: 'KIND_WORDS', loc: 'CAFETERIA', locName: '餐廳', period: 3, status: 'OPEN' },
  ];

  for (const item of scenario) {
    const student = students.find((s) => s.id === item.studentId);
    const occurredOn = taipeiDate(item.day);
    const iso = new Date(Date.now() + item.day * 86400000).toISOString();
    const ref = db.collection('infractions').doc();
    await ref.set({
      studentId: student.id,
      studentNo: student.studentNo,
      studentName: student.name,
      classId: student.classId,
      className: student.className,
      seatNo: student.seatNo,
      typeCode: item.type,
      typeName: item.typeName,
      paperCard: item.paperCard,
      occurredAt: iso,
      occurredOn,
      periodNo: item.period,
      locationCode: item.loc,
      locationName: item.locName,
      note: '示範資料',
      recordedBy: { uid: 'uid_office_01', name: '王淑芬' },
      status: item.status,
      countsTowardRecidivism: true,
      consumedByAlertId: null,
      ...(item.status === 'DONE'
        ? { paperReturnedAt: iso, paperReturnedOn: occurredOn }
        : {}),
      createdAt: iso,
      updatedAt: iso,
    });

    if (item.status === 'OPEN') {
      await db.doc(`recessRestrictions/${student.id}_${occurredOn}`).set({
        studentId: student.id,
        studentNo: student.studentNo,
        studentName: student.name,
        classId: student.classId,
        className: student.className,
        seatNo: student.seatNo,
        date: occurredOn,
        reasons: ['INFRACTION_PAPER'],
        sourceRefs: [{ reason: 'INFRACTION_PAPER', infractionId: ref.id, assignmentId: null }],
        status: 'ACTIVE',
        allowWaterAndRestroom: true,
        periods: [],
        note: `${item.typeName}｜待回收`,
        createdAt: iso,
        updatedAt: iso,
      });
    }
  }
  console.log('✓ 示範情境：王小明 15 天內已 2 次、今日 2 件待回收紙本');
}

async function main() {
  await seedSettings();
  await seedInfractionTypes();
  await seedLocations();
  await seedCalendar();
  if (withDemo) await seedDemo();
  console.log('\n完成。');
}

main().catch((error) => {
  console.error('匯入失敗：', error);
  process.exit(1);
});
