/// <reference types="vite/client" />

/** 由 vite.config.ts 於建置時注入（見 define） */
declare const __BUILD_INFO__: { sha: string; at: string };
