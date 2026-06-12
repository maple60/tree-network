# Tree Network

日本の樹木を、科・属・葉序・鋸歯・常緑/落葉・針葉/広葉などの属性ネットワークとして可視化する Quarto website です。

## Structure

- `data/trees.csv`: source data, one species per row
- `data/attributes.yml`: attribute category definitions
- `scripts/validate_data.py`: data validation
- `scripts/build_graph_data.py`: CSV/YAML to site JSON
- `site-data/tree-network.json`: generated site data
- `assets/tree-network.js`: interactive graph
- `assets/tree-network.css`: graph layout and styling

## Local build

```powershell
python scripts/validate_data.py
python scripts/build_graph_data.py
quarto render
```

The published site is intended for GitHub Pages at:

https://maple60.github.io/tree-network/
