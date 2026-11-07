/** Interface copy for refreshing a tag; English keys are the default text. */
export const refresh = {
  refresh: ['タグ更新', '标签刷新'],
  Refresh: ['更新', '刷新'],
  'Checking tag': ['タグを確認中', '正在检查标签'],
  'Refresh {tag}': ['{tag} を更新', '刷新 {tag}'],
  'Find files that should have this tag, and check them': [
    'このタグが付くべきファイルを探して確認',
    '查找应带此标签的文件并进行检查',
  ],
  'similar {score}': ['類似 {score}', '相似 {score}'],
  'file name': ['ファイル名', '文件名'],
  Words: ['特徴語', '特征词'],
  'Tags that go with it': ['よく一緒に付くタグ', '常一起出现的标签'],
  'No file has this tag yet, so only file names were searched. Nothing matched.': [
    'このタグが付いたファイルがまだないため、ファイル名だけを検索しました。一致はありません。',
    '还没有文件带此标签，因此只搜索了文件名。没有匹配项。',
  ],
  'No candidates. Files like these already have the tag, or were checked already.': [
    '候補はありません。似たファイルにはすでにタグが付いているか、確認済みです。',
    '没有候选文件。相似的文件已带此标签，或已检查过。',
  ],
  'No file needs review.': ['レビューが必要なファイルはありません。', '没有需要审核的文件。'],
  '{count} files to review': ['レビュー待ち {count} 件', '{count} 个文件待审核'],
  'Finds files without this tag that look like its files: by their words, the tags that go with it, and similar files. The decision model then checks each one, and the yeses wait in Review. Nothing is tagged until you accept.':
    [
      'このタグが付いたファイルに似ているのにタグがないファイルを、特徴語・よく一緒に付くタグ・類似ファイルから探します。続いて判定モデルが1件ずつ確認し、該当するものはレビューに入ります。承認するまでタグは付きません。',
      '根据特征词、常一起出现的标签和相似文件，查找与带此标签的文件相似但没有此标签的文件。随后由判定模型逐一检查，符合的进入审核。在你接受之前不会添加任何标签。',
    ],
  'Looking for candidates…': ['候補を探しています…', '正在查找候选文件…'],
  '{tagged} files have it · {count} candidates · {checked} already checked': [
    '付与済み {tagged} 件 · 候補 {count} 件 · 確認済み {checked} 件',
    '已有 {tagged} 个 · 候选 {count} 个 · 已检查 {checked} 个',
  ],
  'At most': ['最大', '最多'],
  'Check {count} files': ['{count} 件を確認', '检查 {count} 个文件'],
  'Checked {count} files for a tag': [
    '{count} 件のファイルをタグについて確認しました',
    '已就标签检查 {count} 个文件',
  ],
} as const;
