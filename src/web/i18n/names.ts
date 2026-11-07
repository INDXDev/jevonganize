/** Interface copy for the proper names panel; English keys are the default text. */
export const names = {
  Names: ['固有名詞', '专有名词'],
  'Names {count}': ['固有名詞 {count}', '专有名词 {count}'],
  'Proper name': ['固有名詞', '专有名词'],
  'All kinds': ['すべての種類', '所有种类'],
  Person: ['人物', '人物'],
  Organization: ['組織', '组织'],
  Place: ['場所', '地点'],
  Product: ['製品', '产品'],
  Project: ['プロジェクト', '项目'],
  Event: ['イベント', '活动'],
  Add: ['追加', '添加'],
  'Filter names': ['固有名詞を絞り込む', '筛选专有名词'],
  'Register {tag}': ['{tag} を登録', '登记 {tag}'],
  'Unregister {tag}': ['{tag} の登録を解除', '取消登记 {tag}'],
  'A registered name is looked for in every file on each Organize': [
    '登録した名前は、整理のたびに全ファイルで探します',
    '已登记的名称会在每次整理时在所有文件中查找',
  ],
  'Remove from every file, and stop offering it': [
    'すべてのファイルから外し、今後も提案しません',
    '从所有文件移除，并且不再建议',
  ],
  'Organize reads proper names from your files. They appear here.': [
    '整理を実行すると、ファイルから固有名詞を読み取り、ここに表示します。',
    '运行整理后，会从文件中读取专有名词并显示在此处。',
  ],
} as const;
