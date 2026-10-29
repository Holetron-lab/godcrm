import { useLanguage } from '@/shared/i18n/LanguageContext';
/**
 * MentionInput Component
 * ADR-023: Agent-as-User & Infinite Chat Architecture
 * 
 * A text input that supports @mentions with autocomplete dropdown
 */

import { useState, useRef, useEffect, useImperativeHandle, forwardRef, KeyboardEvent, ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/shared/utils/cn';
import { Avatar } from '@/shared/components/ui/Avatar';
import { getChatSendMode, useChatSendShortcut } from '@/shared/hooks/useChatSendShortcut';

export interface MentionUser {
  id: number;
  name: string;
  /** Global invocation identity granted by an agent passport. */
  handle?: string | null;
  email?: string;
  avatar?: string;
  icon?: string;
  /** Agent accent color (hex/CSS) — used to tint the avatar circle for bot/agent users. */
  color?: string;
  /** Agent role/description — shown as the dropdown subtitle instead of a generic "Agent User". */
  description?: string;
  type: 'human' | 'agent' | 'bot' | 'service';
}

// ADR-069: Trigger types - @ for mentions, / for agent commands
export type TriggerType = '@' | '/';

export interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onMention?: (user: MentionUser, trigger: TriggerType) => void;
  onSubmit?: () => void;
  onPasteFiles?: (files: File[]) => void;
  availableUsers: MentionUser[];
  availableAgents?: MentionUser[]; // ADR-069: Separate list for /command agents
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  maxRows?: number;
}

export const MentionInput = forwardRef<HTMLTextAreaElement, MentionInputProps>(function MentionInput({
  value,
  onChange,
  onMention,
  onSubmit,
  onPasteFiles,
  availableUsers,
  availableAgents,
  placeholder,
  disabled = false,
  className,
  inputClassName,
  maxRows = 3
}: MentionInputProps, externalRef) {
  const { t } = useLanguage();
  const { preferences } = useChatSendShortcut();
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 256 });
  const [mentionQuery, setMentionQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState(-1);
  const [currentTrigger, setCurrentTrigger] = useState<TriggerType>('@'); // ADR-069
  
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Expose textarea ref to parent for formatting operations
  useImperativeHandle(externalRef, () => inputRef.current!, []);

  // Update dropdown position when shown
  const updateDropdownPosition = () => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.top - 4, // Position above input
        left: rect.left,
        width: Math.max(rect.width, 256)
      });
    }
  };

  // ADR-069: Get list based on trigger type
  // @ shows humans and bot users, / shows only agents
  const sourceList = currentTrigger === '/'
    ? (availableAgents || [])
    : availableUsers;

  // Filter users based on mention query
  const filteredUsers = sourceList.filter(user => {
    if (!mentionQuery) return true;
    const query = mentionQuery.toLowerCase();
    return (
      user.name.toLowerCase().includes(query) ||
      user.handle?.toLowerCase().includes(query) ||
      user.email?.toLowerCase().includes(query)
    );
  });

  // Passport refreshes can remove entries while the picker stays open.
  useEffect(() => {
    setSelectedIndex(index => Math.min(index, Math.max(0, filteredUsers.length - 1)));
  }, [filteredUsers.length]);

  // Auto-resize textarea
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    const lineHeight = 24;
    const maxHeight = lineHeight * maxRows;
    const newHeight = Math.min(input.scrollHeight, maxHeight);
    input.style.height = `${newHeight}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [value, maxRows]);

  // Handle input change
  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart || 0;

    onChange(newValue);

    const textBeforeCursor = newValue.substring(0, cursorPos);

    // ADR-069: Check for both @ and / triggers
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    const lastSlashIndex = textBeforeCursor.lastIndexOf('/');

    // Determine which trigger is active (the one closest to cursor)
    let triggerIndex = -1;
    let trigger: TriggerType = '@';

    if (lastAtIndex > lastSlashIndex) {
      triggerIndex = lastAtIndex;
      trigger = '@';
    } else if (lastSlashIndex > lastAtIndex) {
      triggerIndex = lastSlashIndex;
      trigger = '/';
    }

    if (triggerIndex !== -1) {
      // Check if trigger is at start or after a space
      const charBefore = textBeforeCursor[triggerIndex - 1];
      if (triggerIndex === 0 || charBefore === ' ' || charBefore === '\n') {
        const query = textBeforeCursor.substring(triggerIndex + 1);
        // Only show dropdown if query doesn't contain space (still typing)
        if (!query.includes(' ')) {
          setMentionQuery(query);
          setMentionStartPos(triggerIndex);
          setCurrentTrigger(trigger);
          setShowDropdown(true);
          setSelectedIndex(0);

          // Calculate dropdown position using RAF for accurate measurements
          requestAnimationFrame(() => {
            updateDropdownPosition();
          });
          return;
        }
      }
    }

    setShowDropdown(false);
    setMentionStartPos(-1);
  };

  // Handle user selection from dropdown
  const selectUser = (user: MentionUser) => {
    if (mentionStartPos === -1) return;

    const beforeMention = value.substring(0, mentionStartPos);
    const afterMention = value.substring(mentionStartPos + 1 + mentionQuery.length);

    // Create slug from name
    const nameSlug = currentTrigger === '@' && user.handle
      ? user.handle.toLowerCase()
      : user.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    // ADR-116: Wrap in structured invocation token <<@slug>> or <</slug>>
    // This ensures only intentional invocations trigger agent delegation.
    const token = `<<${currentTrigger}${nameSlug}>>`;
    const newValue = `${beforeMention}${token} ${afterMention}`;

    onChange(newValue);
    onMention?.(user, currentTrigger);
    setShowDropdown(false);
    setMentionStartPos(-1);

    // Focus back on input
    setTimeout(() => {
      inputRef.current?.focus();
      // +4 for << and >> wrapper, +1 for trailing space
      const newPos = beforeMention.length + token.length + 1;
      inputRef.current?.setSelectionRange(newPos, newPos);
    }, 0);
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (showDropdown && e.key === 'Escape') {
      e.preventDefault();
      setShowDropdown(false);
      return;
    }
    // Bug fix #81739: Allow native Ctrl/Cmd shortcuts (Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+Z, etc.)
    // But allow Ctrl+Enter to submit the message
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      onSubmit?.();
      return;
    }
    if (e.ctrlKey || e.metaKey) return;

    if (showDropdown && filteredUsers.length > 0) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => (prev + 1) % filteredUsers.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => (prev - 1 + filteredUsers.length) % filteredUsers.length);
          break;
        case 'Enter':
          e.preventDefault();
          selectUser(filteredUsers[selectedIndex]);
          break;
        case 'Tab':
          e.preventDefault();
          selectUser(filteredUsers[selectedIndex]);
          break;
      }
      return;
    }
    
    if (e.key === 'Enter' && e.shiftKey === (getChatSendMode(preferences) === 'shift-enter') && !e.altKey && !showDropdown) {
      e.preventDefault();
      onSubmit?.();
    }
  };

  // Handle Ctrl+V paste — intercept files/images from clipboard
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0 && onPasteFiles) {
      e.preventDefault();
      onPasteFiles(files);
    }
    // If no files, let the default text paste happen
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && 
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    if (showDropdown && dropdownRef.current) {
      const selectedEl = dropdownRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      selectedEl?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, showDropdown]);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* No mirror overlay — plain text in textarea, pills only in sent messages (HighlightedText) */}
      <textarea
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={placeholder ?? t('aiChat.ui.mentionInputPlaceholder')}
        aria-label={placeholder ?? t('aiChat.ui.mentionInputPlaceholder')}
        disabled={disabled}
        rows={1}
        className={cn(
          'w-full resize-none bg-transparent min-h-[24px]',
          'placeholder:text-[var(--text-tertiary)] focus:outline-none',
          'text-[var(--text-primary)]',
          'text-sm whitespace-pre-wrap break-words',
          inputClassName
        )}
      />
      
      {/* Mention Dropdown - Portal */}
      {showDropdown && filteredUsers.length > 0 && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] max-h-60 overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl"
          style={{
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            width: dropdownPosition.width,
            transform: 'translateY(-100%)'
          }}
        >
          <div className="py-1">
            {filteredUsers.map((user, index) => (
              <button
                key={user.id}
                data-index={index}
                onClick={() => selectUser(user)}
                style={{ boxShadow: `inset 4px 0 0 0 ${user.color || (user.type === 'agent' || user.type === 'bot' ? '#a855f7' : '#3b82f6')}` }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors',
                  index === selectedIndex 
                    ? 'bg-[var(--color-primary-500)]/15 text-[var(--color-primary-500)]' 
                    : 'hover:bg-[var(--bg-tertiary)]'
                )}
              >
                {/* User avatar/icon — shared Avatar resolves image → emoji icon →
                    initial, tinted with the agent's accent color for bot/agent users. */}
                <Avatar
                  url={user.avatar}
                  emoji={user.icon}
                  name={user.name}
                  color={user.color || (user.type === 'agent' || user.type === 'bot' ? '#a855f7' : '#3b82f6')}
                  size={28}
                />

                {/* User info */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-[var(--text-primary)] truncate">
                    {user.name}
                  </div>
                  <div className="text-xs text-[var(--text-secondary)] truncate">
                    {currentTrigger === '/'
                      ? (user.description || t('aiChat.ui.invokeAnAgent'))
                      : (user.type === 'agent' || user.type === 'bot')
                        ? (user.description || '🤖 AI Agent')
                        : (user.email || t('aiChat.ui.user'))}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
      
      {/* No results - Portal */}
      {showDropdown && filteredUsers.length === 0 && mentionQuery && createPortal(
        <div
          ref={dropdownRef}
          role="status"
          className="fixed z-[9999] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl p-3 text-center text-sm text-[var(--text-secondary)]"
          style={{
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            width: dropdownPosition.width,
            transform: 'translateY(-100%)'
          }}
        >
          {t('aiChat.ui.noMentionMatches', { query: `${currentTrigger}${mentionQuery}` })}
        </div>,
        document.body
      )}
    </div>
  );
});

export default MentionInput;
