/** Terminal translations for `jevonganize report`; tags, paths and model ids stay as they are. */
export const reportMessages = {
  'Model usage and the state of the index. Free and local': [
    'モデルの使用量とインデックスの状態。無料・ローカル処理',
    '模型用量与索引状态，免费且在本地运行',
  ],
  'Tokens and estimated cost of the model calls made here': [
    'このマシンで行ったモデル呼び出しのトークン数と推定コスト',
    '本机模型调用的令牌数与估算费用',
  ],
  'From this local day, such as 2026-11-01': [
    'この日（ローカル時刻）から。例: 2026-11-01',
    '从本地时间的这一天开始，例如 2026-11-01',
  ],
  'Up to, not including, this local day': [
    'この日（ローカル時刻）の前日まで',
    '截至本地时间这一天（不含当天）',
  ],
  'day, week or month (day)': [
    'day・week・month のいずれか（既定 day）',
    'day、week 或 month（默认 day）',
  ],
  'Files per library, kinds, top tags, reviews, plans and cache': [
    'ライブラリごとのファイル数、種類、よく使うタグ、要確認、プラン、キャッシュ',
    '各库的文件数、类型、常用标签、待审核、计划与缓存',
  ],
  '{flag} needs a date such as 2026-11-01': [
    '{flag} には 2026-11-01 のような日付を指定してください',
    '{flag} 需要类似 2026-11-01 的日期',
  ],
  '--bucket is day, week or month': [
    '--bucket には day・week・month のいずれかを指定してください',
    '--bucket 必须是 day、week 或 month',
  ],
  ' ({count} calls with no known price)': [
    '（価格不明の呼び出し {count} 回）',
    '（{count} 次调用价格未知）',
  ],
  '{calls} calls, {input} tokens in, {output} out, about ${cost}{unknown}': [
    '{calls} 回、入力 {input} トークン、出力 {output}、約 ${cost}{unknown}',
    '{calls} 次调用，输入 {input} 令牌，输出 {output}，约 ${cost}{unknown}',
  ],
  '{path}: {files} files, {organized} organized, {tagged} tagged, {failed} failed': [
    '{path}: {files} ファイル、整理済み {organized}、タグあり {tagged}、失敗 {failed}',
    '{path}：{files} 个文件，已整理 {organized}，有标签 {tagged}，失败 {failed}',
  ],
  'Open reviews: {count}': ['要確認: {count}', '待审核：{count}'],
  'Plans: {applied} applied, {undone} undone, {proposed} proposed': [
    'プラン: 適用済み {applied}、取り消し {undone}、提案中 {proposed}',
    '计划：已应用 {applied}，已撤销 {undone}，待处理 {proposed}',
  ],
  'Answer cache: {answers} answers, {share} of files free in 30 days': [
    '回答キャッシュ: {answers} 件、直近30日でファイルの {share} が無料',
    '答案缓存：{answers} 条，近 30 天 {share} 的文件免费',
  ],
} as const;
