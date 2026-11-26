let audio: AudioContext | undefined;

export async function playMessageSound(): Promise<void> {
  audio ??= new AudioContext();
  if (audio.state === 'suspended') await audio.resume();
  const start = audio.currentTime;
  for (const [offset, frequency] of [[0, 660], [0.12, 880]] as const) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start + offset);
    gain.gain.linearRampToValueAtTime(0.12, start + offset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, start + offset + 0.12);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.13);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
}
