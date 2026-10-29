import { useMutation, useQueryClient } from '@tanstack/react-query';
import { mailApi } from '../api/mailApi';
import type { MailFolderId } from '../types';

/**
 * User-folder CRUD (create / rename / delete) for the rail. Folders are
 * space-scoped like labels, so the mutations key on `spaceId` alone and
 * invalidate every connector's folder list. A delete also refreshes the
 * message lists: the server moves the folder's messages back to Inbox.
 */
export function useUserFolderMutations(spaceId: number | undefined) {
  const qc = useQueryClient();
  const invalidateFolders = () => {
    void qc.invalidateQueries({ queryKey: ['mail', 'folders', spaceId] });
  };
  const create = useMutation({
    mutationFn: (name: string) => mailApi.userFolders.create(spaceId!, name),
    onSuccess: invalidateFolders,
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: MailFolderId; name: string }) =>
      mailApi.userFolders.rename(spaceId!, id, name),
    onSuccess: invalidateFolders,
  });
  const remove = useMutation({
    mutationFn: (id: MailFolderId) => mailApi.userFolders.remove(spaceId!, id),
    onSuccess: () => {
      invalidateFolders();
      void qc.invalidateQueries({ queryKey: ['mail', 'messages', spaceId] });
    },
  });
  return { create, rename, remove };
}
