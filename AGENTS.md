# AGENTS.md — Stratum Geo-BIM 開発ガイド

このドキュメントは、人間・AIエージェント双方がこのリポジトリを安全に変更するための
アーキテクチャ・コマンド・規約・不変条件をまとめたものです。

## 1. プロダクト概要

- **Stratum Arch Studio**: 敷地選定 → 地下埋設推論 → 3層BIMプラン生成 → 図面エクスポートを行う建築支援アプリ
- フロントエンド: React 19 + TypeScript + Vite + Tailwind CSS v4 + Three.js
- バックエンド: FastAPI + Pydantic（物理制約バリデータ・ルールベースSLM）
- 学習データ・推論はすべてローカル完結（APIキー不要）

## 2. アーキテクチャ

### ディレクトリ構成

```text
frontend/src/
├── main.tsx        # エントリーポイント
├── Root.tsx        # 画面遷移ルーター (Welcome -> Map -> Wizard -> Studio)
├── components/     # 再利用UI (ThemeToggle)
├── pages/          # 画面単位 (Welcome / LandMapExplorer / Wizard / ai_bim_3d)
└── lib/            # ドメインロジック (realSiteData / SubsurfaceInferenceEngine / ArchitecturalDrawings)

backend/
├── server.py               # FastAPI 推論サーバー＆物理整合性バリデータ
├── dataset_generator.py    # 3層BIM学習データ生成器（住宅・商業・クリニック・ラボ）
├── subsurface_ml_engine.py # 地下埋設インフラ ML/物理拘束推論エンジン
├── verify_pipeline.py      # E2Eパイプライン監査＆SVG図面エクスポーター
└── train_qlora.py           # SLM用 QLoRA ファインチューニングスクリプト

backend/tests/      # ユニットテスト (unittest / 標準ライブラリのみ)
data/               # 学習データ (train_stratum_bim.jsonl 500件)
schema/             # stratum_bim_schema.json (3層BIM厳密JSONスキーマ)
models/             # QLoRAファインチューニング済みアダプタ
```

### データフロー

1. `frontend` (Vite dev: ポート5173) は `/api/*` を `http://127.0.0.1:8000` へプロキシ (`frontend/vite.config.ts`)
2. `backend/server.py` (FastAPI) が `/api/generate-blueprint`, `/api/validate-blueprint` 等を受ける
3. 推論は Ollama / vLLM があれば利用し、なければルールベースSLM (`generate_from_prompt_rule_slm`) にフォールバック
4. 生成されたBIM JSONは `validate_and_repair_blueprint` で物理制約を検証・自動補正して返却

### 3層BIMモデル

- **Structure層**: skeleton.columns (通し柱グリッド), skeleton.cores (階・EVシャフト)
- **MEP層**: 給排水・ガス・電気設備のシャフト・配管経路
- **Infill層**: 部室割 (rooms)・建具・内装

## 3. 開発コマンド

```sh
# 一括起動 (バックエンド8000 + フロントエンド5173 + ヘルスチェック)
python3 start_studio.py            # 停止: python3 start_studio.py --stop

# フロントエンド単体
cd frontend && npm ci && npm run dev

# 型検査・ビルド
cd frontend && npm run typecheck  # tsc -b
cd frontend && npm run build       # tsc -b && vite build

# バックエンドのユニットテスト (依存インストール不要・標準ライブラリのみ)
python3 -m unittest discover -s backend/tests -t . -v

# バックエンド個別起動
python3 -m uvicorn backend.server:app --host 127.0.0.1 --port 8000

# E2Eパイプライン監査 (data/ の500件全件に物理制約監査)
python3 backend/verify_pipeline.py

# 学習データセットの再生成
python3 backend/dataset_generator.py
```

## 4. コーディング規約

### TypeScript / React (frontend)
- `tsconfig.json` は `strict: true`。`any` の使用禁止（現状ゼロを維持する）
- 相対importは `./` `../` のみ。`@/` 等のエイリアスは使わない
- スタイリングは Tailwind CSS v4 ユーティリティのみ:
  - 色は `@theme` トークン (`cyan-*`, `slate-*`, `canvas`, `surface`, `raised`, `hover`, `on-accent`) を使う
  - 生CSSの追加は `index.css` の `@theme` / `@layer base` に限る
  - アニメーションは `@theme` の `--animate-*` で定義する（手書き `.animate-*` クラスは作らない）
- ライト/ダークテーマは `html[data-theme]` の CSS変数オーバーライドで実現する

### Python (backend)
- すべての公開関数に型ヒントを付ける（現在はほぼ完全。維持する）
- モジュール冒頭にDocstring（日本語で可）を置く
- `dataset_generator.py` と `subsurface_ml_engine.py` は**標準ライブラリのみ**で動作する純関数モジュールとして維持する（CIで依存ゼロでテストできる根拠）
- 依存追加は最小限に。新規依存は `requirements.txt` にバージョン下限付きで明記

## 5. 不変条件（変更時に必ず維持する物理・建築ルール）

`backend/validate_blueprint()` と `server.py` の `validate_and_repair_blueprint()` が保証する制約:

1. **敷地境界制約**: `abs(r.x) + r.w/2 <= site.width/2` かつ `abs(r.z) + r.d/2 <= site.depth/2`
2. **同一階非重複制約** (AABB Collision): 部屋同士および部屋とコア (`skeleton.cores`) は干渉しない。辺接触（隙間ゼロ）は干渉とみなさない (`eps = 1e-4`)
3. **設備シャフト近接制約**: `needsPlumbing == True` の部屋は plumbing シャフト半径 3.5m 以内に配置する
4. **通し柱グリッド整合性**: `skeleton.columns` は欠損・敷地外れがないこと

範囲制約: `site.width/depth ∈ [6, 30]`, `site.floors ∈ [1, 5]`, `site.floorHeight ∈ [2.8, 4.5]`

`backend/tests/` の round-trip 性質テスト（生成器→バリデータ）がこの保証を守っている。
**生成ロジックを変更したら必ず `python -m unittest discover -s backend/tests -t .` を通すこと。**

## 6. 変更時のチェックリスト

1. `cd frontend && npm run typecheck && npm run build` が通る
2. `python -m unittest discover -s backend/tests -t . -v` が通る（31テスト）
3. 物理制約（§5）を壊す変更でないか確認する
4. READMEの該当セクション（ディレクトリ構成・API一覧）を更新する

## 7. 既知の技術的負債（計画的に解消する）

- **長大関数の分割（未実施）**: `inferLandSubsurface()` 669行、`generate_residential_blueprint()` 377行、`analyzeRealSite()` 333行、`validate_and_repair_blueprint()` 185行。テスト安全網があるため、§5の不変条件を守りつつ段階的に分割する
- **ESLint / Prettier 未導入**: `package-lock.json` の再生成が必要なため、手元で `npm i -D eslint typescript-eslint prettier` して lockfile ごとコミットする形で導入する
- **`data/train_stratum_bim.jsonl` (7.5MB) を生でGit管理**: LFS移行は履歴書き換えが必要なため見送り中
- **循環import**: `lib/SubsurfaceInferenceEngine.tsx` ⇄ `pages/ai_bim_3d.tsx`（type-only import。分割時に解消候補）
