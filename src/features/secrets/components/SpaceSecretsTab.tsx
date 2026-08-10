/**
 * ADR-0040 P2 — Owner Secrets Vault UI.
 *
 * Embedded as the "Secrets" tab in EditSpaceModal (space 11 owner only).
 * Pattern mirrors ADR-0028 Phase 3 (SpaceConnectorsTab): list / add / edit /
 * reveal / delete. Backend: ticket 140012 (P1), routes /api/v3/secrets.
 *
 * Owner-only gate: non-owners see a placeholder and no API calls fire.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  Copy,
  Eye,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { Modal } from '@/shared/components/ui/Modal';
import { Input } from '@/shared/components/ui/Input';
import { useSpaceAccessLevel } from '@/features/spaces/hooks/useSpaceAccessLevel';
import {
  secretsApi,
  SecretSummary,
  CreateSecretBody,
  UpdateSecretBody,
} from '../api/secretsApi';

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;
const REVEAL_TTL_MS = 30_000;

export interface SpaceSecretsTabProps {
  spaceId: number;
}

export function SpaceSecretsTab({ spaceId }: SpaceSecretsTabProps) {
  const access = useSpaceAccessLevel(spaceId);
  const queryClient = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SecretSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SecretSummary | null>(null);
  const [revealTarget, setRevealTarget] = useState<SecretSummary | null>(null);
  const [revealedFor, setRevealedFor] = useState<{ key: string; plaintext: string } | null>(null);
  const revealTimerRef = useRef<number | null>(null);

  const {
    data: secrets = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['secrets', 'list'],
    queryFn: () => secretsApi.list(),
    enabled: access.isOwner && !access.loading,
    retry: false,
  });

  useEffect(() => {
    return () => {
      if (revealTimerRef.current) {
        window.clearTimeout(revealTimerRef.current);
      }
    };
  }, []);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['secrets', 'list'] });

  const handleReveal = async (key: string) => {
    try {
      const { plaintext } = await secretsApi.reveal(key);
      setRevealedFor({ key, plaintext });
      if (revealTimerRef.current) {
        window.clearTimeout(revealTimerRef.current);
      }
      revealTimerRef.current = window.setTimeout(() => {
        setRevealedFor(null);
        revealTimerRef.current = null;
      }, REVEAL_TTL_MS);
      void refetch();
    } catch (err) {
      toast.error(extractErrorMessage(err) || 'Reveal failed');
    }
  };

  if (access.loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
      </div>
    );
  }

  if (!access.isOwner) {
    return <RestrictedPlaceholder />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--text-tertiary)]">
            Зашифрованное хранилище API-ключей и токенов, доступное MCP-инструментам и агентам.
            Каждый просмотр записывается в audit log.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-[var(--color-primary-500)] hover:bg-[var(--color-primary-600)] text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Добавить секрет
        </button>
      </div>

      {isLoading ? (
        <ListSkeleton />
      ) : secrets.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-2">
          {secrets.map((s) => (
            <SecretRow
              key={s.key}
              secret={s}
              revealedPlaintext={revealedFor?.key === s.key ? revealedFor.plaintext : null}
              onReveal={() => setRevealTarget(s)}
              onEdit={() => setEditTarget(s)}
              onDelete={() => setDeleteTarget(s)}
              onCollapseRevealed={() => {
                if (revealTimerRef.current) {
                  window.clearTimeout(revealTimerRef.current);
                  revealTimerRef.current = null;
                }
                setRevealedFor(null);
              }}
            />
          ))}
        </div>
      )}

      {addOpen && (
        <AddSecretModal
          existingKeys={secrets.map((s) => s.key)}
          onClose={() => setAddOpen(false)}
          onSuccess={() => {
            setAddOpen(false);
            invalidate();
          }}
        />
      )}

      {editTarget && (
        <EditSecretModal
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={() => {
            setEditTarget(null);
            invalidate();
          }}
        />
      )}

      {deleteTarget && (
        <DeleteSecretConfirm
          target={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onSuccess={() => {
            setDeleteTarget(null);
            invalidate();
          }}
        />
      )}

      {revealTarget && (
        <RevealConfirm
          target={revealTarget}
          onClose={() => setRevealTarget(null)}
          onConfirm={async () => {
            const k = revealTarget.key;
            setRevealTarget(null);
            await handleReveal(k);
          }}
        />
      )}
    </div>
  );
}

function RestrictedPlaceholder() {
  return (
    <div className="text-center py-12 bg-[var(--bg-secondary)] border border-dashed border-[var(--border-primary)] rounded-lg">
      <ShieldAlert className="w-10 h-10 text-[var(--text-tertiary)] mx-auto mb-3 opacity-60" />
      <p className="text-sm text-[var(--text-primary)] font-medium mb-1">
        Доступ ограничен
      </p>
      <p className="text-xs text-[var(--text-tertiary)] max-w-sm mx-auto">
        Секреты пространства может просматривать и редактировать только владелец.
        Обратитесь к нему, если нужен доступ.
      </p>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-3 animate-pulse h-14"
        />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-8 bg-[var(--bg-secondary)] border border-dashed border-[var(--border-primary)] rounded-lg">
      <KeyRound className="w-10 h-10 text-[var(--text-tertiary)] mx-auto mb-3 opacity-50" />
      <p className="text-sm text-[var(--text-secondary)] mb-1">
        Секретов пока нет
      </p>
      <p className="text-xs text-[var(--text-tertiary)]">
        Добавьте первый ключ — он будет зашифрован и доступен только MCP-инструментам.
      </p>
    </div>
  );
}

function SecretRow({
  secret,
  revealedPlaintext,
  onReveal,
  onEdit,
  onDelete,
  onCollapseRevealed,
}: {
  secret: SecretSummary;
  revealedPlaintext: string | null;
  onReveal: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCollapseRevealed: () => void;
}) {
  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-3 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="p-1.5 rounded bg-primary-500/10 flex-shrink-0">
              <KeyRound className="w-4 h-4 text-primary-500" />
            </div>
            <code className="font-mono text-sm text-[var(--text-primary)] font-medium">
              {secret.key}
            </code>
            {secret.last_revealed_at && (
              <span className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] font-mono">
                revealed {formatRelative(secret.last_revealed_at)}
              </span>
            )}
          </div>
          {secret.description && (
            <p className="text-xs text-[var(--text-tertiary)] mt-1 ml-8 line-clamp-2">
              {secret.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={onReveal}
            disabled={!!revealedPlaintext}
            title="Reveal plaintext (audit logged)"
            className="p-2 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onEdit}
            title="Edit"
            className="p-2 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete"
            className="p-2 rounded hover:bg-red-500/20 text-[var(--text-secondary)] hover:text-red-500"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {revealedPlaintext !== null && (
        <RevealedField
          plaintext={revealedPlaintext}
          onCollapse={onCollapseRevealed}
        />
      )}
    </div>
  );
}

function RevealedField({
  plaintext,
  onCollapse,
}: {
  plaintext: string;
  onCollapse: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(Math.round(REVEAL_TTL_MS / 1000));

  useEffect(() => {
    const interval = window.setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(plaintext);
      toast.success('Скопировано');
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  return (
    <div className="mt-3 p-2 rounded bg-amber-500/10 border border-amber-500/30">
      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={plaintext}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 bg-transparent border-none outline-none text-sm font-mono text-[var(--text-primary)] select-all"
        />
        <button
          type="button"
          onClick={handleCopy}
          title="Скопировать"
          className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <Copy className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onCollapse}
          className="text-[10px] uppercase tracking-wide font-mono text-amber-600 dark:text-amber-400 hover:text-amber-700 px-1.5"
        >
          скрыть · {secondsLeft}s
        </button>
      </div>
    </div>
  );
}

function AddSecretModal({
  existingKeys,
  onClose,
  onSuccess,
}: {
  existingKeys: string[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [plaintext, setPlaintext] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: CreateSecretBody) => secretsApi.create(body),
    onSuccess: () => {
      toast.success('Секрет добавлен');
      onSuccess();
    },
    onError: (err: Error) => {
      setError(extractErrorMessage(err) || err.message || 'Ошибка');
    },
  });

  const handleSubmit = () => {
    setError(null);
    const trimmedKey = key.trim();
    const trimmedDesc = description.trim();
    if (!trimmedKey) {
      setError('Ключ обязателен');
      return;
    }
    if (!SNAKE_CASE.test(trimmedKey)) {
      setError('Ключ должен быть в snake_case (a-z, 0-9, _, начинается с буквы)');
      return;
    }
    if (existingKeys.includes(trimmedKey)) {
      setError('Ключ уже существует');
      return;
    }
    if (!trimmedDesc) {
      setError('Описание обязательно');
      return;
    }
    if (!plaintext) {
      setError('Значение обязательно');
      return;
    }
    create.mutate({ key: trimmedKey, description: trimmedDesc, plaintext });
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Новый секрет"
      description="Ключ и значение будут зашифрованы (AES-GCM). Plaintext не сохраняется в логах."
      size="md"
      primaryAction={{
        label: create.isPending ? 'Сохранение...' : 'Сохранить',
        onClick: handleSubmit,
        disabled: create.isPending,
      }}
      secondaryAction={{
        label: 'Отмена',
        variant: 'ghost',
        onClick: onClose,
      }}
    >
      <div className="space-y-3">
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
            {error}
          </div>
        )}
        <Input
          id="secret-key"
          label="Ключ"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="openai_api_key"
          autoComplete="off"
          hint="snake_case, уникален в пространстве"
          autoFocus
        />
        <Input
          id="secret-description"
          label="Описание"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Назначение секрета"
          autoComplete="off"
        />
        <div className="flex w-full flex-col gap-1 text-sm">
          <label htmlFor="secret-plaintext" className="font-medium text-[var(--text-secondary)]">
            Значение
          </label>
          <input
            id="secret-plaintext"
            type="password"
            value={plaintext}
            onChange={(e) => setPlaintext(e.target.value)}
            placeholder="sk-..."
            autoComplete="new-password"
            spellCheck={false}
            className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 font-mono text-[var(--text-primary)] outline-none focus:border-[var(--color-primary-500)] focus:ring-1 focus:ring-[var(--color-primary-500)] placeholder:text-[var(--text-tertiary)]"
          />
          <span className="text-xs text-[var(--text-tertiary)]">
            Paste из менеджера паролей работает
          </span>
        </div>
      </div>
    </Modal>
  );
}

function EditSecretModal({
  target,
  onClose,
  onSuccess,
}: {
  target: SecretSummary;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [description, setDescription] = useState(target.description);
  const [plaintext, setPlaintext] = useState('');
  const [error, setError] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: (body: UpdateSecretBody) => secretsApi.update(target.key, body),
    onSuccess: () => {
      toast.success('Сохранено');
      onSuccess();
    },
    onError: (err: Error) => {
      setError(extractErrorMessage(err) || err.message || 'Ошибка');
    },
  });

  const handleSubmit = () => {
    setError(null);
    const trimmedDesc = description.trim();
    if (!trimmedDesc) {
      setError('Описание обязательно');
      return;
    }
    const body: UpdateSecretBody = {};
    if (trimmedDesc !== target.description) {
      body.description = trimmedDesc;
    }
    if (plaintext) {
      body.plaintext = plaintext;
    }
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    update.mutate(body);
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Редактировать: ${target.key}`}
      description="Оставьте поле значения пустым, чтобы не менять plaintext."
      size="md"
      primaryAction={{
        label: update.isPending ? 'Сохранение...' : 'Сохранить',
        onClick: handleSubmit,
        disabled: update.isPending,
      }}
      secondaryAction={{
        label: 'Отмена',
        variant: 'ghost',
        onClick: onClose,
      }}
    >
      <div className="space-y-3">
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
            {error}
          </div>
        )}
        <Input
          id="secret-edit-description"
          label="Описание"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          autoComplete="off"
          autoFocus
        />
        <div className="flex w-full flex-col gap-1 text-sm">
          <label htmlFor="secret-edit-plaintext" className="font-medium text-[var(--text-secondary)]">
            Новое значение (опционально)
          </label>
          <input
            id="secret-edit-plaintext"
            type="password"
            value={plaintext}
            onChange={(e) => setPlaintext(e.target.value)}
            placeholder="Оставьте пустым, чтобы не менять"
            autoComplete="new-password"
            spellCheck={false}
            className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 font-mono text-[var(--text-primary)] outline-none focus:border-[var(--color-primary-500)] focus:ring-1 focus:ring-[var(--color-primary-500)] placeholder:text-[var(--text-tertiary)]"
          />
        </div>
      </div>
    </Modal>
  );
}

function DeleteSecretConfirm({
  target,
  onClose,
  onSuccess,
}: {
  target: SecretSummary;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const remove = useMutation({
    mutationFn: () => secretsApi.remove(target.key),
    onSuccess: () => {
      toast.success('Секрет удалён');
      onSuccess();
    },
    onError: (err: Error) => {
      toast.error(extractErrorMessage(err) || err.message || 'Ошибка удаления');
    },
  });

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Удалить секрет?"
      size="sm"
      primaryAction={{
        label: remove.isPending ? 'Удаление...' : 'Удалить',
        variant: 'danger',
        onClick: () => remove.mutate(),
        disabled: remove.isPending,
      }}
      secondaryAction={{
        label: 'Отмена',
        variant: 'ghost',
        onClick: onClose,
      }}
    >
      <p className="text-sm text-[var(--text-secondary)]">
        Ключ <code className="font-mono text-[var(--text-primary)]">{target.key}</code> будет
        удалён. Инструменты и агенты, использующие его, начнут получать ошибку. Это действие необратимо.
      </p>
    </Modal>
  );
}

function RevealConfirm({
  target,
  onClose,
  onConfirm,
}: {
  target: SecretSummary;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Показать значение?"
      size="sm"
      primaryAction={{
        label: 'Показать',
        onClick: onConfirm,
      }}
      secondaryAction={{
        label: 'Отмена',
        variant: 'ghost',
        onClick: onClose,
      }}
    >
      <p className="text-sm text-[var(--text-secondary)]">
        Plaintext <code className="font-mono text-[var(--text-primary)]">{target.key}</code> будет
        показан на 30 секунд. <strong>Каждый просмотр записывается в audit log</strong> (actor, время, ключ).
      </p>
    </Modal>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffMs = then - Date.now();
  const abs = Math.abs(diffMs);
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  const past = diffMs < 0;
  if (abs < min) return past ? 'just now' : 'in <1m';
  if (abs < hr) {
    const m = Math.round(abs / min);
    return past ? `${m}m ago` : `in ${m}m`;
  }
  if (abs < day) {
    const h = Math.round(abs / hr);
    return past ? `${h}h ago` : `in ${h}h`;
  }
  const d = Math.round(abs / day);
  return past ? `${d}d ago` : `in ${d}d`;
}

function extractErrorMessage(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof Error) {
    try {
      const parsed = JSON.parse(err.message);
      return parsed?.error?.message ?? parsed?.message ?? err.message;
    } catch {
      return err.message;
    }
  }
  return null;
}

export default SpaceSecretsTab;
