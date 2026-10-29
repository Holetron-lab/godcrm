import { useEffect, useRef } from 'react';

/** The entire recording stays visible; newer samples compress history toward the left. */
export function RecordingWaveform({ stream }: { stream: MediaStream | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!stream || !canvas || typeof AudioContext === 'undefined') return;
    let context: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      void context.resume().catch(() => {});
      const buffer = new Uint8Array(analyser.fftSize);
      const history: number[] = [];
      timer = setInterval(() => {
        analyser.getByteTimeDomainData(buffer);
        const rms = Math.sqrt(buffer.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / buffer.length);
        history.push(Math.min(1, rms * 4));
        const width = Math.max(1, canvas.clientWidth);
        const height = 24;
        const ratio = window.devicePixelRatio || 1;
        canvas.width = width * ratio; canvas.height = height * ratio;
        const drawing = canvas.getContext('2d');
        if (!drawing) return;
        drawing.scale(ratio, ratio);
        drawing.strokeStyle = getComputedStyle(canvas).color;
        drawing.lineWidth = 2; drawing.lineCap = 'round';
        drawing.beginPath();
        const points = Math.min(history.length, Math.max(2, Math.floor(width / 2)));
        const peaks = Array.from({ length: points }, (_, i) => {
          const from = Math.floor(i * history.length / points);
          const to = Math.floor((i + 1) * history.length / points);
          let peak = 0;
          for (let j = from; j < to; j++) peak = Math.max(peak, history[j]);
          return Math.max(1, peak * (height / 2 - 1));
        });
        for (const direction of [-1, 1]) {
          drawing.moveTo(1, height / 2 + direction * peaks[0]);
          for (let i = 0; i < points; i++) {
            const x = points === 1 ? width - 1 : 1 + i * (width - 2) / (points - 1);
            drawing.lineTo(x, height / 2 + direction * peaks[i]);
          }
        }
        drawing.stroke();
      }, 100);
    } catch {
      // Visualisation is optional; keep recording available if Web Audio is unavailable.
    }
    return () => {
      clearInterval(timer);
      source?.disconnect();
      if (context && context.state !== 'closed') void context.close().catch(() => {});
    };
  }, [stream]);
  return <canvas ref={canvasRef} aria-hidden="true" className="h-6 min-w-0 flex-1 text-[var(--text-secondary)]" />;
}
