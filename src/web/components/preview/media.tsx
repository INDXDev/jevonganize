import { fileUrl } from '../../api.ts';
import type { KindProps } from './index.tsx';

/** The browser's own player, on `/file/:id` with range requests. */
export default function Media({ file, onFail }: KindProps) {
  const Player = file.mime?.startsWith('video/') ? 'video' : 'audio';
  return (
    <div className="grid size-full place-items-center bg-surface-3 p-2">
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- a user's own file has no captions */}
      <Player
        controls
        preload="metadata"
        src={fileUrl(file.id)}
        onError={onFail}
        className="max-h-full max-w-full"
      />
    </div>
  );
}
