# Evaluation score

Run: run.20260906055626429.5c42d9c9-ce24-4da9-9472-c6638a1b3ffc

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

Evidence: 4bf36dac7ac97d109a2cf95f5cafdd2c2a768ec9dd0a3d730a88b90062b9a40d

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true}]
- personalization.user_control: 1 — [{"check":"step-1: deleted cooking-depth inactive","passed":true},{"check":"step-2: deleted cooking-depth inactive","passed":true},{"check":"step-3: deleted cooking-depth inactive","passed":true}]
- personalization.input_validity: 1 — [{"check":"step-3: inactive cooking-depth","passed":true},{"check":"step-3: publication b7f895a2-ef79-4258-87fa-1f52a8a2187d","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-3: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.cooking-description-change

Status: failed

Evidence: 726356a0b946302c86ec9468b124ba5182df74e453edc3e061cf9336ca177030

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-2: publication edd8c7e7-00dc-468f-bb87-7dec515e16e2","passed":true}]
- personalization.comparison_integrity: 0 — [{"check":"step-2: complete paired evidence","passed":false}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.cooking-feedback-reversal

Status: incomplete

Evidence: babac2a82d136649c172ab587d85a3c78aab459c8cf25b826d75e94842dc7be4

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-2: effective input cooking-depth","passed":true},{"check":"step-2: effective input cooking-depth","passed":true},{"check":"step-2: publication 9ac06507-226a-45f8-8a7f-739c268add0a","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-2: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.cooking-opposing-feedback

Status: incomplete

Evidence: e8b68b67edc1dd6c940caa3c3422c5f8b70ad4e618b15cc663de0a5295606181

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-3: publication 6b46957e-d098-4e53-bab4-fec3d9886d39","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-3: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.cooking-pause-resume

Status: incomplete

Evidence: 474070c49a4730cabd3cf45cef716fb0566c10e36a636899545938d8b911ea83

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true},{"check":"step-3: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-4: effective input cooking-depth","passed":true},{"check":"step-4: effective input cooking-depth","passed":true},{"check":"step-4: effective input cooking-depth","passed":true},{"check":"step-4: publication 9f49c7c5-d152-40ef-b593-5e78f9d181a3","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-4: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-accumulation

Status: incomplete

Evidence: 0fe263d5ecd6b65dbc804b97dc81cf11725819158c3ea1f0931ce11cc7249a84

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true},{"check":"step-3: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-4: publication 10b5e184-a8a6-4605-a07e-e4eb2ea860eb","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-4: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-delete-old-evidence

Status: failed

Evidence: f1c4580301538638b98d9d8149df8a3e9db7c4c369dff5bdcfeafa2aa92b2cb8

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true}]
- personalization.user_control: 1 — [{"check":"step-1: deleted photo-depth inactive","passed":true},{"check":"step-2: deleted photo-depth inactive","passed":true}]
- personalization.input_validity: 1 — [{"check":"step-2: inactive photo-depth","passed":true},{"check":"step-2: publication 1d6967f7-679f-461c-80ee-89311daf4912","passed":true}]
- personalization.comparison_integrity: 0 — [{"check":"step-2: complete paired evidence","passed":false}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-last-support

Status: failed

Evidence: 77ff297a40a20d8886a19ca3ddb6c173d55cbadebdb86b0e308643ee794b383b

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-3: publication 977f2c52-3a8f-4a0e-9450-013172726bcc","passed":true}]
- personalization.comparison_integrity: 0 — [{"check":"step-3: complete paired evidence","passed":false}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-partial-support

Status: incomplete

Evidence: 375869cbc5479eaaf9d02cb03b415ccd7d6bf13b0a748233948122645c3db636

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-2: effective input photo-depth","passed":true},{"check":"step-2: effective input photo-depth","passed":true},{"check":"step-2: effective input photo-depth","passed":true},{"check":"step-2: publication da3cc7ce-2cc4-44d1-b89b-7bd75299dfb6","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-2: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-user-edit

Status: incomplete

Evidence: 9e7391ec34a4015be973bca5c3f760b385cf6dfb2c158537b4b079ca8cf6739a

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true},{"check":"step-3: learning calls outside recommendation","passed":true}]
- personalization.user_control: 1 — [{"check":"step-1: preserve user photo-depth","passed":true},{"check":"step-2: preserve user photo-depth","passed":true},{"check":"step-3: preserve user photo-depth","passed":true},{"check":"step-4: preserve user photo-depth","passed":true}]
- personalization.input_validity: 1 — [{"check":"step-4: effective input photo-depth","passed":true},{"check":"step-4: effective input photo-depth","passed":true},{"check":"step-4: effective input photo-depth","passed":true},{"check":"step-4: publication abbc4d00-38d8-41e9-b19d-d77003ecd9ac","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-4: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## Human rubrics

- personalization.semantic_quality: 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。
