/** Interface copy for virtual folders; English keys are the default text. */
export const folders = {
  'Pinned {name}': ['{name} をフォルダーとして固定しました', '已将 {name} 固定为文件夹'],
  'Collapse {name}': ['{name} を折りたたむ', '折叠 {name}'],
  'Expand {name}': ['{name} を展開', '展开 {name}'],
  'Drop files here to tag them {tag}': [
    'ここにファイルをドロップすると {tag} のタグを付けるプランを作ります',
    '将文件拖放到此处，即可创建添加标签 {tag} 的计划',
  ],
  'New folder inside {name}': ['{name} の中に新しいフォルダー', '在 {name} 中新建文件夹'],
  'Edit {name}': ['{name} を編集', '编辑 {name}'],
  'Pin {name} as a folder': ['{name} をフォルダーとして固定', '将 {name} 固定为文件夹'],
  'None: a top-level folder': ['なし（最上位のフォルダー）', '无（顶层文件夹）'],
  'New folder': ['新しいフォルダー', '新建文件夹'],
  'A virtual folder exists only here. Every file whose tags match its rule collects in it on its own. Nothing on disk moves.':
    [
      '仮想フォルダーはこのアプリの中だけにあります。ルールにタグが合うファイルが自動で集まります。ディスク上のファイルは動きません。',
      '虚拟文件夹只存在于本应用中。标签符合规则的文件会自动归入其中。磁盘上的文件不会移动。',
    ],
  'Empty collects every file, for a folder that only groups others.': [
    '空にするとすべてのファイルが入ります。ほかのフォルダーをまとめるだけのフォルダーに使えます。',
    '留空则包含所有文件，适合只用来归组其他文件夹的文件夹。',
  ],
  Match: ['条件', '匹配方式'],
  'Any of these tags': ['いずれかのタグ', '任一标签'],
  'All of these tags': ['すべてのタグ', '全部标签'],
  Without: ['除外するタグ', '排除的标签'],
  Inside: ['親フォルダー', '上级文件夹'],
  'A folder inside another shows only files that match both.': [
    'ほかのフォルダーの中に作ると、両方のルールに合うファイルだけが表示されます。',
    '放在其他文件夹中时，只显示同时符合两者规则的文件。',
  ],
  'Home tag': ['ドロップ時のタグ', '拖放时的标签'],
  'What a file dropped in gets. Left empty, the rule’s tag when it has exactly one.': [
    'ドロップしたファイルに付けるタグです。空欄なら、ルールのタグが 1 つだけのときにそのタグを使います。',
    '拖放进来的文件会获得此标签。留空时，若规则只有一个标签，则使用该标签。',
  ],
  'Dropping is off': ['ドロップは無効', '已关闭拖放'],
  'Delete folder': ['フォルダーを削除', '删除文件夹'],
  'No folders yet. A folder collects every file whose tags match its rule.': [
    'フォルダーはまだありません。フォルダーには、ルールにタグが合うファイルが集まります。',
    '还没有文件夹。文件夹会收集标签符合其规则的所有文件。',
  ],
  'Auto: one folder per tag': ['自動：タグごとのフォルダー', '自动：每个标签一个文件夹'],
  'Remove from folder': ['フォルダーから外す', '移出文件夹'],
  'Close the folder': ['フォルダーを閉じる', '关闭文件夹'],
  'Only files in the virtual folder {name}': [
    '仮想フォルダー {name} のファイルのみ',
    '仅虚拟文件夹 {name} 中的文件',
  ],
  'Leave the folder': ['フォルダーから出る', '退出文件夹'],
  '{count} files match': ['この条件で {count} 件', '符合条件的文件：{count} 个'],
  'No file matches this rule yet': [
    'この条件に合うファイルはまだありません',
    '暂无符合此规则的文件',
  ],
  'Suggested tags': ['おすすめのタグ', '推荐标签'],
  'Add a tag to the rule': ['ルールにタグを追加', '向规则添加标签'],
  'Create the folder {name}': ['フォルダー {name} を作成', '创建文件夹 {name}'],
  Suggestions: ['おすすめ', '推荐'],
  'No folders yet': ['フォルダーはまだありません', '还没有文件夹'],
  'Pick one to create it. A folder collects every file whose tags match its rule.': [
    'クリックするとフォルダーを作成します。フォルダーには、ルールにタグが合うファイルが集まります。',
    '点击即可创建。文件夹会收集标签符合其规则的所有文件。',
  ],
  'Pick a folder on the left to see its files.': [
    '左のフォルダーを選ぶと、そのファイルが表示されます。',
    '在左侧选择一个文件夹，即可查看其中的文件。',
  ],
  'Make a folder from these files': [
    'このファイルたちからフォルダーを作る',
    '用这些文件创建文件夹',
  ],
} as const;
