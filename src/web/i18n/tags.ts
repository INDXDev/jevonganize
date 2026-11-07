/** Interface copy for the Tags screen: its sections, tree and detail pane; English keys are the default text. */
export const tags = {
  // The section name. `Review` alone is the rail's old screen and the status bar's count.
  'Review (section)': ['要確認', '待审核', 'Review'],
  'Run organize': ['整理を実行', '运行整理'],
  'A closed facet has fixed labels, so this tag cannot move.': [
    'ラベルが決まっている分類項目なので、このタグは移動できません。',
    '此分类项的标签是固定的，因此无法移动此标签。',
  ],
  'Tag path': ['タグの階層', '标签路径'],
  '{direct} files with this tag · {total} with it or a tag under it': [
    'このタグ {direct} 件 · 配下のタグを含めて {total} 件',
    '带此标签 {direct} 个文件 · 含其下标签共 {total} 个',
  ],
  'Show files': ['ファイルを表示', '显示文件'],
  'Make a folder': ['フォルダーにする', '创建文件夹'],
  'Move under…': ['親の下へ移動…', '移到父标签下…'],
  'Move to the top': ['最上位へ', '移到顶层'],
  'Move {tag}': ['{tag} を移動', '移动 {tag}'],
  'New parent': ['新しい親', '新的父标签'],
  'No other tag in this facet to move under.': [
    'この分類項目には移動先にできるタグがほかにありません。',
    '此分类项中没有可作为目标的其他标签。',
  ],
  'Plan move': ['移動をプランにする', '生成移动计划'],
  'Include the tags under it': ['配下のタグも含める', '包括其下的标签'],
  'To review {count}': ['要確認 {count} 件', '待审核 {count} 项'],
  'Accept {name}': ['{name} を承認', '接受 {name}'],
  'Reject {name}': ['{name} を却下', '拒绝 {name}'],
  '{count} redundant parents': ['冗長な親 {count} 件', '{count} 个多余的父标签'],
  'is redundant on {count} files with': [
    'は次のタグがある {count} 件で冗長',
    '在带有以下标签的 {count} 个文件上是多余的',
  ],
  'Remove the parent': ['親を外す', '移除父标签'],
  'Under it': ['配下のタグ', '其下的标签'],
  'Often with it': ['よく一緒に付くタグ', '经常一起出现的标签'],
  '{count} files merge into existing {tag}': [
    '{count} 件は既存の {tag} と統合されます',
    '{count} 个文件将并入现有的 {tag}',
  ],
} as const;
