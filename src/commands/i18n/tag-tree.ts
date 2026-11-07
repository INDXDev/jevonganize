/** Terminal translations for the tag tree; tags and paths stay in their original form. */
export const tagTreeMessages = {
  'Tags as a tree, by facet and "/"': [
    'タグをファセットと「/」で木構造に表示',
    '按分面和“/”以树状显示标签',
  ],
  'Plan to move a tag, and every tag under it': [
    'タグを配下のタグごと移動するプランを作成',
    '计划移动标签及其下所有标签',
  ],
  'Move it under this tag': ['このタグの下へ移動', '移到此标签之下'],
  'Move it to the top of its facet': ['ファセットの最上位へ移動', '移到其分面的最上层'],
  'Rename every tag under it too': ['配下のタグもすべて改名', '同时重命名其下所有标签'],
  'Give either --under <parent> or --top': [
    '--under <親> か --top のどちらか一方を指定してください',
    '请指定 --under <父标签> 或 --top 其中之一',
  ],
  '{files}  ({direct} on the tag itself)': [
    '{files}  （タグ自体に {direct}）',
    '{files}  （标签本身 {direct}）',
  ],
  '  {files} files merge into existing {tag}': [
    '  {files} 件は既存の {tag} と統合されます',
    '  {files} 个文件将合并到现有的 {tag}',
  ],
  'Redundant parents': ['冗長な親タグ', '冗余的父标签'],
  '  {tag} with {parent}   {files} files': [
    '  {tag} と {parent}   {files} 件',
    '  {tag} 与 {parent}   {files} 个文件',
  ],
} as const;
