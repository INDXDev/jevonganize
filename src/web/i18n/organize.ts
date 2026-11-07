/** Interface copy for onboarding, the Organize dialog and run estimates; English keys are the default text. */
export const organize = {
  'Before you start': ['実行前に', '开始之前'],
  Topics: ['トピック', '主题'],
  'Topics apply to every folder. Changing them asks topic again on the next run.': [
    'トピックは全フォルダー共通です。変更すると次回の実行でtopicを聞き直します。',
    '主题对所有文件夹生效。更改后，下次运行会重新询问 topic。',
  ],
  'Tags are written when the run ends, and undo reverses them. Answers are cached, so running the same files again costs nothing.':
    [
      '実行が終わるとタグを書き込みます。元に戻すこともできます。回答はキャッシュされるため、同じ内容のファイルを再実行しても費用はかかりません。',
      '运行结束后写入标签，可以撤销。回答会被缓存，因此再次运行相同文件不产生费用。',
    ],
  'Read from the environment.': ['環境変数から読み込みます。', '从环境变量读取。'],
  'Use OPENAI_API_KEY from the environment': [
    '環境変数の OPENAI_API_KEY を使う',
    '使用环境变量 OPENAI_API_KEY',
  ],
  'Choose for me': ['おまかせで選ぶ', '帮我选择'],
  'Choosing…': ['選んでいます…', '正在选择…'],
  '{count} topics chosen': ['{count}件のトピックを選択中', '已选择 {count} 个主题'],
  'Pick from 110,000 topics, or leave this to the model: it reads your file names and chooses 100, for about $0.16 at gpt-6-luna prices.':
    [
      '11万件のトピックから選べます。選ばなければ、モデルがファイル名を読んで100件を選びます（gpt-6-lunaの料金で約$0.16）。',
      '可从 11 万个主题中选择。若不选择，模型会读取文件名并选出 100 个（按 gpt-6-luna 价格约 $0.16）。',
    ],
  'It never moves, renames, edits or deletes a file. It only writes tags, and every run can be undone.':
    [
      'ファイルの移動・名前変更・編集・削除は行いません。書き込むのはタグだけで、どの実行も取り消せます。',
      '绝不移动、重命名、编辑或删除文件。只写入标签，每次运行都可以撤销。',
    ],
  'Skip for now': ['今はスキップ', '暂时跳过'],
  'All libraries': ['すべてのライブラリ', '所有文件库'],
  'Add one in Settings': ['設定で追加', '在设置中添加'],
  Limit: ['上限', '数量上限'],
  'Organize at most this many files. Empty means all of them.': [
    '分類するファイル数の上限。空欄ならすべてが対象です。',
    '最多分类的文件数。留空则处理全部。',
  ],
  'Nothing is written until you apply the plan. Answers are cached, so running the same files again costs nothing.':
    [
      'プランを適用するまでタグは書き込まれません。回答はキャッシュされるため、同じ内容のファイルを再実行しても費用はかかりません。',
      '应用计划前不会写入标签。回答会缓存，因此再次处理相同内容的文件不会产生费用。',
    ],
  'Apply when ready': ['準備ができたら適用', '准备好后应用'],
  ' est.': [' 推定', ' 估算'],
  'files in this query': ['この条件のファイル', '符合条件的文件'],
  'files selected': ['選択中のファイル', '所选文件'],
  'In this view': ['この表示範囲', '当前视图'],
  Indexed: ['索引済み', '已索引'],
  Provider: ['プロバイダー', '服务商'],
  Selection: ['選択範囲', '选择范围'],
  'Stored in a file only you can read.': [
    '自分だけが読めるファイルに保存されます。',
    '保存在仅你可读取的文件中。',
  ],
  'Without one, you can still scan and browse.': [
    'キーがなくてもスキャンと閲覧はできます。',
    '没有密钥也可以扫描和浏览。',
  ],
  Change: ['変更', '更改'],
  'your provider': ['設定したプロバイダー', '所选服务商'],
  'For this run only. Settings stay as they are.': [
    '今回の実行だけに使います。設定は変更しません。',
    '仅用于本次运行，不更改设置。',
  ],
  'The enabled facets. Tick others for this run only.': [
    '有効な分類項目です。チェックを変えると今回の実行だけに反映します。',
    '已启用的分类项。更改勾选仅影响本次运行。',
  ],
  'Nothing has run yet. Progress appears here.': [
    'まだ実行されていません。実行すると進行状況が表示されます。',
    '尚未运行。运行后将在此显示进度。',
  ],
  '{count} files found': ['{count}ファイルを検出', '找到 {count} 个文件'],
  'All {count} files, {cost}': ['全{count}ファイル、{cost}', '全部 {count} 个文件，{cost}'],
  '{count} items need review': ['{count}件の確認が必要です', '{count} 项待审核'],
  'No API key for {provider}.': [
    '{provider} のAPIキーがありません。',
    '没有 {provider} 的 API 密钥。',
  ],
  'Organize {count} files': ['{count}ファイルを整理', '整理 {count} 个文件'],
} as const;
