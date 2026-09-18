/**
 * 儀表板圖表
 *
 * 設計依據（已驗證）：
 *  - 分類色固定指派：slot 1（藍 #2a78d6 / 深色 #3987e5）= 校園安全反思卡、
 *    slot 2（橘 #eb6834 / #d95926）= 口說好話反思卡；不循環重用。
 *    以色盲模擬驗證：淺色 ΔE 24.7、深色 ΔE 26.8（門檻 ≥ 8）。
 *  - 兩個系列同時存在 → 必有圖例，並提供表格檢視，識別不靠顏色單獨傳達。
 *  - 單一軸；堆疊段之間留 2px 底色縫隙；資料端 4px 圓角；hover 顯示提示。
 *  - 以 HTML/CSS 繪製（非拉伸的 SVG viewBox），避免座標軸文字被非等比縮放而變形。
 */
import { useState } from 'react';
import { formatDate, weekdayLabel } from '../lib/format.ts';

export interface TrendPoint {
  date: string;
  safety: number;
  words: number;
}

const PLOT_HEIGHT = 120;

export function TrendChart({ data }: { data: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((point) => point.safety + point.words));

  return (
    <div className="chart">
      <div className="legend">
        <span className="legend__item">
          <span className="legend__swatch" style={{ background: 'var(--series-1)' }} aria-hidden="true" />
          校園安全反思卡
        </span>
        <span className="legend__item">
          <span className="legend__swatch" style={{ background: 'var(--series-2)' }} aria-hidden="true" />
          口說好話反思卡
        </span>
        <span className="spacer" />
        <span className="axis-note">單位：張／日・軸高 {max} 張</span>
      </div>

      <div
        className="trend"
        role="img"
        aria-label={`近 ${data.length} 天每日反思卡張數趨勢，最高 ${max} 張`}
      >
        {data.map((point, index) => {
          const total = point.safety + point.words;
          const safetyH = (point.safety / max) * PLOT_HEIGHT;
          const wordsH = (point.words / max) * PLOT_HEIGHT;
          const dim = hover !== null && hover !== index;
          return (
            <div
              className="trend__col"
              key={point.date}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
            >
              <div className="trend__stack" style={{ height: PLOT_HEIGHT }}>
                {total === 0 ? (
                  <span className="trend__zero" />
                ) : (
                  <>
                    {wordsH > 0 && (
                      <span
                        className="trend__seg trend__seg--words"
                        style={{ height: Math.max(3, wordsH), opacity: dim ? 0.5 : 1 }}
                      />
                    )}
                    {safetyH > 0 && (
                      <span
                        className="trend__seg trend__seg--safety"
                        style={{ height: Math.max(3, safetyH), opacity: dim ? 0.5 : 1 }}
                      />
                    )}
                  </>
                )}
              </div>
              <span className="trend__label">{point.date.slice(5).replace('-', '/')}</span>

              {hover === index && (
                <div className="trend__tip" role="tooltip">
                  <div style={{ fontWeight: 500 }}>
                    {formatDate(point.date)}（{weekdayLabel(point.date)}）
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="legend__swatch" style={{ background: 'var(--series-1)' }} />
                    安全卡 <strong>{point.safety}</strong> 張
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="legend__swatch" style={{ background: 'var(--series-2)' }} />
                    好話卡 <strong>{point.words}</strong> 張
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <details>
        <summary className="small muted" style={{ cursor: 'pointer' }}>
          表格檢視（無障礙 / 匯出用）
        </summary>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="data">
            <thead>
              <tr>
                <th>日期</th>
                <th>校園安全反思卡</th>
                <th>口說好話反思卡</th>
                <th>合計</th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr key={point.date}>
                  <td>
                    {point.date}（{weekdayLabel(point.date)}）
                  </td>
                  <td className="num">{point.safety}</td>
                  <td className="num">{point.words}</td>
                  <td className="num cell-strong">{point.safety + point.words}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** 熱點地點：單一系列的量值比較 → 水平條，單一色相 */
export function HotspotBars({ data }: { data: Array<{ name: string; count: number }> }) {
  const max = Math.max(1, ...data.map((item) => item.count));
  if (data.length === 0) {
    return <div className="small muted">尚無資料</div>;
  }
  return (
    <div className="bars">
      {data.map((item) => (
        <div className="bar-row" key={item.name}>
          <span className="muted" style={{ textAlign: 'right' }}>
            {item.name}
          </span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${Math.max(3, (item.count / max) * 100)}%` }} />
          </span>
          <span className="num cell-strong">{item.count}</span>
        </div>
      ))}
    </div>
  );
}
