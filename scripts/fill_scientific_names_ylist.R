#!/usr/bin/env Rscript

args <- commandArgs(trailingOnly = TRUE)

input <- "data/trees.csv"
output <- input
write_output <- TRUE
allow_unresolved <- FALSE
unresolved_output <- ""

for (arg in args) {
  if (arg == "--check") {
    write_output <- FALSE
  } else if (arg == "--allow-unresolved") {
    allow_unresolved <- TRUE
  } else if (startsWith(arg, "--input=")) {
    input <- sub("^--input=", "", arg)
  } else if (startsWith(arg, "--output=")) {
    output <- sub("^--output=", "", arg)
  } else if (startsWith(arg, "--unresolved-output=")) {
    unresolved_output <- sub("^--unresolved-output=", "", arg)
  } else {
    stop("Unknown argument: ", arg, call. = FALSE)
  }
}

if (!requireNamespace("ylistjp", quietly = TRUE)) {
  stop("The ylistjp package is required. Install it before running this script.", call. = FALSE)
}

read_trees <- function(path) {
  utils::read.csv(
    path,
    fileEncoding = "UTF-8-BOM",
    stringsAsFactors = FALSE,
    check.names = FALSE
  )
}

preserve_instructions <- function(unresolved, path) {
  if (!file.exists(path)) {
    return(unresolved)
  }
  previous <- utils::read.csv(
    path,
    fileEncoding = "UTF-8-BOM",
    stringsAsFactors = FALSE,
    check.names = FALSE
  )
  if (!("id" %in% names(previous)) || !("instruction" %in% names(previous))) {
    return(unresolved)
  }
  instructions <- previous[["instruction"]]
  names(instructions) <- previous[["id"]]
  unresolved[["instruction"]] <- unname(instructions[unresolved[["id"]]])
  unresolved[["instruction"]][is.na(unresolved[["instruction"]])] <- ""
  unresolved
}

write_trees <- function(path, data) {
  write_csv_utf8_bom(data, path, quote = FALSE)
}

write_csv_utf8_bom <- function(data, path, quote = TRUE) {
  tmp <- tempfile(fileext = ".csv")
  utils::write.table(
    data,
    file = tmp,
    sep = ",",
    row.names = FALSE,
    col.names = TRUE,
    quote = quote,
    na = "",
    fileEncoding = "UTF-8"
  )
  con <- file(path, open = "wb")
  on.exit(close(con), add = TRUE)
  writeBin(as.raw(c(0xef, 0xbb, 0xbf)), con)
  writeBin(readBin(tmp, what = "raw", n = file.info(tmp)$size), con)
  unlink(tmp)
}

clean_key <- function(value) {
  value <- trimws(value)
  value <- gsub("^[\"\u300c\u300e]+|[\"\u300d\u300f]+$", "", value)
  value <- trimws(gsub("\\s*\\([^)]*\\)\\s*$", "", value))
  value
}

alias_tokens <- function(value) {
  value[is.na(value)] <- ""
  clean_key(unlist(strsplit(value, "[,\u3001\uff0c]")))
}

name_corrections <- c(
  "オオパウマノスズクサ" = "オオバウマノスズクサ",
  "ミツパアケビ" = "ミツバアケビ",
  "モミジパフウ" = "モミジバフウ",
  "ツリパナ" = "ツリバナ",
  "エンジユ" = "エンジュ",
  "ハリエンジユ" = "ハリエンジュ",
  "イヌエンジユ" = "イヌエンジュ",
  "シマエンジユ" = "シマエンジュ",
  "マルパシモツケ" = "マルバシモツケ",
  "ミヤマフユイチコ" = "ミヤマフユイチゴ",
  "セイヨウヤブイチコ" = "セイヨウヤブイチゴ",
  "ベニパナイチゴ" = "ベニバナイチゴ",
  "パライチゴ" = "バライチゴ",
  "タカネパラ" = "タカネバラ",
  "ミツパウツギ" = "ミツバウツギ",
  "ヒトツパカエデ" = "ヒトツバカエデ",
  "ヤプツバキ" = "ヤブツバキ",
  "ユキツパキ" = "ユキツバキ",
  "シロパイ" = "シロバイ",
  "コバノミツパツツジ" = "コバノミツバツツジ",
  "ウメガサンウ" = "ウメガサソウ",
  "タイミンタチパナ" = "タイミンタチバナ",
  "マルパアオダモ" = "マルバアオダモ",
  "ヒトツパタゴ" = "ヒトツバタゴ",
  "サンゴジユ" = "サンゴジュ"
)

lookup_names <- function(name) {
  corrected <- unname(name_corrections[name])
  unique(c(name, corrected[!is.na(corrected) & nzchar(corrected)]))
}

build_lookup <- function(ylist, statuses) {
  col_ja <- "\u548c\u540d"
  col_alias <- "\u5225\u540d"
  col_scientific <- "\u5b66\u540d"
  col_status <- "\u30b9\u30c6\u30fc\u30bf\u30b9"

  data <- ylist[
    ylist[[col_status]] %in% statuses &
      !is.na(ylist[[col_scientific]]) &
      nzchar(ylist[[col_scientific]]),
    c(col_ja, col_alias, col_scientific),
    drop = FALSE
  ]

  lookup <- list()
  for (i in seq_len(nrow(data))) {
    keys <- unique(clean_key(c(data[[col_ja]][i], alias_tokens(data[[col_alias]][i]))))
    keys <- keys[!is.na(keys) & nzchar(keys)]
    for (key in keys) {
      lookup[[key]] <- unique(c(lookup[[key]], data[[col_scientific]][i]))
    }
  }
  lookup
}

choose_match <- function(name, genus, lookup) {
  hits <- character()
  for (lookup_name in lookup_names(name)) {
    hits <- unique(stats::na.omit(lookup[[lookup_name]]))
    hits <- hits[nzchar(hits)]
    if (length(hits) > 0) {
      break
    }
  }

  genera <- unlist(strsplit(genus, "/", fixed = TRUE))
  genera <- genera[nzchar(genera)]
  if (length(hits) > 1 && length(genera) > 0) {
    pattern <- paste0("^(", paste(genera, collapse = "|"), ")\\b")
    genus_hits <- hits[grepl(pattern, hits)]
    if (length(genus_hits) > 0) {
      hits <- genus_hits
    }
  }

  hits
}

trees <- read_trees(input)
ylist <- ylistjp::ylist_load()

standard_lookup <- build_lookup(ylist, "\u6a19\u6e96")
fallback_lookup <- build_lookup(ylist, c("\u5e83\u7fa9", "\u72ed\u7fa9"))

matched <- 0L
standard_count <- 0L
fallback_count <- 0L
unresolved <- data.frame(
  line = integer(),
  id = character(),
  ja_name = character(),
  genus = character(),
  reason = character(),
  candidates = character(),
  stringsAsFactors = FALSE
)

for (i in seq_len(nrow(trees))) {
  name <- trees[["ja_name"]][i]
  genus <- trees[["genus"]][i]

  hits <- choose_match(name, genus, standard_lookup)
  source <- "standard"
  if (length(hits) == 0) {
    hits <- choose_match(name, genus, fallback_lookup)
    source <- "broad_or_narrow"
  }

  if (length(hits) == 1) {
    current <- trees[["scientific_name"]][i]
    if (is.na(current) || !nzchar(current)) {
      trees[["scientific_name"]][i] <- hits
    } else if (!identical(current, hits)) {
      unresolved <- rbind(
        unresolved,
        data.frame(
          line = i + 1L,
          id = trees[["id"]][i],
          ja_name = name,
          genus = genus,
          reason = "existing scientific_name differs",
          candidates = hits,
          stringsAsFactors = FALSE
        )
      )
      next
    }
    matched <- matched + 1L
    if (identical(source, "standard")) {
      standard_count <- standard_count + 1L
    } else {
      fallback_count <- fallback_count + 1L
    }
  } else {
    unresolved <- rbind(
      unresolved,
      data.frame(
        line = i + 1L,
        id = trees[["id"]][i],
        ja_name = name,
        genus = genus,
        reason = if (length(hits) == 0) "no YList match" else "multiple YList matches",
        candidates = paste(hits, collapse = " | "),
        stringsAsFactors = FALSE
      )
    )
  }
}

cat(
  "YList matches:",
  matched,
  "of",
  nrow(trees),
  sprintf("(standard=%d, broad_or_narrow=%d)", standard_count, fallback_count),
  "\n"
)

if (nrow(unresolved) > 0) {
  cat("Unresolved rows:", nrow(unresolved), "\n")
  print(utils::head(unresolved, 100), row.names = FALSE)
  if (nzchar(unresolved_output)) {
    unresolved <- preserve_instructions(unresolved, unresolved_output)
    write_csv_utf8_bom(unresolved, unresolved_output)
    cat("Wrote", unresolved_output, "\n")
  }
}

if (nrow(unresolved) > 0 && !allow_unresolved) {
  stop("Unresolved YList rows remain; rerun with --allow-unresolved to write partial matches.", call. = FALSE)
}

if (write_output) {
  write_trees(output, trees)
  cat("Wrote", output, "\n")
}
