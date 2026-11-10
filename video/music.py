"""C.A.R.E. System 介紹影片配樂（自行合成，無版權疑慮）

設計：84 BPM、A 大調 I–vi–IV–V 循環，溫暖但不搶戲。
分層：襯底 pad（緩起）、鋼琴式琶音、低音、輕微空氣聲，
最後以指數衰減噪音做的脈衝響應加上殘響。
"""
import math
import struct
import sys
import numpy as np

SR = 44100
BPM = 84.0
BEAT = 60.0 / BPM
BAR = BEAT * 4


def note(freq, dur, *, attack=0.01, decay=0.6, sustain=0.0, release=0.4,
         harmonics=(1.0, 0.5, 0.25, 0.12), detune=0.0, amp=0.2):
    """加法合成單音：基頻＋泛音，ADSR 包絡"""
    n = int(SR * (dur + release))
    t = np.arange(n) / SR
    wave = np.zeros(n)
    for i, level in enumerate(harmonics, start=1):
        f = freq * i * (1.0 + detune * (i - 1))
        wave += level * np.sin(2 * np.pi * f * t + i * 0.3)
    wave /= sum(harmonics)

    # 各段長度一律夾在緩衝區內，短音符才不會算出超出範圍的釋音段
    env = np.zeros(n)
    a = min(max(1, int(SR * attack)), n)
    d = min(max(1, int(SR * decay)), n - a)
    s_len = min(max(0, int(SR * dur) - a - d), n - a - d)
    env[:a] = np.linspace(0, 1, a)
    if d:
        env[a:a + d] = np.linspace(1, sustain, d)
    if s_len:
        env[a + d:a + d + s_len] = sustain
    tail = a + d + s_len
    if tail < n:
        level = env[tail - 1] if tail else 0.0
        env[tail:] = np.linspace(level, 0, n - tail)
    return wave * env * amp


def pad(freqs, dur, amp=0.09):
    """緩起的襯底和弦，帶輕微失諧讓聲音變厚"""
    n = int(SR * dur)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for f in freqs:
        for cents in (-6, 0, 7):
            ff = f * (2 ** (cents / 1200.0))
            out += np.sin(2 * np.pi * ff * t) + 0.3 * np.sin(2 * np.pi * ff * 2 * t)
    out /= (len(freqs) * 3 * 1.3)
    fade = int(SR * 1.2)
    env = np.ones(n)
    env[:fade] = np.linspace(0, 1, fade)
    env[-fade:] = np.linspace(1, 0, fade)
    # 緩慢起伏，避免死板
    env *= 0.85 + 0.15 * np.sin(2 * np.pi * 0.08 * t)
    return out * env * amp


def reverb(x, *, decay=2.2, mix=0.30):
    """以指數衰減噪音當脈衝響應，做出空間感"""
    n = int(SR * decay)
    ir = np.random.default_rng(7).normal(0, 1, n) * np.exp(-np.arange(n) / (SR * decay / 4.5))
    ir[:int(SR * 0.012)] = 0
    ir /= np.abs(ir).sum()
    # 以 FFT 做卷積：直接卷積在數分鐘長度的素材上太慢
    size = 1 << int(np.ceil(np.log2(len(x) + len(ir))))
    wet = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)]
    return (1 - mix) * x + mix * wet * 3.0


def place(buf, sig, at):
    i = int(at * SR)
    end = min(len(buf), i + len(sig))
    if end > i:
        buf[i:end] += sig[: end - i]


NOTES = {  # A 大調音名 → 頻率
    'A2': 110.00, 'E3': 164.81, 'F#3': 185.00, 'D3': 146.83, 'A3': 220.00,
    'C#4': 277.18, 'D4': 293.66, 'E4': 329.63, 'F#4': 369.99, 'A4': 440.00,
    'B4': 493.88, 'C#5': 554.37, 'D5': 587.33, 'E5': 659.26, 'F#5': 739.99,
    'A5': 880.00,
}
PROG = [  # (低音, pad 和弦, 琶音音群)
    ('A2', ['A3', 'C#4', 'E4'], ['A4', 'C#5', 'E5', 'C#5']),
    ('F#3', ['F#3', 'A3', 'C#4'], ['F#4', 'A4', 'C#5', 'A4']),
    ('D3', ['D3', 'F#3', 'A3'], ['D4', 'F#4', 'A4', 'F#4']),
    ('E3', ['E3', 'A3', 'B4'], ['E4', 'B4', 'D5', 'B4']),
]


def build(total_seconds):
    n = int(SR * (total_seconds + 4))
    lead = np.zeros(n)
    bed = np.zeros(n)

    bar = 0
    t = 0.0
    while t < total_seconds:
        low, chord, arp = PROG[bar % len(PROG)]
        section = t / total_seconds

        place(bed, pad([NOTES[f] for f in chord], BAR * 1.05,
                       amp=0.10 if section > 0.08 else 0.07), t)
        place(bed, note(NOTES[low], BAR * 0.9, attack=0.05, decay=1.6,
                        sustain=0.18, release=0.9,
                        harmonics=(1.0, 0.35, 0.12), amp=0.16), t)

        # 前兩小節只有襯底，讓片頭安靜一點；結尾兩小節逐漸收掉
        if bar >= 2 and section < 0.94:
            steps = 8
            for i in range(steps):
                f = NOTES[arp[i % len(arp)]]
                if i % 4 == 3:
                    f *= 2 if bar % 2 else 1
                velocity = 0.115 if i % 2 == 0 else 0.075
                if section > 0.30:
                    velocity *= 1.12
                place(lead, note(f, BEAT * 0.48, attack=0.004, decay=0.55,
                                 sustain=0.0, release=0.5,
                                 harmonics=(1.0, 0.42, 0.18, 0.06),
                                 amp=velocity), t + i * BEAT * 0.5)
            # 每四小節加一記高音，當作段落記號
            if bar % 4 == 3:
                place(lead, note(NOTES['A5'], BEAT * 1.2, attack=0.006, decay=1.1,
                                 release=1.0, harmonics=(1.0, 0.3, 0.1), amp=0.085),
                      t + BEAT * 3)
        t += BAR
        bar += 1

    mix = reverb(lead, decay=2.4, mix=0.34) + reverb(bed, decay=3.0, mix=0.22)
    mix = mix[: int(SR * total_seconds)]

    # 整體淡入淡出
    fi, fo = int(SR * 2.0), int(SR * 4.0)
    mix[:fi] *= np.linspace(0, 1, fi)
    mix[-fo:] *= np.linspace(1, 0, fo)

    peak = np.abs(mix).max()
    mix = mix / peak * 0.5 if peak else mix

    # 立體聲：讓琶音略微展開
    left = mix * 1.0
    right = np.roll(mix, int(SR * 0.012)) * 0.96
    stereo = np.stack([left, right], axis=1)
    return stereo


def write_wav(path, stereo):
    data = (np.clip(stereo, -1, 1) * 32767).astype('<i2').tobytes()
    with open(path, 'wb') as fh:
        fh.write(b'RIFF' + struct.pack('<I', 36 + len(data)) + b'WAVEfmt ')
        fh.write(struct.pack('<IHHIIHH', 16, 1, 2, SR, SR * 4, 4, 16))
        fh.write(b'data' + struct.pack('<I', len(data)))
        fh.write(data)


if __name__ == '__main__':
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 230.0
    out = sys.argv[2] if len(sys.argv) > 2 else 'audio/score.wav'
    write_wav(out, build(seconds))
    print(f'配樂完成：{out}（{seconds:.1f} 秒）')
