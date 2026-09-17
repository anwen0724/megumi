# Evaluation score

Run: run.20260906054751856.a736af31-79f2-4ad3-857c-8564d50f7d31

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

Evidence: b494985f06944434d18d595cbf518d9d9a1a65a050bf095c65a54de3796e201c

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true}]
- personalization.user_control: 1 — [{"check":"step-1: deleted cooking-depth inactive","passed":true},{"check":"step-2: deleted cooking-depth inactive","passed":true},{"check":"step-3: deleted cooking-depth inactive","passed":true}]
- personalization.input_validity: 1 — [{"check":"step-3: inactive cooking-depth","passed":true},{"check":"step-3: publication 0c7e5c3a-aaa0-4e76-9252-4ad675ad1178","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-3: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.cooking-description-change

Status: incomplete

Evidence: 04284de409ebb15bf87519fa1a6606f2653489e3868a5df104c9713a6cfd3d2b

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-2: effective input cooking-depth","passed":true},{"check":"step-2: effective input cooking-depth","passed":true},{"check":"step-2: effective input cooking-depth","passed":true},{"check":"step-2: publication 2b942333-7ea6-4ec7-98d8-e4e1516bca92","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-2: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.cooking-feedback-reversal

Status: failed

Evidence: 39c6c32b0cb9feaebcc0bc26680c0f95d3f9229619e7bb43068691e374744a34

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-2: publication eaa744b0-52ec-4bcb-b6cf-8cb5f9883d0b","passed":true}]
- personalization.comparison_integrity: 0 — [{"check":"step-2: complete paired evidence","passed":false}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.cooking-opposing-feedback

Status: incomplete

Evidence: bd4f95f114b3c85f0622d454e47999c81655fb5dffc27a7ae95ceeca63a8a319

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-3: effective input 5ba91637-62e1-4808-84ba-01d45b24cc42","passed":true},{"check":"step-3: effective input 5ba91637-62e1-4808-84ba-01d45b24cc42","passed":true},{"check":"step-3: effective input 5ba91637-62e1-4808-84ba-01d45b24cc42","passed":true},{"check":"step-3: publication 0dc2379a-96d6-4a78-9746-0d2ff1a35c64","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-3: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.cooking-pause-resume

Status: failed

Evidence: 9220f6f44019d77d7495d0551b5b9e1342d079e452ab929d07f599350629c131

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true},{"check":"step-3: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-4: effective input cooking-depth","passed":true},{"check":"step-4: effective input cooking-depth","passed":true},{"check":"step-4: effective input cooking-depth","passed":true},{"check":"step-4: publication e7b3a6e7-c1f7-40e7-a9fd-3bea457ba1eb","passed":true}]
- personalization.comparison_integrity: 0 — [{"check":"step-4: complete paired evidence","passed":false}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-accumulation

Status: incomplete

Evidence: c6b1c35b829de71f2af4e70aff80efb6b1a6281264ce6512e0c679b09536e6bf

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true},{"check":"step-3: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-4: publication a56d9325-d906-4b64-8884-a47e8df8dec2","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-4: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-delete-old-evidence

Status: incomplete

Evidence: ae46a0a7686e8216858d5ddc9cb2109ebadf6cb1ad04956693ff0191814267f4

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true}]
- personalization.user_control: 1 — [{"check":"step-1: deleted photo-depth inactive","passed":true},{"check":"step-2: deleted photo-depth inactive","passed":true}]
- personalization.input_validity: 1 — [{"check":"step-2: inactive photo-depth","passed":true},{"check":"step-2: publication 66c06d52-fa4f-4c9d-b195-dca8fe283960","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-2: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-last-support

Status: failed

Evidence: f937b0e14f1c3c4891f2f3bfd20750f9d623488f6d25f2023c2b593db0e739e5

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-3: publication 9e8c00f8-b96a-40b9-b57f-26e08ec81c16","passed":true}]
- personalization.comparison_integrity: 0 — [{"check":"step-3: complete paired evidence","passed":false}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-partial-support

Status: failed

Evidence: 63452264156284f2c2ffb9e2b6f78682db292974af9fca4c81a41ee0a3ee73fe

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-2: publication 4978c165-3b98-4001-abcb-56ede48ffeef","passed":true}]
- personalization.comparison_integrity: 0 — [{"check":"step-2: complete paired evidence","passed":false}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-user-edit

Status: failed

Evidence: bd97f49fd1cac8997706fda5b46977fd90b0aab0fd25b4a0bef4b6892d3b24c8

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true},{"check":"step-3: learning calls outside recommendation","passed":true}]
- personalization.user_control: 1 — [{"check":"step-1: preserve user photo-depth","passed":true},{"check":"step-2: preserve user photo-depth","passed":true},{"check":"step-3: preserve user photo-depth","passed":true},{"check":"step-4: preserve user photo-depth","passed":true}]
- personalization.input_validity: 1 — [{"check":"step-4: effective input photo-depth","passed":true},{"check":"step-4: effective input photo-depth","passed":true},{"check":"step-4: publication 141ece93-0a8b-4e08-bf7d-ea9f25c2d3db","passed":true}]
- personalization.comparison_integrity: 0 — [{"check":"step-4: complete paired evidence","passed":false}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## Human rubrics

- personalization.semantic_quality: 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。
