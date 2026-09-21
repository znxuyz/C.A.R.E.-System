import { describe, expect, it } from "vitest";
import {
  classDocId,
  diffRoster,
  parseRoster,
  parseRosterRows,
  studentDocId,
} from "../src/core/services/roster.ts";
import { parseCsv } from "../src/lib/rosterFile.ts";

describe("parseRoster", () => {
  it("解析四欄名冊並略過標題列", () => {
    const { rows, errors } = parseRoster(
      [
        "班級,座號,學號,姓名",
        "七年一班,1,1140101,王小明",
        "七年一班,2,1140102,李小美",
      ].join("\n"),
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      {
        className: "七年一班",
        seatNo: 1,
        studentNo: "1140101",
        name: "王小明",
      },
      {
        className: "七年一班",
        seatNo: 2,
        studentNo: "1140102",
        name: "李小美",
      },
    ]);
  });

  it("接受 Tab 分隔與空白行，座號可留空", () => {
    const { rows, errors } = parseRoster("七年一班\t\t1140101\t王小明\n\n");
    expect(errors).toEqual([]);
    expect(rows[0]?.seatNo).toBeNull();
  });

  it("逐行回報錯誤而非整份失敗", () => {
    const { rows, errors } = parseRoster(
      [
        "七年一班,1,1140101,王小明",
        "七年一班,2,1140101,重複生",
        "七年一班,3",
        "七年一班,x,1140103,座號錯",
      ].join("\n"),
    );
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain("重複");
    expect(errors[1]).toContain("欄位不足");
    expect(errors[2]).toContain("座號");
  });

  it("文件 ID 用自然鍵，重複匯入不會產生重複學生", () => {
    expect(studentDocId("1140101")).toBe("stu_1140101");
    expect(classDocId("七年一班")).toBe("cls_七年一班");
    expect(classDocId("七年 一班")).toBe("cls_七年_一班");
  });
});

describe("parseRosterRows（Excel／CSV 共用）", () => {
  it("依標題列對應欄位，順序不拘", () => {
    const { rows, errors } = parseRosterRows([
      ["學號", "姓名", "班級", "座號"],
      ["1140101", "王小明", "七年一班", "1"],
    ]);
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({
      className: "七年一班",
      seatNo: 1,
      studentNo: "1140101",
      name: "王小明",
    });
  });

  it("認得校務系統常見的標題別名", () => {
    const { rows } = parseRosterRows([
      ["班級名稱", "座位號碼", "學生證號", "學生姓名"],
      ["七年二班", "5", "1140205", "陳小華"],
    ]);
    expect(rows[0]?.studentNo).toBe("1140205");
    expect(rows[0]?.className).toBe("七年二班");
  });

  it("沒有標題列時沿用固定欄位順序", () => {
    const { rows } = parseRosterRows([["七年一班", "3", "1140103", "林小安"]]);
    expect(rows[0]?.name).toBe("林小安");
  });

  it("略過全空白列", () => {
    const { rows, errors } = parseRosterRows([
      ["班級", "座號", "學號", "姓名"],
      ["", "", "", ""],
      ["七年一班", "1", "1140101", "王小明"],
    ]);
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([]);
  });
});

describe("parseCsv", () => {
  it("支援以雙引號包住、內含逗號的欄位", () => {
    const table = parseCsv(
      '班級,座號,學號,姓名\n"七年一班, 甲組",1,1140101,"王,小明"',
    );
    expect(table[1]).toEqual(["七年一班, 甲組", "1", "1140101", "王,小明"]);
  });

  it("雙引號內的兩個連續引號視為一個引號", () => {
    expect(parseCsv('"a""b",c')[0]).toEqual(['a"b', "c"]);
  });
});

describe("diffRoster（新學年換屆）", () => {
  const existing = [
    {
      id: "stu_1140101",
      studentNo: "1140101",
      name: "王小明",
      className: "七年一班",
      seatNo: 1,
      active: true,
    },
    {
      id: "stu_1140102",
      studentNo: "1140102",
      name: "李小美",
      className: "七年一班",
      seatNo: 2,
      active: true,
    },
    {
      id: "stu_1130301",
      studentNo: "1130301",
      name: "張小畢",
      className: "九年一班",
      seatNo: 3,
      active: true,
    },
    {
      id: "stu_1140900",
      studentNo: "1140900",
      name: "休學生",
      className: "七年三班",
      seatNo: 9,
      active: false,
    },
  ];

  it("學號相同、班級不同視為重新編班，而非新學生", () => {
    const diff = diffRoster(existing, [
      {
        studentNo: "1140101",
        name: "王小明",
        className: "八年二班",
        seatNo: 7,
      },
    ]);
    expect(diff.created).toHaveLength(0);
    expect(diff.reclassed).toHaveLength(1);
    expect(diff.reclassed[0]?.before.className).toBe("七年一班");
  });

  it("檔案中沒有的在校生列為畢業／轉出；已停用者不重複列入", () => {
    const diff = diffRoster(existing, [
      {
        studentNo: "1140101",
        name: "王小明",
        className: "八年二班",
        seatNo: 7,
      },
    ]);
    expect(diff.missing.map((s) => s.studentNo).sort()).toEqual(
      ["1140102", "1130301"].sort(),
    );
  });

  it("新學號視為新生，已停用學號再次出現視為重新啟用", () => {
    const diff = diffRoster(existing, [
      {
        studentNo: "1150101",
        name: "新生一",
        className: "七年一班",
        seatNo: 1,
      },
      {
        studentNo: "1140900",
        name: "休學生",
        className: "八年三班",
        seatNo: 9,
      },
    ]);
    expect(diff.created.map((r) => r.studentNo)).toEqual(["1150101"]);
    expect(diff.reactivated.map((r) => r.studentNo)).toEqual(["1140900"]);
  });

  it("完全相同的一列不算異動", () => {
    const diff = diffRoster(existing, [
      {
        studentNo: "1140101",
        name: "王小明",
        className: "七年一班",
        seatNo: 1,
      },
    ]);
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.reclassed).toHaveLength(0);
  });
});
