/**
 * 排程作業（Cloud Scheduler，時區 Asia/Taipei）
 *
 *  1. dailyRecessRollForward（每上課日 07:10）
 *     把尚未結案的管制「續帳」到今天：
 *       - 反思卡未完成（違規當日未完成雙重審核）→ 續管制
 *       - 安全觀察員值勤完成但檢討書未通過 → 續管制至通過後隔日
 *     反之，已達解鎖日者不再建立當日管制帳，等於自動解鎖。
 *
 *  2. pendingApprovalReminder（每上課日 15:40）
 *     提醒導師／生教組仍有待簽章、待蓋章案件，避免學生權益被行政延宕卡住。
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { COLLECTIONS, col } from '../data/collections.js';
import { getStudent, loadCalendar, loadSettings } from '../data/repositories.js';
import { addDays } from '../domain/dates.js';
import { ASSIGNMENT_STATUS, CASE_STATUS, RESTRICTION_REASONS } from '../domain/types.js';
import { systemClock } from '../lib/clock.js';
import { db } from '../lib/firebase.js';
import { notify, resolveRecipients } from '../notifications/notifier.js';
import { freezeRecess } from '../services/restrictionService.js';

const SCHEDULE_OPTS = { region: 'asia-east1' as const, timeZone: 'Asia/Taipei' };

export const dailyRecessRollForward = onSchedule(
  { ...SCHEDULE_OPTS, schedule: '10 7 * * 1-5' },
  async () => {
    const firestore = db();
    const today = systemClock.today();
    const calendar = await loadCalendar(firestore, today, today);
    if (!calendar.isSchoolDay(today)) {
      logger.info(`[rollForward] ${today} 非上課日，跳過`);
      return;
    }
    const settings = await loadSettings(firestore);

    // (1) 反思卡尚未完成者續管制
    const pendingCards = await col(firestore, COLLECTIONS.reflectionCards)
      .where('status', 'in', [CASE_STATUS.DRAFT, CASE_STATUS.RETURNED, CASE_STATUS.PENDING_TEACHER, CASE_STATUS.PENDING_OFFICE])
      .where('countOn', '<', today)
      .limit(500)
      .get();

    for (const doc of pendingCards.docs) {
      try {
        const student = await getStudent(firestore, doc.get('studentId') as string);
        await freezeRecess(
          firestore,
          {
            student,
            date: today,
            reason: RESTRICTION_REASONS.INFRACTION_REFLECTION,
            periods: [],
            sourceRef: { infractionId: doc.get('infractionId') as string },
            note: `${doc.get('countOn')} 之反思卡尚未完成雙重審核，管制續行`,
          },
          systemClock,
        );
      } catch (error) {
        logger.error(`[rollForward] 卡片 ${doc.id} 續帳失敗`, error);
      }
    }

    // (2) 檢討書未通過者續管制（值勤日之後）
    const pendingAssignments = await col(firestore, COLLECTIONS.observerAssignments)
      .where('status', 'in', [ASSIGNMENT_STATUS.DUTY_COMPLETED, ASSIGNMENT_STATUS.REVIEW_PENDING])
      .limit(500)
      .get();

    for (const doc of pendingAssignments.docs) {
      const unlockOn = doc.get('unlockOn') as string | undefined;
      if (unlockOn && today >= unlockOn) continue; // 已達解鎖日 → 不再管制
      try {
        const student = await getStudent(firestore, doc.get('studentId') as string);
        await freezeRecess(
          firestore,
          {
            student,
            date: today,
            reason: RESTRICTION_REASONS.OBSERVER_REVIEW_PENDING,
            periods: settings.observerPeriodNumbers,
            sourceRef: { assignmentId: doc.id },
            note: '行為檢討書尚未完成雙重審核，管制續行',
          },
          systemClock,
        );
      } catch (error) {
        logger.error(`[rollForward] 派單 ${doc.id} 續帳失敗`, error);
      }
    }

    logger.info(
      `[rollForward] ${today} 完成：反思卡 ${pendingCards.size} 筆、派單 ${pendingAssignments.size} 筆`,
    );
  },
);

export const pendingApprovalReminder = onSchedule(
  { ...SCHEDULE_OPTS, schedule: '40 15 * * 1-5' },
  async () => {
    const firestore = db();
    const now = systemClock.now();
    const settings = await loadSettings(firestore);

    const [teacherQueue, officeQueue] = await Promise.all([
      col(firestore, COLLECTIONS.reflectionCards)
        .where('status', '==', CASE_STATUS.PENDING_TEACHER)
        .limit(500)
        .get(),
      col(firestore, COLLECTIONS.reflectionCards)
        .where('status', '==', CASE_STATUS.PENDING_OFFICE)
        .limit(500)
        .get(),
    ]);

    // 導師提醒：依班級彙總，一位導師一則通知
    const byClass = new Map<string, number>();
    for (const doc of teacherQueue.docs) {
      const classId = doc.get('classId') as string;
      byClass.set(classId, (byClass.get(classId) ?? 0) + 1);
    }
    for (const [classId, count] of byClass) {
      const recipients = await resolveRecipients(firestore, 'HOMEROOM_TEACHER', { classId });
      if (recipients.length === 0) continue;
      await notify(firestore, {
        templateCode: 'REFLECTION_SUBMITTED_TO_TEACHER',
        audience: 'HOMEROOM_TEACHER',
        recipients,
        context: {
          studentName: `${count} 位學生`,
          studentNo: '-',
          className: classId,
          cardTitle: '反思卡',
        },
        now,
        channels: settings.notifications,
      });
    }

    if (officeQueue.size > 0) {
      const recipients = await resolveRecipients(firestore, 'DISCIPLINE_OFFICE', {});
      if (recipients.length > 0) {
        await notify(firestore, {
          templateCode: 'CASE_PENDING_OFFICE',
          audience: 'DISCIPLINE_OFFICE',
          recipients,
          context: {
            studentName: `${officeQueue.size} 件`,
            studentNo: '-',
            className: '待蓋章',
          },
          now,
          channels: settings.notifications,
        });
      }
    }

    logger.info(
      `[reminder] 待導師簽章 ${teacherQueue.size} 件、待生教組蓋章 ${officeQueue.size} 件`,
    );
  },
);
