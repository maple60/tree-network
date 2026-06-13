# assets/tree-network.js 保守メモ

この文書は `assets/tree-network.js` から読み取れる範囲だけをまとめたものです。HTML、CSS、`site-data/tree-network.json` の完全な仕様はこのファイルだけでは確認できないため、必要な箇所では「未確認」と書きます。

## 1. 全体目的

`assets/tree-network.js` は、`#tree-network-app` が存在するページ上で、樹種データを属性ノードのネットワークとして表示するためのブラウザ用JavaScriptです。

主な役割は次のとおりです。

- `site-data/tree-network.json` を読み込む。
- 検索、カテゴリ表示切替、樹種エッジ表示、エッジ件数制限、リセット操作を受け付ける。
- 現在の条件から、表示するノード、集約リンク、樹種ごとのパスを計算する。
- D3.js を使ってSVGネットワークを描画する。
- 統計、詳細パネル、樹種リストを更新する。

このファイルから読み取れるデータ構造は次の範囲です。

- `data.categories`: `id`, `label`, `color`, `order`, `defaultVisible` を使う。
- `data.nodes`: `id`, `label`, `category`, `categoryLabel`, `color`, `speciesIds`, `speciesCount` を使う。
- `data.species`: `id`, `jaName`, `scientificName`, `sourceNote`, `attributes`, `attributeNodeIds` を使う。

## 2. ページ読み込みからネットワーク描画までの処理フロー

1. ファイル全体は即時実行関数 `(() => { ... })();` で囲まれている。
2. `document.getElementById("tree-network-app")` でアプリ領域を探す。
3. アプリ領域がなければ何もしない。
4. `state` と `els` を作る。
5. DOM読み込み中なら `DOMContentLoaded` 後に `init()` を呼ぶ。読み込み済みならすぐ `init()` を呼ぶ。
6. `init()` で `window.d3` の有無を確認する。
7. D3.js がなければ `showError()` でエラーを表示して止まる。
8. `fetch("site-data/tree-network.json")` でデータを読み込む。
9. 読み込み成功後、`state.data`, `state.nodeById`, `state.categoryById`, `state.selectedCategoryIds` を初期化する。
10. `buildCategoryFilters()` でカテゴリチェックボックスを作る。
11. `bindControls()` で検索欄などのイベントを登録する。
12. `update()` で初回描画する。
13. リサイズ時は `debounce(update, 120)` で少し待ってから再描画する。
14. `update()` は `deriveModel()` で表示モデルを作り、`renderStats()`, `renderGraph()`, `renderDetail()`, `renderSpeciesList()` を順番に呼ぶ。

## 3. `state` オブジェクト

| プロパティ | 意味 | 主な参照・変更箇所 |
| --- | --- | --- |
| `data` | JSONから読み込んだ元データ全体。読み込み前は `null`。 | `init()` で設定。ほぼ全関数が参照。 |
| `nodeById` | ノードIDからノードレコードを引く `Map`。 | `init()` で設定。カテゴリ非表示時、詳細表示時に参照。 |
| `categoryById` | カテゴリIDからカテゴリレコードを引く `Map`。 | `init()` で設定。`renderGraph()` でノード配置に使用。 |
| `selectedCategoryIds` | 表示対象カテゴリIDの `Set`。 | `init()`, `buildCategoryFilters()`, リセットで変更。 |
| `selectedNodeIds` | クリックで選択された属性ノードIDの `Set`。 | ノードクリック、背景クリック、リセット、カテゴリ非表示時に変更。 |
| `selectedSpeciesId` | 選択中の樹種ID。未選択なら `null`。 | 検索、ノードクリック、樹種パス、樹種リスト、背景クリック、リセットで変更。 |
| `search` | 検索欄の文字列。空文字なら検索なし。 | 検索入力、リセットで変更。`matchesSearch()` で参照。 |
| `showSpeciesEdges` | 樹種ごとのパスを明示的に表示するかどうか。 | チェックボックス、リセットで変更。`deriveModel()` で参照。 |
| `edgeLimit` | 樹種パスとして描く最大樹種数。初期値は `140`。 | スライダー、リセットで変更。`limitSpeciesForPaths()` で参照。 |
| `transform` | D3 zoom の現在の拡大・移動状態。 | `renderGraph()` のzoomイベントで変更し、再描画時に再適用。 |
| `positions` | ノードIDごとの前回位置。再描画時の初期位置に使う。 | `renderGraph()` と `ticked()` で参照・変更。 |
| `simulation` | 現在動いている D3 force simulation。 | `renderGraph()` で停止・作成。ドラッグ時にも参照。 |

## 4. `els` オブジェクト

`els` はHTML要素への参照です。IDやclass名そのものはHTML側で定義されていますが、HTMLファイルはこのJSだけでは未確認です。

| プロパティ | DOM要素 | このJSでの使い方 |
| --- | --- | --- |
| `search` | `#tn-search` | 検索入力を読み取り、リセット時に空にする。 |
| `showSpecies` | `#tn-show-species` | 樹種エッジ表示のチェック状態を読む。 |
| `edgeLimit` | `#tn-edge-limit` | 樹種エッジ描画数の制限値を読む。 |
| `edgeLimitValue` | `#tn-edge-limit-value` | 現在の制限値を文字で表示する。 |
| `reset` | `#tn-reset` | クリックで検索・選択・表示設定を初期状態へ戻す。 |
| `categoryFilters` | `#tn-category-filters` | カテゴリチェックボックス一覧を作る場所。 |
| `speciesCount` | `#tn-species-count` | 条件に一致する樹種数を表示する。 |
| `nodeCount` | `#tn-node-count` | 表示中ノード数を表示する。 |
| `edgeCount` | `#tn-edge-count` | 表示中リンク数または樹種エッジ数を表示する。 |
| `modeLabel` | `#tn-mode-label` | `aggregate` または `species edge` を表示する。 |
| `graph` | `#tn-graph` | D3でSVGネットワークを描く対象。 |
| `graphShell` | `.tn-graph-shell` | SVGサイズ計算のために幅・高さを読む。 |
| `detail` | `#tn-detail` | 選択樹種、選択属性、検索結果、初期案内を表示する。 |
| `speciesList` | `#tn-species-list` | 条件に一致する樹種ボタン一覧を表示する。 |

## 5. 主要関数ごとの説明

### 初期化と更新

| 関数 | 役割 | 入力 | 出力 | 参照・変更する `state` | 変更すると画面上で変わること |
| --- | --- | --- | --- | --- | --- |
| `init()` | D3確認、JSON読み込み、初期state設定、初回描画、リサイズ登録を行う。 | なし。`fetch()` でJSONを読む。 | なし。失敗時はエラー表示。 | `data`, `nodeById`, `categoryById`, `selectedCategoryIds` を設定。 | 起動時の読み込み先、初期表示カテゴリ、初回描画の有無が変わる。 |
| `bindControls()` | UI操作のイベントを登録する。 | なし。`els` の各要素を使う。 | なし。 | `search`, `selectedSpeciesId`, `showSpeciesEdges`, `edgeLimit`, `selectedNodeIds`, `selectedCategoryIds` を変更。 | 検索、樹種エッジ切替、件数制限、リセットの動きが変わる。 |
| `buildCategoryFilters()` | カテゴリチェックボックスを描画する。 | なし。 | なし。DOMを更新。 | `selectedCategoryIds`, `selectedNodeIds`, `selectedSpeciesId` を参照・変更。 | カテゴリ一覧、チェック操作、非表示カテゴリのノード選択解除が変わる。 |
| `update()` | 表示モデルを作り、各表示領域を再描画する。 | なし。 | なし。 | `data` を参照。各描画関数経由で多くの `state` を参照。 | 再描画対象と再描画順が変わる。呼び出し忘れは画面更新漏れになる。 |

### 表示モデルの計算

| 関数 | 役割 | 入力 | 出力 | 参照・変更する `state` | 変更すると画面上で変わること |
| --- | --- | --- | --- | --- | --- |
| `deriveModel()` | 現在条件から、表示ノード、集約リンク、樹種パスを計算する。 | なし。 | `hasActiveFilter`, `filteredSpecies`, `visibleNodes`, `aggregateLinks`, `speciesPaths`, `speciesEdgesActive` を含むオブジェクト。 | `data`, `selectedNodeIds`, `selectedCategoryIds`, `selectedSpeciesId`, `search`, `showSpeciesEdges` を参照。 | 検索・選択・カテゴリ表示・樹種エッジ表示の全体ルールが変わる。 |
| `matchesSearch(species)` | 1樹種が検索文字列に一致するか判定する。 | `species`。 | `true` または `false`。 | `search` を参照。 | 検索対象フィールドや検索の一致条件が変わる。 |
| `buildAggregateLinks(speciesRecords, visibleNodeIds)` | 隣り合うカテゴリ間の属性ノードを集約リンクにする。 | 樹種配列、表示ノードID集合。 | `source`, `target`, `count`, `speciesIds` を持つリンク配列。 | `orderedSelectedCategories()` 経由で `data`, `selectedCategoryIds` を参照。 | 集約リンクの作り方、太さ、表示本数の元データが変わる。 |
| `limitSpeciesForPaths(filteredSpecies)` | 樹種パスとして描く樹種数を制限する。 | 条件に一致した樹種配列。 | 制限後の樹種配列。 | `selectedSpeciesId`, `data`, `edgeLimit` を参照。 | 樹種エッジの最大本数、選択樹種を優先表示する挙動が変わる。 |
| `pathNodesForSpecies(species, visibleNodeIds)` | 1樹種の属性値を、表示ノードIDの並びに変換する。 | 樹種、表示ノードID集合。 | ノードID配列。 | `orderedSelectedCategories()` 経由で `data`, `selectedCategoryIds` を参照。 | 樹種パスがどのノードをどの順番で通るかが変わる。 |

### 描画

| 関数 | 役割 | 入力 | 出力 | 参照・変更する `state` | 変更すると画面上で変わること |
| --- | --- | --- | --- | --- | --- |
| `renderStats(model)` | 統計表示を更新する。 | `deriveModel()` の戻り値。 | なし。DOMを更新。 | 直接変更なし。 | 樹種数、ノード数、リンク数、モード表示が変わる。 |
| `renderGraph(model)` | D3でSVGネットワークを描く。 | `deriveModel()` の戻り値。 | なし。SVGを更新。 | `simulation` を停止・作成。`positions`, `transform`, `selectedNodeIds`, `selectedSpeciesId` を参照・変更。 | ネットワーク全体の見た目、ノード配置、リンク、ズーム、ドラッグ、クリック動作が変わる。 |
| `ticked()` | force simulation の各tickでSVG座標を更新する。 | なし。`renderGraph()` 内の変数を使う。 | なし。SVG属性を更新。 | `positions` を更新。 | ノードとリンクの動き、画面内への収まり方が変わる。 |
| `renderDetail(model)` | 詳細パネルを現在状態に合わせて描く。 | `deriveModel()` の戻り値。 | なし。`innerHTML` を更新。 | `selectedSpeciesId`, `data`, `selectedNodeIds`, `nodeById`, `search` を参照。 | 詳細パネルの文言、選択時・検索時・初期時の表示が変わる。 |
| `speciesDetailHtml(species)` | 樹種詳細のHTML文字列を作る。 | 樹種。 | HTML文字列。 | `orderedSelectedCategories()` 経由で `data`, `selectedCategoryIds` を参照。 | 樹種選択時の詳細パネル内容が変わる。 |
| `renderSpeciesList(model)` | 樹種リストを最大80件まで描く。 | `deriveModel()` の戻り値。 | なし。DOMを更新。 | `selectedSpeciesId` を参照・変更。 | 樹種リストの並び、件数、クリック時の選択動作が変わる。 |

### 補助関数

| 関数 | 役割 | 入力 | 出力 | 参照・変更する `state` | 変更すると画面上で変わること |
| --- | --- | --- | --- | --- | --- |
| `orderedSelectedCategories()` | 選択中カテゴリを `order` 順で返す。 | なし。 | カテゴリ配列。 | `data`, `selectedCategoryIds` を参照。 | カテゴリの横並び順、リンク生成順、樹種パス順が変わる。 |
| `valuesForCategory(species, categoryId)` | 樹種の指定カテゴリ属性値を返す。 | 樹種、カテゴリID。 | 属性値配列。 | なし。 | 属性値の読み取り方が変わる。 |
| `makeNodeId(categoryId, value)` | カテゴリIDと値からノードIDを作る。 | カテゴリID、属性値。 | `"category::value"` 形式の文字列。 | なし。 | JSON側のノードID規則と合わないとリンクやパスが壊れる。 |
| `categoryX(category, width)` | カテゴリ順に応じたX座標を計算する。 | カテゴリ、SVG幅。 | X座標。 | `orderedSelectedCategories()` 経由で `data`, `selectedCategoryIds` を参照。 | ノードの横方向配置が変わる。 |
| `nodeRadius(node)` | 表示樹種数からノード半径を計算する。 | ノード。 | 半径。 | なし。 | ノード円の大きさが変わる。 |
| `nodeClass(node)` | ノードのCSSクラスを作る。 | ノード。 | クラス文字列。 | `selectedNodeIds`, `search` を参照。 | 選択・ミュート状態の見た目が変わる。実際の見た目はCSS側で未確認。 |
| `countNodesByCategory(nodes)` | カテゴリごとのノード数を数える。 | ノード配列。 | `Map`。 | なし。 | カテゴリ一覧の件数表示が変わる。 |
| `normalize(value)` | 検索用に文字列化して小文字化する。 | 任意の値。 | 文字列。 | なし。 | 大文字小文字の扱いなど検索の一致条件が変わる。 |
| `escapeHtml(value)` | `innerHTML` 用にHTML特殊文字をエスケープする。 | 任意の値。 | エスケープ済み文字列。 | なし。 | 詳細パネルなどに外部文字列を安全に入れられるかが変わる。 |
| `clamp(value, min, max)` | 値を範囲内に収める。 | 値、最小、最大。 | 範囲内の値。 | なし。 | ノードがSVG外へ出にくい挙動が変わる。 |
| `jitter(amount)` | 初期位置にランダムな揺らぎを加える。 | 揺らぎ幅。 | 数値。 | なし。 | 初期ノード位置のばらつきが変わる。 |
| `debounce(callback, wait)` | 連続イベントの最後だけ処理する。 | 関数、待ち時間。 | 新しい関数。 | なし。 | リサイズ時の再描画頻度が変わる。 |
| `showError(message)` | アプリ領域にエラーを表示する。 | メッセージ。 | なし。DOMを更新。 | なし。 | D3やJSON読み込み失敗時の表示が変わる。 |

## 6. 「やりたい変更」別の編集ガイド

### 検索対象を変えたい場合

編集候補は `matchesSearch(species)` です。

現在は次を検索対象にしています。

- `species.jaName`
- `species.scientificName`
- `species.sourceNote`
- `Object.values(species.attributes).flat()`

一致判定は `normalize(values.join(" ")).includes(query)` です。完全一致にしたい、別フィールドを足したい、属性だけ検索したくない、などはこの関数を変更します。

注意: `normalize()` を変えると検索全体の文字の扱いが変わります。

### ノード表示条件を変えたい場合

編集候補は `deriveModel()` の `visibleNodes` 計算部分です。

現在は次の流れです。

1. `selectedCategoryIds` に含まれるカテゴリのノードだけ残す。
2. 条件一致樹種数を `activeSpeciesCount` として計算する。
3. 検索・ノード選択・樹種選択がある場合は、`displayCount > 0` のノードか、選択中ノードだけ残す。

ノードの大きさだけ変えたい場合は `nodeRadius(node)` です。選択やミュートのCSSクラスを変えたい場合は `nodeClass(node)` です。

### リンク生成ロジックを変えたい場合

集約リンクは `buildAggregateLinks(speciesRecords, visibleNodeIds)` が作ります。

現在は `orderedSelectedCategories()` の順番で、隣り合うカテゴリだけをつなぎます。同じ樹種が左カテゴリと右カテゴリの両方に値を持つと、その全組み合わせをリンク候補にします。同じ `source=>target` は `count` を増やします。

樹種ごとのパスは `pathNodesForSpecies(species, visibleNodeIds)` が作ります。

注意: `makeNodeId(categoryId, value)` の形式を変えると、JSON内のノードIDと合わなくなる可能性があります。JSON側仕様はこのJSだけでは未確認です。

### グラフの見た目を変えたい場合

編集候補は `renderGraph(model)` と補助関数です。

- SVGの最小サイズ: `width = Math.max(520, ...)`, `height = Math.max(500, ...)`
- ズーム範囲: `scaleExtent([0.35, 4])`
- 集約リンクの太さ: `Math.max(1, Math.sqrt(link.count) * 1.25)`
- ノードの半径: `nodeRadius(node)`
- カテゴリ別の横位置: `categoryX(category, width)`
- force simulation の力: `forceLink`, `forceManyBody`, `forceCollide`, `forceX`, `forceY`

色や線の詳細な見た目はCSSクラスにも依存します。CSSの実装はこのJSだけでは未確認です。

### 詳細パネルの表示を変えたい場合

編集候補は `renderDetail(model)` と `speciesDetailHtml(species)` です。

現在の優先順位は次のとおりです。

1. `selectedSpeciesId` がある場合、樹種詳細を表示する。
2. `selectedNodeIds` がある場合、選択中属性と一致樹種数を表示する。
3. `search` がある場合、検索結果件数を表示する。
4. どれもなければ初期案内を表示する。

`innerHTML` を使っているため、データ由来の文字列を入れる場合は `escapeHtml()` を通してください。

### 樹種リストの表示を変えたい場合

編集候補は `renderSpeciesList(model)` です。

現在は `model.filteredSpecies` を日本語名 `jaName` でソートし、先頭80件だけ表示します。各項目は `button` で、クリックすると `state.selectedSpeciesId` を設定して `update()` します。

表示件数を変える場合は `.slice(0, 80)` を変更します。表示する項目を増やす場合は `button.append(ja, sci)` の周辺を編集します。

## 7. 初心者が注意すべき副作用

### `update()` の呼び出しタイミング

`state` を変えただけでは画面は自動では変わりません。多くのイベント処理は、`state` を変更した直後に `update()` を呼んでいます。

ただし、`renderGraph()` 内の樹種パス `mouseenter` は `state.selectedSpeciesId` を変更したあと、全体再描画ではなく `renderDetail(model)` と `renderSpeciesList(model)` だけを呼びます。ここを `update()` に変えると、ホバーだけでグラフ全体が再描画されるようになります。

### `state` の変更

`state.selectedNodeIds` と `state.selectedCategoryIds` は `Set` です。追加は `.add()`、削除は `.delete()`、全削除は `.clear()` を使っています。

`state.positions` はノード位置を保持します。これを消すと、次回描画時にノード位置が初期化されます。

### D3 force simulation

`renderGraph()` は毎回、前回の `state.simulation` を `stop()` してから新しい simulation を作ります。止め忘れると、古いsimulationが残って予期しない動きや負荷につながる可能性があります。

force simulation の各パラメータはノード位置に影響します。特に `forceManyBody`, `forceCollide`, `forceX`, `forceY` を変えると、同じデータでも配置が大きく変わります。

### DOM再描画

`renderGraph()` は `svg.selectAll("*").remove()` でSVG内を全削除してから描き直します。ノードやリンクに直接DOM状態を持たせても、次の `update()` で消えます。

`buildCategoryFilters()` と `renderSpeciesList()` も中身を空にしてから作り直します。イベントリスナーも作り直されます。

### `innerHTML` 使用時の `escapeHtml()`

`renderDetail()`, `speciesDetailHtml()`, `showError()` は `innerHTML` を使います。

データや入力文字列をHTMLへ入れる場合、既存コードは `escapeHtml()` を使っています。新しい表示項目を足すときも、HTMLタグとして解釈させたい固定文字列以外は `escapeHtml()` を通してください。

## 8. 将来的な分割候補

特に `renderGraph()` は、SVG初期化、データ準備、ズーム、集約リンク、樹種パス、ノード、ドラッグ、force simulation、tick更新を1つの関数で扱っています。動作を保ったまま読みやすくするなら、次のように分ける候補があります。

- `getGraphSize()`  
  `graphShell` から `width` と `height` を計算する。
- `resetSvg(svg, width, height)`  
  前回描画の削除、`viewBox` 設定、レイヤー作成を担当する。
- `buildGraphNodes(model, width, height)`  
  `state.positions` を使ってD3用ノード配列を作る。
- `buildGraphLinks(model, nodeById)`  
  表示可能な集約リンクだけをD3用リンク配列にする。
- `applyZoom(svg, viewport)`  
  D3 zoom の設定と `state.transform` の保存・復元を担当する。
- `renderAggregateLinks(layer, links, model)`  
  集約リンクのD3 selectionを作る。
- `renderSpeciesPaths(layer, model, line, callbacks)`  
  樹種パスのD3 selectionとイベントを作る。
- `renderNodes(layer, nodes, callbacks)`  
  ノード、円、ラベル、件数ラベルを作る。
- `createDragBehavior()`  
  ドラッグ時の `fx`, `fy`, `alphaTarget` 処理をまとめる。
- `startSimulation(nodes, links, width, height, ticked)`  
  force simulation の作成だけを担当する。
- `updateGraphPositions(...)`  
  現在の `ticked()` の中身を外に出す。

分割する場合も、最初は関数を移動するだけにして、表示条件やD3パラメータは同時に変更しない方が点検しやすいです。
