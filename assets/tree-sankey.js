(() => {
  const app = document.getElementById("tree-sankey-app");
  if (!app) return;

  const INITIAL_CATEGORY_IDS = [
    "leaf_persistence",
    "leaf_type",
    "leaf_complexity",
    "leaf_arrangement",
    "leaf_margin",
    "serration",
  ];
  const MAX_SPECIES_LIST = 120;
  const NODE_WIDTH = 18;

  // 画面全体で共有する状態。元データは変更せず、表示用モデルだけを毎回作り直す。
  const state = {
    data: null,
    categoryById: new Map(),
    nodeById: new Map(),
    speciesById: new Map(),
    selectedCategoryIds: new Set(INITIAL_CATEGORY_IDS),
    selectedNodeIds: new Set(),
    selectedLinkKeys: new Set(),
    selectedSpeciesId: null,
    search: "",
  };

  // HTML側の要素参照。IDを変えた場合はここも合わせる。
  const els = {
    search: document.getElementById("ts-search"),
    reset: document.getElementById("ts-reset"),
    categoryFilters: document.getElementById("ts-category-filters"),
    categoryCount: document.getElementById("ts-category-count"),
    speciesCount: document.getElementById("ts-species-count"),
    nodeCount: document.getElementById("ts-node-count"),
    linkCount: document.getElementById("ts-link-count"),
    graphShell: document.querySelector(".ts-graph-shell"),
    graph: document.getElementById("ts-graph"),
    empty: document.getElementById("ts-empty"),
    tooltip: document.getElementById("ts-tooltip"),
    detail: document.getElementById("ts-detail"),
    speciesList: document.getElementById("ts-species-list"),
    speciesListCount: document.getElementById("ts-species-list-count"),
  };

  /**
   * 初期化処理。D3、d3-sankey、JSONデータを準備して初回描画する。
   *
   * @returns {void}
   */
  function init() {
    if (!window.d3) {
      showError("D3.js の読み込みに失敗しました。ネットワーク接続またはCDNの読み込みを確認してください。");
      return;
    }

    if (!window.d3.sankey) {
      showError("d3-sankey の読み込みに失敗しました。CDNの読み込みを確認してください。");
      return;
    }

    fetch("site-data/tree-network.json")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        state.data = data;
        state.categoryById = new Map(data.categories.map((category) => [category.id, category]));
        state.nodeById = new Map(data.nodes.map((node) => [node.id, node]));
        state.speciesById = new Map(data.species.map((species) => [species.id, species]));
        state.selectedCategoryIds = initialCategorySet(data.categories);
        buildCategoryFilters();
        bindControls();
        update();
        window.addEventListener("resize", debounce(update, 120));
      })
      .catch((error) => {
        showError(`tree-network.json を読み込めませんでした: ${error.message}`);
      });
  }

  /**
   * 検索とリセットのUI操作を state 更新と再描画につなぐ。
   *
   * @returns {void}
   */
  function bindControls() {
    els.search.addEventListener("input", () => {
      state.search = els.search.value.trim();
      state.selectedSpeciesId = null;
      update();
    });

    els.reset.addEventListener("click", () => {
      state.search = "";
      clearSelections();
      state.selectedCategoryIds = initialCategorySet(state.data.categories);
      els.search.value = "";
      buildCategoryFilters();
      update();
    });
  }

  /**
   * カテゴリのチェックボックス一覧を作る。
   *
   * @returns {void}
   */
  function buildCategoryFilters() {
    els.categoryFilters.innerHTML = "";
    const counts = countNodesByCategory(state.data.nodes);
    const categories = orderedCategories(state.data.categories);

    for (const category of categories) {
      const label = document.createElement("label");
      label.className = "ts-category-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.selectedCategoryIds.has(category.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          state.selectedCategoryIds.add(category.id);
        } else {
          state.selectedCategoryIds.delete(category.id);
          clearSelectionsForCategory(category.id);
        }
        update();
      });

      const dot = document.createElement("span");
      dot.className = "ts-color-dot";
      dot.style.background = category.color;

      const text = document.createElement("span");
      text.textContent = category.label;

      const count = document.createElement("span");
      count.className = "ts-category-count";
      count.textContent = `${counts.get(category.id) || 0}`;

      label.append(checkbox, dot, text, count);
      els.categoryFilters.appendChild(label);
    }
  }

  /**
   * 現在の state から表示モデルを作り、Sankey図と詳細パネルを更新する。
   *
   * @returns {void}
   */
  function update() {
    if (!state.data) return;
    const model = deriveModel();
    pruneSelection(model);
    renderStats(model);
    renderGraph(model);
    renderDetail(model);
    renderSpeciesList(model);
  }

  /**
   * state と元データから、Sankey描画に必要なノード・リンク・樹種集合を作る。
   *
   * @returns {object} 描画と詳細表示で使う派生モデル。
   */
  function deriveModel() {
    const categories = orderedSelectedCategories();
    const categoryIds = new Set(categories.map((category) => category.id));
    const searchSpecies = state.data.species.filter((species) => matchesSearch(species));
    const filteredSpecies = searchSpecies.filter((species) => matchesSelectedConditions(species));
    const nodeSpeciesSets = buildNodeSpeciesSets(filteredSpecies, categoryIds);
    const rawLinks = buildSankeyLinks(filteredSpecies, categories);
    const flowTotals = countNodeFlowTotals(rawLinks);

    const nodes = state.data.nodes
      .filter((node) => categoryIds.has(node.category))
      .map((node) => {
        const speciesIds = Array.from(nodeSpeciesSets.get(node.id) || []);
        const flow = flowTotals.get(node.id) || { incoming: 0, outgoing: 0 };
        return {
          id: node.id,
          label: node.label,
          name: node.label,
          category: node.category,
          categoryLabel: node.categoryLabel,
          color: node.color,
          speciesIds,
          speciesCount: speciesIds.length,
          // 複数値を全組み合わせでリンク化すると、リンク合計がユニーク樹種数を少し上回ることがある。
          // d3-sankeyのレイアウト破綻を避けるため、矩形の計算値はリンク合計も受けられる大きさにする。
          fixedValue: Math.max(speciesIds.length, flow.incoming, flow.outgoing, 1),
        };
      })
      .filter((node) => node.speciesCount > 0);

    const nodeIds = new Set(nodes.map((node) => node.id));
    const links = rawLinks.filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target));

    return {
      categories,
      filteredSpecies,
      filteredSpeciesById: new Map(filteredSpecies.map((species) => [species.id, species])),
      nodes,
      nodeById: new Map(nodes.map((node) => [node.id, node])),
      links,
      linkByKey: new Map(links.map((link) => [link.key, link])),
    };
  }

  /**
   * カテゴリごとに、どの樹種がどの属性ノードを持つかを集計する。
   *
   * @param {object[]} speciesRecords 検索条件に一致した樹種。
   * @param {Set<string>} categoryIds 表示対象カテゴリID。
   * @returns {Map<string, Set<string>>} ノードIDごとの樹種ID集合。
   */
  function buildNodeSpeciesSets(speciesRecords, categoryIds) {
    const nodeSpeciesSets = new Map();

    for (const species of speciesRecords) {
      for (const categoryId of categoryIds) {
        for (const nodeId of nodeIdsForSpeciesCategory(species, categoryId)) {
          if (!state.nodeById.has(nodeId)) continue;
          if (!nodeSpeciesSets.has(nodeId)) nodeSpeciesSets.set(nodeId, new Set());
          nodeSpeciesSets.get(nodeId).add(species.id);
        }
      }
    }

    return nodeSpeciesSets;
  }

  /**
   * 隣接する表示カテゴリ間の属性組み合わせをリンクとして集計する。
   *
   * 重要な集計ルール:
   * - カテゴリは categories[].order の順に左から右へ並ぶ。
   * - 隣り合うカテゴリだけをリンク化する。
   * - 複数値を持つ樹種は、そのカテゴリペア内の全組み合わせをリンク化する。
   * - ただし、同じ樹種が同じカテゴリペア・同じ属性ペアに重複して入っても1回だけ数える。
   * - speciesIds はリンクごとに保持し、クリック時の樹種一覧に使う。
   *
   * @param {object[]} speciesRecords 検索条件に一致した樹種。
   * @param {object[]} categories order順の表示カテゴリ。
   * @returns {object[]} Sankeyリンク配列。
   */
  function buildSankeyLinks(speciesRecords, categories) {
    const linkMap = new Map();

    for (const species of speciesRecords) {
      for (let index = 0; index < categories.length - 1; index += 1) {
        const left = categories[index];
        const right = categories[index + 1];
        const sourceNodeIds = nodeIdsForSpeciesCategory(species, left.id);
        const targetNodeIds = nodeIdsForSpeciesCategory(species, right.id);

        // 1つの樹種内で重複値があっても、同じ属性ペアを二重加算しないための番兵。
        const speciesPairKeys = new Set();

        for (const source of sourceNodeIds) {
          if (!state.nodeById.has(source)) continue;
          for (const target of targetNodeIds) {
            if (!state.nodeById.has(target)) continue;

            const key = `${left.id}|${right.id}|${source}|${target}`;
            if (speciesPairKeys.has(key)) continue;
            speciesPairKeys.add(key);

            if (!linkMap.has(key)) {
              linkMap.set(key, {
                key,
                source,
                target,
                sourceCategory: left.id,
                targetCategory: right.id,
                sourceCategoryLabel: left.label,
                targetCategoryLabel: right.label,
                speciesIdSet: new Set(),
              });
            }
            linkMap.get(key).speciesIdSet.add(species.id);
          }
        }
      }
    }

    return Array.from(linkMap.values())
      .map((link) => ({
        key: link.key,
        source: link.source,
        target: link.target,
        sourceCategory: link.sourceCategory,
        targetCategory: link.targetCategory,
        sourceCategoryLabel: link.sourceCategoryLabel,
        targetCategoryLabel: link.targetCategoryLabel,
        speciesIds: Array.from(link.speciesIdSet),
        count: link.speciesIdSet.size,
        value: link.speciesIdSet.size,
      }))
      .filter((link) => link.count > 0)
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, "ja"));
  }

  /**
   * Sankeyレイアウト用に、各ノードに流入・流出するリンク数合計を数える。
   *
   * @param {object[]} links buildSankeyLinks() が返すリンク配列。
   * @returns {Map<string, {incoming: number, outgoing: number}>} ノードIDごとの流量合計。
   */
  function countNodeFlowTotals(links) {
    const totals = new Map();
    const ensure = (nodeId) => {
      if (!totals.has(nodeId)) totals.set(nodeId, { incoming: 0, outgoing: 0 });
      return totals.get(nodeId);
    };

    for (const link of links) {
      ensure(link.source).outgoing += link.count;
      ensure(link.target).incoming += link.count;
    }

    return totals;
  }

  /**
   * 検索文字列に樹種レコードが一致するか判定する。
   *
   * @param {object} species 樹種レコード。
   * @returns {boolean} 一致する場合は true。
   */
  function matchesSearch(species) {
    if (!state.search) return true;
    const query = normalize(state.search);
    const attributeValues = Object.values(species.attributes || {}).flat();
    const values = [species.jaName, species.scientificName, species.sourceNote, ...attributeValues];
    return normalize(values.join(" ")).includes(query);
  }

  /**
   * クリックで追加したノード条件・リンク条件に樹種が一致するか判定する。
   * 複数条件はすべて AND として扱う。
   *
   * @param {object} species 樹種レコード。
   * @returns {boolean} すべての選択条件に一致する場合は true。
   */
  function matchesSelectedConditions(species) {
    const attributeNodeIds = new Set(species.attributeNodeIds || []);

    for (const nodeId of state.selectedNodeIds) {
      if (!attributeNodeIds.has(nodeId)) return false;
    }

    for (const linkKey of state.selectedLinkKeys) {
      const condition = parseLinkKey(linkKey);
      if (!condition) return false;

      // リンク条件は「その隣接カテゴリペアで source と target の属性を同時に持つ」ことを意味する。
      // 複数値属性はリンク作成時に全組み合わせ化しているため、両端ノードを持てば該当ペアに一致する。
      if (!attributeNodeIds.has(condition.source) || !attributeNodeIds.has(condition.target)) return false;
    }

    return true;
  }

  /**
   * 現在のモデルに存在しない選択状態を解除する。
   *
   * @param {object} model deriveModel() が返す表示モデル。
   * @returns {void}
   */
  function pruneSelection(model) {
    for (const nodeId of Array.from(state.selectedNodeIds)) {
      const node = state.nodeById.get(nodeId);
      if (!node || !state.selectedCategoryIds.has(node.category)) state.selectedNodeIds.delete(nodeId);
    }

    for (const linkKey of Array.from(state.selectedLinkKeys)) {
      const condition = parseLinkKey(linkKey);
      if (!condition) {
        state.selectedLinkKeys.delete(linkKey);
        continue;
      }

      const source = state.nodeById.get(condition.source);
      const target = state.nodeById.get(condition.target);
      const sourceVisible = source && state.selectedCategoryIds.has(source.category);
      const targetVisible = target && state.selectedCategoryIds.has(target.category);
      if (!sourceVisible || !targetVisible) state.selectedLinkKeys.delete(linkKey);
    }

    if (state.selectedSpeciesId && !model.filteredSpeciesById.has(state.selectedSpeciesId)) {
      state.selectedSpeciesId = null;
    }
  }

  /**
   * 件数表示を更新する。
   *
   * @param {object} model deriveModel() が返す表示モデル。
   * @returns {void}
   */
  function renderStats(model) {
    els.categoryCount.textContent = `${model.categories.length}件`;
    els.speciesCount.textContent = `${model.filteredSpecies.length}種`;
    els.nodeCount.textContent = `${model.nodes.length} nodes`;
    els.linkCount.textContent = `${model.links.length} links`;
  }

  /**
   * D3 SankeyでSVGを描画する。
   *
   * @param {object} model deriveModel() が返す表示モデル。
   * @returns {void}
   */
  function renderGraph(model) {
    const svg = d3.select(els.graph);
    svg.selectAll("*").remove();
    hideTooltip();

    const shellWidth = els.graphShell.getBoundingClientRect().width || 720;
    const width = Math.max(720, Math.floor(shellWidth));
    const maxColumnNodes = Math.max(1, ...model.categories.map((category) => model.nodes.filter((node) => node.category === category.id).length));
    const height = Math.max(560, 180 + maxColumnNodes * 32);
    const margin = { top: 42, right: 180, bottom: 32, left: 34 };

    els.graph.style.height = `${height}px`;
    els.graph.style.minWidth = `${width}px`;
    svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);

    if (model.categories.length < 2) {
      showEmpty("2つ以上のカテゴリを選択してください。");
      return;
    }

    if (!model.filteredSpecies.length) {
      showEmpty("条件に一致する樹種はありません。");
      return;
    }

    if (!model.nodes.length) {
      showEmpty("表示できる属性ノードがありません。");
      return;
    }

    hideEmpty();

    const categoryIndex = new Map(model.categories.map((category, index) => [category.id, index]));
    const graph = {
      nodes: model.nodes.map((node) => ({ ...node })),
      links: model.links.map((link) => ({ ...link })),
    };

    const padding = Math.max(8, Math.min(24, height / (maxColumnNodes + 1) * 0.35));
    const sankey = d3
      .sankey()
      .nodeId((node) => node.id)
      .nodeWidth(NODE_WIDTH)
      .nodePadding(padding)
      .nodeAlign((node, columnCount) => {
        const index = categoryIndex.get(node.category) || 0;
        return clamp(index, 0, Math.max(0, columnCount - 1));
      })
      .nodeSort((a, b) => b.speciesCount - a.speciesCount || a.label.localeCompare(b.label, "ja"))
      .linkSort((a, b) => b.count - a.count || a.key.localeCompare(b.key, "ja"))
      .extent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]]);

    try {
      sankey(graph);
    } catch (error) {
      showEmpty(`Sankey図の配置計算に失敗しました: ${error.message}`);
      return;
    }

    const root = svg.append("g").attr("class", "ts-sankey-root");
    renderCategoryLabels(root, model.categories, categoryIndex, width, margin);
    renderLinks(root, graph.links);
    renderNodes(root, graph.nodes, categoryIndex, model.categories.length);

    svg.on("click", () => {
      if (hasActiveSelections()) {
        clearSelections();
        update();
      }
    });
  }

  /**
   * カテゴリ見出しを各カラム上部に描画する。
   *
   * @param {object} root SVGグループ。
   * @param {object[]} categories 表示カテゴリ。
   * @param {Map<string, number>} categoryIndex カテゴリIDごとの列番号。
   * @param {number} width SVG幅。
   * @param {object} margin 余白設定。
   * @returns {void}
   */
  function renderCategoryLabels(root, categories, categoryIndex, width, margin) {
    const innerWidth = width - margin.left - margin.right - NODE_WIDTH;
    const divisor = Math.max(1, categories.length - 1);

    root
      .append("g")
      .attr("class", "ts-category-label-layer")
      .selectAll("text")
      .data(categories)
      .join("text")
      .attr("class", "ts-category-label")
      .attr("x", (category) => margin.left + ((categoryIndex.get(category.id) || 0) / divisor) * innerWidth)
      .attr("y", 22)
      .text((category) => category.label);
  }

  /**
   * Sankeyリンクを描画し、クリック・ホバーの対象にする。
   *
   * @param {object} root SVGグループ。
   * @param {object[]} links d3-sankeyで座標付けされたリンク配列。
   * @returns {void}
   */
  function renderLinks(root, links) {
    const path = d3.sankeyLinkHorizontal();

    root
      .append("g")
      .attr("class", "ts-link-layer")
      .attr("fill", "none")
      .selectAll("path")
      .data([...links].sort((a, b) => b.width - a.width))
      .join("path")
      .attr("class", (link) => (state.selectedLinkKeys.has(link.key) ? "ts-link is-selected" : "ts-link"))
      .attr("d", path)
      .attr("stroke", (link) => link.source.color)
      .attr("stroke-width", (link) => Math.max(1, link.width))
      .on("mouseenter", (event, link) => {
        showTooltip(event, linkTooltipHtml(link));
      })
      .on("mousemove", moveTooltip)
      .on("mouseleave", hideTooltip)
      .on("click", (event, link) => {
        event.stopPropagation();
        toggleSetValue(state.selectedLinkKeys, link.key);
        state.selectedSpeciesId = null;
        update();
      });
  }

  /**
   * Sankeyノードを描画し、クリック・ホバーの対象にする。
   *
   * @param {object} root SVGグループ。
   * @param {object[]} nodes d3-sankeyで座標付けされたノード配列。
   * @param {Map<string, number>} categoryIndex カテゴリIDごとの列番号。
   * @param {number} categoryCount 表示カテゴリ数。
   * @returns {void}
   */
  function renderNodes(root, nodes, categoryIndex, categoryCount) {
    const node = root
      .append("g")
      .attr("class", "ts-node-layer")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("class", (item) => (state.selectedNodeIds.has(item.id) ? "ts-node is-selected" : "ts-node"))
      .on("mouseenter", (event, item) => {
        showTooltip(event, nodeTooltipHtml(item));
      })
      .on("mousemove", moveTooltip)
      .on("mouseleave", hideTooltip)
      .on("click", (event, item) => {
        event.stopPropagation();
        toggleSetValue(state.selectedNodeIds, item.id);
        state.selectedSpeciesId = null;
        update();
      });

    node
      .append("rect")
      .attr("x", (item) => item.x0)
      .attr("y", (item) => item.y0)
      .attr("height", (item) => Math.max(1, item.y1 - item.y0))
      .attr("width", (item) => item.x1 - item.x0)
      .attr("fill", (item) => item.color);

    node
      .append("text")
      .attr("x", (item) => nodeLabelX(item, categoryIndex, categoryCount))
      .attr("y", (item) => (item.y0 + item.y1) / 2)
      .attr("dy", "0.35em")
      .attr("text-anchor", (item) => nodeLabelAnchor(item, categoryIndex, categoryCount))
      .text((item) => `${item.label} (${item.speciesCount}種)`);
  }

  /**
   * 詳細パネルを描画する。
   *
   * @param {object} model deriveModel() が返す表示モデル。
   * @returns {void}
   */
  function renderDetail(model) {
    if (state.selectedSpeciesId) {
      const species = model.filteredSpeciesById.get(state.selectedSpeciesId);
      els.detail.innerHTML = species ? speciesDetailHtml(species) : emptyDetailHtml(model);
      return;
    }

    if (hasFilterSelections()) {
      els.detail.innerHTML = `
        <p class="ts-detail-title">選択中の条件</p>
        <div class="ts-attribute-chips">${selectedConditionChipsHtml()}</div>
        <p>${model.filteredSpecies.length}種が現在の条件に一致しています。</p>
      `;
      return;
    }

    els.detail.innerHTML = emptyDetailHtml(model);
  }

  /**
   * 樹種一覧を描画する。
   *
   * @param {object} model deriveModel() が返す表示モデル。
   * @returns {void}
   */
  function renderSpeciesList(model) {
    els.speciesList.innerHTML = "";
    const speciesRecords = speciesForSelection(model);
    els.speciesListCount.textContent = `${speciesRecords.length}種`;

    if (!speciesRecords.length) {
      const empty = document.createElement("p");
      empty.className = "ts-detail-empty";
      empty.textContent = "該当する樹種はありません。";
      els.speciesList.appendChild(empty);
      return;
    }

    for (const species of speciesRecords.slice(0, MAX_SPECIES_LIST)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = species.id === state.selectedSpeciesId ? "ts-species-button is-selected" : "ts-species-button";
      button.addEventListener("click", () => {
        state.selectedSpeciesId = species.id;
        update();
      });

      const ja = document.createElement("strong");
      ja.textContent = species.jaName || species.id;
      const sci = document.createElement("em");
      sci.textContent = species.scientificName || "";
      const taxonomy = document.createElement("span");
      taxonomy.textContent = taxonomyText(species);
      button.append(ja, sci, taxonomy);
      els.speciesList.appendChild(button);
    }

    if (speciesRecords.length > MAX_SPECIES_LIST) {
      const note = document.createElement("p");
      note.className = "ts-more-note";
      note.textContent = `ほか ${speciesRecords.length - MAX_SPECIES_LIST}種`;
      els.speciesList.appendChild(note);
    }
  }

  /**
   * 現在の検索・クリック条件に一致する樹種レコードを返す。
   *
   * @param {object} model deriveModel() が返す表示モデル。
   * @returns {object[]} 樹種レコード。
   */
  function speciesForSelection(model) {
    return [...model.filteredSpecies].sort((a, b) => (a.jaName || "").localeCompare(b.jaName || "", "ja"));
  }

  /**
   * ノード条件・リンク条件・樹種詳細選択をまとめて解除する。
   *
   * @returns {void}
   */
  function clearSelections() {
    state.selectedNodeIds.clear();
    state.selectedLinkKeys.clear();
    state.selectedSpeciesId = null;
  }

  /**
   * 非表示にしたカテゴリに関係するクリック条件を解除する。
   *
   * @param {string} categoryId 非表示にしたカテゴリID。
   * @returns {void}
   */
  function clearSelectionsForCategory(categoryId) {
    for (const nodeId of Array.from(state.selectedNodeIds)) {
      const node = state.nodeById.get(nodeId);
      if (node?.category === categoryId) state.selectedNodeIds.delete(nodeId);
    }

    for (const linkKey of Array.from(state.selectedLinkKeys)) {
      const condition = parseLinkKey(linkKey);
      if (!condition || condition.sourceCategory === categoryId || condition.targetCategory === categoryId) {
        state.selectedLinkKeys.delete(linkKey);
      }
    }

    state.selectedSpeciesId = null;
  }

  /**
   * クリック由来の絞り込み条件があるか判定する。
   *
   * @returns {boolean} ノード条件またはリンク条件がある場合は true。
   */
  function hasFilterSelections() {
    return state.selectedNodeIds.size > 0 || state.selectedLinkKeys.size > 0;
  }

  /**
   * 解除対象の選択状態があるか判定する。
   *
   * @returns {boolean} 解除対象がある場合は true。
   */
  function hasActiveSelections() {
    return hasFilterSelections() || Boolean(state.selectedSpeciesId);
  }

  /**
   * Set 内の値をクリックごとに追加/解除する。
   *
   * @param {Set<string>} set 対象 Set。
   * @param {string} value 追加または解除する値。
   * @returns {void}
   */
  function toggleSetValue(set, value) {
    if (set.has(value)) {
      set.delete(value);
    } else {
      set.add(value);
    }
  }

  /**
   * buildSankeyLinks() のリンクキーを条件オブジェクトに戻す。
   *
   * @param {string} linkKey リンクキー。
   * @returns {object|null} パースできた条件。
   */
  function parseLinkKey(linkKey) {
    const parts = String(linkKey || "").split("|");
    if (parts.length !== 4) return null;
    return {
      sourceCategory: parts[0],
      targetCategory: parts[1],
      source: parts[2],
      target: parts[3],
    };
  }

  /**
   * 選択中条件を詳細パネルに表示するチップHTMLにする。
   *
   * @returns {string} チップHTML。
   */
  function selectedConditionChipsHtml() {
    const chips = [];
    const selectedNodes = Array.from(state.selectedNodeIds)
      .map((nodeId) => state.nodeById.get(nodeId))
      .filter(Boolean)
      .sort((a, b) => (state.categoryById.get(a.category)?.order || 0) - (state.categoryById.get(b.category)?.order || 0));

    for (const node of selectedNodes) {
      chips.push(`<span class="ts-chip">${escapeHtml(node.categoryLabel)}: ${escapeHtml(node.label)}</span>`);
    }

    for (const linkKey of Array.from(state.selectedLinkKeys)) {
      const condition = parseLinkKey(linkKey);
      const source = condition ? state.nodeById.get(condition.source) : null;
      const target = condition ? state.nodeById.get(condition.target) : null;
      if (!condition || !source || !target) continue;
      const sourceCategory = state.categoryById.get(condition.sourceCategory)?.label || source.categoryLabel;
      const targetCategory = state.categoryById.get(condition.targetCategory)?.label || target.categoryLabel;
      chips.push(
        `<span class="ts-chip ts-chip-link">${escapeHtml(sourceCategory)}: ${escapeHtml(source.label)} → ${escapeHtml(targetCategory)}: ${escapeHtml(target.label)}</span>`,
      );
    }

    return chips.join("");
  }

  /**
   * 樹種詳細パネルに差し込むHTML文字列を作る。
   *
   * @param {object} species 樹種レコード。
   * @returns {string} 詳細HTML。
   */
  function speciesDetailHtml(species) {
    const chips = orderedCategories(state.data.categories)
      .flatMap((category) =>
        valuesForCategory(species, category.id).map(
          (value) => `<span class="ts-chip">${escapeHtml(category.label)}: ${escapeHtml(value)}</span>`,
        ),
      )
      .join("");

    return `
      <p class="ts-detail-title">${escapeHtml(species.jaName || species.id)}</p>
      <p class="ts-detail-scientific">${escapeHtml(species.scientificName || "")}</p>
      <div class="ts-attribute-chips">${chips}</div>
      <p>${escapeHtml(species.sourceNote || "")}</p>
    `;
  }

  /**
   * 未選択時の詳細HTMLを作る。
   *
   * @param {object} model deriveModel() が返す表示モデル。
   * @returns {string} 詳細HTML。
   */
  function emptyDetailHtml(model) {
    if (state.search) {
      return `
        <p class="ts-detail-title">検索結果</p>
        <p>${escapeHtml(state.search)} に一致する樹種は ${model.filteredSpecies.length}種です。</p>
      `;
    }

    return `
      <p class="ts-detail-empty">ノードまたはリンクをクリックすると条件を追加できます。複数条件は AND で絞り込みます。</p>
    `;
  }

  /**
   * ツールチップ用のノードHTMLを作る。
   *
   * @param {object} node Sankeyノード。
   * @returns {string} ツールチップHTML。
   */
  function nodeTooltipHtml(node) {
    return `
      <strong>${escapeHtml(node.label)}</strong>
      <span>${escapeHtml(node.categoryLabel)}</span><br>
      <span>${node.speciesCount}種</span>
    `;
  }

  /**
   * ツールチップ用のリンクHTMLを作る。
   *
   * @param {object} link Sankeyリンク。
   * @returns {string} ツールチップHTML。
   */
  function linkTooltipHtml(link) {
    return `
      <strong>${escapeHtml(link.source.label)} → ${escapeHtml(link.target.label)}</strong>
      <span>${escapeHtml(link.sourceCategoryLabel)} → ${escapeHtml(link.targetCategoryLabel)}</span><br>
      <span>${link.count}種</span>
    `;
  }

  /**
   * 樹種の指定カテゴリ値を、既存ノードID形式に変換して返す。
   *
   * @param {object} species 樹種レコード。
   * @param {string} categoryId カテゴリID。
   * @returns {string[]} 重複排除済みノードID配列。
   */
  function nodeIdsForSpeciesCategory(species, categoryId) {
    return Array.from(new Set(valuesForCategory(species, categoryId).map((value) => makeNodeId(categoryId, value))));
  }

  /**
   * 樹種の属性から、指定カテゴリの値リストを取り出す。
   *
   * @param {object} species 樹種レコード。
   * @param {string} categoryId カテゴリID。
   * @returns {string[]} 属性値の配列。未設定なら空配列。
   */
  function valuesForCategory(species, categoryId) {
    return species.attributes?.[categoryId] || [];
  }

  /**
   * カテゴリIDと属性値から、既存のノードID形式を作る。
   *
   * @param {string} categoryId カテゴリID。
   * @param {string} value 属性値。
   * @returns {string} ノードID。
   */
  function makeNodeId(categoryId, value) {
    return `${categoryId}::${value}`;
  }

  /**
   * 初期表示カテゴリを作る。family/genusは初期OFFにする。
   *
   * @param {object[]} categories categories配列。
   * @returns {Set<string>} 初期選択カテゴリID。
   */
  function initialCategorySet(categories) {
    const categoryIds = new Set(categories.map((category) => category.id));
    const initialIds = INITIAL_CATEGORY_IDS.filter((id) => categoryIds.has(id));
    return new Set(initialIds.length ? initialIds : categories.filter((category) => category.id !== "family" && category.id !== "genus").map((category) => category.id));
  }

  /**
   * 現在選択されているカテゴリを order 順に返す。
   *
   * @returns {object[]} 選択カテゴリ。
   */
  function orderedSelectedCategories() {
    return orderedCategories(state.data.categories).filter((category) => state.selectedCategoryIds.has(category.id));
  }

  /**
   * categories配列を order 順に並べる。
   *
   * @param {object[]} categories categories配列。
   * @returns {object[]} order順カテゴリ。
   */
  function orderedCategories(categories) {
    return [...categories].sort((a, b) => a.order - b.order);
  }

  /**
   * カテゴリごとのノード数を数える。
   *
   * @param {object[]} nodes ノード配列。
   * @returns {Map<string, number>} カテゴリIDごとのノード数。
   */
  function countNodesByCategory(nodes) {
    const counts = new Map();
    for (const node of nodes) {
      counts.set(node.category, (counts.get(node.category) || 0) + 1);
    }
    return counts;
  }

  /**
   * ノードラベルのX座標を返す。
   *
   * @param {object} node Sankeyノード。
   * @param {Map<string, number>} categoryIndex カテゴリIDごとの列番号。
   * @param {number} categoryCount 表示カテゴリ数。
   * @returns {number} X座標。
   */
  function nodeLabelX(node, categoryIndex, categoryCount) {
    const index = categoryIndex.get(node.category) || 0;
    return index >= categoryCount - 1 ? node.x0 - 7 : node.x1 + 7;
  }

  /**
   * ノードラベルのtext-anchorを返す。
   *
   * @param {object} node Sankeyノード。
   * @param {Map<string, number>} categoryIndex カテゴリIDごとの列番号。
   * @param {number} categoryCount 表示カテゴリ数。
   * @returns {string} text-anchor値。
   */
  function nodeLabelAnchor(node, categoryIndex, categoryCount) {
    const index = categoryIndex.get(node.category) || 0;
    return index >= categoryCount - 1 ? "end" : "start";
  }

  /**
   * 科・属の短い表示文字列を作る。
   *
   * @param {object} species 樹種レコード。
   * @returns {string} 科・属の表示。
   */
  function taxonomyText(species) {
    const family = valuesForCategory(species, "family").join(", ");
    const genus = valuesForCategory(species, "genus").join(", ");
    return [family, genus].filter(Boolean).join(" / ");
  }

  /**
   * 空状態メッセージを表示する。
   *
   * @param {string} message 表示するメッセージ。
   * @returns {void}
   */
  function showEmpty(message) {
    els.empty.hidden = false;
    els.empty.textContent = message;
  }

  /**
   * 空状態メッセージを隠す。
   *
   * @returns {void}
   */
  function hideEmpty() {
    els.empty.hidden = true;
    els.empty.textContent = "";
  }

  /**
   * ツールチップを表示する。
   *
   * @param {MouseEvent} event マウスイベント。
   * @param {string} html ツールチップHTML。
   * @returns {void}
   */
  function showTooltip(event, html) {
    els.tooltip.hidden = false;
    els.tooltip.innerHTML = html;
    moveTooltip(event);
  }

  /**
   * ツールチップをマウス位置へ移動する。
   *
   * @param {MouseEvent} event マウスイベント。
   * @returns {void}
   */
  function moveTooltip(event) {
    const offset = 14;
    const rect = els.tooltip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - rect.width - 8, event.clientX + offset);
    const top = Math.min(window.innerHeight - rect.height - 8, event.clientY + offset);
    els.tooltip.style.left = `${Math.max(8, left)}px`;
    els.tooltip.style.top = `${Math.max(8, top)}px`;
  }

  /**
   * ツールチップを隠す。
   *
   * @returns {void}
   */
  function hideTooltip() {
    els.tooltip.hidden = true;
  }

  /**
   * アプリ領域にエラーメッセージを表示する。
   *
   * @param {string} message 表示するメッセージ。
   * @returns {void}
   */
  function showError(message) {
    app.innerHTML = `<div class="ts-error">${escapeHtml(message)}</div>`;
  }

  /**
   * 検索比較用に日本語ロケールで小文字化する。
   *
   * @param {*} value 任意の値。
   * @returns {string} 正規化した文字列。
   */
  function normalize(value) {
    return String(value || "").toLocaleLowerCase("ja-JP");
  }

  /**
   * innerHTML に入れる文字列をHTMLエスケープする。
   *
   * @param {*} value 任意の値。
   * @returns {string} HTML特殊文字を置換した文字列。
   */
  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * 値を最小値と最大値の範囲内に収める。
   *
   * @param {number} value 入力値。
   * @param {number} min 最小値。
   * @param {number} max 最大値。
   * @returns {number} 範囲内に丸めた値。
   */
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * 連続イベントの最後だけ callback を実行する。
   *
   * @param {Function} callback 実行する関数。
   * @param {number} wait 待ち時間ミリ秒。
   * @returns {Function} debounce 済み関数。
   */
  function debounce(callback, wait) {
    let timeout = null;
    return (...args) => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => callback(...args), wait);
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
