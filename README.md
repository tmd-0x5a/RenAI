# 恋AI（Ren AI）

![Next.js](https://img.shields.io/badge/Next.js-black?style=flat-square&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![Tailwind_CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri-FFC131?style=flat-square&logo=tauri&logoColor=white)

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
RenAI/
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
- システムプロンプトとパース処理の強化により、AIの思考プロセス（Thinking Process）や英語、システムログ（Draft等）の不要な出力を厳格に除外し、純粋なセリフのみを抽出
- 高難易度推論モデル向けの最大トークン数拡張（4096）による長文生成時の途絶防止と、安全なフォールバック処理
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
-m <model_path> --host 127.0.0.1 --port 8080 --ctx-size 2048 --n-gpu-layers 0 --chat-template chatml
```
> ※`--chat-template chatml` を付与することで、一部モデルに内蔵された強制思考モード（Thinking Process）を上書きし、即座に発話を生成させています。

### 開発・デバッグ機能
- 開発環境（`tauri dev`）で起動時、AIエンジンが生成している全トークン（思考プロセスなど、画面上に表示されない出力含む）がリアルタイムでRust側のコンソールへストリーミング出力され、AIの内部状態を容易に監視できます。

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

| モデル名 | 位置づけ | メモリ/VRAM目安 | 特徴 | 推奨GPU |
|--------|--------|-----------|------|---------|
| `Qwen3-VL-4B-Instruct-Q4_K_M.gguf` | **標準** | 4GB ~ | 品質と速度の優れたバランス | RTX 3060 等 (VRAM 6GB以上) |
| `Qwen3.5-0.8B-JP-Q4_K_M.gguf` | **超軽量** | 1.5GB ~ | 日本語特化・最速 | なし (CPUでもサクサク動作) |
| `Qwen3.5-9B-Q8_0.gguf` | **最高品質** | 10GB ~ | 最高品質・かなり遅い | RTX 4070 等 (VRAM 12GB以上) |

> ファイル名の末尾がモデルの量子化レベルです。Q8_0が高品質、Q4_K_Mが品質と速度のバランス型です。

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

## 推論エンジンの自動セットアップ機能について（免責事項）

本アプリでは、処理速度を向上させるための「推論エンジン（llama.cpp）」を、アプリ内の設定画面からワンクリックでインストールする機能を提供しています。
お使いのPC環境（OS：Windows/macOS/Linux、GPU：NVIDIA製GPUの有無など）を自動判定し、最適なバージョンの実行ファイルとライブラリ（WindowsでCUDA環境の場合は必要なcudart等も同梱）を[llama.cpp の公式リリース](https://github.com/ggerganov/llama.cpp)から自動的に一括ダウンロードして配置・実行します。

> **※ダウンロード時のライセンス同意について**
> この機能は `llama.cpp` を利用するため、ダウンロード開始時にMITライセンス（[https://github.com/ggml-org/llama.cpp/blob/master/LICENSE](https://github.com/ggml-org/llama.cpp/blob/master/LICENSE)）への同意ダイアログが表示されます。

### 手動での推論エンジン設定について

自動設定機能を利用せず、ご自身で推論エンジンを手動設定する場合は以下の手順で行ってください。

1. [llama.cpp 公式リリース (Releases)](https://github.com/ggerganov/llama.cpp/releases/latest) にアクセスします。
2. お使いのOS環境（GPUドライバのバージョン等）に適したビルドの圧縮ファイル（Windowsの場合は `.zip`、Mac/Linuxの場合は `.tar.gz`）をダウンロードしてください。
   * ※NVIDIA製GPUでCUDA 12を使用する場合は、`cudart-llama-bin-win-cuda-...` 等のランタイムDLLも含めてダウンロードが必要です。
3. ダウンロードしたアーカイブを解凍し、中にある実行ファイル（`llama-server.exe` または `llama-server` 等）およびすべての付随するライブラリ群（`.dll`, `.so`, `.dylib` 等）を抽出し、すべて同じ階層で以下のディレクトリに配置してください。
   * **配置先パス:** `<リポジトリルート>/src-tauri/target/debug/bin/cuda/` (デバッグビルド時) または `<リポジトリルート>/src-tauri/bin/cuda/` (本番ビルド時など) 
     * ※ `cuda` フォルダが存在しない場合は作成してください。

4. 実行ファイル（`llama-server.exe`等）が `<前記パス>` の直下に配置されれば準備完了です。アプリ上から推論エンジンを「GPU」に切り替えて実行できます。

> [!CAUTION]  
> **免責事項**  
> 本機能を使用してインターネットから実行ファイル等をダウンロード・配置・実行することによって生じたいかなる損害、情報の消失、またはその他の不具合について、当方は一切の責任を負いません。  
> 外部バイナリの実行を伴いますので、**すべてご自身の責任（自己責任）においてご利用ください。**

## 既知の制限事項

- localStorageベースのため、テキストデータ（会話履歴）が大量になると容量制限に到達する可能性があります。
- 起動時にデフォルトモデル → localStorageの選択モデルへの二重起動が発生します。
- Tailwind CSS v4の一部ユーティリティ（`size-*`）が特定環境で適用されない場合があり、インラインstyleで対応している箇所があります。
