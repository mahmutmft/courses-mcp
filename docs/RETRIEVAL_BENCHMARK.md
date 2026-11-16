# Retrieval benchmark

Run npm run benchmark:retrieval from the repository root. The command uses the
production index builder and ranker on synthetic Macedonian and English text
shaped like reader output. It requires no Moodle account. The fixtures include
PDF page evidence, competing results across courses, a composed Unicode case,
and one unsupported source. The benchmark measures retrieval within this corpus.

An answerable case passes when the expected course, URL and page appear in the
first five hits. The command requires at least 90% of answerable cases to pass,
zero invalid citations and no hits for designated no-match queries. The
unsupported source is counted separately. An empty search in a partially indexed
corpus only means no match was found in the indexed text.

Initial synthetic baseline: 25/25 answerable queries hit the expected citation,
6/6 no-match queries returned no hits, and all returned citations were valid.
These scores describe the fixtures and do not estimate live Moodle coverage.

CI runs the benchmark in the required Node checks and tests job on pull requests and default-branch pushes.
