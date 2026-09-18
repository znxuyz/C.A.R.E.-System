/**
 * 通知模板（App 推播 + Email）
 *
 * 文案原則（正向管教）：
 *  - 描述行為與待辦事項，不評價人格。
 *  - 明確告知學生權益：反思期間可正常飲水與如廁。
 */
export interface NotificationContext {
  studentName: string;
  studentNo: string;
  className: string;
  typeName?: string;
  locationName?: string;
  occurredAt?: string;
  periodNo?: number;
  cardTitle?: string;
  dutyOn?: string;
  unlockOn?: string;
  windowDays?: number;
  cardCount?: number;
  comment?: string;
  deepLink?: string;
}

export interface RenderedNotification {
  title: string;
  body: string;
  emailSubject: string;
  emailHtml: string;
}

const WATER_NOTE = '反思期間學生可正常飲水與如廁。';

function html(lines: string[]): string {
  return [
    '<div style="font-family:system-ui,-apple-system,\'Noto Sans TC\',sans-serif;line-height:1.7;color:#1f2933">',
    ...lines.map((line) => `<p style="margin:0 0 10px">${line}</p>`),
    '<hr style="border:none;border-top:1px solid #e4e7eb;margin:16px 0">',
    '<p style="margin:0;font-size:12px;color:#7b8794">C.A.R.E. System — 行為反思與追蹤系統（本信件由系統自動發送）</p>',
    '</div>',
  ].join('');
}

export const TEMPLATES = {
  /** 違規登錄成功 → 通知班導師 */
  INFRACTION_LOGGED: (c: NotificationContext): RenderedNotification => ({
    title: `【違規通報】${c.className} ${c.studentName}`,
    body: `${c.typeName}｜${c.locationName ?? '校內'}｜第 ${c.periodNo ?? '-'} 節。該生當日自由下課已暫停，待完成反思卡與雙重審核。`,
    emailSubject: `[C.A.R.E.] 違規通報：${c.className} ${c.studentName}（${c.typeName}）`,
    emailHtml: html([
      `導師您好：`,
      `貴班學生 <strong>${c.studentName}</strong>（學號 ${c.studentNo}）於 ${c.occurredAt ?? ''} 在 <strong>${c.locationName ?? '校內'}</strong> 發生「<strong>${c.typeName}</strong>」情形，已由系統登錄。`,
      `系統已暫停該生當日自由下課權限，待其完成對應反思卡並經您線上簽章、生教組蓋章後，當日即自動解除。${WATER_NOTE}`,
      `若該時段為您班級活動優先安排，請於簽章畫面勾選「導師班級活動優先」，該時段將不計入處分。`,
      c.deepLink ? `<a href="${c.deepLink}">前往簽章</a>` : '',
    ]),
  }),

  /** 學生送出反思卡 → 通知導師簽章 */
  REFLECTION_SUBMITTED_TO_TEACHER: (c: NotificationContext): RenderedNotification => ({
    title: `【待導師簽章】${c.className} ${c.studentName}`,
    body: `${c.studentName} 已完成「${c.cardTitle ?? '反思卡'}」填寫，請線上查看並簽章。`,
    emailSubject: `[C.A.R.E.] 待簽章：${c.className} ${c.studentName} 的${c.cardTitle ?? '反思卡'}`,
    emailHtml: html([
      `導師您好：`,
      `<strong>${c.studentName}</strong>（${c.studentNo}）已送出「${c.cardTitle ?? '反思卡'}」，請登入系統查看內容並完成線上簽章。`,
      c.deepLink ? `<a href="${c.deepLink}">前往簽章</a>` : '',
    ]),
  }),

  CONDUCT_REVIEW_SUBMITTED_TO_TEACHER: (c: NotificationContext): RenderedNotification => ({
    title: `【待導師簽章】行為檢討書 — ${c.studentName}`,
    body: `${c.studentName} 已完成安全觀察員值勤並提交行為檢討書，請查看並簽章。`,
    emailSubject: `[C.A.R.E.] 待簽章：${c.studentName} 的行為檢討書`,
    emailHtml: html([
      `導師您好：`,
      `<strong>${c.studentName}</strong> 已完成安全觀察員值勤並提交行為檢討書，請查看並簽章；經生教組蓋章後隔日解除下課管制。`,
      c.deepLink ? `<a href="${c.deepLink}">前往簽章</a>` : '',
    ]),
  }),

  /** 導師已簽章 → 通知生教組蓋章 */
  CASE_PENDING_OFFICE: (c: NotificationContext): RenderedNotification => ({
    title: `【待生教組蓋章】${c.className} ${c.studentName}`,
    body: `導師已完成簽章，請進行最終審核蓋章。`,
    emailSubject: `[C.A.R.E.] 待蓋章：${c.className} ${c.studentName}`,
    emailHtml: html([
      `生教組您好：`,
      `<strong>${c.className} ${c.studentName}</strong> 的案件已完成導師簽章，請於系統進行最終審核蓋章。`,
      c.deepLink ? `<a href="${c.deepLink}">前往審核</a>` : '',
    ]),
  }),

  /** 退回補正 */
  CASE_RETURNED: (c: NotificationContext): RenderedNotification => ({
    title: `【退回補正】${c.cardTitle ?? '反思卡'}`,
    body: `退回原因：${c.comment ?? '請補充說明'}。請至學務處電腦修改後重新送出。`,
    emailSubject: `[C.A.R.E.] 退回補正：${c.studentName}`,
    emailHtml: html([
      `${c.studentName} 同學：`,
      `你的「${c.cardTitle ?? '反思卡'}」需要補充：<strong>${c.comment ?? '請補充說明'}</strong>。`,
      `請於下課時間至學務處電腦修改後重新送出。${WATER_NOTE}`,
    ]),
  }),

  /** 導師班級活動優先 → 豁免 */
  CASE_EXEMPTED: (c: NotificationContext): RenderedNotification => ({
    title: `【已豁免】${c.studentName} 該時段不計入處分`,
    body: `導師已勾選「班級活動優先」，本次不計入處分，當日下課管制已解除。`,
    emailSubject: `[C.A.R.E.] 已豁免：${c.studentName}`,
    emailHtml: html([
      `${c.studentName} 同學：`,
      `導師已勾選「班級活動優先」，本次案件不計入處分，當日下課管制已解除。`,
    ]),
  }),

  /** 反思卡完成 → 當日解鎖 */
  REFLECTION_COMPLETED: (c: NotificationContext): RenderedNotification => ({
    title: `【已完成】${c.cardTitle ?? '反思卡'}審核通過`,
    body: `導師簽章與生教組蓋章皆已完成，當日下課管制已解除。`,
    emailSubject: `[C.A.R.E.] 審核通過：${c.studentName}`,
    emailHtml: html([
      `${c.studentName} 同學：`,
      `你的「${c.cardTitle ?? '反思卡'}」已完成導師簽章與生教組蓋章，當日下課管制已解除，謝謝你的配合與反思。`,
    ]),
  }),

  /** 累犯警示 → 通知生教組與導師 */
  RECIDIVISM_ALERT: (c: NotificationContext): RenderedNotification => ({
    title: `⚠️【累犯警示】${c.className} ${c.studentName}`,
    body: `${c.windowDays ?? 15} 天內已累計 ${c.cardCount ?? 3} 張反思卡，已自動排入安全觀察員追蹤清單（值勤日 ${c.dutyOn ?? '待排'}）。`,
    emailSubject: `[C.A.R.E.] 累犯警示：${c.className} ${c.studentName}（${c.windowDays ?? 15} 天 ${c.cardCount ?? 3} 張）`,
    emailHtml: html([
      `生教組／導師您好：`,
      `<strong>${c.className} ${c.studentName}</strong>（${c.studentNo}）於 ${c.windowDays ?? 15} 天內累計填寫 <strong>${c.cardCount ?? 3}</strong> 張反思卡，已達累犯門檻。`,
      `系統已自動將該生排入「安全觀察員追蹤清單」，預定值勤日：<strong>${c.dutyOn ?? '待生教組排定'}</strong>（一日下課共 5 節，扣除打掃時間與 5 分鐘短下課）。`,
      `值勤結束後學生須提交行為檢討書，經導師簽章與生教組蓋章後，隔日恢復自由下課。`,
      c.deepLink ? `<a href="${c.deepLink}">查看追蹤清單</a>` : '',
    ]),
  }),

  /** 安全觀察員派單 */
  OBSERVER_ASSIGNED: (c: NotificationContext): RenderedNotification => ({
    title: `【安全觀察員派單】${c.studentName}`,
    body: `值勤日 ${c.dutyOn}，請於各節下課至學務處報到，協助觀察走廊奔跑情形。`,
    emailSubject: `[C.A.R.E.] 安全觀察員派單：${c.studentName}（${c.dutyOn}）`,
    emailHtml: html([
      `${c.studentName} 同學：`,
      `你已被排入安全觀察員任務，值勤日 <strong>${c.dutyOn}</strong>，共 5 節下課至學務處報到，協助觀察並提醒走廊奔跑的同學。`,
      `值勤結束後請於系統提交「行為檢討書」。${WATER_NOTE}`,
    ]),
  }),

  /** 檢討書完成 → 隔日解鎖 */
  CONDUCT_REVIEW_COMPLETED: (c: NotificationContext): RenderedNotification => ({
    title: `【已結案】行為檢討書審核通過`,
    body: `檢討書已通過雙重審核，將於 ${c.unlockOn ?? '下一上課日'} 恢復自由下課。`,
    emailSubject: `[C.A.R.E.] 結案通知：${c.studentName}`,
    emailHtml: html([
      `${c.studentName} 同學／導師您好：`,
      `行為檢討書已完成導師簽章與生教組蓋章，系統將於 <strong>${c.unlockOn ?? '下一上課日'}</strong> 正式解鎖，恢復自由下課時間。`,
    ]),
  }),
} as const;

export type TemplateCode = keyof typeof TEMPLATES;

export function renderTemplate(
  code: TemplateCode | string,
  context: NotificationContext,
): RenderedNotification {
  const template = (TEMPLATES as Record<string, ((c: NotificationContext) => RenderedNotification) | undefined>)[code];
  if (!template) {
    return {
      title: `C.A.R.E. 系統通知`,
      body: `案件狀態已更新（${code}）。`,
      emailSubject: `[C.A.R.E.] 系統通知`,
      emailHtml: html([`案件狀態已更新（${code}）。`]),
    };
  }
  return template(context);
}
