/** Terminal translations for `facets`, `config`, `auth` and `doctor`. */
export const settingsMessages = {
  'List and enable facets': ['分類項目の一覧・有効化', '列出和启用分类项'],
  'Packs and facets, with * on enabled ones': [
    'パックと分類項目。有効なものに * を表示',
    '分类包和维度，* 表示已启用',
  ],
  'One facet': ['分類項目の詳細', '查看单个分类项'],
  'Enable packs or facets': ['パック・分類項目を有効化', '启用分类包或分类项'],
  'Disable packs or facets': ['パック・分類項目を無効化', '禁用分类包或分类项'],
  'Read and change the config': ['設定の表示・変更', '读取和修改配置'],
  'Print the config, or one key': ['設定全体、または1つのキーを表示', '显示全部配置或单个键'],
  'Validate and save one key': ['1つのキーを検証して保存', '验证并保存一个配置键'],
  'Print the config, data and cache paths': [
    '設定・データ・キャッシュのパスを表示',
    '显示配置、数据和缓存路径',
  ],
  'Open the config in $VISUAL or $EDITOR, then validate': [
    '$VISUAL または $EDITOR で設定を編集し検証',
    '在 $VISUAL 或 $EDITOR 中编辑配置并验证',
  ],
  'Manage API keys': ['APIキーの管理', '管理 API 密钥'],
  'Store a key. Pipe it in for scripts': [
    'キーを保存。スクリプトでは標準入力から渡す',
    '保存密钥，脚本可通过管道传入',
  ],
  'Each provider and where its key comes from': [
    'プロバイダーとキーの取得元',
    '各提供商及其密钥来源',
  ],
  'Delete a stored key': ['保存したキーを削除', '删除已保存的密钥'],
  'Allow or refuse keys from the environment: on or off': [
    '環境変数のキーを許可・拒否: on または off',
    '允许或拒绝使用环境变量密钥：on 或 off',
  ],
  'Use: auth env on, or auth env off': [
    '使い方: auth env on または auth env off',
    '用法：auth env on 或 auth env off',
  ],
  'Check the runtime, key, volumes and optional tools': [
    '実行環境・キー・ボリューム・補助ツールを確認',
    '检查运行环境、密钥、卷和可选工具',
  ],
  '{key} is set. Use keys from the environment?': [
    '{key} が設定されています。環境変数のキーを使いますか？',
    '已设置 {key}。使用环境变量中的密钥吗？',
  ],
  'There is no provider named "{name}"': [
    '"{name}" というプロバイダーはありません',
    '没有名为“{name}”的提供商',
  ],
  'There is no facet named "{id}"': ['"{id}" という分類項目はありません', '没有名为“{id}”的分类项'],
  '{id}  ({kind}, pack {pack}{enabled})': [
    '{id}  ({kind}、パック {pack}{enabled})',
    '{id}  （{kind}，分类包 {pack}{enabled}）',
  ],
  ', enabled': ['、有効', '，已启用'],
  'Levels: {levels}': ['段階: {levels}', '等级：{levels}'],
  'Applies to: {types}': ['対象: {types}', '适用类型：{types}'],
  'every file': ['すべてのファイル', '所有文件'],
  'Enabled {ids}.': ['{ids} を有効にしました。', '已启用 {ids}。'],
  'Disabled {ids}.': ['{ids} を無効にしました。', '已禁用 {ids}。'],
  'There is no config key "{key}"': ['設定キー "{key}" はありません', '没有配置键“{key}”'],
  'The editor did not finish. {draft} is kept': [
    'エディターが終了しませんでした。{draft} を保持しています',
    '编辑器未正常完成，已保留 {draft}',
  ],
  none: ['なし', '无'],
  file: ['ファイル', '文件'],
  env: ['環境変数', '环境变量'],
  note: ['参考', '提示'],
  ok: ['正常', '正常'],
  FAIL: ['失敗', '失败'],
  '{name} API key': ['{name} のAPIキー', '{name} API 密钥'],
  'Stored a key for {name}.': ['{name} のキーを保存しました。', '已保存 {name} 的密钥。'],
  'Removed the key for {name}.': ['{name} のキーを削除しました。', '已删除 {name} 的密钥。'],
  'No key stored for {name}.': ['{name} のキーは保存されていません。', '未保存 {name} 的密钥。'],
  'Environment keys are on.': ['環境変数のキーを許可しました。', '已允许使用环境变量密钥。'],
  'Environment keys are off.': ['環境変数のキーを拒否しました。', '已禁用环境变量密钥。'],
  '{provider} API key (Enter to skip)': [
    '{provider} のAPIキー（Enterでスキップ）',
    '{provider} API 密钥（按 Enter 跳过）',
  ],
  'No key for {provider}. Pipe one to stdin': [
    '{provider} のキーがありません。標準入力から渡してください',
    '没有 {provider} 的密钥，请通过管道传入标准输入',
  ],
} as const;
