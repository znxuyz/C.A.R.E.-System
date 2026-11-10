"""把場景、標題卡、字幕與配樂合成為一支介紹影片。

流程：
  1. 每段裁切並轉為統一規格（1920x1080 / 30fps / h264）
  2. 以 xfade 串接，字幕在同一道 filter 內燒錄（只編碼一次）
  3. 依最終長度合成配樂後混音
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, 'work')
SCENES = os.path.join(HERE, 'scenes')
CARDS = os.path.join(HERE, 'cards')
AUDIO = os.path.join(HERE, 'audio')
FPS = 30
XFADE = 0.5           # 轉場長度
FONT = 'WenQuanYi Zen Hei'

# (類型, 來源, 起, 迄, [(字幕起, 字幕迄, 文字), ...])  時間皆相對該段
TIMELINE = [
    ('card', 'c00-open', 0, 7.0, []),
    ('card', 'c01-problem', 0, 8.5, []),
    ('scene', 's01-login', 0.6, 8.2, [
        (0.8, 7.0, '以學校 Google 帳號登入\\N（本片為示範資料）')]),
    ('scene', 's02-dashboard', 0.5, 14.8, [
        (0.5, 4.2, '開啟系統，今天該處理的事一次看完'),
        (4.6, 8.4, '今日管制中、待回收紙本、再犯警示、安全觀察員'),
        (8.8, 11.4, '近 14 天趨勢與違規熱點，作為導護站位的依據'),
        (11.8, 14.2, '關注名單：已有紀錄、尚未達門檻的學生')]),
    ('card', 'c02-daily', 0, 3.6, []),
    ('scene', 's03-log-find', 2.2, 15.9, [
        (0.3, 4.0, '登錄違規：學號、姓名、班級都能搜尋'),
        (4.4, 8.0, '打「小美」就找得到，不必記得完整學號'),
        (8.4, 13.2, '也可以直接選班級與座號 —— 現場最快的方式')]),
    ('scene', 's04-log-first', 2.0, 17.3, [
        (0.4, 4.6, '選違規類型與地點，現場 30 秒完成'),
        (6.6, 10.4, '期間內第一次：只做記錄與勸導'),
        (10.8, 15.0, '不必寫反思卡，下課也不受影響')]),
    ('scene', 's05-log-second', 5.2, 21.5, [
        (0.6, 5.0, '同一位學生，同一期間內第二次'),
        (8.6, 12.4, '這次發放紙本反思卡，並凍結當日自由下課'),
        (12.8, 16.0, '系統同時算出：15 天內累計 2 次，再 1 次觸發警示')]),
    ('scene', 's07-cases', 1.2, 13.6, [
        (0.4, 5.0, '待回收紙本：誰的卡還沒繳回，一目了然'),
        (5.6, 11.8, '按下「已回收」，當日下課管制立刻解除')]),
    ('scene', 's10-restrictions', 1.5, 10.9, [
        (0.4, 8.8, '下課管制名單可查任一日，並直接列印張貼')]),
    ('card', 'c03-followup', 0, 3.6, []),
    ('scene', 's06-first-offenders', 1.5, 11.4, [
        (0.4, 4.6, '初犯名單：期間內只有一次紀錄的學生'),
        (5.0, 9.6, '標示紀錄何時到期 —— 表現穩定就會歸零')]),
    ('scene', 's08-alerts', 1.4, 11.9, [
        (0.4, 4.8, '達到門檻自動發出再犯警示'),
        (5.2, 10.2, '可展開依據：哪幾筆違規被認列，隨時可追溯')]),
    ('scene', 's09-observer', 1.5, 11.0, [
        (0.4, 9.0, '自動排入安全觀察員值勤，逐節報到打卡')]),
    ('scene', 's11-student', 1.2, 15.2, [
        (0.4, 5.6, '學生查詢：班級、姓名、學號都能找'),
        (6.2, 13.6, '違規歷程一覽，親師溝通與輔導會議直接使用')]),
    ('card', 'c04-admin', 0, 3.6, []),
    ('scene', 's12-settings', 1.4, 20.1, [
        (0.4, 5.6, '校規不必改程式：回溯天數、觸發次數都可調'),
        (6.2, 12.0, '違規類型與對應的反思卡名稱可自訂'),
        (12.6, 18.4, '學生名冊可直接上傳 Excel，換屆一次搞定')]),
    ('scene', 's13-users', 1.4, 11.9, [
        (0.4, 9.8, '以 Google 信箱授權同仁，對方不需事先註冊')]),
    ('scene', 's14-public', 0.8, 9.5, [
        (0.3, 4.2, '其他老師免登入即可查看公開看板'),
        (4.6, 8.4, '只有去識別化統計 —— 不含姓名與學號')]),
    ('card', 'c05-arch', 0, 9.5, []),
    ('card', 'c06-end', 0, 8.0, []),
]


def run(cmd, **kw):
    result = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if result.returncode != 0:
        print(' '.join(cmd[:12]), '...')
        print(result.stderr[-2500:])
        sys.exit(1)
    return result


def normalize():
    """裁切並轉為統一規格；標題卡加上緩慢推近，避免靜止畫面太死板"""
    os.makedirs(WORK, exist_ok=True)
    paths = []
    for index, (kind, name, start, end, _subs) in enumerate(TIMELINE):
        out = os.path.join(WORK, f'seg{index:02d}.mp4')
        dur = round(end - start, 3)
        if kind == 'card':
            src = os.path.join(CARDS, f'{name}.png')
            frames = int(dur * FPS)
            # zoompan：1.0 → 1.045 的緩慢推近
            vf = (f"scale=3840:-1,zoompan=z='min(1.045,1+0.045*on/{frames})'"
                  f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                  f":d={frames}:s=1920x1080:fps={FPS},format=yuv420p")
            cmd = ['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-i', src,
                   '-t', str(dur), '-vf', vf]
        else:
            src = os.path.join(SCENES, f'{name}.webm')
            cmd = ['ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-i', src,
                   '-t', str(dur), '-vf',
                   f'fps={FPS},scale=1920:1080:flags=lanczos,format=yuv420p']
        cmd += ['-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
                '-pix_fmt', 'yuv420p', out]
        run(cmd)
        paths.append((out, dur))
        print(f'  ✔ seg{index:02d} {name} {dur:.1f}s')
    return paths


def ass_time(seconds):
    h = int(seconds // 3600)
    m = int(seconds % 3600 // 60)
    s = seconds % 60
    return f'{h}:{m:02d}:{s:05.2f}'


def write_subtitles(offsets):
    """依各段在成品中的起點換算字幕絕對時間"""
    lines = [
        '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1920', 'PlayResY: 1080',
        'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
        '[V4+ Styles]',
        ('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, '
         'BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, '
         'BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding'),
        (f'Style: Sub,{FONT},52,&H00FFFFFF,&H000000FF,&HC8101418,&H96000000,'
         '-1,0,0,0,100,100,0.6,0,3,0,0,2,160,160,74,1'),
        '', '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ]
    for index, (_kind, _name, _start, _end, subs) in enumerate(TIMELINE):
        base = offsets[index]
        for rel_start, rel_end, text in subs:
            lines.append(
                f'Dialogue: 0,{ass_time(base + rel_start)},{ass_time(base + rel_end)},'
                f'Sub,,0,0,0,,{{\\fad(220,220)}}{text}')
    path = os.path.join(WORK, 'subs.ass')
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines) + '\n')
    return path


def build_video(segments, subs_path):
    """以 xfade 串接並燒錄字幕"""
    inputs = []
    for path, _dur in segments:
        inputs += ['-i', path]

    filters = []
    current = '[0:v]'
    total = segments[0][1]
    for i in range(1, len(segments)):
        offset = round(total - XFADE, 3)
        label = f'[x{i}]'
        filters.append(
            f'{current}[{i}:v]xfade=transition=fade:duration={XFADE}:offset={offset}{label}')
        current = label
        total = round(total + segments[i][1] - XFADE, 3)

    escaped = subs_path.replace(':', r'\:')
    filters.append(f"{current}ass='{escaped}'[v]")
    out = os.path.join(WORK, 'video.mp4')
    run(['ffmpeg', '-v', 'error', '-y', *inputs,
         '-filter_complex', ';'.join(filters), '-map', '[v]',
         '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
         '-pix_fmt', 'yuv420p', '-r', str(FPS), out])
    return out, total


def main():
    print('1/4 裁切與標準化')
    segments = normalize()

    offsets, total = [], 0.0
    for _path, dur in segments:
        offsets.append(round(total, 3))
        total = round(total + dur - XFADE, 3)
    total = round(total + XFADE, 3)
    print(f'  成品長度約 {total:.1f} 秒（{int(total // 60)}:{int(total % 60):02d}）')

    print('2/4 產生字幕')
    subs = write_subtitles(offsets)

    print('3/4 串接轉場並燒錄字幕（較花時間）')
    video, measured = build_video(segments, subs)

    print('4/4 合成配樂並混音')
    os.makedirs(AUDIO, exist_ok=True)
    score = os.path.join(AUDIO, 'score.wav')
    run([sys.executable, os.path.join(HERE, 'music.py'), str(round(measured, 2)), score])
    final = os.path.join(HERE, 'care-system-intro.mp4')
    run(['ffmpeg', '-v', 'error', '-y', '-i', video, '-i', score,
         '-filter:a', 'volume=0.80,afade=t=in:st=0:d=2,'
                      f'afade=t=out:st={max(0, measured - 4):.2f}:d=4',
         '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
         '-c:a', 'aac', '-b:a', '192k', '-shortest', final])
    print(f'\n完成：{final}')
    print(json.dumps({'duration': measured, 'segments': len(segments)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
