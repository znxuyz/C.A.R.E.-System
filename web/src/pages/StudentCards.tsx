import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import {
  CASE_STATUS_LABEL,
  CASE_STATUS_TONE,
  FORM_KIND_TONE,
  formatDate,
} from '../lib/format.ts';
import { Badge, Callout, EmptyState, Field, Panel, WaterNotice } from '../components/ui.tsx';
import { useToast } from '../components/toast.tsx';
import type { CardDetail, CardSummary, Session } from '../lib/types.ts';

/**
 * 學生端：填寫反思卡
 * 在學務處電腦或平板操作；題目由 formTemplates 模板驅動，
 * 必填與最少字數於前後端雙重檢核（後端為準）。
 */
export function StudentCards({ session }: { session: Session }) {
  const toast = useToast();
  const [cards, setCards] = useState<CardSummary[] | null>(null);
  const [active, setActive] = useState<CardDetail | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const studentId = session.studentId ?? '';
    void api
      .studentCards(studentId)
      .then(setCards)
      .catch(() => setCards([]));
  }, [session.studentId]);

  useEffect(load, [load]);

  const open = async (cardId: string) => {
    const detail = await api.card(cardId);
    setActive(detail);
    setAnswers(detail.answers ?? {});
  };

  const submit = async () => {
    if (!active) return;
    for (const section of active.template.sections) {
      for (const question of section.questions) {
        const value = answers[question.id];
        if (question.required && (value === undefined || value === '')) {
          toast.push(`「${question.label}」為必填`, 'error');
          return;
        }
        if (question.minLength && typeof value === 'string' && value.trim().length < question.minLength) {
          toast.push(`「${question.label}」至少需 ${question.minLength} 字`, 'error');
          return;
        }
      }
    }
    setBusy(true);
    try {
      await api.submitCard(active.id, answers);
      toast.push('已送出，等待導師線上簽章');
      setActive(null);
      load();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : '送出失敗', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (active) {
    return (
      <>
        <Panel
          title={active.template.title}
          hint={`${active.typeName}｜違規日 ${formatDate(active.countOn)}`}
          actions={
            <button className="btn" onClick={() => setActive(null)}>
              返回
            </button>
          }
        >
          <div className="stack">
            <Callout>
              <span aria-hidden="true">🌱</span>
              <span>{active.template.guidance}</span>
            </Callout>

            {active.template.sections.map((section) => (
              <section key={section.id} className="stack">
                <h3 className="card__title" style={{ fontSize: 14 }}>
                  {section.title}
                </h3>
                {section.questions.map((question) => {
                  const value = answers[question.id];
                  const setValue = (next: unknown) =>
                    setAnswers((prev) => ({ ...prev, [question.id]: next }));
                  return (
                    <Field
                      key={question.id}
                      label={`${question.label}${question.required ? ' ＊' : ''}`}
                      hint={question.minLength ? `至少 ${question.minLength} 字` : undefined}
                    >
                      {question.type === 'textarea' ? (
                        <textarea
                          value={(value as string) ?? ''}
                          placeholder={question.placeholder}
                          onChange={(event) => setValue(event.target.value)}
                        />
                      ) : question.type === 'choice' ? (
                        <select
                          value={(value as string) ?? ''}
                          onChange={(event) => setValue(event.target.value)}
                        >
                          <option value="">請選擇</option>
                          {question.options?.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : question.type === 'multiselect' ? (
                        <div className="stack" style={{ gap: 6 }}>
                          {question.options?.map((option) => {
                            const list = Array.isArray(value) ? (value as string[]) : [];
                            return (
                              <label key={option} className="row" style={{ gap: 8 }}>
                                <input
                                  type="checkbox"
                                  checked={list.includes(option)}
                                  onChange={(event) =>
                                    setValue(
                                      event.target.checked
                                        ? [...list, option]
                                        : list.filter((item) => item !== option),
                                    )
                                  }
                                />
                                <span>{option}</span>
                              </label>
                            );
                          })}
                        </div>
                      ) : question.type === 'scale' || question.type === 'number' ? (
                        <input
                          type="number"
                          min={question.min ?? 0}
                          max={question.max ?? 99}
                          value={(value as number) ?? ''}
                          onChange={(event) => setValue(Number(event.target.value))}
                        />
                      ) : (
                        <input
                          type="text"
                          value={(value as string) ?? ''}
                          placeholder={question.placeholder}
                          onChange={(event) => setValue(event.target.value)}
                        />
                      )}
                    </Field>
                  );
                })}
              </section>
            ))}

            <WaterNotice />

            <div className="btn-row">
              <button className="btn btn--primary btn--lg" disabled={busy} onClick={() => void submit()}>
                {busy ? '送出中…' : '送出，請導師簽章'}
              </button>
              <span className="small muted">
                送出後：導師線上簽章 → 生教組蓋章 → 當日自動解除下課管制
              </span>
            </div>
          </div>
        </Panel>
      </>
    );
  }

  return (
    <Panel title="我的反思卡" hint="完成填寫 → 導師簽章 → 生教組蓋章 → 當日解除管制" flush>
      {!cards ? (
        <div className="card__body muted">載入中…</div>
      ) : cards.length === 0 ? (
        <EmptyState title="目前沒有待填寫的反思卡" hint="保持下去！" />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>違規日</th>
                <th>類型</th>
                <th>反思卡</th>
                <th>狀態</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cards.map((card) => (
                <tr key={card.id}>
                  <td>{formatDate(card.countOn)}</td>
                  <td>{card.typeName}</td>
                  <td>
                    <Badge tone={FORM_KIND_TONE[card.formKind]}>{card.formTitle}</Badge>
                  </td>
                  <td>
                    <Badge tone={CASE_STATUS_TONE[card.status]} dot>
                      {CASE_STATUS_LABEL[card.status]}
                    </Badge>
                  </td>
                  <td>
                    {card.status === 'DRAFT' || card.status === 'RETURNED' ? (
                      <button className="btn btn--primary" onClick={() => void open(card.id)}>
                        {card.status === 'RETURNED' ? '補正後重新送出' : '開始填寫'}
                      </button>
                    ) : (
                      <button className="btn" onClick={() => void open(card.id)}>
                        檢視
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
