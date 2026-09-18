import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import {
  CASE_STATUS_LABEL,
  CASE_STATUS_TONE,
  FORM_KIND_TONE,
  ROLE_LABEL,
  formatDate,
  formatDateTime,
} from '../lib/format.ts';
import { Badge, Callout, Field } from './ui.tsx';
import { Drawer } from './Drawer.tsx';
import { useToast } from './toast.tsx';
import type { CardDetail } from '../lib/types.ts';

/**
 * 反思卡審核抽屜（導師簽章 / 生教組蓋章共用）
 *
 * 審核者需要在同一畫面看到四件事，才能「看內容做判斷」而非蓋橡皮章：
 *  ① 違規事實（誰登錄、何時、何地、第幾節）
 *  ② 學生逐題作答
 *  ③ 15 天累犯進度（決定是否需要進一步輔導）
 *  ④ 簽核軌跡（誰簽過、幾點簽的）
 */
export function CardReviewDrawer({
  cardId,
  stage,
  actorName,
  onClose,
  onDone,
}: {
  cardId: string;
  stage: 'HOMEROOM_TEACHER' | 'DISCIPLINE_OFFICE';
  actorName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [card, setCard] = useState<CardDetail | null>(null);
  const [comment, setComment] = useState('');
  const [activityPriority, setActivityPriority] = useState(false);
  const [exemptReason, setExemptReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .card(cardId)
      .then(setCard)
      .catch((error) => toast.push(error instanceof Error ? error.message : '載入失敗', 'error'));
  }, [cardId, toast]);

  const act = async (decision: 'SIGNED' | 'RETURNED') => {
    if (!card) return;
    setBusy(true);
    try {
      const input = {
        cardId: card.id,
        decision,
        comment: comment.trim() || undefined,
        teacherActivityPriority: stage === 'HOMEROOM_TEACHER' ? activityPriority : undefined,
        exemptReason: exemptReason.trim() || undefined,
      };
      if (stage === 'HOMEROOM_TEACHER') {
        await api.teacherSign(input, actorName);
        toast.push(
          activityPriority
            ? '已勾選班級活動優先：該時段不計入處分，當日管制已解除'
            : decision === 'SIGNED'
              ? '已完成導師簽章，案件送交生教組'
              : '已退回學生補正',
        );
      } else {
        await api.officeStamp(input, actorName);
        toast.push(decision === 'SIGNED' ? '已蓋章結案，當日下課管制解除' : '已退回補正');
      }
      onDone();
      onClose();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '操作失敗', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!card) {
    return (
      <Drawer title="載入中…" onClose={onClose}>
        <div className="muted">讀取反思卡內容…</div>
      </Drawer>
    );
  }

  const answered = card.template.sections.flatMap((section) =>
    section.questions.map((question) => ({
      section: section.title,
      label: question.label,
      value: card.answers[question.id],
    })),
  );

  return (
    <Drawer
      title={`${card.className} ${card.studentName}・${card.formTitle}`}
      subtitle={
        <>
          學號 {card.studentNo}｜{card.typeName}｜基準日 {formatDate(card.countOn)}
        </>
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={() => void act('RETURNED')}>
            退回補正
          </button>
          <button className="btn btn--primary" disabled={busy} onClick={() => void act('SIGNED')}>
            {stage === 'HOMEROOM_TEACHER'
              ? activityPriority
                ? '確認班級活動優先（不計處分）'
                : '完成導師簽章'
              : '蓋章結案（當日解除管制）'}
          </button>
        </>
      }
    >
      <div className="row">
        <Badge tone={CASE_STATUS_TONE[card.status]} dot>
          {CASE_STATUS_LABEL[card.status]}
        </Badge>
        <Badge tone={FORM_KIND_TONE[card.formKind]}>{card.formTitle}</Badge>
        {card.returnCount > 0 && <Badge tone="warning">已退回 {card.returnCount} 次</Badge>}
      </div>

      <section>
        <h3 className="card__title" style={{ fontSize: 14, marginBottom: 8 }}>
          違規事實
        </h3>
        <dl className="kv">
          <dt>類型</dt>
          <dd>{card.infraction.typeName}</dd>
          <dt>時間</dt>
          <dd>
            {formatDateTime(card.infraction.occurredAt)}
            {card.infraction.periodNo ? `・第 ${card.infraction.periodNo} 節下課` : ''}
          </dd>
          <dt>地點</dt>
          <dd>{card.infraction.locationName}</dd>
          <dt>登錄者</dt>
          <dd>
            {card.infraction.reporterName}（{ROLE_LABEL[card.infraction.reporterRole]}）
          </dd>
          {card.infraction.description && (
            <>
              <dt>補充</dt>
              <dd>{card.infraction.description}</dd>
            </>
          )}
        </dl>
      </section>

      <Callout tone={card.progress.cardCount >= card.progress.threshold - 1 ? 'warning' : undefined}>
        <span aria-hidden="true">📊</span>
        <span>
          累犯視窗 {card.progress.windowStart} ~ {card.progress.windowEnd}：
          已累計 <strong>{card.progress.cardCount}</strong> / {card.progress.threshold} 張
          {card.progress.shortfall > 0
            ? `（再 ${card.progress.shortfall} 張即觸發安全觀察員）`
            : '（已達門檻）'}
        </span>
      </Callout>

      <section>
        <h3 className="card__title" style={{ fontSize: 14, marginBottom: 8 }}>
          學生填寫內容
        </h3>
        {answered.map((item, index) => (
          <div className="qa" key={`${item.label}-${index}`}>
            <div className="qa__q">{item.label}</div>
            <div className="qa__a">
              {Array.isArray(item.value)
                ? item.value.join('、')
                : item.value === undefined || item.value === ''
                  ? '（未填）'
                  : String(item.value)}
            </div>
          </div>
        ))}
      </section>

      {card.approvals.length > 0 && (
        <section>
          <h3 className="card__title" style={{ fontSize: 14, marginBottom: 8 }}>
            簽核軌跡
          </h3>
          <div className="timeline">
            {card.approvals.map((approval, index) => (
              <div className="timeline__item" key={index}>
                <span className="timeline__dot timeline__dot--done" />
                <div>
                  <div className="timeline__title">
                    {approval.stage === 'HOMEROOM_TEACHER' ? '導師簽章' : '生教組蓋章'}・
                    {approval.decision === 'SIGNED'
                      ? '同意'
                      : approval.decision === 'EXEMPTED'
                        ? '班級活動優先（不計處分）'
                        : '退回補正'}
                  </div>
                  <div className="timeline__meta">
                    {approval.actorName}・{formatDateTime(approval.actedAt)}
                    {approval.comment ? `・${approval.comment}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {stage === 'HOMEROOM_TEACHER' && (
        <label className={`check${activityPriority ? ' check--on' : ''}`}>
          <input
            type="checkbox"
            checked={activityPriority}
            onChange={(event) => setActivityPriority(event.target.checked)}
          />
          <span>
            <span className="check__label">導師班級活動優先</span>
            <span className="check__desc">
              勾選表示該時段為班級活動（如班際比賽練習、幹部訓練），
              <strong>該時段不計入處分</strong>：案件結案為「不計處分」、不列入累犯統計，
              並立即解除當日下課管制。
            </span>
          </span>
        </label>
      )}

      {stage === 'HOMEROOM_TEACHER' && activityPriority && (
        <Field label="活動事由" hint="供生教組查核與學期統計">
          <input
            type="text"
            value={exemptReason}
            onChange={(event) => setExemptReason(event.target.value)}
            placeholder="例：班際籃球賽練習"
          />
        </Field>
      )}

      <Field
        label={stage === 'HOMEROOM_TEACHER' ? '導師評語（選填；退回時必填）' : '生教組意見（選填；退回時必填）'}
      >
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={
            stage === 'HOMEROOM_TEACHER'
              ? '例：已與學生談過，願意在走廊提醒同學，值得鼓勵。'
              : '例：反思內容具體，准予結案。'
          }
        />
      </Field>
    </Drawer>
  );
}
