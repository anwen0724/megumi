# Evaluation score

Run: run.20260906053743386.3bf6d1d1-2b2e-4175-8772-64f9128055f2

Status: **failed**

This conclusion covers only the selected metrics and cases. Pending reviews and missing evidence are not passes.

| Metric | Scored | Unavailable | Needs review | Not applicable |
| --- | ---: | ---: | ---: | ---: |
| personalization.lazy_trigger | 10 | 0 | 0 | 0 |
| personalization.user_control | 3 | 0 | 0 | 7 |
| personalization.input_validity | 10 | 0 | 0 | 0 |
| personalization.comparison_integrity | 10 | 0 | 0 | 0 |
| personalization.semantic_quality | 0 | 0 | 10 | 0 |

## controlled/preference-sequence.cooking-delete-new-evidence

Status: incomplete

Evidence: 8984d493c85e48fde9771d03874ff1c5d4ed1ef17de115f4a51cc2f28ed4227f

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true}]
- personalization.user_control: 1 — [{"check":"step-1: deleted cooking-depth inactive","passed":true},{"check":"step-2: deleted cooking-depth inactive","passed":true},{"check":"step-3: deleted cooking-depth inactive","passed":true}]
- personalization.input_validity: 1 — [{"check":"step-3: inactive cooking-depth","passed":true},{"check":"step-3: publication 3aec0b71-50d6-4d17-9d00-980e22fd0cbf","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-3: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.cooking-description-change

Status: incomplete

Evidence: 39f9c2ac250b397c282c3f31c3a409ca22ee7158578c744d8d28f086bc9b05cd

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-2: publication 9f048b3e-997e-4bc2-bf73-a78d1245912c","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-2: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.cooking-feedback-reversal

Status: failed

Evidence: cd1d5f7c31cf90955dbc276024649216812ef342fda294456747d0fba67b422e

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-2: publication c8f451df-94a5-44cb-a497-a589124d8d57","passed":true}]
- personalization.comparison_integrity: 0 — [{"check":"step-2: complete paired evidence","passed":false}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.cooking-opposing-feedback

Status: incomplete

Evidence: ecabc8349b53aafa764a7d07982befee523abf4a81e5e340449e8d90db2437ba

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-3: effective input 8e710d91-9c54-4ede-bbff-88cc514c51b5","passed":true},{"check":"step-3: effective input a0a48b2d-9ba9-4351-b3f8-4dffd5990ec4","passed":true},{"check":"step-3: effective input 8e710d91-9c54-4ede-bbff-88cc514c51b5","passed":true},{"check":"step-3: effective input a0a48b2d-9ba9-4351-b3f8-4dffd5990ec4","passed":true},{"check":"step-3: publication 1581bf24-871f-459c-ac3d-67fd3ed0ac0d","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-3: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.cooking-pause-resume

Status: incomplete

Evidence: e2663ffe23105662f3ec8d0ed3aafc642dbfb15b14fdcac3c6609760d8fedb8c

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true},{"check":"step-3: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-4: effective input cooking-depth","passed":true},{"check":"step-4: effective input cooking-depth","passed":true},{"check":"step-4: effective input cooking-depth","passed":true},{"check":"step-4: effective input cooking-depth","passed":true},{"check":"step-4: publication 1d3614e6-f4da-4903-8181-115335321d41","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-4: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-accumulation

Status: incomplete

Evidence: afd96075c65460a207d8216d1f879c3bc889d8639eb343b6a6391933a233e033

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true},{"check":"step-3: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-4: publication 767b49e9-4128-4b22-b136-6f680ff5932d","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-4: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-delete-old-evidence

Status: incomplete

Evidence: 6a3c9a4a6762283ed9823f9f977e47b9923379d5d93e7c612ce47279ba3551c2

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true}]
- personalization.user_control: 1 — [{"check":"step-1: deleted photo-depth inactive","passed":true},{"check":"step-2: deleted photo-depth inactive","passed":true}]
- personalization.input_validity: 1 — [{"check":"step-2: inactive photo-depth","passed":true},{"check":"step-2: publication 3eab7589-a9b5-4508-9af9-4692ff8911bb","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-2: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-last-support

Status: failed

Evidence: d5e5f3e2915a0ed05de5bf887925ddbbb91bc54e222a393a077c6591f31b52ce

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-3: effective input photo-depth","passed":true},{"check":"step-3: effective input photo-depth","passed":true},{"check":"step-3: effective input photo-depth","passed":true},{"check":"step-3: effective input photo-depth","passed":true},{"check":"step-3: publication a43fd26d-c7fc-48ab-9c40-46956b4ffae7","passed":true}]
- personalization.comparison_integrity: 0 — [{"check":"step-3: complete paired evidence","passed":false}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-partial-support

Status: incomplete

Evidence: effaa764c2716a6af20622ed3d269e8c1035d29aaa46aa26c09787b31fc3883f

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-2: effective input photo-depth","passed":true},{"check":"step-2: effective input photo-depth","passed":true},{"check":"step-2: effective input photo-depth","passed":true},{"check":"step-2: publication 0a8206b9-80db-490f-b112-36d0827b00fe","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-2: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-user-edit

Status: incomplete

Evidence: 39a93e138f62ee0a14a2b05af998623ed1c1e6f29dc3f03b12449b572d903147

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true},{"check":"step-3: learning calls outside recommendation","passed":true}]
- personalization.user_control: 1 — [{"check":"step-1: preserve user photo-depth","passed":true},{"check":"step-2: preserve user photo-depth","passed":true},{"check":"step-3: preserve user photo-depth","passed":true},{"check":"step-4: preserve user photo-depth","passed":true}]
- personalization.input_validity: 1 — [{"check":"step-4: effective input photo-depth","passed":true},{"check":"step-4: effective input photo-depth","passed":true},{"check":"step-4: effective input photo-depth","passed":true},{"check":"step-4: publication 28fcfafa-5fd6-4ab8-9b5b-f9214b67bf27","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-4: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## Human rubrics

- personalization.semantic_quality: 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。
