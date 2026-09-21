/**
 * 內建基本資料
 *
 * 違規類型與地點屬於「校規設定」，正式資料放在 Firestore 的
 * `infractionTypes` / `locations`。但在尚未匯入前，登錄畫面若空白
 * 會讓人誤以為系統壞掉，因此這裡提供一組內建預設值：
 *  - 前端在集合為空時直接採用，登錄流程立即可用
 *  - 管理者於「系統設定 → 基本資料」按一次即可寫入 Firestore，
 *    之後就能自行增修（寫入後即以 Firestore 資料為準）
 */
import type { PaperCard } from "./types.js";

export interface InfractionTypeSeed {
  code: string;
  name: string;
  paperCard: PaperCard;
  paperCardLabel: string;
  icon: string;
  order: number;
  countsTowardRecidivism: boolean;
}

export interface LocationSeed {
  code: string;
  name: string;
  isHotspot: boolean;
}

/** 需求規格明列的兩類違規，各自對應一張紙本反思卡 */
export const DEFAULT_INFRACTION_TYPES: InfractionTypeSeed[] = [
  {
    code: "RUN_IN_CORRIDOR",
    name: "走廊奔跑",
    paperCard: "SAFETY",
    paperCardLabel: "校園安全反思卡",
    icon: "🏃",
    order: 1,
    countsTowardRecidivism: true,
  },
  {
    code: "FOUL_LANGUAGE",
    name: "口出穢言",
    paperCard: "KIND_WORDS",
    paperCardLabel: "口說好話反思卡",
    icon: "💬",
    order: 2,
    countsTowardRecidivism: true,
  },
];

/** 常見校園地點；`isHotspot` 會在儀表板的熱點統計中優先呈現 */
export const DEFAULT_LOCATIONS: LocationSeed[] = [
  { code: "CORRIDOR_2F", name: "二樓走廊", isHotspot: true },
  { code: "CORRIDOR_3F", name: "三樓走廊", isHotspot: true },
  { code: "STAIRS_A", name: "A 棟樓梯", isHotspot: true },
  { code: "LOBBY", name: "川堂", isHotspot: false },
  { code: "PLAYGROUND", name: "操場", isHotspot: false },
  { code: "CAFETERIA", name: "餐廳", isHotspot: false },
  { code: "CLASSROOM", name: "教室", isHotspot: false },
  { code: "OTHER", name: "其他", isHotspot: false },
];
