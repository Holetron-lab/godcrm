import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Calculator, Plus, RefreshCw, Loader2, AlertCircle, Trash2, Edit2, Check, X, ExternalLink } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { Input } from '@/shared/components/ui/Input';
import { showToast } from '@/shared/hooks/useToast';
import { Switch } from '@/shared/components/ui/Switch';
import { apiClient } from '@/shared/utils/apiClient';

interface Variable {
  id: number;
  name: string;
  value: string | null;
  scope: 'space' | 'table' | 'dashboard';
  scopeRef: number | null;
  formula: string;
  description?: string;
  streamId: number;
}

interface SpaceVariablesTabProps {
  spaceId: number;
}

export const SpaceVariablesTab = ({ spaceId }: SpaceVariablesTabProps) => {
  const { t } = useLanguage();
  const [newVariable, setNewVariable] = useState({ name: '', formula: '', description: '' });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: '', formula: '', description: '' });

  // Create Variables table mutation
  const createTableMutation = useMutation({
    mutationFn: async () => {
      return apiClient.post<{ success: boolean; data: { table_id: number; project_id: number; status: string } }>(
        `/spaces/${spaceId}/variables-table`
      );
    },
    onSuccess: (result) => {
      showToast(result.data.status === 'created' ? t('spaces.variables.tableCreated') : t('spaces.variables.tableFound'), 'success');
      refetch();
    },
    onError: () => {
      showToast(t('spaces.variables.createFailed'), 'error');
    }
  });

  // Fetch variables
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['space-variables', spaceId],
    queryFn: async () => {
      const json = await apiClient.get<{ success: boolean; data: { tableId: number | null; variables: Variable[] } }>(
        `/spaces/${spaceId}/variables`
      );
      return json.data;
    }
  });

  // Recalculate mutation
  const recalculateMutation = useMutation({
    mutationFn: async () => {
      return apiClient.post<{ success: boolean; data: { calculated: number } }>(
        `/spaces/${spaceId}/variables/recalculate`
      );
    },
    onSuccess: (result) => {
      showToast(t('spaces.variables.recalculated', { count: result.data.calculated }), 'success');
      refetch();
    },
    onError: () => {
      showToast(t('spaces.variables.recalculateFailed'), 'error');
    }
  });

  // Add variable mutation
  const addMutation = useMutation({
    mutationFn: async (variable: { name: string; formula: string; description: string }) => {
      if (!data?.tableId) throw new Error('Variables table not found');
      
      return apiClient.post(`/tables/${data.tableId}/rows`, {
        data: {
          name: variable.name.startsWith('$') ? variable.name : `$${variable.name}`,
          formula: variable.formula,
          description: variable.description,
          scope_type: 'space'
        }
      });
    },
    onSuccess: () => {
      showToast(t('spaces.variables.added'), 'success');
      setNewVariable({ name: '', formula: '', description: '' });
      refetch();
    },
    onError: () => {
      showToast(t('spaces.variables.addFailed'), 'error');
    }
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (rowId: number) => {
      if (!data?.tableId) throw new Error('Variables table not found');
      return apiClient.delete(`/tables/${data.tableId}/rows/${rowId}`);
    },
    onSuccess: () => {
      showToast(t('spaces.variables.deleted'), 'success');
      refetch();
    }
  });

  // Update mutation  
  const updateMutation = useMutation({
    mutationFn: async ({ rowId, data: updateData }: { rowId: number; data: Record<string, unknown> }) => {
      if (!data?.tableId) throw new Error('Variables table not found');
      return apiClient.patch(`/tables/${data.tableId}/rows/${rowId}`, { data: updateData });
    },
    onSuccess: () => {
      showToast(t('spaces.variables.updated'), 'success');
      setEditingId(null);
      refetch();
    }
  });

  const handleAdd = () => {
    if (!newVariable.name.trim() || !newVariable.formula.trim()) {
      showToast(t('spaces.variables.required'), 'error');
      return;
    }
    addMutation.mutate(newVariable);
  };

  const startEdit = (v: Variable) => {
    setEditingId(v.id);
    setEditForm({ name: v.name, formula: v.formula, description: v.description || '' });
  };

  const saveEdit = () => {
    if (editingId === null) return;
    updateMutation.mutate({
      rowId: editingId,
      data: {
        name: editForm.name.startsWith('$') ? editForm.name : `$${editForm.name}`,
        formula: editForm.formula,
        description: editForm.description
      }
    });
  };

  if (isLoading) {
    return (
      <div role="status" aria-label={t('common.loading')} className="flex items-center justify-center h-40">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--accent-primary)]" />
      </div>
    );
  }

  const enabled = !!data?.tableId;
  const variables = data?.variables || [];

  const handleEnableToggle = (checked: boolean) => {
    if (checked && !enabled) {
      createTableMutation.mutate();
    }
  };

  return (
    <div className="space-y-4">
      {/* Enable toggle - same style as Access tab */}
      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-[var(--accent-primary)]" />
            <h4 className="text-sm font-medium text-[var(--text-primary)]">
              {t('spaces.variables.title')}
            </h4>
            {createTableMutation.isPending && (
              <span className="text-xs text-[var(--text-tertiary)]">{t('spaces.variables.creatingTable')}</span>
            )}
          </div>
          <Switch
            aria-label={t('spaces.variables.title')}
            checked={enabled}
            onCheckedChange={handleEnableToggle}
            disabled={createTableMutation.isPending || enabled}
          />
        </div>
        <p className="text-xs text-[var(--text-tertiary)]">
          {t('spaces.variables.description')}
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-400 p-3 bg-red-500/10 rounded-lg border border-red-500/30">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">{t('spaces.variables.loadFailed')}</span>
          <button 
            onClick={() => refetch()} 
            className="ml-auto text-xs underline hover:no-underline"
          >
            {t('spaces.variables.retry')}
          </button>
        </div>
      )}

      {enabled && (
        <div className="space-y-4">
          {/* Header with actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-tertiary)]">
                {t('spaces.variables.count', { count: variables.length })}
              </span>
              {data?.tableId && (
                <a 
                  href={`/tables/${data.tableId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-[var(--accent-primary)] hover:underline"
                >
                  <ExternalLink className="w-3 h-3" />
                  {t('spaces.variables.openTable')}
                </a>
              )}
            </div>
            <button
              onClick={() => recalculateMutation.mutate()}
              disabled={recalculateMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--accent-primary)] border border-[var(--accent-primary)]/30 rounded-md hover:bg-[var(--accent-primary)]/10 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${recalculateMutation.isPending ? 'animate-spin' : ''}`} />
              {t('spaces.variables.recalculate')}
            </button>
          </div>

          {/* Add new variable form */}
          <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border-primary)]">
            <div className="flex items-center gap-2 mb-2">
              <Plus className="w-4 h-4 text-[var(--text-tertiary)]" />
              <span className="text-xs font-medium text-[var(--text-secondary)]">{t('spaces.variables.newVariable')}</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Input
            placeholder={t('spaces.variables.namePlaceholder')}
            aria-label={t('spaces.variables.name')}
            value={newVariable.name}
            onChange={(e) => setNewVariable({ ...newVariable, name: e.target.value })}
            className="text-sm"
          />
          <Input
            placeholder={t('spaces.variables.formulaPlaceholder')}
            aria-label={t('spaces.variables.formula')}
            value={newVariable.formula}
            onChange={(e) => setNewVariable({ ...newVariable, formula: e.target.value })}
            className="text-sm"
          />
          <div className="flex gap-2">
            <Input
              placeholder={t('spaces.variables.fieldDescription')}
              aria-label={t('spaces.variables.fieldDescription')}
              value={newVariable.description}
              onChange={(e) => setNewVariable({ ...newVariable, description: e.target.value })}
              className="text-sm flex-1"
            />
            <button
              onClick={handleAdd}
              disabled={addMutation.isPending}
              className="px-3 py-1.5 text-xs font-medium bg-[var(--accent-primary)] text-white rounded-md hover:bg-[var(--accent-primary)]/90 transition-colors disabled:opacity-50"
            >
              {addMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('spaces.variables.add')}
            </button>
          </div>
        </div>
      </div>

      {/* Variables list */}
      <div className="space-y-1">
        {variables.length === 0 ? (
          <div className="text-center py-8 text-[var(--text-tertiary)]">
            {t('spaces.variables.empty')}
          </div>
        ) : (
          variables.map((v) => (
            <div
              key={v.id}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--bg-secondary)] group"
            >
              {editingId === v.id ? (
                // Edit mode
                <>
                  <Input
                    aria-label={t('spaces.variables.name')}
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="text-sm w-32"
                  />
                  <Input
                    aria-label={t('spaces.variables.formula')}
                    value={editForm.formula}
                    onChange={(e) => setEditForm({ ...editForm, formula: e.target.value })}
                    className="text-sm flex-1"
                  />
                  <Input
                    aria-label={t('spaces.variables.fieldDescription')}
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    className="text-sm w-40"
                    placeholder={t('spaces.variables.fieldDescription')}
                  />
                  <button
                    aria-label={t('common.save')}
                    onClick={saveEdit}
                    className="p-1.5 text-green-400 hover:bg-green-500/10 rounded"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    aria-label={t('common.cancel')}
                    onClick={() => setEditingId(null)}
                    className="p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] rounded"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                // View mode
                <>
                  <code className="text-sm font-mono text-[var(--accent-primary)] bg-[var(--accent-primary)]/10 px-2 py-0.5 rounded">
                    {v.name}
                  </code>
                  <span className="text-xs text-[var(--text-tertiary)]">=</span>
                  <code className="text-sm font-mono text-[var(--text-secondary)] flex-1 truncate">
                    {v.formula}
                  </code>
                  {v.value !== null && (
                    <span className="text-sm font-medium text-[var(--text-primary)] bg-[var(--bg-secondary)] px-2 py-0.5 rounded">
                      → {v.value}
                    </span>
                  )}
                  {v.description && (
                    <span className="text-xs text-[var(--text-tertiary)] truncate max-w-32">
                      {v.description}
                    </span>
                  )}
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                    <button
                      aria-label={t('common.edit')}
                      onClick={() => startEdit(v)}
                      className="p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      aria-label={t('common.delete')}
                      onClick={() => deleteMutation.mutate(v.id)}
                      className="p-1.5 text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
        </div>
      )}
    </div>
  );
};
