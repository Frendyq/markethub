// Short beeps for scans: on a busy warehouse floor the picker hears the result without looking.
let context: AudioContext | null = null;

export function beep(kind: 'ok' | 'done' | 'error'): void {
  try {
    context ??= new AudioContext();
    const tones = kind === 'error' ? [220, 180] : kind === 'done' ? [880, 1175] : [988];
    tones.forEach((frequency, index) => {
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      const start = context!.currentTime + index * 0.12;
      oscillator.type = kind === 'error' ? 'square' : 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.15, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.1);
      oscillator.connect(gain).connect(context!.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.11);
    });
  } catch {
    // No audio device: the screen still shows the result.
  }
}
