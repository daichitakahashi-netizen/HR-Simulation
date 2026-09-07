# アーキテクチャ及びコーディングガイドライン（最新版）

## 1. 技術スタック
- フロントエンド: Angular 17+ (Standalone Components)
- UIライブラリ: Angular Material
- バックエンド/DB: Firebase Firestore
- 計算処理: Web Worker + munkres-js

## 2. ディレクトリ構造と役割
- **型定義 (`src/app/core/models/`)**: `employee.model.ts`, `scenario.model.ts`, `simulation.model.ts`
- **サービス階層 (`src/app/core/services/`)**:
  - `simulation-engine.service.ts`: 計算エンジンの統括
  - `simulation-store.service.ts`: 課題1〜4検証用（CSV参照）。BehaviorSubject + Signals による状態管理
  - `hr-planning-store.service.ts`: 経年タレントマネジメント実務用（Firestore参照）。`simulation-store.service.ts` とは完全に分離し、相互の状態を参照しない
  - `firestore.service.ts`, `scenario-repository.service.ts`: Firebase永続化
  - `csv-parser.service.ts`: CSV読み込み
- **バックグラウンド計算 (`src/app/workers/`)**: `simulation.worker.ts`（Web Workerで全探索＋ハンガリアン法を実行。状態を保持しない純粋関数として設計し、`/simulation`・`/hr-planning`双方から共通利用する）
- **UIコンポーネント**: `src/app/features/`, `src/app/shared/`
- **ルーティング**: `/simulation`（課題1〜4検証用、`SimulationStoreService`と連携）と `/hr-planning`（経年実務用、`HrPlanningStoreService`と連携）を分離して定義する（3重の隔離壁：ルーティング／状態管理／計算エンジンの分離）。

## 3. 実装方針とルール
- **UI (Angular Material)**: カスタムCSSは最小限にし、Angular Materialコンポーネントを優先利用すること。
- **計算ロジック**: UIスレッドをブロックしないよう、重い最適化計算はすべて `simulation.worker.ts` へ委譲すること。
- **データ永続化**: シミュレーション結果の保存・読み込みのみ Firebase を使用する。`environment.ts` から設定を読み込み、不要な変更を加えないこと。

## 4. AI（Claude Code）への厳守事項
1. 指示されたファイルのみを編集し、無関係なファイルを勝手にリファクタリングしないこと。
2. テストやビルドエラー時は自律的に何度も再試行せず、直ちに停止してエラーログを出力し確認を求めること。
3. FirebaseのAPIキーや機密情報を出力・変更しないこと。
4. 前置きや解説は一切不要。コードの修正・作成のみを実行すること。