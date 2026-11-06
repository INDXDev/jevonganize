/** Audio and video: tags from the container, and frames through `ffmpeg` when it is installed. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ifExists } from '../core/config.ts';
import { addImage } from './images.ts';
import { type Extractor, iso, put } from './source.ts';
import { findTool, runTool, withTempDir } from './tools.ts';

/** Only local reads: a crafted container can name playlists and URLs for ffmpeg to fetch. */
const frameArgs = (input: string, seek: string, output: string) => [
  '-nostdin',
  '-v',
  'error',
  '-protocol_whitelist',
  'file',
  '-ss',
  seek,
  '-i',
  input,
  '-frames:v',
  '1',
  output,
];

/** Reads tags, duration and codec. Cover art is skipped. */
export const media: Extractor = async (file, state) => {
  const { parseFile } = await import('music-metadata');
  const { common, format } = await parseFile(file.path, { skipCovers: true });
  put(state, 'title', common.title);
  put(state, 'artist', common.artist);
  put(state, 'album', common.album);
  put(state, 'genre', common.genre?.join(', '));
  put(state, 'duration', format.duration);
  put(state, 'codec', format.codec);
  put(state, 'created', iso(common.date));
};

/** Takes evenly spaced frames, or one from the start when `media` found no duration. */
export const ffmpegFrames: Extractor = async (file, state, budget) => {
  const ffmpeg = findTool('ffmpeg');
  if (!ffmpeg || state.images.length) return;
  const { default: sharp } = await import('sharp');
  const duration = Number(state.metadata.duration) || 0;
  const count = duration ? budget.images : Math.min(1, budget.images);
  await withTempDir(async (dir) => {
    for (let index = 0; index < count; index++) {
      const frame = join(dir, `${index}.png`);
      const seek = String((duration * (index + 0.5)) / count);
      await runTool(ffmpeg, frameArgs(file.path, seek, frame), file);
      const bytes = await ifExists(readFile(frame)); // a seek past the last frame writes nothing
      if (bytes) await addImage(state, budget, sharp(bytes), `frame-${index + 1}`);
    }
  });
};
