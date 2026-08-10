import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, ExternalLink } from 'lucide-react';

interface AudioConfig {
  prefix?: string;
  suffix?: string;
  formula?: string;
  showWaveform?: boolean;
  showDuration?: boolean;
  autoplay?: boolean;
}

interface AudioCellProps {
  value: unknown;
  config?: AudioConfig;
  rowData?: Record<string, unknown>;
  rawMode?: boolean;
}

// Resolve formula template
const resolveFormula = (formula: string, rowData?: Record<string, unknown>): string => {
  if (!formula || !rowData) return formula || '';
  return formula.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    if (key === 'row_id') {
      const rowId = rowData['id'] ?? rowData['row_id'] ?? rowData['_id'];
      return rowId !== undefined && rowId !== null ? String(rowId) : '';
    }
    const val = rowData[key];
    return val !== undefined && val !== null ? String(val) : '';
  });
};

// Parse audio URL
const parseAudioUrl = (value: unknown, config?: AudioConfig, rowData?: Record<string, unknown>): string => {
  if (!value) return '';
  
  // If formula is set, use it
  if (config?.formula) {
    return resolveFormula(config.formula, rowData);
  }
  
  let url = String(value).trim();
  if (!url) return '';
  
  // Apply prefix/suffix
  const prefix = config?.prefix ? resolveFormula(config.prefix, rowData) : '';
  const suffix = config?.suffix ? resolveFormula(config.suffix, rowData) : '';
  
  return `${prefix}${url}${suffix}`;
};

// Format duration as mm:ss
const formatDuration = (seconds: number): string => {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Simple waveform visualization (animated bars)
const Waveform: React.FC<{ isPlaying: boolean; progress: number }> = ({ isPlaying, progress }) => {
  const bars = 20;
  
  return (
    <div className="flex items-center gap-0.5 h-6 flex-1">
      {Array.from({ length: bars }).map((_, i) => {
        const isPast = (i / bars) < progress;
        const height = Math.random() * 60 + 20; // Random height 20-80%
        
        return (
          <div
            key={i}
            className={`w-1 rounded-full transition-all duration-150 ${
              isPast 
                ? 'bg-[var(--color-primary-500)]' 
                : 'bg-[var(--text-tertiary)]'
            } ${isPlaying && isPast ? 'animate-pulse' : ''}`}
            style={{ 
              height: `${height}%`,
              opacity: isPast ? 1 : 0.4
            }}
          />
        );
      })}
    </div>
  );
};

export const AudioCell: React.FC<AudioCellProps> = ({
  value,
  config,
  rowData,
  rawMode = false,
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioUrl = parseAudioUrl(value, config, rowData);
  const showWaveform = config?.showWaveform !== false;
  const showDuration = config?.showDuration !== false;

  // Reset state when URL changes
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setIsLoaded(false);
    setError(null);
  }, [audioUrl]);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
      setIsLoaded(true);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    const handleError = () => {
      setError('Ошибка загрузки');
      setIsPlaying(false);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [audioUrl]);

  const togglePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => setError('Не удалось воспроизвести'));
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setIsMuted(!isMuted);
  }, [isMuted]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio || !duration) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    audio.currentTime = percent * duration;
  }, [duration]);

  // RAW mode - показываем URL
  if (rawMode) {
    if (!audioUrl) {
      return <span className="font-mono text-xs text-[var(--text-tertiary)]">NULL</span>;
    }
    return (
      <span className="font-mono text-xs text-[var(--text-secondary)] break-all">
        {audioUrl}
      </span>
    );
  }

  // Empty state
  if (!audioUrl) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
        <Volume2 className="w-4 h-4" />
        <span>—</span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-500">
        <VolumeX className="w-4 h-4" />
        <span>{error}</span>
      </div>
    );
  }

  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <div className="flex items-center gap-2 py-1 px-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] min-w-[200px]">
      {/* Hidden audio element */}
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      {/* Play/Pause button */}
      <button
        onClick={togglePlay}
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
          isPlaying 
            ? 'bg-[var(--color-primary-500)] text-white' 
            : 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--color-primary-500)] hover:text-white'
        }`}
      >
        {isPlaying ? (
          <Pause className="w-4 h-4" />
        ) : (
          <Play className="w-4 h-4 ml-0.5" />
        )}
      </button>

      {/* Waveform / Progress bar */}
      <div 
        className="flex-1 cursor-pointer" 
        onClick={handleSeek}
        title={`${formatDuration(currentTime)} / ${formatDuration(duration)}`}
      >
        {showWaveform ? (
          <Waveform isPlaying={isPlaying} progress={progress} />
        ) : (
          <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
            <div 
              className="h-full bg-[var(--color-primary-500)] transition-all"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* Duration */}
      {showDuration && (
        <span className="flex-shrink-0 text-xs text-[var(--text-tertiary)] font-mono min-w-[40px] text-right">
          {isLoaded ? formatDuration(currentTime) : '...'}
        </span>
      )}

      {/* Mute button */}
      <button
        onClick={toggleMute}
        className="flex-shrink-0 p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
      >
        {isMuted ? (
          <VolumeX className="w-4 h-4" />
        ) : (
          <Volume2 className="w-4 h-4" />
        )}
      </button>

      {/* External link */}
      <a
        href={audioUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="flex-shrink-0 p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        title="Открыть в новой вкладке"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </div>
  );
};
