import React from 'react';
import { Bot, User } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import type { TurnHeaderProps } from './types';

export const TurnHeader: React.FC<TurnHeaderProps> = ({
  turnType,
  senderName,
  timestamp,
  timestampEnd,
  isProcessing,
  agentColor,
  agentIcon,
  tokenCount,
}) => (
  <div className="flex items-center gap-2 mb-2">
    {/* Avatar */}
    <div
      className={cn(
        'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0',
        turnType === 'human'
          ? 'bg-blue-500/20 text-blue-400'
          : 'bg-purple-500/20 text-purple-400'
      )}
      style={
        turnType === 'agent' && agentColor
          ? { backgroundColor: `${agentColor}20`, color: agentColor }
          : undefined
      }
    >
      {turnType === 'human' ? (
        <User className="w-3.5 h-3.5" />
      ) : agentIcon ? (
        <span className="text-sm leading-none">{agentIcon}</span>
      ) : (
        <Bot className="w-3.5 h-3.5" />
      )}
    </div>

    {/* Agent color dot before name */}
    {turnType === 'agent' && agentColor && (
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: agentColor }}
      />
    )}

    {/* Sender name */}
    <span className="text-sm font-medium text-[var(--text-primary)] truncate">
      {senderName}
    </span>

    {/* Badge */}
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium',
        turnType === 'human'
          ? 'bg-blue-500/15 text-blue-400'
          : 'bg-purple-500/15 text-purple-400'
      )}
      style={
        turnType === 'agent' && agentColor
          ? { backgroundColor: `${agentColor}15`, color: agentColor }
          : undefined
      }
    >
      {turnType === 'human' ? (
        <User className="w-3 h-3" />
      ) : (
        <Bot className="w-3 h-3" />
      )}
      {turnType === 'human' ? 'Human' : 'Agent'}
    </span>

    {/* Processing indicator -- compact dot in header */}
    {isProcessing && (
      <span className="relative flex h-2.5 w-2.5 flex-shrink-0" title="Агент работает">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
      </span>
    )}

    {/* Token count */}
    {tokenCount != null && tokenCount > 0 && (
      <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0 tabular-nums">
        {tokenCount.toLocaleString()} tokens
      </span>
    )}

    {/* Spacer */}
    <span className="flex-1" />

    {/* Timestamp -- show range if start != end */}
    <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0">
      {timestampEnd && timestampEnd !== timestamp ? `${timestamp} – ${timestampEnd}` : timestamp}
    </span>
  </div>
);
