/**
 * Firestore 錯誤的中文說明
 *
 * SDK 只會丟出 "Missing or insufficient permissions."，看不出是「規則沒發布」
 * 還是「這個帳號權限不足」。現場老師需要的是下一步該做什麼，不是英文代碼。
 */
export function describeFirestoreError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code ?? "";
  const message = error instanceof Error ? error.message : String(error);

  if (
    code === "permission-denied" ||
    /insufficient permissions/i.test(message)
  ) {
    return [
      "安全規則拒絕了這次操作（權限不足）。常見原因依可能性排序：",
      "① Firebase 主控台的安全規則不是最新版 —— 請重新貼上專案的 firestore.rules 並按「發布」；",
      "② 目前登入的帳號沒有管理者角色（匯入名冊、維護類型與地點都需要管理者）；",
      "③ 該帳號的授權已被取消或停用。",
    ].join("\n");
  }
  if (code === "unavailable" || /offline|network/i.test(message)) {
    return "連不上 Firebase（網路不通或被擋）。資料仍在雲端，恢復連線後重新載入即可。";
  }
  if (code === "unauthenticated") {
    return "登入狀態已失效，請重新以 Google 帳號登入。";
  }
  if (code === "resource-exhausted") {
    return "Firebase 免費額度今日已用完，明天重置後即可恢復。";
  }
  return message;
}
