# Evaluation score

Run: run.20260906061340654.ec4614e0-9bb5-4521-8af4-dd491d80f5f3

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

Evidence: d7f433189121b38b5bff14efc3a7eed09ad4ab56e798c368af2d6bd57a380908

- personalization.lazy_trigger: 1 — [{"check":"first-feedback: learning calls outside recommendation","passed":true},{"check":"inspect-first: learning calls outside recommendation","passed":true},{"check":"next-day: learning calls outside recommendation","passed":true},{"check":"second-feedback: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"first-recommendation: outcome","passed":true},{"check":"first-recommendation: publication f3e8ef19-e4a9-4720-a0e7-86157b4b4e2e","passed":true},{"check":"second-recommendation: publication 1f670318-04f1-4b07-8df5-1a3507905fd4","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"second-recommendation: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## Human rubrics

- personalization.semantic_quality: 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。
