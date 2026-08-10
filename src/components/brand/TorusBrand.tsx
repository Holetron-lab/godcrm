import { useEffect, useState, useRef, useCallback } from 'react';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';

interface TorusBrandProps {
  size?: 'hero' | 'compact';
  interactive?: boolean;
  className?: string;
}

const Lightning = ({
  startX, startY, endX, endY, onComplete,
}: {
  startX: number; startY: number; endX: number; endY: number; onComplete: () => void;
}) => {
  useEffect(() => {
    const timer = setTimeout(onComplete, 300);
    return () => clearTimeout(timer);
  }, [onComplete]);

  const segments = 5;
  let path = `M ${startX} ${startY}`;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const x = startX + (endX - startX) * t + (Math.random() - 0.5) * 30;
    const y = startY + (endY - startY) * t + (Math.random() - 0.5) * 20;
    path += ` L ${x} ${y}`;
  }
  path += ` L ${endX} ${endY}`;

  return (
    <svg className="absolute inset-0 pointer-events-none z-50" style={{ width: '100%', height: '100%' }}>
      <path
        d={path}
        stroke="rgba(147, 197, 253, 0.8)"
        strokeWidth="1.33"
        fill="none"
        style={{
          filter: 'drop-shadow(0 0 3px rgba(96, 165, 250, 0.8)) drop-shadow(0 0 6px rgba(147, 197, 253, 0.5))',
          animation: 'lightningFade 0.3s ease-out forwards',
        }}
      />
    </svg>
  );
};

export const TorusBrand = ({
  size = 'hero',
  interactive = true,
  className = '',
}: TorusBrandProps) => {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const animate = !prefersReducedMotion;
  const enableInteractions = interactive && animate;

  const [waveIndex, setWaveIndex] = useState<number | null>(null);
  const [lightnings, setLightnings] = useState<Array<{ id: number; startX: number; startY: number; endX: number; endY: number }>>([]);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isMouseInContainer, setIsMouseInContainer] = useState(false);
  const torusRef = useRef<HTMLDivElement>(null);
  const lightningIdRef = useRef(0);
  const lastMoveTimeRef = useRef(Date.now());
  const idleCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const dims = size === 'hero'
    ? { container: 'w-[550px] h-96', segments: 48, segmentSize: 55, majorRadius: 200, textSize: 'text-5xl', acronymSize: 'text-base', acronymSubSize: 'text-sm', dividerWidth: 'w-80' }
    : { container: 'w-[300px] h-56', segments: 32, segmentSize: 32, majorRadius: 110, textSize: 'text-3xl', acronymSize: 'text-sm', acronymSubSize: 'text-xs', dividerWidth: 'w-48' };

  // Lightning when cursor is idle for 1-3 seconds
  useEffect(() => {
    if (!enableInteractions || !isMouseInContainer) return;

    const checkIdle = () => {
      const idleTime = Date.now() - lastMoveTimeRef.current;
      if (idleTime >= 1000 && idleTime <= 3000 && mousePos.x > 0 && mousePos.y > 0) {
        if (!torusRef.current) return;
        const centerX = torusRef.current.offsetWidth / 2;
        const centerY = torusRef.current.offsetHeight / 2;
        const angle = Math.random() * Math.PI * 2;
        const radius = dims.majorRadius - 20 + Math.random() * 30;

        const startX = centerX + Math.cos(angle) * radius;
        const startY = centerY + Math.sin(angle) * radius * 0.35;

        setLightnings((prev) => [...prev, {
          id: lightningIdRef.current++,
          startX, startY,
          endX: mousePos.x,
          endY: mousePos.y,
        }]);
        lastMoveTimeRef.current = Date.now();
      }
    };

    idleCheckRef.current = setInterval(checkIdle, 500);
    return () => {
      if (idleCheckRef.current) clearInterval(idleCheckRef.current);
    };
  }, [enableInteractions, isMouseInContainer, mousePos, dims.majorRadius]);

  // Random ambient lightning
  useEffect(() => {
    if (!animate) return;

    const spawnLightning = () => {
      if (!torusRef.current) return;
      const centerX = torusRef.current.offsetWidth / 2;
      const centerY = torusRef.current.offsetHeight / 2;
      const angle = Math.random() * Math.PI * 2;
      const radius = dims.majorRadius - 20 + Math.random() * 30;

      const startX = centerX + Math.cos(angle) * radius;
      const startY = centerY + Math.sin(angle) * radius * 0.35;

      const endX = enableInteractions && isMouseInContainer && mousePos.x > 0
        ? mousePos.x
        : centerX + (Math.random() - 0.5) * 150;
      const endY = enableInteractions && isMouseInContainer && mousePos.y > 0
        ? mousePos.y
        : centerY + (Math.random() - 0.5) * 80;

      setLightnings((prev) => [...prev, {
        id: lightningIdRef.current++,
        startX, startY, endX, endY,
      }]);
    };

    const interval = setInterval(() => {
      if (Math.random() < 0.1) spawnLightning();
    }, 3000);

    return () => clearInterval(interval);
  }, [animate, enableInteractions, isMouseInContainer, mousePos, dims.majorRadius]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!enableInteractions) return;
    lastMoveTimeRef.current = Date.now();
    if (!torusRef.current) return;
    const rect = torusRef.current.getBoundingClientRect();
    const sx = rect.width / torusRef.current.offsetWidth || 1;
    const sy = rect.height / torusRef.current.offsetHeight || 1;
    setMousePos({ x: (e.clientX - rect.left) / sx, y: (e.clientY - rect.top) / sy });
  }, [enableInteractions]);

  const handleMouseEnterContainer = useCallback(() => {
    if (!enableInteractions) return;
    setIsMouseInContainer(true);
    lastMoveTimeRef.current = Date.now();
  }, [enableInteractions]);

  const handleMouseLeaveContainer = useCallback(() => {
    setIsMouseInContainer(false);
  }, []);

  const handleSegmentHover = useCallback((index: number) => {
    if (!enableInteractions) return;
    setWaveIndex(index);
  }, [enableInteractions]);

  const handleSegmentLeave = useCallback(() => {
    setTimeout(() => setWaveIndex(null), 500);
  }, []);

  const removeLightning = useCallback((id: number) => {
    setLightnings((prev) => prev.filter((l) => l.id !== id));
  }, []);

  return (
    <div className={`relative flex flex-col items-center justify-center ${className}`}>
      <div
        ref={torusRef}
        className={`relative ${dims.container} flex items-center justify-center mb-4 origin-top scale-[1.3]`}
        style={{ perspective: '1000px' }}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnterContainer}
        onMouseLeave={handleMouseLeaveContainer}
      >
        {lightnings.map((l) => (
          <Lightning
            key={l.id}
            startX={l.startX}
            startY={l.startY}
            endX={l.endX}
            endY={l.endY}
            onComplete={() => removeLightning(l.id)}
          />
        ))}
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ marginTop: '-14px' }}
        >
          <span
            className={`${dims.textSize} font-bold tracking-[0.25em] whitespace-nowrap text-[var(--text-primary)]`}
            style={{
              textShadow: '0 0 24px rgba(96, 165, 250, 0.7), 0 0 48px rgba(147, 197, 253, 0.5), 0 0 80px rgba(59, 130, 246, 0.4)',
              animation: animate ? 'echoPulse 4s ease-in-out infinite' : undefined,
            }}
          >
            GOD CRM
          </span>
        </div>
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            animation: animate ? 'rotateTorus 30s linear infinite' : undefined,
            transform: animate ? undefined : 'rotateX(18deg)',
            transformStyle: 'preserve-3d',
          }}
        >
          {Array.from({ length: dims.segments }).map((_, i) => {
            const angle = (i / dims.segments) * Math.PI * 2;
            const x = Math.cos(angle) * dims.majorRadius;
            const z = Math.sin(angle) * dims.majorRadius;
            const rotationDeg = (i / dims.segments) * 360;

            const isWaveActive = waveIndex !== null;
            const distance = isWaveActive ? Math.abs(i - waveIndex) : 999;
            const waveScale = isWaveActive && distance < 8 ? 1 + (8 - distance) * 0.03 : 1;
            const waveOpacity = isWaveActive && distance < 8 ? 0.7 + (8 - distance) * 0.04 : 0.5;

            return (
              <div
                key={i}
                className="absolute torus-segment"
                onMouseEnter={() => handleSegmentHover(i)}
                onMouseLeave={handleSegmentLeave}
                style={{
                  width: `${dims.segmentSize}px`,
                  height: `${dims.segmentSize}px`,
                  transform: `translate3d(${x}px, 0, ${z}px) rotateY(${rotationDeg}deg) scale(${waveScale})`,
                  transformStyle: 'preserve-3d',
                  transition: 'transform 0.4s ease-out, opacity 0.4s ease-out',
                }}
              >
                {[0, 1, 2].map((layer) => (
                  <div
                    key={layer}
                    className="absolute rounded-full"
                    style={{
                      width: `${dims.segmentSize - layer * 10}px`,
                      height: `${dims.segmentSize - layer * 10}px`,
                      left: `${layer * 5}px`,
                      top: `${layer * 5}px`,
                      border: `2px solid rgba(147, 197, 253, ${0.25 - layer * 0.05})`,
                      boxShadow: layer === 0
                        ? '0 0 10px rgba(96, 165, 250, 0.25), inset 0 0 8px rgba(147, 197, 253, 0.15)'
                        : 'none',
                      background: layer === 2
                        ? 'radial-gradient(circle, rgba(180,210,255,0.2) 0%, transparent 70%)'
                        : 'transparent',
                      opacity: waveOpacity,
                      animation: animate ? `shimmer ${4 + (i % 6) * 0.3}s ease-in-out infinite` : undefined,
                      animationDelay: animate ? `${i * 0.08}s` : undefined,
                      transition: 'all 0.4s ease-out',
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col items-center gap-1 -mt-8 mb-3 md:-mt-10">
        <span
          className={`${dims.acronymSize} font-semibold tracking-[0.05em] uppercase text-[var(--text-primary)] text-center whitespace-nowrap`}
          style={{ textShadow: '0 0 20px rgba(96, 165, 250, 0.5), 0 0 40px rgba(147, 197, 253, 0.3)' }}
        >
          Generative Orchestration & Development
        </span>
        <span
          className={`${dims.acronymSubSize} font-medium tracking-wide text-[var(--text-secondary)] text-center`}
          style={{ textShadow: '0 0 15px rgba(96, 165, 250, 0.4), 0 0 30px rgba(147, 197, 253, 0.2)' }}
        >
          Critical Resource Manager
        </span>
      </div>
      <div
        className={`${dims.dividerWidth} h-px mb-4`}
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(96, 165, 250, 0.6), rgba(147, 197, 253, 0.8), rgba(96, 165, 250, 0.6), transparent)',
          boxShadow: '0 0 10px rgba(96, 165, 250, 0.5), 0 0 20px rgba(147, 197, 253, 0.3)',
          animation: animate ? 'linePulse 3s ease-in-out infinite' : undefined,
        }}
      />
      <style>{`
        @keyframes rotateTorus {
          0% { transform: rotateX(18deg) rotateY(0deg); }
          100% { transform: rotateX(18deg) rotateY(360deg); }
        }
        @keyframes shimmer {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
        @keyframes linePulse {
          0%, 100% { opacity: 0.6; box-shadow: 0 0 10px rgba(96, 165, 250, 0.5), 0 0 20px rgba(147, 197, 253, 0.3); }
          50% { opacity: 1; box-shadow: 0 0 15px rgba(96, 165, 250, 0.7), 0 0 30px rgba(147, 197, 253, 0.5); }
        }
        @keyframes echoPulse {
          0%, 100% { text-shadow: 0 0 18px rgba(59, 130, 246, 0.55), 0 0 36px rgba(96, 165, 250, 0.35); }
          50% { text-shadow: 0 0 26px rgba(59, 130, 246, 0.75), 0 0 52px rgba(96, 165, 250, 0.5); }
        }
        @keyframes lightningFade {
          0% { opacity: 1; stroke-width: 2; }
          100% { opacity: 0; stroke-width: 0.67; }
        }
        .torus-segment:hover .rounded-full {
          transform: scale(1.15);
          box-shadow: 0 0 12px rgba(96, 165, 250, 0.4), inset 0 0 10px rgba(147, 197, 253, 0.25) !important;
          border-color: rgba(147, 197, 253, 0.45) !important;
        }
        .torus-segment .rounded-full {
          transition: all 0.4s ease-out;
        }
      `}</style>
    </div>
  );
};
