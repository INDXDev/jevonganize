/** Terminal translations for `jevonganize folders`. */
export const folderMessages = {
  '{count} folders are named {name}. Use its id': [
    '{name} という名前のフォルダーが {count} 個あります。ID で指定してください',
    '有 {count} 个名为 {name} 的文件夹，请改用其 ID',
  ],
  'There is no folder {name}. Run: jevonganize folders': [
    'フォルダー {name} はありません。確認: jevonganize folders',
    '没有文件夹 {name}。请运行：jevonganize folders',
  ],
  'No folders yet. Add one: jevonganize folders add <name> --tag <tag>': [
    'フォルダーはまだありません。追加: jevonganize folders add <name> --tag <tag>',
    '还没有文件夹。添加：jevonganize folders add <name> --tag <tag>',
  ],
  'Auto:': ['自動:', '自动：'],
  'Saved folder {name} (id {id}).': [
    'フォルダー {name} を保存しました（ID {id}）。',
    '已保存文件夹 {name}（ID {id}）。',
  ],
  'Files put in it get {tag}.': [
    '入れたファイルには {tag} が付きます。',
    '放入的文件会获得 {tag}。',
  ],
  'It has no home tag, so files cannot be put in it. Add one with --home.': [
    'ドロップ時のタグがないため、ファイルを入れられません。--home で指定してください。',
    '它没有拖放时的标签，因此不能放入文件。请用 --home 指定。',
  ],
  'Deleted folder {name}. No file or tag changed.': [
    'フォルダー {name} を削除しました。ファイルとタグは変わっていません。',
    '已删除文件夹 {name}。文件和标签均未改变。',
  ],
  'Virtual folders: saved tag rules that collect files on their own': [
    '仮想フォルダー: タグのルールを保存し、合うファイルを自動で集めます',
    '虚拟文件夹：保存标签规则，自动收集符合的文件',
  ],
  'Print the folder tree with counts': ['フォルダーの一覧を件数付きで表示', '显示文件夹树及文件数'],
  'Also print one folder per tag namespace and value': [
    'タグの種類と値ごとの自動フォルダーも表示',
    '同时显示按标签类别和值自动生成的文件夹',
  ],
  'Save a folder that collects files by their tags': [
    'タグでファイルを集めるフォルダーを保存',
    '保存按标签收集文件的文件夹',
  ],
  'Collect files with this tag. Repeatable': [
    'このタグを持つファイルを集める。複数指定可',
    '收集具有此标签的文件，可重复指定',
  ],
  'Repeated --tag: a file needs all of them, not any': [
    '複数の --tag をすべて持つファイルだけにする（既定はいずれか）',
    '多个 --tag 时要求全部具备，而不是任一',
  ],
  'Leave out files with this tag. Repeatable': [
    'このタグを持つファイルを除く。複数指定可',
    '排除具有此标签的文件，可重复指定',
  ],
  'Put it inside this folder, which narrows it further': [
    'このフォルダーの中に作り、さらに絞り込む',
    '放在此文件夹中，进一步缩小范围',
  ],
  'The tag files put in it get': ['入れたファイルに付けるタグ', '放入的文件获得的标签'],
  'List the files in a folder, or in a tag such as topic:finance': [
    'フォルダー、または topic:finance などのタグにあるファイルを一覧表示',
    '列出文件夹中的文件，或 topic:finance 等标签下的文件',
  ],
  'Delete a folder and the folders inside it. Files and tags stay': [
    'フォルダーと中のフォルダーを削除。ファイルとタグはそのまま',
    '删除文件夹及其中的文件夹。文件和标签保持不变',
  ],
  'Plan to give files the folder’s home tag': [
    'ファイルにフォルダーのタグを付けるプランを作成',
    '创建为文件添加该文件夹标签的计划',
  ],
  'Plan to remove the folder’s home tag from files': [
    'ファイルからフォルダーのタグを外すプランを作成',
    '创建从文件移除该文件夹标签的计划',
  ],
  'Suggest folders to save, or with --tags, tags for a rule. From tag counts; calls no model': [
    '保存するとよいフォルダー、または --tags でルールに足すタグを提案。タグの件数だけで判断し、モデルは呼びません',
    '建议值得保存的文件夹，或用 --tags 建议规则可添加的标签。只依据标签数量，不调用模型',
  ],
  'Suggest tags for the rule given by --tag, --not-tag and --folder': [
    '--tag・--not-tag・--folder で指定したルールに足すタグを提案',
    '为 --tag、--not-tag 和 --folder 指定的规则建议标签',
  ],
  'Nothing to suggest yet. Scan and organize some files first.': [
    'まだ提案できるものがありません。先にファイルをスキャンして整理してください。',
    '暂无可建议的内容。请先扫描并整理一些文件。',
  ],
  '{count} files match this rule.': [
    'このルールに合うファイルは {count} 件です。',
    '符合此规则的文件有 {count} 个。',
  ],
} as const;
