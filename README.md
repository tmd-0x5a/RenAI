# 恋AI（Koi AI）

ローカルLLMを搭載した恋愛シミュレーションチャットアプリ。完全オフラインで動作し、自分だけのキャラクターを作成して会話を楽しめます。

> [!WARNING]  
> **注意: モデルファイルおよび推論バックエンド（llama-server）はこのリポジトリには含まれていません。**  
> 動作させるには、ご自身でGGUF形式のLLMモデルをダウンロードし、所定のフォルダに配置する必要があります。詳細は[モデルファイルの追加](#モデルファイルの追加)をご参照ください。

## 技術スタック

| レイヤー | 技術 | バージョン |
|---------|------|-----------|
| デスクトップフレームワーク | Tauri | v2 (fs/dialog/http プラグイン利用) |
| フロントエンド | Next.js (Turbopack) | 16.1.6 |
| UI | React + Tailwind CSS v4 | React 19.2, TW 4 |
| 言語 | TypeScript / Rust | TS 5, Rust 2021 edition |
| LLM推論 | llama.cpp (llama-server) | sidecar |
| ファイル・HTTP | @tauri-apps/plugin-fs, dialog, http | ローカル画像読込, CORS回避用 |

## プロジェクト構成

```
D:\AI_renai\
├── src/                          # フロントエンド (Next.js)
│   ├── app/
│   │   ├── globals.css           # グローバルCSS・テーマ変数
│   │   ├── layout.tsx            # ルートレイアウト・フォント読込
│   │   └── page.tsx              # メインページ（フェーズ管理・キャラ管理）
│   ├── components/
│   │   ├── CharacterSelect.tsx   # キャラクター選択画面
│   │   ├── SetupScreen.tsx       # キャラ作成・編集画面
│   │   └── GameScreen.tsx        # トーク（チャット）画面
│   └── lib/
│       └── utils.ts              # cn() ユーティリティ (clsx + tailwind-merge)
│
├── src-tauri/                    # バックエンド (Tauri + Rust)
│   ├── src/
│   │   └── lib.rs                # Tauriアプリ設定・llama-server管理・コマンド
│   ├── bin/                      # llama-serverバイナリ + DLL
│   ├── resources/                # GGUFモデルファイル配置先
│   ├── capabilities/             # 機能・権限制御（default.json）
│   ├── tauri.conf.json           # Tauri設定（ウィンドウ・CSP・アセットプロトコル）
│   └── Cargo.toml                # Rust依存関係
│
├── package.json                  # npm依存関係・スクリプト
└── next.config.ts                # Next.js設定（static export）
```

## 機能一覧

### キャラクター管理
- 複数キャラクターの作成・編集・削除
- キャラごとに独立した設定（名前・性格・口調）とトーク履歴
- 立ち絵画像・表情差分画像の設定（ローカルファイルパス形式で保存しlocalStorageを圧迫しない設計）
- 旧単一キャラデータからの自動マイグレーション

### 表情差分システム
- ユーザー定義の表情ラベル（例: 照れ, 笑顔, 怒り）と差分画像を登録
- AIにプロンプトで表情タグ（`[照れ]`, `[通常]` 等）の付与を指示
- レスポンスからタグを解析 → 立ち絵を自動切替 → タグ除去して表示
- `[通常]` タグまたはタグなし → デフォルト画像に戻る

### チャット機能
- llama-serverの `/v1/chat/completions` APIへストリーミング接続
- `@tauri-apps/plugin-http` でブラウザCORS制限を回避
- 会話履歴は直近10件をコンテキストとして送信
- AIの改行レスポンス → 複数チャットバブルとして分割表示（LINE風）
- トーク画面のヘッダー名クリックでキャラ設定（性格・口調・表情差分）を表示

### AIモデル管理
- `src-tauri/resources/` 内の `.gguf` ファイルを自動検出・一覧表示
- UI上でモデルを切替（既存llama-serverをkill → 新モデルで再起動）
- 選択モデルはlocalStorageに保存、次回起動時に自動切替

### データ永続化と画像管理
- テキストデータは `localStorage` に保存
  - `ai-renai-characters`: キャラクター管理配列（設定 + メッセージ履歴）
  - `ai-renai-active-char`: 選択中キャラID / `ai-renai-phase`: 現在のフェーズ / `ai-renai-model`: モデル名
- **画像管理**: 画像の実データ(Base64)は保存せず、Tauri Plugin (`dialog`, `fs`) を利用してローカルの**絶対パス**のみを永続化。画面表示時にはTauriの `asset://` プロトコルを通して安全に読み込みます。

## 画面フロー

```
キャラ選択（select）──→ キャラ作成/編集（setup）
       │                         │
       │                         ↓ 保存
       │                    キャラ選択に戻る
       │
       ↓ キャラ選択
   トーク画面（game）──→ ← ボタンでキャラ選択に戻る
```

## Rust側の構成 (`lib.rs`)

### 管理構造体
- `AppPaths`: リソースディレクトリ・実行ファイル・binディレクトリのパス
- `SidecarState`: llama-serverの子プロセスとパス情報をMutexで管理

### セキュリティと権限制御
- **API通信**: llama-server は `--host 127.0.0.1` でローカルホスト内からのみアクセス可能に制限。
- **ファイルアクセス**: Tauri V2の Capabilities (`src-tauri/capabilities/default.json`) にて、シェルアクセスを llama-server (sidecar) のみに限定。パストラバーサル防止措置も実装。

### Tauriコマンド
| コマンド | 引数 | 返り値 | 機能 |
|---------|------|--------|------|
| `list_models` | なし | `Vec<String>` | resources/内の.ggufファイル名一覧 |
| `switch_model` | `model_name: String` | `Result<String, String>` | 現行サーバーkill → 新モデルで再起動 |

### llama-server起動引数
```
-m <model_path> --host 127.0.0.1 --port 8080 --ctx-size 2048 --n-gpu-layers 0
```

## プロンプト設計 (`buildSystemPrompt`)

システムプロンプトはキャラの設定値から動的に生成：
- キャラ名・性格・口調を埋め込み
- 表情差分ラベルがある場合、使用可能タグ一覧とルールを追加
- 30文字以内・句点禁止・改行で複数メッセージOK等のルール
- `/no_think` で思考トークン抑制

## セットアップ

### 前提条件
- Node.js 18+
- Rust toolchain（rustup）
- llama-server バイナリ（`src-tauri/bin/` に配置）
- GGUFモデルファイル（`src-tauri/resources/` に配置）

### 起動方法
```bash
npm install
npm run tauri dev
```

### モデルファイルの追加

アプリは GGUF 形式のモデルファイルを使用します。

#### 1. モデルの入手

[Hugging Face](https://huggingface.co/) から GGUF 形式のモデルをダウンロードします。

**推奨モデル例：**

| モデル | サイズ | メモリ目安 | 特徴 |
|--------|--------|-----------|------|
| Qwen3.5-0.8B-JP-Q8_0 | ~764 MB | 2 GB | 軽量・高速・CPU向け |
| Qwen3.5-0.8B-JP-Q4_K_M | ~500 MB | 1.5 GB | さらに軽量 |
| Qwen3.5-9B-Q4_K_M | ~5 GB | 8 GB | 高品質・要大容量RAM |
| Qwen3.5-9B-Q8_0 | ~9 GB | 12 GB | 最高品質・かなり遅い |

> ファイル名の末尾がモデルの量子化レベルです。Q8_0が最高品質、Q4_K_Mが品質と速度のバランス型です。

#### 2. ファイルの配置

ダウンロードした `.gguf` ファイルを以下のディレクトリにコピーします：

- **開発時**: `src-tauri/resources/`
- **ビルド後**: アプリの `resources/` ディレクトリ

```
src-tauri/resources/
├── Qwen3.5-0.8B-JP-Q8_0.gguf
├── Qwen3.5-9B-Q4_K_M.gguf
└── (任意の.ggufファイルを追加可能)
```

#### 3. アプリ内で切替

キャラクター選択画面の下部にある「**AIモデル（全キャラ共通）**」セクションで：
1. ドロップダウンから使いたいモデルを選択
2. 「切替」ボタンをクリック
3. 「✓ 切替完了」が表示されれば成功

> 配置したファイルは自動的に一覧に表示されます。アプリの再起動は不要です。

## 既知の制限事項

- localStorageベースのため、テキストデータ（会話履歴）が大量になると容量制限に到達する可能性があります。
- llama-serverは現在CPU推論のみ（`--n-gpu-layers 0`）で動作しています。
- 起動時にデフォルトモデル → localStorageの選択モデルへの二重起動が発生します。
- Tailwind CSS v4の一部ユーティリティ（`size-*`）が特定環境で適用されない場合があり、インラインstyleで対応している箇所があります。
