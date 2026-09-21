import { describe, expect, it } from 'vitest';
import { matchStudents, type StudentIndexEntry } from '../src/core/domain/studentSearch.ts';

const student = (
  studentNo: string,
  name: string,
  className: string,
  seatNo: number,
  extra: Partial<StudentIndexEntry> = {},
): StudentIndexEntry => ({
  id: `stu_${studentNo}`,
  studentNo,
  name,
  className,
  seatNo,
  active: true,
  window: [],
  ...extra,
});

const INDEX: StudentIndexEntry[] = [
  student('115028', '黃俞霏', '一年一班', 27),
  student('114043', '黃品云', '二年二班', 14),
  student('110075', '黃俊昊', '六年四班', 8),
  student('110130', '黃伊婕', '六年四班', 19),
  student('112043', '王小明', '四年一班', 8, { window: ['2026-09-20', '2026-09-10'] }),
  student('112131', '李小美', '四年一班', 10, { active: false }),
];

describe('matchStudents', () => {
  it('不截斷結果：姓氏相符的全部回傳', () => {
    expect(matchStudents(INDEX, '黃', '2026-09-07')).toHaveLength(4);
  });

  it('中間的字也找得到（子字串比對，非前綴）', () => {
    const hits = matchStudents(INDEX, '小明', '2026-09-07');
    expect(hits.map((h) => h.studentNo)).toEqual(['112043']);
  });

  it('可用班級搜尋整班', () => {
    const hits = matchStudents(INDEX, '六年四班', '2026-09-07');
    expect(hits.map((h) => h.name)).toEqual(['黃俊昊', '黃伊婕']);
  });

  it('學號可打前幾碼，也可打中間片段', () => {
    expect(matchStudents(INDEX, '110', '2026-09-07')).toHaveLength(2);
    expect(matchStudents(INDEX, '2043', '2026-09-07').map((h) => h.name)).toEqual(['王小明']);
  });

  it('學號完全相符者排第一', () => {
    const hits = matchStudents(INDEX, '110075', '2026-09-07');
    expect(hits[0]?.studentNo).toBe('110075');
  });

  it('已離校的學生排在在校生之後', () => {
    const hits = matchStudents(INDEX, '四年一班', '2026-09-07');
    expect(hits.map((h) => h.name)).toEqual(['王小明', '李小美']);
  });

  it('只計入回溯視窗內的違規次數', () => {
    expect(matchStudents(INDEX, '王小明', '2026-09-15')[0]?.windowCount).toBe(1);
    expect(matchStudents(INDEX, '王小明', '2026-09-01')[0]?.windowCount).toBe(2);
  });

  it('空字串不回傳任何結果', () => {
    expect(matchStudents(INDEX, '   ', '2026-09-07')).toEqual([]);
  });
});
