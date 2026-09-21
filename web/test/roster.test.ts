import { describe, expect, it } from 'vitest';
import { classDocId, parseRoster, studentDocId } from '../src/core/services/roster.ts';

describe('parseRoster', () => {
  it('解析四欄名冊並略過標題列', () => {
    const { rows, errors } = parseRoster(
      ['班級,座號,學號,姓名', '七年一班,1,1140101,王小明', '七年一班,2,1140102,李小美'].join('\n'),
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { className: '七年一班', seatNo: 1, studentNo: '1140101', name: '王小明' },
      { className: '七年一班', seatNo: 2, studentNo: '1140102', name: '李小美' },
    ]);
  });

  it('接受 Tab 分隔與空白行，座號可留空', () => {
    const { rows, errors } = parseRoster('七年一班\t\t1140101\t王小明\n\n');
    expect(errors).toEqual([]);
    expect(rows[0]?.seatNo).toBeNull();
  });

  it('逐行回報錯誤而非整份失敗', () => {
    const { rows, errors } = parseRoster(
      ['七年一班,1,1140101,王小明', '七年一班,2,1140101,重複生', '七年一班,3', '七年一班,x,1140103,座號錯'].join(
        '\n',
      ),
    );
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain('重複');
    expect(errors[1]).toContain('欄位不足');
    expect(errors[2]).toContain('座號');
  });

  it('文件 ID 用自然鍵，重複匯入不會產生重複學生', () => {
    expect(studentDocId('1140101')).toBe('stu_1140101');
    expect(classDocId('七年一班')).toBe('cls_七年一班');
    expect(classDocId('七年 一班')).toBe('cls_七年_一班');
  });
});
