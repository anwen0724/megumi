# Evaluation score

Run: run.20260906060731641.f9cd1035-a3b5-460a-ae9e-4a5ce953b4da

Status: **incomplete**

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

Evidence: 35a8fd1e12649a8c2ca131bcf70f00c74f9c1337002b71fb98c776dbb9374cf4

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true}]
- personalization.user_control: 1 — [{"check":"step-1: deleted cooking-depth inactive","passed":true},{"check":"step-2: deleted cooking-depth inactive","passed":true},{"check":"step-3: deleted cooking-depth inactive","passed":true}]
- personalization.input_validity: 1 — [{"check":"step-3: inactive cooking-depth","passed":true},{"check":"step-3: publication 486ac388-4eeb-4607-8c10-d0b371ddd1a8","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-3: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.cooking-description-change

Status: incomplete

Evidence: fc4b04a723cc7ced0a8b761b1c58d9b589ef8c12438685e6c767ea1c34210937

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-2: publication 06f36d9a-a9f4-4459-a837-9b35c7ad914f","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-2: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.cooking-feedback-reversal

Status: incomplete

Evidence: 3e79f81d4a80d3702b8014010befe8a0effebf7adb12378b99df662590c7b9d5

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-2: effective input cooking-depth","passed":true},{"check":"step-2: effective input cooking-depth","passed":true},{"check":"step-2: effective input cooking-depth","passed":true},{"check":"step-2: publication 0d7f29b0-ee4c-474e-b706-f4f1d6369220","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-2: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.cooking-opposing-feedback

Status: incomplete

Evidence: cb699e451d32f490f1ae820f9c7552d77b81a556d3d90f788f733bc3a000cf29

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-3: effective input 4ff10e81-18e8-4776-8409-dfc2b1bc1aa5","passed":true},{"check":"step-3: effective input f1c4258d-5dd9-44bf-8942-238a3a8dc024","passed":true},{"check":"step-3: effective input 4ff10e81-18e8-4776-8409-dfc2b1bc1aa5","passed":true},{"check":"step-3: effective input f1c4258d-5dd9-44bf-8942-238a3a8dc024","passed":true},{"check":"step-3: publication f1793eba-1380-4c65-be15-8d312aee4fb5","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-3: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.cooking-pause-resume

Status: incomplete

Evidence: 9fa7c26c3bfc98aa7df40cc6f07823a2a2ba9d4f8ef196edca47de207c632998

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true},{"check":"step-3: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-4: effective input cooking-depth","passed":true},{"check":"step-4: effective input cooking-depth","passed":true},{"check":"step-4: effective input cooking-depth","passed":true},{"check":"step-4: publication b2cf9371-5fe1-4f92-ac17-86e2090dab7b","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-4: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-accumulation

Status: incomplete

Evidence: 6510ccac7fb8bef515117e84f181b510596e764ba3f3c4d466fd059a2edf002f

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true},{"check":"step-3: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-4: publication 89853bb5-e5ae-4fb4-b73f-ffba4fd6d856","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-4: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-delete-old-evidence

Status: incomplete

Evidence: 1dbc909b20e782a212dce21e94243b78645cfd6aaa6c8afea568afcc23f3ca8c

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true}]
- personalization.user_control: 1 — [{"check":"step-1: deleted photo-depth inactive","passed":true},{"check":"step-2: deleted photo-depth inactive","passed":true}]
- personalization.input_validity: 1 — [{"check":"step-2: inactive photo-depth","passed":true},{"check":"step-2: publication 6352235e-536d-4ca4-91d0-4150ffbff46b","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-2: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-last-support

Status: incomplete

Evidence: 0bc3921455c290213dff408f677e952a40d96636410202c1e1f52077a86814c0

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-3: publication e7b7630a-7954-48cc-b009-9d9db021354c","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-3: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-partial-support

Status: incomplete

Evidence: 1732d31f2de5990d99815e1772b277882c080944e939f72c737785621ab48912

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-2: effective input photo-depth","passed":true},{"check":"step-2: effective input photo-depth","passed":true},{"check":"step-2: effective input photo-depth","passed":true},{"check":"step-2: effective input photo-depth","passed":true},{"check":"step-2: publication cf5cb6e1-4bf7-44f2-947a-12e518c0a0e8","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-2: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-user-edit

Status: incomplete

Evidence: 5cc316b4033979fba078807cb68d0c8d796b65b62fa0b9187519fd8345d944f3

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true},{"check":"step-3: learning calls outside recommendation","passed":true}]
- personalization.user_control: 1 — [{"check":"step-1: preserve user photo-depth","passed":true},{"check":"step-2: preserve user photo-depth","passed":true},{"check":"step-3: preserve user photo-depth","passed":true},{"check":"step-4: preserve user photo-depth","passed":true}]
- personalization.input_validity: 1 — [{"check":"step-4: effective input photo-depth","passed":true},{"check":"step-4: effective input photo-depth","passed":true},{"check":"step-4: publication 70c22ea6-420e-46db-8cd5-9599d2e94864","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-4: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## Human rubrics

- personalization.semantic_quality: 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。
