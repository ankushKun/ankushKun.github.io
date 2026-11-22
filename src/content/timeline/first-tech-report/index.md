---
title: "Published Construct Technical Report 2026-01"
description: "Co-authored 'Compatible APIs, Incompatible Thresholds' with Nischal Naik, benchmarking Cloudflare's Clef against TypeSafe's Jev across 1,053 agent calls."
date: 2026-10-05
kind: ["launch", "milestone"]
tags: ["construct", "ai-agents", "machine-learning"]
links:
  - label: "Read the PDF"
    url: "/papers/compatible-apis-incompatible-thresholds.pdf"
related: ["/blogs/clef-vs-jev-benchmark", "/blogs/jev-ai-agents"]
---
"Compatible APIs, Incompatible Thresholds" is Construct Technical Report 2026-01, with my name on the cover next to Nischal Naik's.

When Cloudflare released Clef, we pointed the decision specs we had written for Jev at it without changing a line and ran 1,053 calls against 117 labelled cases. Clef came out slightly ahead and returned the identical probability on every repeated call. The bigger lesson was that swapping decision models is a thresholds and reproducibility problem, not just an API problem. The [blog post](/blogs/clef-vs-jev-benchmark/) has the full write-up.
