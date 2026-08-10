/**
 * System Variables for Markdown and Templates
 * 
 * These variables are automatically available in MarkdownPreview and other template contexts.
 * Variables use {variable_name} syntax in content.
 * 
 * @see ADR-026 for space-level variables
 */

export type VariableType = 'system' | 'static' | 'computed';

export interface SystemVariableDefinition {
  name: string;
  type: VariableType;
  description: string;
  /** For static variables - the fixed value */
  value?: string | number;
  /** For system/computed variables - function to compute value from context */
  compute?: (ctx: SystemVariableContext) => string | number | undefined;
}

export interface SystemVariableContext {
  widgetId?: number;
  userId?: number | string;
  userName?: string;
  userEmail?: string;
  projectId?: number;
  spaceId?: number;
  spaceName?: string;
  tableId?: number;
}

/**
 * System variable definitions
 */
export const SYSTEM_VARIABLES: SystemVariableDefinition[] = [
  // Widget context
  {
    name: 'current_widget_id',
    type: 'system',
    description: 'Current widget ID for internal links',
    compute: (ctx) => ctx.widgetId ? `/widgets/${ctx.widgetId}` : undefined,
  },
  {
    name: 'widget_id',
    type: 'system', 
    description: 'Raw widget ID number',
    compute: (ctx) => ctx.widgetId,
  },
  
  // User context
  {
    name: 'current_user_id',
    type: 'system',
    description: 'Current logged-in user ID',
    compute: (ctx) => ctx.userId,
  },
  {
    name: 'current_user_name',
    type: 'system',
    description: 'Current logged-in user name',
    compute: (ctx) => ctx.userName,
  },
  {
    name: 'current_user_email',
    type: 'system',
    description: 'Current logged-in user email',
    compute: (ctx) => ctx.userEmail,
  },
  
  // Project/Space context
  {
    name: 'current_project_id',
    type: 'system',
    description: 'Current project/space ID',
    compute: (ctx) => ctx.projectId || ctx.spaceId,
  },
  {
    name: 'current_space_id',
    type: 'system',
    description: 'Current space ID',
    compute: (ctx) => ctx.spaceId,
  },
  {
    name: 'current_space_name',
    type: 'system',
    description: 'Current space name',
    compute: (ctx) => ctx.spaceName,
  },
  {
    name: 'current_table_id',
    type: 'system',
    description: 'Current table ID',
    compute: (ctx) => ctx.tableId,
  },
  
  // Date/Time
  {
    name: 'current_date',
    type: 'computed',
    description: 'Current date (localized)',
    compute: () => new Date().toLocaleDateString(),
  },
  {
    name: 'current_datetime',
    type: 'computed',
    description: 'Current date and time (localized)',
    compute: () => new Date().toLocaleString(),
  },
  {
    name: 'current_year',
    type: 'computed',
    description: 'Current year',
    compute: () => new Date().getFullYear(),
  },
  {
    name: 'current_month',
    type: 'computed',
    description: 'Current month (1-12)',
    compute: () => new Date().getMonth() + 1,
  },
  {
    name: 'current_timestamp',
    type: 'computed',
    description: 'Current Unix timestamp',
    compute: () => Math.floor(Date.now() / 1000),
  },
  
  // Static URLs
  {
    name: 'api_url',
    type: 'static',
    description: 'API base URL',
    value: import.meta.env.VITE_API_URL || 'https://devcrm.hltrn.cc/api/v3',
  },
  {
    name: 'app_url',
    type: 'static',
    description: 'Application base URL',
    value: import.meta.env.VITE_APP_URL || window.location.origin,
  },
];

/**
 * Build variables object from context
 * Merges system variables with any custom variables passed in
 */
export function buildSystemVariables(
  ctx: SystemVariableContext,
  customVariables?: Record<string, string | number>
): Record<string, string | number> {
  const vars: Record<string, string | number> = {};
  
  // Compute system variables
  for (const def of SYSTEM_VARIABLES) {
    let value: string | number | undefined;
    
    if (def.type === 'static' && def.value !== undefined) {
      value = def.value;
    } else if (def.compute) {
      value = def.compute(ctx);
    }
    
    if (value !== undefined) {
      vars[def.name] = value;
    }
  }
  
  // Merge custom variables (override system if same name)
  if (customVariables) {
    Object.assign(vars, customVariables);
  }
  
  return vars;
}

/**
 * Substitute {variable_name} placeholders in content
 */
export function substituteVariables(
  content: string, 
  variables: Record<string, string | number>
): string {
  if (!content || Object.keys(variables).length === 0) {
    return content;
  }
  
  return content.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, varName) => {
    if (varName in variables) {
      return String(variables[varName]);
    }
    // Keep original if variable not found
    return match;
  });
}

/**
 * Get list of available variable names for autocomplete/documentation
 */
export function getAvailableVariableNames(): string[] {
  return SYSTEM_VARIABLES.map(v => v.name);
}

/**
 * Get variable documentation for help/tooltips
 */
export function getVariableDocumentation(): Array<{ name: string; type: string; description: string }> {
  return SYSTEM_VARIABLES.map(v => ({
    name: `{${v.name}}`,
    type: v.type,
    description: v.description,
  }));
}

/**
 * Merge system variables with space variables
 * System variables use {name} syntax, space variables use $name syntax
 * 
 * @param ctx - System variable context
 * @param spaceVariables - Variables from useVariables hook (with $ prefix)
 * @param customVariables - Additional custom variables
 * @returns Combined variables map
 */
export function mergeAllVariables(
  ctx: SystemVariableContext,
  spaceVariables?: Record<string, string | number | null>,
  customVariables?: Record<string, string | number>
): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  
  // 1. Add system variables (without braces, they're added during substitution)
  const systemVars = buildSystemVariables(ctx, customVariables);
  Object.assign(result, systemVars);
  
  // 2. Add space variables (keep $ prefix)
  if (spaceVariables) {
    for (const [key, value] of Object.entries(spaceVariables)) {
      if (value !== null) {
        result[key] = value;
      }
    }
  }
  
  return result;
}

/**
 * Substitute both {system_var} and $space_var in content
 */
export function substituteAllVariables(
  content: string,
  variables: Record<string, string | number>
): string {
  if (!content) return content;
  
  let result = content;
  
  // 1. Substitute {variable_name} (system variables)
  result = result.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, varName) => {
    if (varName in variables) {
      return String(variables[varName]);
    }
    return match;
  });
  
  // 2. Substitute $variable_name (space variables) - but NOT in URLs
  // Only substitute $var when not preceded by ? or & (URL params)
  result = result.replace(/(?<![?&])\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, varName) => {
    const fullName = '$' + varName;
    if (fullName in variables) {
      return String(variables[fullName]);
    }
    return match;
  });
  
  return result;
}
