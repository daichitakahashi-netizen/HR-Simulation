# アーキテクチャ及びコーディングガイドライン

## 1. 技術スタック
- フロントエンド: Angular 17+ (Standalone Components)
- UIライブラリ: Angular Material
- バックエンド/DB: Firebase Firestore

## 2. 実装方針と責任分界
- **UI (Angular Material):** カスタムCSSは原則記述せず、MatTable, MatCard, MatButton等のコンポーネントとAngularの標準Flex/Gridのみで構成すること。
- **計算ロジック (`calculator.service.ts`):** 状態を持たない純粋関数（Pure Functions）として実装し、入力値に対して常に同じ計算結果（売上・利益など）を返すこと。
- **最適化アルゴリズム (`optimizer.service.ts`):** 100名（3^100通り）の総当たりは計算爆発を起こすため、貪欲法（Greedy）や局所探索（Local Search）などのヒューリスティックなアプローチを採用すること。
- **データ永続化 (`firebase.service.ts`):** 実行したシミュレーション結果（課題1〜4等）の保存と読み込みのみを担当。環境変数（`environment.ts`）から設定を読み込む。

## 3. AI（Claude Code）への厳守事項
1. **最小限の編集:** 指示されたファイルのみを編集し、勝手に他のファイルをリファクタリングしないこと。
2. **コマンドの制限:** `ng generate`等は実行して良いが、テストやビルドエラーが発生した場合は自律的な再試行（無限ループ）を行わず、直ちに停止して人間に指示を仰ぐこと。
3. **セキュリティ:** FirebaseのAPIキーや機密情報を出力しないこと。
4. **出力:** 解説は一切不要。必要なコードの追加・修正のみを出力・実行すること。