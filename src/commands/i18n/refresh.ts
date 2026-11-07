/** Terminal translations for `refresh`; identifiers, tags and paths stay in their original form. */
export const refreshMessages = {
  'Find files that should probably have a tag, and check them': [
    'タグが付いていないが付くべきファイルを探して確認',
    '查找可能应带此标签的文件并进行检查',
  ],
  'Check at most this many files (50, at most 200)': [
    '確認するファイルの最大数（既定50、最大200）',
    '最多检查的文件数（默认 50，最多 200）',
  ],
  'List the candidates and the estimate, and stop': [
    '候補と見積もりを表示して終了',
    '列出候选文件和估算后停止',
  ],
  '{tag}: {tagged} files have it, {count} candidates, {checked} already checked': [
    '{tag}: 付与済み {tagged} 件、候補 {count} 件、確認済み {checked} 件',
    '{tag}：已有 {tagged} 个文件，候选 {count} 个，已检查 {checked} 个',
  ],
  'similar {score}': ['類似 {score}', '相似 {score}'],
  name: ['名前', '名称'],
  'No candidates. Nothing was sent.': [
    '候補はありません。何も送信していません。',
    '没有候选文件。未发送任何内容。',
  ],
  '{count} files to review: jevonganize review --tag {tag}': [
    'レビュー待ち {count} 件: jevonganize review --tag {tag}',
    '{count} 个文件待审核：jevonganize review --tag {tag}',
  ],
  Checking: ['確認中', '正在检查'],
} as const;
