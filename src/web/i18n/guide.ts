/** Interface copy for the settings pages and the guided tour; English keys are the default text. */
export const guide = {
  // Settings groups and pages
  Basics: ['基本', '基本'],
  'Language and help': ['言語とヘルプ', '语言与帮助'],
  'The language of the app, and the guided tour.': [
    'アプリの表示言語と、操作ガイドです。',
    '应用的显示语言，以及导览。',
  ],
  'The folders Jevonganize indexes, what it skips, and how it notices changes.': [
    'Jevonganize が読み込むフォルダー、読み飛ばすファイル、変更の見張り方です。',
    'Jevonganize 索引的文件夹、跳过的文件，以及如何发现更改。',
  ],
  'Theme, density and size of this window.': [
    'このウィンドウのテーマ、表示密度、大きさです。',
    '此窗口的主题、密度和大小。',
  ],
  AI: ['AI', 'AI'],
  'AI models': ['AIモデル', 'AI 模型'],
  'Which model decides tags, which one chats, and which one reads names.': [
    'タグを決めるモデル、チャットするモデル、名前を読み取るモデルを選びます。',
    '选择决定标签的模型、用于聊天的模型，以及读取名称的模型。',
  ],
  'Keys for each provider. They stay on this machine and are never shown again.': [
    'AIサービスごとのキーです。この PC から出ることはなく、保存後は二度と表示されません。',
    '各 AI 服务的密钥。它们只保存在本机，保存后不会再次显示。',
  ],
  'Tags and questions': ['タグと質問', '标签与问题'],
  'Tagging rules': ['タグ付けのルール', '标签规则'],
  'Which questions are asked, how sure the model must be, and how many tags a file gets.': [
    'どの質問をするか、モデルにどれだけの確信を求めるか、1ファイルに何個までタグを付けるかを決めます。',
    '要问哪些问题、模型需要多有把握，以及每个文件最多有几个标签。',
  ],
  Advanced: ['詳細', '高级'],
  'Thumbnails, columns and hidden files in the file list.': [
    'ファイル一覧のサムネイル、列、隠しファイルの表示です。',
    '文件列表中的缩略图、列和隐藏文件。',
  ],
  'What is read per file': ['ファイルごとに読む量', '每个文件读取的内容'],
  'How much text, how many pages and images are read and sent for each file.': [
    '1ファイルにつき、どれだけのテキスト・ページ・画像を読み取って送るかです。',
    '每个文件读取并发送多少文本、页面和图像。',
  ],
  'Extraction pipeline': ['抽出パイプライン', '提取流程'],
  'Which readers run for which kinds of file. For experts.': [
    'ファイルの種類ごとに、どの読み取り処理を使うかです。上級者向けです。',
    '为每种文件运行哪些读取器。适合高级用户。',
  ],
  'Server and speed': ['サーバーと速度', '服务器与速度'],
  'The local port, and how many model calls run at once.': [
    'ローカルサーバーのポートと、モデルへの同時リクエスト数です。',
    '本地端口，以及同时进行的模型调用数量。',
  ],
  'Connect an AI client such as Claude Code through MCP.': [
    'Claude Code などの AI クライアントを MCP でつなぎます。',
    '通过 MCP 连接 Claude Code 等 AI 客户端。',
  ],
  'Checks the key, each folder and optional tools, and shows where files are kept.': [
    'キー、各フォルダー、追加ツールを確認し、データの保存場所を表示します。',
    '检查密钥、各文件夹和可选工具，并显示数据的保存位置。',
  ],
  'Settings without a page of their own yet.': [
    '専用のページがまだない設定です。',
    '还没有专属页面的设置。',
  ],
  'Watch for changes': ['変更の見張り', '监视更改'],
  'Keeps the index up to date while the app is open.': [
    'アプリを開いている間、索引を最新の状態に保ちます。',
    '应用打开期间，保持索引为最新。',
  ],
  'Question sets': ['質問セット', '问题集'],
  'Packs or single questions to ask about each file. The Questions screen lists them with their labels.':
    [
      '各ファイルについて尋ねるパックや個別の質問です。分類項目の画面に、ラベルと一緒に一覧があります。',
      '对每个文件提问的问题包或单个问题。分类项页面会连同标签一起列出。',
    ],
  'How sure the model must be': ['モデルに求める確信度', '模型需要多有把握'],
  'Confidence decides whether a tag is applied, sent to Review, or dropped. Changing these costs nothing.':
    [
      '確信度によって、タグをそのまま付けるか、確認に回すか、捨てるかが決まります。変更しても費用はかかりません。',
      '置信度决定标签是直接应用、送去审核，还是丢弃。修改这些不产生费用。',
    ],
  'Easier to change on the Tags screen. Colours stay in the app and are not written to files.': [
    'タグの画面から変えるほうが簡単です。色はアプリ内だけのもので、ファイルには書き込まれません。',
    '在标签页面修改更方便。颜色只保存在应用中，不会写入文件。',
  ],
  'Name patterns to skip, such as *.tmp. Secret files such as .env are always skipped.': [
    '読み飛ばす名前のパターンです（例：*.tmp）。.env などの秘密情報のファイルは常に読み飛ばします。',
    '要跳过的名称模式，例如 *.tmp。.env 等机密文件始终会被跳过。',
  ],
  'Search settings': ['設定を検索', '搜索设置'],
  'No setting matches.': ['一致する設定はありません。', '没有匹配的设置。'],
  'Fix the marked fields to save.': [
    '印の付いた項目を直すと保存できます。',
    '请修正标记的字段后再保存。',
  ],
  'Guided tour': ['操作ガイド', '导览'],
  'A short walk through the main screens. It changes nothing.': [
    '主な画面を順番に案内します。設定やファイルは何も変わりません。',
    '带你快速浏览主要页面，不会更改任何内容。',
  ],
  'Start the tour': ['ガイドを始める', '开始导览'],

  // AI models page
  'Decision model': ['タグを決めるモデル', '决定标签的模型'],
  'Decides every tag': ['すべてのタグを決定', '决定所有标签'],
  'Answers your questions about each file by choosing from fixed labels. Every tag Organize or Refresh adds is decided here, never by the other two models.':
    [
      'ファイルごとに質問へ答え、決められたラベルの中から選びます。整理や更新で付くタグはすべてこのモデルが決め、他の2つのモデルが決めることはありません。',
      '针对每个文件回答问题，并从固定的标签中选择。整理或刷新添加的每个标签都由它决定，绝不会由另外两个模型决定。',
    ],
  "Sends: each file's name, an excerpt of its text, up to the image limit, and metadata. You see the cost before a run.":
    [
      '送る内容：各ファイルの名前、テキストの抜粋、上限までの画像、メタデータ。実行前に費用を確認できます。',
      '发送内容：每个文件的名称、文本摘录、不超过上限的图像以及元数据。运行前会显示费用。',
    ],
  'Chat model': ['チャットのモデル', '聊天模型'],
  'Talks with you in the chat panel, answers questions, and suggests new labels for open questions. It never decides tags.':
    [
      'チャット欄であなたと話し、質問に答え、自由回答の質問に新しいラベルを提案します。タグを決めることはありません。',
      '在聊天面板中与你对话、回答问题，并为开放式问题建议新标签。它从不决定标签。',
    ],
  'Sends: your messages, and the file names, paths and tags its tools look up.': [
    '送る内容：あなたのメッセージと、ツールで調べたファイル名・パス・タグ。',
    '发送内容：你的消息，以及其工具查到的文件名、路径和标签。',
  ],
  'Name-reading model': ['名前を読み取るモデル', '读取名称的模型'],
  'Reads proper names, such as people, companies and places, out of file text during Organize. They become entity: tags you can undo. It never chooses from your questions.':
    [
      '整理のときに、人・会社・地名などの固有名詞をファイルの本文から読み取ります。取り消し可能な entity: タグになります。質問への回答を選ぶことはありません。',
      '整理时从文件文本中读取人名、公司名、地名等专有名称，并成为可撤销的 entity: 标签。它从不回答你的问题。',
    ],
  'Sends: file text. If your decision model runs on your own server, set this too, or text goes to OpenAI.':
    [
      '送る内容：ファイルの本文。タグを決めるモデルを自分のサーバーで動かしている場合は、こちらも設定してください。そのままだと本文が OpenAI に送られます。',
      '发送内容：文件文本。如果决定标签的模型运行在你自己的服务器上，也请设置这里，否则文本会发送到 OpenAI。',
    ],
  'Which model': ['使うモデル', '使用的模型'],
  'Same as the decision model': ['タグを決めるモデルと同じ', '与决定标签的模型相同'],
  'A different model': ['別のモデル', '其他模型'],
  '{service} only decides tags, so this needs a service that writes text.': [
    '{service} はタグの決定専用なので、文章を書ける別のサービスを選んでください。',
    '{service} 只能决定标签，这里需要一个能生成文本的服务。',
  ],
  'Uses {model}.': ['{model} を使います。', '使用 {model}。'],
  'AI service': ['AIサービス', 'AI 服务'],
  'Leave empty to use {model}.': ['空欄なら {model} を使います。', '留空则使用 {model}。'],
  'The model id, such as {example}.': [
    'モデルのIDです（例：{example}）。',
    '模型 ID，例如 {example}。',
  ],
  'Server address': ['サーバーのアドレス', '服务器地址'],
  'The address of your server, such as {example}.': [
    'あなたのサーバーのアドレスです（例：{example}）。',
    '你的服务器地址，例如 {example}。',
  ],
  "Requests go here instead of the service's own address. To remove it, edit config.toml.": [
    'サービス本来のアドレスではなく、ここにリクエストを送ります。消すには config.toml を編集してください。',
    '请求会发送到这里，而不是服务自己的地址。要删除它，请编辑 config.toml。',
  ],
  'Cloudflare account ID': ['Cloudflare のアカウントID', 'Cloudflare 账户 ID'],
  'Find it in the Cloudflare dashboard.': [
    'Cloudflare のダッシュボードで確認できます。',
    '可在 Cloudflare 控制台中找到。',
  ],
  'Required for this provider.': ['このサービスでは必須です。', '此服务必须填写。'],
  'Enter a full address that starts with http:// or https://.': [
    'http:// または https:// で始まるアドレスを入力してください。',
    '请输入以 http:// 或 https:// 开头的完整地址。',
  ],
  'This provider only decides tags, so it cannot do this job.': [
    'このサービスはタグの決定専用なので、この役割には使えません。',
    '此服务只能决定标签，无法承担这项工作。',
  ],
  'Recommended. Needs an OpenAI API key, and accepts images.': [
    'おすすめです。OpenAI の APIキーが必要で、画像も扱えます。',
    '推荐。需要 OpenAI API 密钥，并支持图像。',
  ],
  'Direct access to Jev. It decides tags only, and cannot chat.': [
    'Jev を直接使います。タグの決定専用で、チャットには使えません。',
    '直接使用 Jev。只能决定标签，不能聊天。',
  ],
  'Vercel AI Gateway, which reaches several models with one key.': [
    'Vercel AI Gateway です。1つのキーで複数のモデルを使えます。',
    'Vercel AI Gateway，一个密钥即可使用多个模型。',
  ],
  'Workers AI. Needs your account ID. Text only, and it decides tags only.': [
    'Workers AI です。アカウントIDが必要です。テキストのみで、タグの決定専用です。',
    'Workers AI。需要账户 ID。仅支持文本，且只能决定标签。',
  ],
  'OpenRouter. Set the model id. Its decision endpoint is still in alpha.': [
    'OpenRouter です。モデルIDを指定してください。判定用の窓口はまだアルファ版です。',
    'OpenRouter。请设置模型 ID。其决策接口仍处于 alpha 阶段。',
  ],
  'Your own server that speaks the Jev protocol. A key is optional.': [
    'Jev のプロトコルに対応した自前のサーバーです。キーはなくてもかまいません。',
    '支持 Jev 协议的自有服务器。密钥可选。',
  ],
  'Any OpenAI-compatible chat server, such as Ollama or Groq. Its answers are estimates, so they wait in Review.':
    [
      'Ollama や Groq など、OpenAI 互換のチャットサーバーです。回答は推定値なので、確認に回ります。',
      '任何兼容 OpenAI 的聊天服务器，例如 Ollama 或 Groq。其回答是估算值，因此会进入审核。',
    ],
  'Key stored on this machine.': ['キーはこの PC に保存されています。', '密钥已保存在本机。'],
  'Key taken from the environment.': ['キーは環境変数から読み込んでいます。', '密钥来自环境变量。'],
  'No key. A local server may not need one.': [
    'キーはありません。ローカルのサーバーなら不要な場合があります。',
    '没有密钥。本地服务器可能不需要。',
  ],
  'No key yet. Without one, nothing is sent.': [
    'キーがまだありません。キーがない間は何も送信されません。',
    '还没有密钥。没有密钥时不会发送任何内容。',
  ],
  'Add a key': ['キーを追加', '添加密钥'],
  'Check the key': ['キーを確認', '检查密钥'],
  'Checks the saved settings. Nothing is sent to the service.': [
    '保存済みの設定を確認します。サービスには何も送りません。',
    '检查已保存的设置，不会向服务发送任何内容。',
  ],
  'Save first to check these settings.': [
    'この設定を確認するには、先に保存してください。',
    '请先保存，再检查这些设置。',
  ],
  'Extra models for some questions': ['一部の質問用の追加モデル', '用于部分问题的额外模型'],
  'Optional. A question set uses one by naming it in profile. Each one used costs another request per file. To remove one, edit config.toml.':
    [
      '任意です。質問セットの profile に名前を書くと、そのモデルを使います。使うたびにファイルごとのリクエストが1回増えます。削除するには config.toml を編集してください。',
      '可选。问题集在 profile 中写上名称即可使用。每使用一个，每个文件就多一次请求。要删除，请编辑 config.toml。',
    ],
  'New profile name': ['新しいプロファイルの名前', '新配置档名称'],
  'Name, such as vision': ['名前（例：vision）', '名称，例如 vision'],

  // Guided tour
  'Close the tour': ['ガイドを閉じる', '关闭导览'],
  'Step {step} of {total}': ['{step} / {total}', '第 {step} 步，共 {total} 步'],
  'Not now': ['今はしない', '以后再说'],
  'Skip tour': ['ガイドを終える', '跳过导览'],
  Previous: ['前へ', '上一步'],
  Next: ['次へ', '下一步'],
  Done: ['完了', '完成'],
  'Show me around': ['案内してもらう', '带我看看'],
  'Welcome to Jevonganize': ['Jevonganize へようこそ', '欢迎使用 Jevonganize'],
  'A one-minute tour of the main screens. Jevonganize only adds tags. It never moves, renames or deletes a file.':
    [
      '主な画面を1分で案内します。Jevonganize はタグを付けるだけで、ファイルを移動・名前変更・削除することはありません。',
      '用一分钟带你浏览主要页面。Jevonganize 只添加标签，从不移动、重命名或删除文件。',
    ],
  'Your folders': ['あなたのフォルダー', '你的文件夹'],
  'Folders you added are listed here. Add more in Settings, under Folders.': [
    '追加したフォルダーはここに並びます。増やすときは「設定」の「フォルダー」から追加します。',
    '你添加的文件夹会列在这里。可在“设置”的“文件夹”中添加更多。',
  ],
  'Scanning reads the folder into the index. It runs on this machine and costs nothing.': [
    'スキャンはフォルダーの中身を索引に読み込みます。この PC の中だけで動き、費用はかかりません。',
    '扫描会把文件夹读入索引。它在本机运行，不产生费用。',
  ],
  'The decision model answers a set of questions about each file and picks tags from fixed labels. You see what is sent and the cost before it starts.':
    [
      'タグを決めるモデルが、ファイルごとにいくつかの質問へ答え、決められたラベルからタグを選びます。始める前に、送る内容と費用を確認できます。',
      '决定标签的模型会针对每个文件回答一组问题，并从固定标签中选出标签。开始前你可以看到要发送的内容和费用。',
    ],
  'Answers the model was unsure of wait here. Nothing is written until you accept it.': [
    'モデルが自信を持てなかった回答はここで待っています。あなたが承認するまで、何も書き込まれません。',
    '模型没有把握的回答会在这里等待。你接受之前，不会写入任何内容。',
  ],
  'Every tag in your folders, as a tree. Rename, merge, move and colour them here. Organize, Review and Names are here too.':
    [
      'フォルダー内のすべてのタグを階層で表示します。ここで名前の変更、統合、移動、色分けができます。整理・要確認・固有名詞もこの画面にあります。',
      '以树状显示文件夹中的所有标签。可在这里重命名、合并、移动和设置颜色。整理、待审核和专有名词也在这里。',
    ],
  'Tags you star with ☆ are pinned here. Click one to show its files, or drop files on it to tag them.':
    [
      '☆ を押したタグがここに並びます。クリックでそのタグのファイルを表示し、ファイルをドロップするとタグを付けられます。',
      '点过 ☆ 的标签会固定在这里。点击即可显示其文件，把文件拖到上面即可添加该标签。',
    ],
  'A virtual folder is a saved tag search. Matching files collect in it on their own, and nothing is moved. A suggestion here makes one in a click.':
    [
      '仮想フォルダーは、保存したタグの検索です。条件に合うファイルが自動で集まり、ファイル自体は移動しません。ここのおすすめから1クリックで作れます。',
      '虚拟文件夹是保存下来的标签搜索。符合条件的文件会自动汇集，文件本身不会移动。点击这里的建议即可一键创建。',
    ],
  "A tag's actions": ['タグの操作', '标签操作'],
  'Select a tag to work on it here: star it for Favorites, rename or move it, or Refresh it to find files it may have missed. Every change is a plan you apply.':
    [
      'タグを選ぶと、ここで操作できます。☆ でお気に入りに入れる、名前の変更や移動、「更新」で付け漏れのファイルを探す、などです。変更はすべてプランになり、適用して初めて書き込まれます。',
      '选择一个标签即可在这里操作：点 ☆ 加入收藏、重命名或移动，或用“刷新”查找可能漏掉该标签的文件。每项更改都是一个计划，需你应用后才会写入。',
    ],
  'Model usage and its estimated cost, the state of your folders, and the history. Every change to tags is a plan listed here, and any plan can be undone.':
    [
      'モデルの使用量と費用の見積もり、フォルダーの状態、履歴を表示します。タグへの変更はすべて「プラン」としてここに残り、どのプランも取り消せます。',
      '显示模型用量与估算费用、文件夹的状态以及历史。对标签的每次更改都是一个计划，列在这里，任何计划都可以撤销。',
    ],
  'The questions asked about each file, and the labels each answer can pick. Turn packs on or off and edit them here.':
    [
      '各ファイルに尋ねる質問と、回答で選べるラベルです。ここでパックのオン・オフや編集ができます。',
      '对每个文件提出的问题，以及每个回答可选的标签。可在这里开关和编辑问题包。',
    ],
  'Choose models, add keys and folders. Start this tour again from Settings or the command palette.':
    [
      'モデルの選択、キーやフォルダーの追加はここで行います。このガイドは「設定」やコマンドパレットからもう一度始められます。',
      '在这里选择模型、添加密钥和文件夹。可从“设置”或命令面板再次开始本导览。',
    ],
} as const satisfies Record<string, readonly [string, string]>;
