# Evaluation score

Run: run.20260906060731641.d8391cb2-4ee8-4922-9213-c889826a3559

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

Evidence: 2e590df943eac9133a2cc2291280ff057db81e0f91a560e8c78da39ef03d3e8c

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true}]
- personalization.user_control: 1 — [{"check":"step-1: deleted cooking-depth inactive","passed":true},{"check":"step-2: deleted cooking-depth inactive","passed":true},{"check":"step-3: deleted cooking-depth inactive","passed":true}]
- personalization.input_validity: 1 — [{"check":"step-3: inactive cooking-depth","passed":true},{"check":"step-3: publication 92d827d3-923b-4101-bd08-56bdcf7889b9","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-3: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.cooking-description-change

Status: incomplete

Evidence: f29d2ed7c4d447dbb89616b88b3bddfd51310e3cc8af66a7f9aaefca7fb6904b

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-2: effective input cooking-depth","passed":true},{"check":"step-2: effective input cooking-depth","passed":true},{"check":"step-2: effective input cooking-depth","passed":true},{"check":"step-2: effective input cooking-depth","passed":true},{"check":"step-2: effective input cooking-depth","passed":true},{"check":"step-2: publication d607da13-82ac-4d17-9f08-ad47baee7bb3","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-2: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.cooking-feedback-reversal

Status: incomplete

Evidence: a0fd224944e571b50da37bc657df7646f5763fd095a6810df95813170555ba6a

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-2: effective input cooking-depth","passed":true},{"check":"step-2: effective input cooking-depth","passed":true},{"check":"step-2: publication 946e2e51-341b-42c4-8e82-22924eba3a59","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-2: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.cooking-opposing-feedback

Status: incomplete

Evidence: 8beb133daca35dd3fa8efa17e69dfdab1618523ffdbd41bebc4e16fc55ee03da

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-3: publication 3bbfd357-daa8-4278-95a4-a239ce419945","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-3: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.cooking-pause-resume

Status: incomplete

Evidence: a89c3c49a36be3ade44361c9f29b0f39f71e57004089370c7a2e5a25ca69809a

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true},{"check":"step-3: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-4: effective input cooking-depth","passed":true},{"check":"step-4: effective input cooking-depth","passed":true},{"check":"step-4: effective input cooking-depth","passed":true},{"check":"step-4: effective input cooking-depth","passed":true},{"check":"step-4: publication f4730d95-4754-404a-95b0-c9886fb98597","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-4: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-accumulation

Status: incomplete

Evidence: 09b28832645683bfa676a6970a5f6c17c174d811eaeee0296f93000c3ef37a07

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true},{"check":"step-3: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-4: publication e1008652-a24f-475b-a72a-286df0cb7ad6","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-4: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-delete-old-evidence

Status: incomplete

Evidence: 53efe6b4763ade85701fb21bcdb7b9463d637abc2c3c08f92474eb52d5d93add

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true}]
- personalization.user_control: 1 — [{"check":"step-1: deleted photo-depth inactive","passed":true},{"check":"step-2: deleted photo-depth inactive","passed":true}]
- personalization.input_validity: 1 — [{"check":"step-2: inactive photo-depth","passed":true},{"check":"step-2: publication 9253fbe2-a179-4a1b-9c98-5ab6743a786d","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-2: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-last-support

Status: incomplete

Evidence: 26a132b9dcdb729429d880c06f8cd1b3dce9fe40121ca621be4ac358108ccb37

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-3: publication fd535efb-f14d-45bb-a593-05b786018b71","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-3: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-partial-support

Status: incomplete

Evidence: cffc374c15d8b7324c7d6b2380f6094aa96b59780c42ecc0f502f29034fe0ef4

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true}]
- personalization.user_control: not_applicable — No applicable continuous checks.
- personalization.input_validity: 1 — [{"check":"step-2: effective input photo-depth","passed":true},{"check":"step-2: effective input photo-depth","passed":true},{"check":"step-2: effective input photo-depth","passed":true},{"check":"step-2: publication 91b6b6a0-8afb-4cc8-8c24-43eedf47858f","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-2: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## controlled/preference-sequence.photo-user-edit

Status: incomplete

Evidence: 9d4efe75f93ac59cfbbdbd56bfcee5f23ab593aa10393805ee646b43db4bdc2c

- personalization.lazy_trigger: 1 — [{"check":"step-1: learning calls outside recommendation","passed":true},{"check":"step-2: learning calls outside recommendation","passed":true},{"check":"step-3: learning calls outside recommendation","passed":true}]
- personalization.user_control: 1 — [{"check":"step-1: preserve user photo-depth","passed":true},{"check":"step-2: preserve user photo-depth","passed":true},{"check":"step-3: preserve user photo-depth","passed":true},{"check":"step-4: preserve user photo-depth","passed":true}]
- personalization.input_validity: 1 — [{"check":"step-4: effective input photo-depth","passed":true},{"check":"step-4: effective input photo-depth","passed":true},{"check":"step-4: publication 201f3971-c158-40a4-a765-0f91b133fd78","passed":true}]
- personalization.comparison_integrity: 1 — [{"check":"step-4: complete paired evidence","passed":true}]
- personalization.semantic_quality: needs_review — 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。

## Human rubrics

- personalization.semantic_quality: 逐检查点评审：推断是否有据、范围是否适当、删除后重学是否有新依据；两组分别记录符合用户取舍的条目数/实际推荐数及理由。注明实际人工评审身份；空推荐或缺失证据保持未完成。
