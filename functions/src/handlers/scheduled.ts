/**
 * 排程作業（Cloud Scheduler，時區 Asia/Taipei）
 *
 *  dailyRollForward（每上課日 07:10）
 *   1. 紙本反思卡未回收者 → 管制續帳到今天（拖延不等於免責）
 *   2. 值勤完成但檢討書未回收者 → 續帳；已達解鎖日者不再建立管制帳＝自動解鎖
 *   3. 重建公開唯讀看板
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { COLLECTIONS, col } from '../data/collections.js';
import { getStudent, loadCalendar, loadSettings } from '../data/repositories.js';
import { ASSIGNMENT_STATUS, INFRACTION_STATUS, RESTRICTION_REASONS } from '../domain/types.js';
import { systemClock } from '../lib/clock.js';
import { db } from '../lib/firebase.js';
import { freezeRecess } from '../services/restrictionService.js';
import { rebuildPublicBoard } from '../services/publicBoardService.js';

const SCHEDULE_OPTS = { region: 'asia-east1' as const, timeZone: 'Asia/Taipei' };

export const dailyRollForward = onSchedule(
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

    if (settings.carryOverUnfinished) {
      // (1) 紙本反思卡尚未回收者續管制
      const pending = await col(firestore, COLLECTIONS.infractions)
        .where('status', '==', INFRACTION_STATUS.OPEN)
        .where('occurredOn', '<', today)
        .limit(500)
        .get();

      for (const doc of pending.docs) {
        try {
          const student = await getStudent(firestore, doc.get('studentId') as string);
          await freezeRecess(
            firestore,
            {
              student,
              date: today,
              reason: RESTRICTION_REASONS.INFRACTION_PAPER,
              periods: [],
              sourceRef: { infractionId: doc.id },
              note: `${doc.get('occurredOn')} 之紙本反思卡尚未回收，管制續行`,
            },
            systemClock,
          );
        } catch (error) {
          logger.error(`[rollForward] 違規 ${doc.id} 續帳失敗`, error);
        }
      }
      logger.info(`[rollForward] 反思卡續帳 ${pending.size} 筆`);
    }

    // (2) 檢討書未回收者續管制（值勤日之後）
    const assignments = await col(firestore, COLLECTIONS.observerAssignments)
      .where('status', '==', ASSIGNMENT_STATUS.DUTY_COMPLETED)
      .limit(500)
      .get();

    for (const doc of assignments.docs) {
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
            note: '紙本行為檢討書尚未回收，管制續行',
          },
          systemClock,
        );
      } catch (error) {
        logger.error(`[rollForward] 派單 ${doc.id} 續帳失敗`, error);
      }
    }

    // (3) 重建公開看板
    await rebuildPublicBoard(firestore, systemClock);
    logger.info(`[rollForward] ${today} 完成（派單 ${assignments.size} 筆）`);
  },
);
