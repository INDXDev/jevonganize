/** Interface copy for the Dashboard; English keys are the default text. */
export const dashboard = {
  Overview: ['概要', '概览'],
  History: ['履歴', '历史'],
  Period: ['期間', '期间'],
  'Last {count} days': ['過去 {count} 日', '最近 {count} 天'],
  'Cost, last {count} days': ['コスト（過去 {count} 日）', '费用（最近 {count} 天）'],
  'Tokens, in and out': ['トークン（入力と出力）', 'token（输入和输出）'],
  'Open reviews': ['要確認', '待审核'],
  '{input} in · {output} out': ['入力 {input} · 出力 {output}', '输入 {input} · 输出 {output}'],
  '{organized} of {files} files': [
    '{files} ファイル中 {organized}',
    '{files} 个文件中的 {organized} 个',
  ],
  'Some prices are unknown ({count} calls)': [
    '一部の価格が不明です（{count} 回）',
    '部分价格未知（{count} 次调用）',
  ],
  'Estimated from list prices. Decision models bill input only.': [
    '公開価格からの見積もりです。タグを決めるモデルは入力だけに課金されます。',
    '按公开价格估算。决定标签的模型只对输入计费。',
  ],
  'Cost per day': ['日別のコスト', '每日费用'],
  'Cost per day, stacked by feature': [
    '日別のコスト（機能ごとに積み上げ）',
    '每日费用（按功能堆叠）',
  ],
  'Top: {cost}': ['最大 {cost}', '最高 {cost}'],
  'No model calls in this period.': [
    'この期間のモデル呼び出しはありません。',
    '此期间没有模型调用。',
  ],
  'By feature': ['機能別', '按功能'],
  'By model': ['モデル別', '按模型'],
  Feature: ['機能', '功能'],
  Calls: ['呼び出し', '调用'],
  Tokens: ['トークン', 'token'],
  Cost: ['コスト', '费用'],
  'Tag suggestions': ['タグの提案', '标签建议'],
  'Organize (from cache)': ['整理（キャッシュから）', '整理（来自缓存）'],
  'Last scan': ['最終スキャン', '上次扫描'],
  Never: ['なし', '从未'],
  'Kinds of file': ['ファイルの種類', '文件类型'],
  'Top tags': ['よく使うタグ', '常用标签'],
  'Cached answers: {count} · reused in the last 30 days: {rate}': [
    'キャッシュ済みの回答 {count} · 過去 30 日の再利用率 {rate}',
    '已缓存的回答 {count} · 最近 30 天复用率 {rate}',
  ],
} as const;
