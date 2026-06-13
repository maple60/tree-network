# trait_input_candidates.csv

`trait_input_candidates.csv` は、樹木形質データの入力を短時間で進めるためのレビュー用候補CSVです。

このCSVは正本データではありません。機械的に抽出・正規化した候補を含むため、`review_status` と `review_confidence` を確認し、必要に応じて原資料や別典拠で確認してから正本データへ取り込んでください。

## 方針

- `id` は候補行を識別するための安定IDです。
- `scientific_name` は空欄です。学名は別の典拠データで補完する前提です。
- 先頭の `id` から `source_note` までは `trees_demo.csv` に近い基本列です。
- 長い本文抜粋、画像座標、ローカルファイルパスは含めていません。
- `family` は明らかな文字認識由来の誤字のみ補正し、補正前の値は `family_ja_raw` に残しています。
- `*_raw` 列はレビュー補助用です。正本化するときは基本列を人が確認してください。

## 生成

```powershell
python scripts/export_public_trait_candidates.py --input <private intermediate CSV>
```

入力ファイルは公開リポジトリには含めません。
