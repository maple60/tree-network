(() => {
  const app = document.getElementById("tree-browser-app");
  if (!app) return;

  const FILTER_CATEGORIES = [
    "leaf_persistence",
    "leaf_type",
    "leaf_complexity",
    "leaf_arrangement",
    "leaf_margin",
    "serration",
    "family",
    "genus",
  ];

  const state = {
    data: null,
    categoryById: new Map(),
    valuesByCategory: new Map(),
    selectedFilters: new Map(),
    search: "",
  };

  const els = {
    search: document.getElementById("tb-search"),
    reset: document.getElementById("tb-reset"),
    filters: document.getElementById("tb-filters"),
    results: document.getElementById("tb-results"),
    resultCount: document.getElementById("tb-result-count"),
    resultSummary: document.getElementById("tb-result-summary"),
    activeFilterCount: document.getElementById("tb-active-filter-count"),
  };

  /**
   * JSONを読み込み、フィルタUIと初回の結果一覧を作る。
   *
   * @returns {void}
   */
  function init() {
    fetch("site-data/tree-network.json")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        prepareData(data);
        buildFilterUi();
        bindControls();
        update();
      })
      .catch((error) => {
        showError(`tree-network.json を読み込めませんでした: ${error.message}`);
      });
  }

  /**
   * 元データからカテゴリ索引、フィルタ候補、選択状態を準備する。
   *
   * @param {object} data tree-network.json の内容。
   * @returns {void}
   */
  function prepareData(data) {
    state.data = data;
    state.categoryById = new Map(data.categories.map((category) => [category.id, category]));
    state.valuesByCategory = buildFilterValues(data);
    state.selectedFilters = new Map(FILTER_CATEGORIES.map((categoryId) => [categoryId, new Set()]));
  }

  /**
   * 検索欄とリセットボタンを、状態更新と再描画につなぐ。
   *
   * @returns {void}
   */
  function bindControls() {
    els.search.addEventListener("input", () => {
      state.search = els.search.value.trim();
      update();
    });

    els.reset.addEventListener("click", () => {
      state.search = "";
      els.search.value = "";
      for (const selectedValues of state.selectedFilters.values()) selectedValues.clear();
      buildFilterUi();
      update();
    });
  }

  /**
   * カテゴリごとのチェックボックス群を作る。
   *
   * @returns {void}
   */
  function buildFilterUi() {
    els.filters.innerHTML = "";
    const fragment = document.createDocumentFragment();

    for (const categoryId of FILTER_CATEGORIES) {
      const category = state.categoryById.get(categoryId);
      const values = state.valuesByCategory.get(categoryId) || [];
      if (!category || !values.length) continue;

      const group = document.createElement("details");
      group.className = "tb-filter-group";
      group.open = categoryId !== "genus";

      const summary = document.createElement("summary");
      const title = document.createElement("span");
      title.textContent = category.label;
      const count = document.createElement("span");
      count.className = "tb-filter-count";
      count.textContent = `${values.length}`;
      summary.append(title, count);

      const list = document.createElement("div");
      list.className = "tb-filter-options";

      for (const item of values) {
        list.appendChild(buildFilterOption(categoryId, item));
      }

      group.append(summary, list);
      fragment.appendChild(group);
    }

    els.filters.appendChild(fragment);
  }

  /**
   * 1つのフィルタ候補をチェックボックスとして作る。
   *
   * @param {string} categoryId カテゴリID。
   * @param {object} item 値と件数。
   * @returns {HTMLLabelElement} フィルタ行。
   */
  function buildFilterOption(categoryId, item) {
    const selectedValues = selectedSet(categoryId);
    const label = document.createElement("label");
    label.className = "tb-filter-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedValues.has(item.value);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedValues.add(item.value);
      } else {
        selectedValues.delete(item.value);
      }
      update();
    });

    const value = document.createElement("span");
    value.textContent = item.value;

    const count = document.createElement("span");
    count.className = "tb-option-count";
    count.textContent = `${item.count}`;

    label.append(checkbox, value, count);
    return label;
  }

  /**
   * 現在の検索語とフィルタから該当樹種を計算し、画面を更新する。
   *
   * @returns {void}
   */
  function update() {
    if (!state.data) return;
    const results = state.data.species
      .filter((species) => matchesSearch(species) && matchesFilters(species))
      .sort((a, b) => normalize(a.jaName).localeCompare(normalize(b.jaName), "ja"));

    renderCounts(results);
    renderResults(results);
  }

  /**
   * 和名・学名・科・属・全形質が検索語に一致するか調べる。
   *
   * @param {object} species 樹種レコード。
   * @returns {boolean} 検索条件に合えば true。
   */
  function matchesSearch(species) {
    if (!state.search) return true;
    const query = normalize(state.search);
    const values = [
      species.jaName,
      species.scientificName,
      species.sourceNote,
      ...Object.values(species.attributes || {}).flat(),
    ];
    return normalize(values.join(" ")).includes(query);
  }

  /**
   * 各カテゴリの選択値に、樹種の属性が合うか調べる。
   *
   * @param {object} species 樹種レコード。
   * @returns {boolean} フィルタ条件に合えば true。
   */
  function matchesFilters(species) {
    for (const categoryId of FILTER_CATEGORIES) {
      const selectedValues = selectedSet(categoryId);
      if (!selectedValues.size) continue;

      const speciesValues = valuesForCategory(species, categoryId);
      if (!speciesValues.some((value) => selectedValues.has(value))) return false;
    }
    return true;
  }

  /**
   * 表示件数と選択中条件数を更新する。
   *
   * @param {object[]} results 条件に一致した樹種。
   * @returns {void}
   */
  function renderCounts(results) {
    const total = state.data.species.length;
    const activeFilters = countActiveFilters();
    els.resultCount.textContent = `${results.length}種`;
    els.activeFilterCount.textContent = `${activeFilters}条件`;
    els.resultSummary.textContent = `${total}種中 ${results.length}種を表示しています。`;
  }

  /**
   * 結果一覧をカードとして描画する。
   *
   * @param {object[]} results 条件に一致した樹種。
   * @returns {void}
   */
  function renderResults(results) {
    els.results.innerHTML = "";

    if (!results.length) {
      const empty = document.createElement("p");
      empty.className = "tb-empty";
      empty.textContent = "該当する樹種はありません。条件を減らしてください。";
      els.results.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const species of results) {
      fragment.appendChild(buildSpeciesCard(species));
    }
    els.results.appendChild(fragment);
  }

  /**
   * 1樹種分のカードを作る。
   *
   * @param {object} species 樹種レコード。
   * @returns {HTMLElement} 樹種カード。
   */
  function buildSpeciesCard(species) {
    const card = document.createElement("article");
    card.className = "tb-species-card";

    const title = document.createElement("h3");
    title.textContent = species.jaName || "和名未設定";

    const scientificName = document.createElement("p");
    scientificName.className = "tb-scientific-name";
    scientificName.textContent = species.scientificName || "学名未設定";

    const taxonomy = document.createElement("dl");
    taxonomy.className = "tb-taxonomy";
    appendTerm(taxonomy, "科", joinValues(species, "family"));
    appendTerm(taxonomy, "属", joinValues(species, "genus"));

    const traits = document.createElement("div");
    traits.className = "tb-traits";
    for (const categoryId of FILTER_CATEGORIES.filter((id) => id !== "family" && id !== "genus")) {
      appendTraitChips(traits, species, categoryId);
    }

    card.append(title, scientificName, taxonomy, traits);
    return card;
  }

  /**
   * 定義リストに、科や属の表示行を追加する。
   *
   * @param {HTMLDListElement} list 追加先の定義リスト。
   * @param {string} term 見出し。
   * @param {string} value 値。
   * @returns {void}
   */
  function appendTerm(list, term, value) {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value || "未設定";
    list.append(dt, dd);
  }

  /**
   * 主要形質をカテゴリ名つきチップとして追加する。
   *
   * @param {HTMLElement} container 追加先。
   * @param {object} species 樹種レコード。
   * @param {string} categoryId カテゴリID。
   * @returns {void}
   */
  function appendTraitChips(container, species, categoryId) {
    const category = state.categoryById.get(categoryId);
    const values = valuesForCategory(species, categoryId);
    if (!category || !values.length) return;

    for (const value of values) {
      const chip = document.createElement("span");
      chip.className = "tb-trait-chip";
      chip.textContent = `${category.label}: ${value}`;
      container.appendChild(chip);
    }
  }

  /**
   * 全樹種からカテゴリ別のフィルタ候補と件数を作る。
   *
   * @param {object} data tree-network.json の内容。
   * @returns {Map<string, object[]>} カテゴリIDごとの値一覧。
   */
  function buildFilterValues(data) {
    const countsByCategory = new Map(FILTER_CATEGORIES.map((categoryId) => [categoryId, new Map()]));

    for (const species of data.species) {
      for (const categoryId of FILTER_CATEGORIES) {
        for (const value of valuesForCategory(species, categoryId)) {
          const counts = countsByCategory.get(categoryId);
          counts.set(value, (counts.get(value) || 0) + 1);
        }
      }
    }

    const valuesByCategory = new Map();
    for (const categoryId of FILTER_CATEGORIES) {
      const category = data.categories.find((item) => item.id === categoryId);
      const counts = countsByCategory.get(categoryId);
      const fixedOrder = category?.values || [];
      const orderedValues = [
        ...fixedOrder.filter((value) => counts.has(value)),
        ...Array.from(counts.keys())
          .filter((value) => !fixedOrder.includes(value))
          .sort((a, b) => normalize(a).localeCompare(normalize(b), "ja")),
      ];

      valuesByCategory.set(
        categoryId,
        orderedValues.map((value) => ({ value, count: counts.get(value) || 0 })),
      );
    }

    return valuesByCategory;
  }

  /**
   * 指定カテゴリで選択中の値セットを返す。
   *
   * @param {string} categoryId カテゴリID。
   * @returns {Set<string>} 選択中の値。
   */
  function selectedSet(categoryId) {
    if (!state.selectedFilters.has(categoryId)) state.selectedFilters.set(categoryId, new Set());
    return state.selectedFilters.get(categoryId);
  }

  /**
   * 樹種から指定カテゴリの属性値を配列で取り出す。
   *
   * @param {object} species 樹種レコード。
   * @param {string} categoryId カテゴリID。
   * @returns {string[]} 属性値。
   */
  function valuesForCategory(species, categoryId) {
    return (species.attributes && species.attributes[categoryId]) || [];
  }

  /**
   * 指定カテゴリの値を読める文字列にする。
   *
   * @param {object} species 樹種レコード。
   * @param {string} categoryId カテゴリID。
   * @returns {string} 表示用の結合済み文字列。
   */
  function joinValues(species, categoryId) {
    return valuesForCategory(species, categoryId).join("、");
  }

  /**
   * 現在選ばれているチェックボックス数を数える。
   *
   * @returns {number} 選択中フィルタ数。
   */
  function countActiveFilters() {
    let count = 0;
    for (const selectedValues of state.selectedFilters.values()) count += selectedValues.size;
    return count;
  }

  /**
   * 検索比較のため、小文字化して前後空白を落とす。
   *
   * @param {*} value 任意の値。
   * @returns {string} 正規化した文字列。
   */
  function normalize(value) {
    return String(value || "").toLocaleLowerCase("ja-JP").trim();
  }

  /**
   * アプリ領域に読み込みエラーを表示する。
   *
   * @param {string} message エラーメッセージ。
   * @returns {void}
   */
  function showError(message) {
    app.innerHTML = "";
    const error = document.createElement("div");
    error.className = "tb-error";
    error.textContent = message;
    app.appendChild(error);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
