# Evaluation score

Run: run.20260906061340655.46bf24cf-ea2e-4a6d-a9db-35c4a9be7f18

Status: **incomplete**

This conclusion covers only the selected metrics and cases. Pending reviews and missing evidence are not passes.

| Metric | Scored | Unavailable | Needs review | Not applicable |
| --- | ---: | ---: | ---: | ---: |
| personalization.lazy_trigger | 1 | 0 | 0 | 0 |
| personalization.user_control | 0 | 0 | 0 | 1 |
| personalization.input_validity | 1 | 0 | 0 | 0 |
| personalization.comparison_integrity | 1 | 0 | 0 | 0 |
| personalization.semantic_quality | 0 | 0 | 1 | 0 |

## controlled/preference-sequence.photo-accumulation

Status: incomplete

Evidence: 6ea1e142fa4b23ec3d836652b58757c774cd03379df9c53b21904da1402a9ec4

- personalization.lazy_trigger: 1 — [{"check":"first-feedback: learning calls outside recommendation","passed":true},{"check":"inspect-first: learning calls outside recommendation","passed":true},{"check":"next-day: learning calls outside recommendation","passed":true},{"check":"second-feedback: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"first-recommendation: outcome","passed":true},{"check":"first-recommendation: publication 392f404e-ef4f-4181-9d3a-2e312b407948","passed":true},{"check":"second-recommendation: publication c691e6f0-418c-407f-864b-785275e448e6","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"second-recommendation: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## Human rubrics

- personalization.semantic_quality: 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。
