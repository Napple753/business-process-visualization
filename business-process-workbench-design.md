# 業務フロー管理基盤 構想まとめ

## 目的

Excelベースの業務フロー管理を廃止し、Gitで管理可能なテキストベースの業務フロー管理基盤を構築する。

## 現状課題

- Excelで自由記述できてしまう
- Git差分が実質確認できない
- As-Is / To-Be比較が困難
- レビュー品質が属人的
- プロセス挿入・削除・並び替えが面倒
- コネクタ張り替え作業が発生
- プロセス名変更時の追跡が困難

---

# 管理対象

業務フローは以下3要素で構成する。

## Swimlane

業務参加者。

例:

- 営業
- 課長
- システム
- 顧客

## Process

業務工程。

例:

- 受注
- 承認
- 登録

## Flow

工程間の接続。

例:

- 受注 → 承認
- 承認 → 登録

---

# 基本方針

- Gitを唯一の正とする
- テキスト管理を前提とする
- GUIは編集支援ツールと位置付ける
- プロジェクト内にエディタ実装は持ち込まない
- As-Is / To-Beを標準機能とする

---

# ディレクトリ構成

```text
business-processes/
│
├─ sales-order/
│   ├─ README.md
│   ├─ asis.yaml
│   └─ tobe.yaml
│
├─ procurement/
│   ├─ README.md
│   ├─ asis.yaml
│   └─ tobe.yaml
│
└─ shipping/
    ├─ README.md
    ├─ asis.yaml
    └─ tobe.yaml
```

## README.md

人間向け説明。

- 業務概要
- 対象部門
- 関連業務
- 注意事項

## YAML

機械可読な業務フロー定義。

---

# DSL方針

PlantUMLやMermaidを一次ソースにはしない。

保存形式はYAMLとする。

描画時に図を生成する。

```text
YAML
 ↓
Graph AST
 ↓
Layout Engine
 ↓
React Flow
```

---

# ID設計

## 結論

UUIDと業務IDの二重管理はしない。

永続Slug IDのみ採用する。

例:

```yaml
processes:

  receive-order:
    name: 受注

  approve-order:
    name: 承認

  register-order:
    name: 登録
```

## ルール

### id

- 永続
- 主キー
- 変更禁止
- 人間可読

### name

- 表示名
- 変更可能

例:

```diff
- name: 受注
+ name: 電子受注
```

As-Is / To-Beは id で対応付ける。

---

# Flow定義

```yaml
flows:
  - from: receive-order
    to: approve-order

  - from: approve-order
    to: register-order
```

順番はFlowで表現する。

プロセス定義と順番を分離する。

---

# As-Is / To-Be比較

## 対応付け

同じ id を同じ工程として扱う。

名前が変更されても対応関係は維持する。

## 差分種別

- Added
- Removed
- Renamed
- Moved
- Lane Changed

---

# レイアウト要件

## 同一工程位置合わせ

As-Is

```text
P10
 ↓
P20
 ↓
P30
```

To-Be

```text
P10
 ↓
P15
 ↓
P20
 ↓
P30
```

表示時:

- P10を同じ高さ
- P20を同じ高さ
- P30を同じ高さ
- P15のみ中間配置

## 分岐・合流

対応必須。

```text
      ┌─ B
A ────┤
      └─ C
          ↓
          D
```

---

# UI要件

## 一覧画面

- 業務一覧
- As-Is有無
- To-Be有無

## 比較画面

左右比較。

```text
As-Is       To-Be
```

## 編集機能

- ノード追加
- ノード削除
- ノード移動
- レーン変更
- 分岐追加
- 合流追加

## UX要件

Excelのような手動配線は禁止。

例:

```text
A → B → C
```

BとCの間に追加

```text
A → B → X → C
```

接続とレイアウトは自動更新。

---

# エディタ配布方針

エディタはプロジェクト管理対象外とする。

独立ツールとして管理する。

利用者は

```text
process-workbench.exe
```

を起動するだけ。

## 起動フロー

```text
EXE起動
 ↓
フォルダ選択
 ↓
business-processes検出
 ↓
GUI表示
```

---

# 技術候補

## デスクトップ

第一候補:

- Tauri

代替:

- Electron

## UI

- React
- TypeScript
- React Flow

## レイアウト

第一候補:

- ELK (Eclipse Layout Kernel)

代替:

- Dagre
- Graphviz

## データ

- YAML
- Markdown

---

# 採用方針

## 保存形式

- README.md
- asis.yaml
- tobe.yaml

## ID

- 永続Slug ID
- UUID不採用

## UI

- React Flow

## レイアウト

- ELK

## 比較

- IDベース比較
- 同一IDは同一位置を維持

## 配布

- Tauri製EXE
- フォルダ選択式
- プロジェクトへの組み込み不要
