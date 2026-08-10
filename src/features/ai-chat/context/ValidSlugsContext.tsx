/**
 * ValidSlugsContext
 * Provides a cached set of valid @mention and /command slugs
 * so HighlightedText can distinguish real users/agents from plain text.
 */
import React, { createContext, useContext, useMemo } from 'react';
import type { MentionUser } from '../components/MentionInput';

interface ValidSlugs {
  mentionSlugs: Set<string>;
  commandSlugs: Set<string>;
}

const defaultSlugs: ValidSlugs = {
  mentionSlugs: new Set(),
  commandSlugs: new Set(),
};

const ValidSlugsContext = createContext<ValidSlugs>(defaultSlugs);

/** Derive slug from name — same logic as MentionInput.selectUser */
function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

interface ValidSlugsProviderProps {
  mentionUsers?: MentionUser[];
  slashAgents?: MentionUser[];
  children: React.ReactNode;
}

export function ValidSlugsProvider({ mentionUsers = [], slashAgents = [], children }: ValidSlugsProviderProps) {
  const value = useMemo<ValidSlugs>(() => {
    const mentionSlugs = new Set<string>();
    for (const u of mentionUsers) {
      if (u.name) mentionSlugs.add(toSlug(u.name));
    }
    // Agents are valid mentions too (<<@agent>> or @agent)
    for (const a of slashAgents) {
      if (a.name) mentionSlugs.add(toSlug(a.name));
    }

    const commandSlugs = new Set<string>();
    for (const a of slashAgents) {
      if (a.name) commandSlugs.add(toSlug(a.name));
    }

    return { mentionSlugs, commandSlugs };
  }, [mentionUsers, slashAgents]);

  return (
    <ValidSlugsContext.Provider value={value}>
      {children}
    </ValidSlugsContext.Provider>
  );
}

export function useValidSlugs(): ValidSlugs {
  return useContext(ValidSlugsContext);
}
