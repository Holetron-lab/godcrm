import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage } from '@/shared/i18n/LanguageContext';
import { AudioDraftAttachment } from '../AudioDraftAttachment';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it.each([
  ['ru', 'Прослушать voice.webm', 'Удалить аудио voice.webm'],
  ['en', 'Play voice.webm', 'Remove audio voice.webm'],
])('plays, removes and releases a recording in %s', (language, playLabel, removeLabel) => {
  localStorage.setItem('god-crm-language', language);
  URL.createObjectURL = vi.fn(() => 'blob:voice');
  URL.revokeObjectURL = vi.fn();
  const onRemove = vi.fn();
  const file = new File(['voice'], 'voice.webm', { type: 'audio/webm' });
  const { unmount } = render(<LanguageProvider><AudioDraftAttachment file={file} onRemove={onRemove} /></LanguageProvider>);
  expect(screen.getByRole('button', { name: playLabel })).toBeEnabled();
  expect(document.querySelector('audio')).toHaveAttribute('src', 'blob:voice');
  expect(document.querySelector('audio')).not.toHaveAttribute('controls');
  expect(screen.getByRole('link')).toHaveAttribute('download', file.name);
  fireEvent.click(screen.getByRole('button', { name: removeLabel }));
  expect(onRemove).toHaveBeenCalledOnce();
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:voice');
});

it('updates recording controls when the language changes without replacing the recording', () => {
  localStorage.setItem('god-crm-language', 'en');
  URL.createObjectURL = vi.fn(() => 'blob:voice');
  URL.revokeObjectURL = vi.fn();
  const file = new File(['voice'], 'voice.webm', { type: 'audio/webm' });
  function Example() {
    const { setLanguage } = useLanguage();
    return <><button onClick={() => setLanguage('ru')}>RU</button><AudioDraftAttachment file={file} onRemove={() => {}} /></>;
  }
  render(<LanguageProvider><Example /></LanguageProvider>);
  const audio = screen.getByLabelText('Play voice.webm');
  fireEvent.click(screen.getByText('RU'));
  expect(screen.getByLabelText('Прослушать voice.webm')).toBe(audio);
  expect(URL.createObjectURL).toHaveBeenCalledOnce();
});


it('plays and pauses inline, displays duration and reports a failed play', async () => {
  localStorage.setItem('god-crm-language', 'en');
  URL.createObjectURL = vi.fn(() => 'blob:voice');
  URL.revokeObjectURL = vi.fn();
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const file = Object.assign(new File(['voice'], 'voice.webm', { type: 'audio/webm' }), { duration: 73 });
  render(<LanguageProvider><AudioDraftAttachment file={file} onRemove={() => {}} /></LanguageProvider>);
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '0:00 / 1:13');
  fireEvent.click(screen.getByRole('button', { name: 'Play voice.webm' }));
  expect(play).toHaveBeenCalledOnce();
  const audio = document.querySelector('audio')!;
  fireEvent.play(audio);
  fireEvent.click(screen.getByRole('button', { name: 'Pause voice.webm' }));
  expect(pause).toHaveBeenCalled();
  fireEvent.pause(audio);
  play.mockRejectedValueOnce(new Error('Unsupported'));
  fireEvent.click(screen.getByRole('button', { name: 'Play voice.webm' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
});
