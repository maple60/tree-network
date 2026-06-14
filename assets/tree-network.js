(() => {
  const app = document.getElementById("tree-network-app");
  if (!app) return;

  const DEFAULT_EDGE_LIMIT = 60;
  const AGGREGATE_LINK_LIMIT = 60;

  // 画面全体で共有する状態。各描画関数はこの state を参照して表示を決める。
  const state = {
    data: null,
    nodeById: new Map(),
    categoryById: new Map(),
    selectedCategoryIds: new Set(),
    selectedNodeIds: new Set(),
    selectedSpeciesId: null,
    search: "",
    showSpeciesEdges: false,
    edgeLimit: DEFAULT_EDGE_LIMIT,
    transform: null,
    positions: new Map(),
    simulation: null,
  };

  // HTML 側の要素参照。IDやclass名を変える場合はここも対応が必要。
  const els = {
    search: document.getElementById("tn-search"),
    showSpecies: document.getElementById("tn-show-species"),
    edgeLimit: document.getElementById("tn-edge-limit"),
    edgeLimitValue: document.getElementById("tn-edge-limit-value"),
    reset: document.getElementById("tn-reset"),
    categoryFilters: document.getElementById("tn-category-filters"),
    speciesCount: document.getElementById("tn-species-count"),
    nodeCount: document.getElementById("tn-node-count"),
    edgeCount: document.getElementById("tn-edge-count"),
    modeLabel: document.getElementById("tn-mode-label"),
    graph: document.getElementById("tn-graph"),
    graphShell: document.querySelector(".tn-graph-shell"),
    detail: document.getElementById("tn-detail"),
    speciesList: document.getElementById("tn-species-list"),
  };

  /**
   * 初期化処理。D3とJSONデータを準備し、初回描画とリサイズ時の再描画を登録する。
   *
   * @returns {void}
   */
  function init() {
    if (!window.d3) {
      showError("D3.js の読み込みに失敗しました。ネットワーク接続またはCDNの読み込みを確認してください。");
      return;
    }

    fetch("site-data/tree-network.json")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        state.data = data;
        state.nodeById = new Map(data.nodes.map((node) => [node.id, node]));
        state.categoryById = new Map(data.categories.map((category) => [category.id, category]));
        state.selectedCategoryIds = new Set(
          data.categories.filter((category) => category.defaultVisible).map((category) => category.id),
        );
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
   * 検索、表示切替、件数制限、リセットの各UI操作を state 更新と再描画につなぐ。
   *
   * @returns {void}
   */
  function bindControls() {
    els.search.addEventListener("input", () => {
      state.search = els.search.value.trim();
      state.selectedSpeciesId = null;
      update();
    });

    els.showSpecies.addEventListener("change", () => {
      state.showSpeciesEdges = els.showSpecies.checked;
      update();
    });

    els.edgeLimit.addEventListener("input", () => {
      state.edgeLimit = Number(els.edgeLimit.value);
      els.edgeLimitValue.textContent = String(state.edgeLimit);
      update();
    });

    els.reset.addEventListener("click", () => {
      state.search = "";
      state.selectedNodeIds.clear();
      state.selectedSpeciesId = null;
      state.showSpeciesEdges = false;
      state.edgeLimit = DEFAULT_EDGE_LIMIT;
      state.selectedCategoryIds = new Set(
        state.data.categories.filter((category) => category.defaultVisible).map((category) => category.id),
      );
      els.search.value = "";
      els.showSpecies.checked = false;
      els.edgeLimit.value = String(DEFAULT_EDGE_LIMIT);
      els.edgeLimitValue.textContent = String(DEFAULT_EDGE_LIMIT);
      buildCategoryFilters();
      update();
    });
  }

  /**
   * カテゴリのチェックボックス一覧を現在の state に合わせて作り直す。
   *
   * @returns {void}
   */
  function buildCategoryFilters() {
    els.categoryFilters.innerHTML = "";
    const counts = countNodesByCategory(state.data.nodes);

    for (const category of state.data.categories) {
      const label = document.createElement("label");
      label.className = "tn-category-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.selectedCategoryIds.has(category.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          state.selectedCategoryIds.add(category.id);
        } else {
          state.selectedCategoryIds.delete(category.id);

          // 非表示にしたカテゴリの選択済みノードは、絞り込み条件からも外す。
          for (const nodeId of Array.from(state.selectedNodeIds)) {
            const node = state.nodeById.get(nodeId);
            if (node && node.category === category.id) state.selectedNodeIds.delete(nodeId);
          }
        }
        state.selectedSpeciesId = null;
        update();
      });

      const dot = document.createElement("span");
      dot.className = "tn-color-dot";
      dot.style.background = category.color;

      const text = document.createElement("span");
      text.textContent = category.label;

      const count = document.createElement("span");
      count.className = "tn-category-count";
      count.textContent = `${counts.get(category.id) || 0}`;

      label.append(checkbox, dot, text, count);
      els.categoryFilters.appendChild(label);
    }
  }

  /**
   * 現在の state から表示モデルを作り、統計・グラフ・詳細・樹種リストを再描画する。
   *
   * @returns {void}
   */
  function update() {
    if (!state.data) return;
    const model = deriveModel();
    renderStats(model);
    renderGraph(model);
    renderDetail(model);
    renderSpeciesList(model);
  }

  /**
   * state と元データから、画面描画に必要なノード・リンク・樹種パスを計算する。
   *
   * @returns {object} 統計と描画で使う派生モデル。
   */
  function deriveModel() {
    const hasSearch = state.search.length > 0;
    const searchSpecies = state.data.species.filter((species) => matchesSearch(species));
    const filteredSpecies = searchSpecies.filter((species) =>
      Array.from(state.selectedNodeIds).every((nodeId) => species.attributeNodeIds.includes(nodeId)),
    );
    const filteredSpeciesIds = new Set(filteredSpecies.map((species) => species.id));
    const hasActiveFilter = hasSearch || state.selectedNodeIds.size > 0 || state.selectedSpeciesId;

    // 表示対象カテゴリだけを残し、検索やノード選択がある場合は該当樹種数があるノードに絞る。
    const visibleNodes = state.data.nodes
      .filter((node) => state.selectedCategoryIds.has(node.category))
      .map((node) => {
        const activeCount = node.speciesIds.filter((speciesId) => filteredSpeciesIds.has(speciesId)).length;
        return {
          ...node,
          activeSpeciesCount: activeCount,
          displayCount: hasActiveFilter ? activeCount : node.speciesCount,
        };
      })
      .filter((node) => !hasActiveFilter || node.displayCount > 0 || state.selectedNodeIds.has(node.id));

    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const aggregateSourceSpecies = hasActiveFilter ? filteredSpecies : state.data.species;
    const aggregateLinks = buildAggregateLinks(aggregateSourceSpecies, visibleNodeIds);

    // 樹種エッジは明示ON、検索、ノード選択、樹種選択のいずれかで有効になる。
    const speciesEdgesActive = state.showSpeciesEdges || hasSearch || state.selectedNodeIds.size > 0 || state.selectedSpeciesId;
    const speciesForPaths = speciesEdgesActive ? limitSpeciesForPaths(filteredSpecies) : [];
    const speciesPaths = speciesForPaths
      .map((species) => ({ species, nodes: pathNodesForSpecies(species, visibleNodeIds) }))
      .filter((item) => item.nodes.length >= 2);

    return {
      hasActiveFilter,
      filteredSpecies,
      visibleNodes,
      aggregateLinks,
      speciesPaths,
      speciesEdgesActive,
    };
  }

  /**
   * 樹種レコードが現在の検索文字列に一致するか判定する。
   *
   * @param {object} species 樹種レコード。
   * @returns {boolean} 検索に一致する場合は true。
   */
  function matchesSearch(species) {
    if (!state.search) return true;
    const query = normalize(state.search);
    const values = [
      species.jaName,
      species.scientificName,
      species.sourceNote,
      ...Object.values(species.attributes).flat(),
    ];
    return normalize(values.join(" ")).includes(query);
  }

  /**
   * 隣り合う表示カテゴリ間で、同じ樹種が共有する属性ノード同士を集約リンクにする。
   *
   * @param {object[]} speciesRecords 集約対象の樹種レコード。
   * @param {Set<string>} visibleNodeIds 現在表示されているノードID。
   * @returns {object[]} 太さ計算用の count を持つリンク配列。
   */
  function buildAggregateLinks(speciesRecords, visibleNodeIds) {
    const selectedCategories = orderedSelectedCategories();
    const linkMap = new Map();

    for (const species of speciesRecords) {
      for (let index = 0; index < selectedCategories.length - 1; index += 1) {
        const left = selectedCategories[index];
        const right = selectedCategories[index + 1];
        const leftNodeIds = valuesForCategory(species, left.id)
          .map((value) => makeNodeId(left.id, value))
          .filter((nodeId) => visibleNodeIds.has(nodeId));
        const rightNodeIds = valuesForCategory(species, right.id)
          .map((value) => makeNodeId(right.id, value))
          .filter((nodeId) => visibleNodeIds.has(nodeId));

        for (const source of leftNodeIds) {
          for (const target of rightNodeIds) {
            const key = `${source}=>${target}`;
            if (!linkMap.has(key)) {
              linkMap.set(key, { source, target, count: 0, speciesIds: [] });
            }
            const link = linkMap.get(key);
            link.count += 1;
            link.speciesIds.push(species.id);
          }
        }
      }
    }

    return Array.from(linkMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, AGGREGATE_LINK_LIMIT);
  }

  /**
   * 樹種パスとして描く樹種数を state.edgeLimit までに制限する。
   *
   * @param {object[]} filteredSpecies 現在の条件に一致する樹種。
   * @returns {object[]} パス描画対象の樹種。
   */
  function limitSpeciesForPaths(filteredSpecies) {
    const selectedSpecies = state.selectedSpeciesId
      ? state.data.species.find((species) => species.id === state.selectedSpeciesId)
      : null;
    const sorted = [...filteredSpecies].sort((a, b) => a.jaName.localeCompare(b.jaName, "ja"));
    const limited = sorted.slice(0, state.edgeLimit);
    if (selectedSpecies && !limited.some((species) => species.id === selectedSpecies.id)) {
      limited.unshift(selectedSpecies);
    }
    return limited;
  }

  /**
   * 1つの樹種が持つ属性値を、カテゴリ順のノードID列に変換する。
   *
   * @param {object} species 樹種レコード。
   * @param {Set<string>} visibleNodeIds 現在表示されているノードID。
   * @returns {string[]} 樹種パスに使うノードID列。
   */
  function pathNodesForSpecies(species, visibleNodeIds) {
    const categories = orderedSelectedCategories();
    const nodeIds = [];
    for (const category of categories) {
      for (const value of valuesForCategory(species, category.id)) {
        const nodeId = makeNodeId(category.id, value);
        if (visibleNodeIds.has(nodeId)) nodeIds.push(nodeId);
      }
    }
    return nodeIds;
  }

  /**
   * 画面上部などの集計表示を更新する。
   *
   * @param {object} model deriveModel() が返す表示モデル。
   * @returns {void}
   */
  function renderStats(model) {
    els.speciesCount.textContent = `${model.filteredSpecies.length}種`;
    els.nodeCount.textContent = `${model.visibleNodes.length} nodes`;
    els.edgeCount.textContent = model.speciesEdgesActive
      ? `${model.speciesPaths.length} species edges`
      : `${model.aggregateLinks.length} aggregate links`;
    els.modeLabel.textContent = model.speciesEdgesActive ? "species edge" : "aggregate";
  }

  /**
   * D3でネットワークSVGを描画する。ノード位置は state.positions に保存して次回描画へ引き継ぐ。
   *
   * @param {object} model deriveModel() が返す表示モデル。
   * @returns {void}
   */
  function renderGraph(model) {
    // SVG初期化: 既存の描画と前回の force simulation を止め、現在サイズで描き直す。
    const svg = d3.select(els.graph);
    const bounds = els.graphShell.getBoundingClientRect();
    const width = Math.max(520, Math.floor(bounds.width));
    const height = Math.max(500, Math.floor(bounds.height));

    if (state.simulation) state.simulation.stop();
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const viewport = svg.append("g").attr("class", "tn-viewport");
    const aggregateLayer = viewport.append("g").attr("class", "tn-aggregate-layer");
    const speciesLayer = viewport.append("g").attr("class", "tn-species-layer");
    const nodeLayer = viewport.append("g").attr("class", "tn-node-layer");
    const labelLayer = viewport.append("g").attr("class", "tn-label-layer");

    const nodes = model.visibleNodes.map((node) => {
      const previous = state.positions.get(node.id);
      const category = state.categoryById.get(node.category);
      return {
        ...node,
        x: previous?.x ?? categoryX(category, width) + jitter(30),
        y: previous?.y ?? height / 2 + jitter(120),
      };
    });
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const links = model.aggregateLinks
      .filter((link) => nodeById.has(link.source) && nodeById.has(link.target))
      .map((link) => ({ ...link }));

    // D3 zoom: 拡大縮小とパンを viewport に反映し、次回描画でも transform を維持する。
    const zoom = d3
      .zoom()
      .scaleExtent([0.35, 4])
      .on("zoom", (event) => {
        state.transform = event.transform;
        viewport.attr("transform", event.transform);
      });
    svg.call(zoom);
    if (state.transform) svg.call(zoom.transform, state.transform);

    // aggregate link: 樹種エッジが無効なときだけ、集約リンクを線で表示する。
    const aggregateLink = aggregateLayer
      .selectAll("line")
      .data(model.speciesEdgesActive ? [] : links, (link) => `${link.source}-${link.target}`)
      .join("line")
      .attr("class", "tn-aggregate-link")
      .attr("stroke-width", (link) => Math.min(5, Math.max(0.8, Math.sqrt(link.count) * 0.34)));

    const line = d3
      .line()
      .curve(d3.curveCatmullRom.alpha(0.42))
      .x((point) => point.x)
      .y((point) => point.y);

    const speciesPathClass = (item) =>
      item.species.id === state.selectedSpeciesId ? "tn-species-path is-selected" : "tn-species-path";
    const speciesLabelClass = (item) =>
      item.species.id === state.selectedSpeciesId || model.speciesPaths.length === 1
        ? "tn-species-label is-visible"
        : "tn-species-label";
    const highlightSpecies = (item) => {
      state.selectedSpeciesId = item.species.id;
      renderDetail(model);
      renderSpeciesList(model);
      speciesPath.attr("class", speciesPathClass);
      speciesLabel.attr("class", speciesLabelClass);
    };

    // species path: 見える線と、マウスで触りやすい当たり判定用の線を分けて描く。
    const speciesPath = speciesLayer
      .append("g")
      .attr("class", "tn-species-visible-layer")
      .selectAll("path")
      .data(model.speciesPaths, (item) => item.species.id)
      .join("path")
      .attr("class", speciesPathClass);

    const speciesHitPath = speciesLayer
      .append("g")
      .attr("class", "tn-species-hit-layer")
      .selectAll("path")
      .data(model.speciesPaths, (item) => item.species.id)
      .join("path")
      .attr("class", "tn-species-hit-path")
      .on("mouseenter", (_, item) => {
        highlightSpecies(item);
      })
      .on("click", (event, item) => {
        event.stopPropagation();
        state.selectedSpeciesId = item.species.id;
        update();
      });

    const speciesLabel = labelLayer
      .selectAll("g")
      .data(model.speciesPaths, (item) => item.species.id)
      .join("g")
      .attr("class", speciesLabelClass);

    speciesLabel
      .append("rect")
      .attr("x", -6)
      .attr("y", -19)
      .attr("width", (item) => Math.max(50, item.species.jaName.length * 14 + 12))
      .attr("height", 24)
      .attr("rx", 4)
      .attr("ry", 4);

    speciesLabel
      .append("text")
      .attr("x", 0)
      .attr("y", -3)
      .text((item) => item.species.jaName);

    // node: 属性ノードをグループとして作り、クリックで絞り込み条件を切り替える。
    const node = nodeLayer
      .selectAll("g")
      .data(nodes, (item) => item.id)
      .join("g")
      .attr("class", (item) => nodeClass(item))
      .call(
        // drag behavior: ドラッグ中だけ force simulation を温め、ノード位置をマウス位置へ固定する。
        d3
          .drag()
          .on("start", (event, item) => {
            if (!event.active) state.simulation.alphaTarget(0.25).restart();
            item.fx = item.x;
            item.fy = item.y;
          })
          .on("drag", (event, item) => {
            item.fx = event.x;
            item.fy = event.y;
          })
          .on("end", (event, item) => {
            if (!event.active) state.simulation.alphaTarget(0);
            item.fx = null;
            item.fy = null;
          }),
      )
      .on("click", (event, item) => {
        event.stopPropagation();
        if (state.selectedNodeIds.has(item.id)) {
          state.selectedNodeIds.delete(item.id);
        } else {
          state.selectedNodeIds.add(item.id);
        }
        state.selectedSpeciesId = null;
        update();
      });

    node
      .append("circle")
      .attr("r", (item) => nodeRadius(item))
      .attr("fill", (item) => item.color);

    node
      .append("text")
      .attr("x", (item) => nodeRadius(item) + 5)
      .attr("y", -2)
      .text((item) => item.label);

    node
      .append("text")
      .attr("class", "tn-node-count-label")
      .attr("x", (item) => nodeRadius(item) + 5)
      .attr("y", 12)
      .text((item) => `${item.displayCount}種`);

    svg.on("click", () => {
      if (state.selectedNodeIds.size || state.selectedSpeciesId) {
        state.selectedNodeIds.clear();
        state.selectedSpeciesId = null;
        update();
      }
    });

    // force simulation: リンク、反発、衝突、カテゴリ別X座標、中央寄せY座標でノードを配置する。
    state.simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((item) => item.id)
          .distance((link) => Math.max(80, 160 - link.count * 4))
          .strength(0.2),
      )
      .force("charge", d3.forceManyBody().strength(-260))
      .force("collide", d3.forceCollide((item) => nodeRadius(item) + 12))
      .force("x", d3.forceX((item) => categoryX(state.categoryById.get(item.category), width)).strength(0.16))
      .force("y", d3.forceY(height / 2).strength(0.055))
      .on("tick", ticked);

    ticked();

    /**
     * tick update: force simulation の各 tick で線とノード位置をSVGへ反映する。
     *
     * @returns {void}
     */
    function ticked() {
      for (const item of nodes) {
        item.x = clamp(item.x, 20, width - 20);
        item.y = clamp(item.y, 28, height - 28);
        state.positions.set(item.id, { x: item.x, y: item.y });
      }

      aggregateLink
        .attr("x1", (link) => link.source.x)
        .attr("y1", (link) => link.source.y)
        .attr("x2", (link) => link.target.x)
        .attr("y2", (link) => link.target.y);

      const speciesPathD = (item) => {
        const points = item.nodes.map((nodeId) => nodeById.get(nodeId)).filter(Boolean);
        return points.length >= 2 ? line(points) : null;
      };
      speciesPath.attr("d", speciesPathD);
      speciesHitPath.attr("d", speciesPathD);
      speciesLabel.attr("transform", (item) => {
        const points = item.nodes.map((nodeId) => nodeById.get(nodeId)).filter(Boolean);
        if (!points.length) return "translate(-9999,-9999)";
        const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
        const y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
        return `translate(${clamp(x + 10, 8, width - 120)},${clamp(y - 10, 24, height - 8)})`;
      });

      node.attr("transform", (item) => `translate(${item.x},${item.y})`);
    }
  }

  /**
   * 選択中の樹種、選択中ノード、検索状態に応じて詳細パネルを描画する。
   *
   * @param {object} model deriveModel() が返す表示モデル。
   * @returns {void}
   */
  function renderDetail(model) {
    const selectedSpecies = state.selectedSpeciesId
      ? state.data.species.find((species) => species.id === state.selectedSpeciesId)
      : null;

    if (selectedSpecies) {
      els.detail.innerHTML = speciesDetailHtml(selectedSpecies);
      return;
    }

    if (state.selectedNodeIds.size) {
      const selectedNodes = Array.from(state.selectedNodeIds)
        .map((nodeId) => state.nodeById.get(nodeId))
        .filter(Boolean);
      const chips = selectedNodes
        .map((node) => `<span class="tn-chip">${escapeHtml(node.categoryLabel)}: ${escapeHtml(node.label)}</span>`)
        .join("");
      els.detail.innerHTML = `
        <p class="tn-detail-title">選択中の属性</p>
        <div class="tn-attribute-chips">${chips}</div>
        <p>${model.filteredSpecies.length}種が現在の条件に一致しています。</p>
      `;
      return;
    }

    if (state.search) {
      els.detail.innerHTML = `
        <p class="tn-detail-title">検索結果</p>
        <p>${escapeHtml(state.search)} に一致する樹種は ${model.filteredSpecies.length}種です。</p>
      `;
      return;
    }

    els.detail.innerHTML = `
      <p class="tn-detail-empty">属性ノードをクリックするか、樹種名・学名・形質で検索してください。</p>
      <p class="tn-detail-empty">初期状態では属性間の集約リンクを表示します。樹種エッジは検索・選択時に表示されます。</p>
    `;
  }

  /**
   * 樹種詳細パネルに差し込むHTML文字列を作る。
   *
   * @param {object} species 樹種レコード。
   * @returns {string} 詳細パネル用HTML。
   */
  function speciesDetailHtml(species) {
    const chips = orderedSelectedCategories()
      .flatMap((category) =>
        valuesForCategory(species, category.id).map(
          (value) => `<span class="tn-chip">${escapeHtml(category.label)}: ${escapeHtml(value)}</span>`,
        ),
      )
      .join("");

    return `
      <p class="tn-detail-title">${escapeHtml(species.jaName)}</p>
      <p class="tn-detail-scientific">${escapeHtml(species.scientificName)}</p>
      <div class="tn-attribute-chips">${chips}</div>
      <p>${escapeHtml(species.sourceNote || "")}</p>
    `;
  }

  /**
   * 現在の条件に一致する樹種リストを最大80件まで描画する。
   *
   * @param {object} model deriveModel() が返す表示モデル。
   * @returns {void}
   */
  function renderSpeciesList(model) {
    els.speciesList.innerHTML = "";
    const list = [...model.filteredSpecies]
      .sort((a, b) => a.jaName.localeCompare(b.jaName, "ja"))
      .slice(0, 80);

    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "tn-detail-empty";
      empty.textContent = "該当する樹種はありません。";
      els.speciesList.appendChild(empty);
      return;
    }

    for (const species of list) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = species.id === state.selectedSpeciesId ? "tn-species-button is-selected" : "tn-species-button";
      button.addEventListener("click", () => {
        state.selectedSpeciesId = species.id;
        update();
      });

      const ja = document.createElement("strong");
      ja.textContent = species.jaName;
      const sci = document.createElement("em");
      sci.textContent = species.scientificName;
      button.append(ja, sci);
      els.speciesList.appendChild(button);
    }
  }

  /**
   * 現在選択されているカテゴリを order 順に返す。
   *
   * @returns {object[]} 選択中カテゴリ。
   */
  function orderedSelectedCategories() {
    return state.data.categories
      .filter((category) => state.selectedCategoryIds.has(category.id))
      .sort((a, b) => a.order - b.order);
  }

  /**
   * 樹種の属性から、指定カテゴリの値リストを取り出す。
   *
   * @param {object} species 樹種レコード。
   * @param {string} categoryId カテゴリID。
   * @returns {string[]} 属性値の配列。未設定なら空配列。
   */
  function valuesForCategory(species, categoryId) {
    return species.attributes[categoryId] || [];
  }

  /**
   * カテゴリIDと属性値から、ノードID形式を作る。
   *
   * @param {string} categoryId カテゴリID。
   * @param {string} value 属性値。
   * @returns {string} ノードID。
   */
  function makeNodeId(categoryId, value) {
    return `${categoryId}::${value}`;
  }

  /**
   * カテゴリの order に応じたX座標を計算する。
   *
   * @param {object} category カテゴリレコード。
   * @param {number} width SVGの幅。
   * @returns {number} ノード配置の基準X座標。
   */
  function categoryX(category, width) {
    const categories = orderedSelectedCategories();
    const index = Math.max(0, categories.findIndex((item) => item.id === category.id));
    const divisor = Math.max(1, categories.length - 1);
    return 70 + (index / divisor) * Math.max(120, width - 140);
  }

  /**
   * 表示樹種数に応じたノード半径を計算する。
   *
   * @param {object} node ノードレコード。
   * @returns {number} SVG circle の半径。
   */
  function nodeRadius(node) {
    return Math.max(8, Math.min(24, 7 + Math.sqrt(Math.max(1, node.displayCount)) * 2.2));
  }

  /**
   * ノードの選択状態やミュート状態からCSSクラス文字列を作る。
   *
   * @param {object} node ノードレコード。
   * @returns {string} CSSクラス。
   */
  function nodeClass(node) {
    const classes = ["tn-node"];
    if (state.selectedNodeIds.has(node.id)) classes.push("is-selected");
    if ((state.search || state.selectedNodeIds.size) && node.displayCount === 0) classes.push("is-muted");
    return classes.join(" ");
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
   * 検索比較用に文字列化して日本語ロケールで小文字化する。
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
   * 初期配置に少しだけランダムな揺らぎを足す。
   *
   * @param {number} amount 揺らぎの幅。
   * @returns {number} 正負どちらかの揺らぎ量。
   */
  function jitter(amount) {
    return (Math.random() - 0.5) * amount;
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

  /**
   * アプリ領域にエラーメッセージを表示する。
   *
   * @param {string} message 表示するメッセージ。
   * @returns {void}
   */
  function showError(message) {
    app.innerHTML = `<div class="tn-error">${escapeHtml(message)}</div>`;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
