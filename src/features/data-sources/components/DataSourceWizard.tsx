import { useState, useEffect, useMemo } from 'react';
import { logger } from '@/shared/utils/logger';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { Modal } from '@/shared/components/ui/Modal';
import { Input } from '@/shared/components/ui/Input';
import { Button } from '@/shared/components/ui/Button';
import { Select } from '@/shared/components/ui/Select';
import { Switch } from '@/shared/components/ui/Switch';
import { useCreateDataSource, useTestConnection } from '../hooks/useDataSources';
import { CreateDataSourceDto, DataSourceType } from '../types/dataSource.types';
import { dataSourcesApi } from '../api/dataSourcesApi';
import { useSpacesQuery } from '@/features/spaces/hooks/useSpacesQuery';
import { useProjectStore } from '@/features/projects/store/projectStore';

interface DataSourceWizardProps {
  workspaceId: string;
  dataSourceId?: string | null;
  defaultSpaceId?: number | null;
  defaultProjectId?: number | null;
  onClose: () => void;
  onSuccess?: () => void;
}

const defaultPorts: Record<DataSourceType, number> = {
  mysql: 3306,
  postgresql: 5432,
  local_mysql: 3306,
  local_postgresql: 5432,
  sqlite: 0
};

export function DataSourceWizard({ workspaceId, dataSourceId, defaultSpaceId, defaultProjectId, onClose, onSuccess }: DataSourceWizardProps) {
  const { t } = useLanguage();
  const createMutation = useCreateDataSource();
  const testMutation = useTestConnection();
  
  // Space and Project selection
  const { data: spaces = [] } = useSpacesQuery();
  const projects = useProjectStore((state) => state.projects);
  const [targetSpaceId, setTargetSpaceId] = useState<number | null>(defaultSpaceId ?? null);
  const [targetProjectId, setTargetProjectId] = useState<number | null>(defaultProjectId ?? null);
  
  // Filter projects by selected space
  const filteredProjects = useMemo(() => {
    if (!projects) return [];
    if (!targetSpaceId) return projects;
    return projects.filter(p => p.space_id === targetSpaceId);
  }, [projects, targetSpaceId]);
  
  const [formData, setFormData] = useState<CreateDataSourceDto>({
    workspace_id: workspaceId,
    name: '',
    description: '',
    type: 'mysql',
    host: 'localhost',
    port: 3306,
    database: '',
    username: '',
    password: '',
    use_ssh: false
  });

  const [isLoadingData, setIsLoadingData] = useState(!!dataSourceId);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Load existing data source for editing
  useEffect(() => {
    if (dataSourceId) {
      setIsLoadingData(true);
      dataSourcesApi.get(dataSourceId)
        .then((ds) => {
          setFormData({
            workspace_id: workspaceId,
            name: ds.name,
            description: ds.description || '',
            type: ds.type,
            host: ds.host || ds.db_host || 'localhost',
            port: ds.port || ds.db_port || 3306,
            database: ds.database || ds.db_name || '',
            username: ds.username || ds.db_username || '',
            password: '', // Don't show password
            use_ssh: ds.use_ssh || false
          });
        })
        .catch((error) => {
          logger.error('Failed to load data source:', error);
        })
        .finally(() => {
          setIsLoadingData(false);
        });
    }
  }, [dataSourceId, workspaceId]);

  const handleTypeChange = (type: DataSourceType) => {
    setFormData(prev => ({
      ...prev,
      type,
      port: defaultPorts[type]
    }));
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    
    logger.debug('[DataSourceWizard] Validating form:', formData);
    
    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }
    if (!formData.host.trim()) {
      newErrors.host = 'Host is required';
    }
    if (!formData.database.trim() && formData.type !== 'sqlite') {
      newErrors.database = 'Database name is required';
    }
    if (!formData.username.trim()) {
      newErrors.username = 'Username is required';
    }
    // Password is optional for local connections (e.g., root without password)
    // Only validate password for non-local connections
    if (!formData.type.startsWith('local_') && !formData.password.trim()) {
      newErrors.password = 'Password is required';
    }

    if (formData.use_ssh) {
      if (!formData.ssh_host?.trim()) {
        newErrors.ssh_host = 'SSH host is required';
      }
      if (!formData.ssh_user?.trim()) {
        newErrors.ssh_user = 'SSH user is required';
      }
    }

    setErrors(newErrors);
    logger.debug('[DataSourceWizard] Validation errors:', newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleTestConnection = async () => {
    if (!validateForm()) return;

    setTestResult(null);
    
    try {
      // For testing, we need to create the data source first (or use a separate test endpoint)
      // For now, just validate the form and show success
      setTestResult({
        success: true,
        message: 'Configuration validated successfully (connection test will be performed on save)'
      });
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Connection failed'
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    logger.debug('[DataSourceWizard] handleSubmit called');
    logger.debug('[DataSourceWizard] formData:', formData);
    logger.debug('[DataSourceWizard] targetSpaceId:', targetSpaceId, 'targetProjectId:', targetProjectId);
    
    if (!validateForm()) {
      logger.debug('[DataSourceWizard] Validation failed, errors:', errors);
      return;
    }

    logger.debug('[DataSourceWizard] Validation passed, creating data source...');

    try {
      // Use targetProjectId as workspace_id (backend interprets workspace_id as project_id)
      // This ensures data source is created in the correct Space's System Data project
      const dataToSend = {
        ...formData,
        workspace_id: targetProjectId ? String(targetProjectId) : workspaceId,
        project_id: targetProjectId || undefined,
        space_id: targetSpaceId || undefined
      };
      logger.debug('[DataSourceWizard] Sending data:', dataToSend);
      
      const result = await createMutation.mutateAsync(dataToSend);
      logger.debug('[DataSourceWizard] Creation successful:', result);
      onSuccess?.();
      onClose();
    } catch (error) {
      logger.error('[DataSourceWizard] Creation error:', error);
      // Error is handled by the mutation hook
    }
  };

  return (
    <Modal
      open={true}
      onOpenChange={onClose}
      title={t('dataSources.wizard.title')}
      size="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Space and Project selectors */}
        <div className="grid gap-3 grid-cols-2">
          {spaces.length > 0 && (
            <Select
              label="Пространство"
              value={targetSpaceId !== null ? String(targetSpaceId) : ''}
              onChange={(value) => {
                setTargetSpaceId(value ? Number(value) : null);
                setTargetProjectId(null); // Reset project when space changes
              }}
              options={spaces.map((space) => ({ 
                label: `${space.name} (${space.id})`, 
                value: String(space.id) 
              }))}
              placeholder="Все пространства"
            />
          )}
          {projects && projects.length > 0 && (
            <Select
              label="Проект"
              value={targetProjectId !== null ? String(targetProjectId) : ''}
              onChange={(value) => setTargetProjectId(value ? Number(value) : null)}
              options={filteredProjects.map((project) => ({ 
                label: `${project.name} (${project.id})`, 
                value: String(project.id) 
              }))}
              placeholder="Выберите проект"
            />
          )}
        </div>

        {/* Basic Info */}
        <div className="space-y-4">
          <Input
            label={t('dataSources.wizard.name')}
            placeholder={t('dataSources.wizard.namePlaceholder')}
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            error={errors.name}
            required
          />

          <Input
            label={t('dataSources.wizard.description')}
            placeholder={t('dataSources.wizard.descriptionPlaceholder')}
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />

          <Select
            label={t('dataSources.wizard.type')}
            value={formData.type}
            onChange={(value) => handleTypeChange(value as DataSourceType)}
            options={[
              { value: 'mysql', label: 'MySQL (SSH Tunnel)' },
              { value: 'postgresql', label: 'PostgreSQL (SSH Tunnel)' },
              { value: 'local_mysql', label: 'MySQL (Local Server)' },
              { value: 'local_postgresql', label: 'PostgreSQL (Local Server)' },
              { value: 'sqlite', label: 'SQLite' }
            ]}
          />
        </div>

        {/* Connection Settings */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('dataSources.wizard.stepConnection')}
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t('dataSources.wizard.host')}
              placeholder={t('dataSources.wizard.hostPlaceholder')}
              value={formData.host}
              onChange={(e) => setFormData({ ...formData, host: e.target.value })}
              error={errors.host}
              required
            />

            <Input
              label={t('dataSources.wizard.port')}
              type="number"
              value={formData.port.toString()}
              onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 0 })}
              required
            />
          </div>

          <Input
            label={t('dataSources.wizard.database')}
            value={formData.database}
            onChange={(e) => setFormData({ ...formData, database: e.target.value })}
            error={errors.database}
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t('dataSources.wizard.username')}
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              error={errors.username}
              required
            />

            <Input
              label={t('dataSources.wizard.password')}
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              error={errors.password}
              required={!formData.type.startsWith('local_')}
              placeholder={formData.type.startsWith('local_') ? 'Leave empty for root without password' : ''}
            />
          </div>
        </div>

        {/* SSH Tunnel (Optional) - only for non-local connections */}
        {!formData.type.startsWith('local_') && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t('dataSources.wizard.stepSSH')}
            </h3>
            <Switch
              checked={formData.use_ssh || false}
              onCheckedChange={(checked) => setFormData({ ...formData, use_ssh: checked })}
              label={t('dataSources.wizard.useSSH')}
            />
          </div>

          {formData.use_ssh && (
            <div className="space-y-4 pl-4 border-l-2 border-primary-500">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label={t('dataSources.wizard.sshHost')}
                  value={formData.ssh_host || ''}
                  onChange={(e) => setFormData({ ...formData, ssh_host: e.target.value })}
                  error={errors.ssh_host}
                  required
                />

                <Input
                  label={t('dataSources.wizard.sshPort')}
                  type="number"
                  value={formData.ssh_port?.toString() || '22'}
                  onChange={(e) => setFormData({ ...formData, ssh_port: parseInt(e.target.value) || 22 })}
                  required
                />
              </div>

              <Input
                label={t('dataSources.wizard.sshUser')}
                value={formData.ssh_user || ''}
                onChange={(e) => setFormData({ ...formData, ssh_user: e.target.value })}
                error={errors.ssh_user}
                required
              />

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('dataSources.wizard.sshPrivateKey')}
                </label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-xs"
                  rows={4}
                  value={formData.ssh_private_key || ''}
                  onChange={(e) => setFormData({ ...formData, ssh_private_key: e.target.value })}
                  placeholder="-----BEGIN RSA PRIVATE KEY-----"
                />
              </div>
            </div>
          )}
        </div>
        )}

        {/* Test Result */}
        {testResult && (
          <div className={`p-3 rounded-md ${testResult.success ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200' : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'}`}>
            <p className="text-sm font-medium">
              {testResult.success ? '✅' : '❌'} {testResult.message}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
          >
            {t('dataSources.wizard.cancelButton')}
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={handleTestConnection}
            disabled={testMutation.isPending}
          >
            {testMutation.isPending ? t('dataSources.wizard.testing') : t('dataSources.wizard.testButton')}
          </Button>

          <Button
            type="submit"
            variant="primary"
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? t('dataSources.wizard.saving') : t('dataSources.wizard.saveButton')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
