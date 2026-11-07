/** Interface copy for favorite tags; English keys are the default text. */
export const favorites = {
  Favorites: ['お気に入り', '收藏'],
  'Press ☆ on a tag to pin it here': [
    'タグの ☆ を押すとここに並びます',
    '点击标签上的 ☆ 即可固定到这里',
  ],
  'Favorite {tag}': ['{tag} をお気に入りにする', '收藏 {tag}'],
  'Add to favorites': ['お気に入りに追加', '添加到收藏'],
  'Remove from favorites': ['お気に入りから外す', '从收藏中移除'],
  'Add to favorites: {tag}': ['お気に入りに追加: {tag}', '添加到收藏：{tag}'],
  'Add {tag} to {count} files': [
    '{count} 件のファイルに {tag} を付ける',
    '为 {count} 个文件添加 {tag}',
  ],
  '{tag}: drop files to tag them, drag to reorder, Alt+click to exclude': [
    '{tag}: ファイルをドロップでタグ付け、ドラッグで並べ替え、Alt+クリックで除外',
    '{tag}：拖入文件即可添加标签，拖动可排序，Alt+点击可排除',
  ],
} as const;
