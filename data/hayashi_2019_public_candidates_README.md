# hayashi_2019_public_candidates.csv

`hayashi_2019_public_candidates.csv` は、林将之 (2019)『樹木の葉』の私的スキャンを NDLOCR-Lite で読み取り、公開しやすい候補データに整形したCSVです。

このCSVは公開前レビュー用の候補データです。OCR由来の誤読や形質抽出の揺れを含むため、`review_status` と `review_confidence` を確認してから正本データへ取り込んでください。

## 方針

- `id` はスキャン番号と左右ページから作る安定IDです。
- `scientific_name` は空欄です。学名は別の典拠データで補完する前提です。
- 先頭の `id` から `source_note` までは `trees_demo.csv` に近い基本列です。
- OCR本文の長い抜粋、座標、privateフォルダのパスは含めていません。
- `family` は明らかなOCR誤字のみ補正し、補正前の値は `family_ja_ocr` に残しています。
- `*_ocr` 列はレビュー補助用です。正本化するときは基本列を人が確認してください。

## 生成

```powershell
python scripts/export_public_ocr_candidates.py
```

入力は `private_input/review/hayashi_2019_ndlocr_lite_candidates.csv`、出力は `data/hayashi_2019_public_candidates.csv` です。
