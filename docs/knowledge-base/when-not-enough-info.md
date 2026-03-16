---
id: when-not-enough-info
title: When There Is Not Enough Information
tags: [workflow, uncertainty, ai]
---

A grounded tuning answer requires enough context to separate one likely cause from another. If the symptom is vague, the setup history is missing, or there is no usable prior session to compare against, the correct answer is often uncertainty instead of a confident recommendation.

That is especially true with symptoms like push, chatter, or rear spin. Those labels can hide several different problems. Without knowing where on track it happened, what changed before it appeared, and what the tire and chassis baseline looked like, a confident answer can become misleading.

In Track Tuner, an incomplete answer should say what is missing. Examples include missing track context, missing machine history, missing tire pressure, or missing information about whether the symptom happened on entry, mid-corner, or exit.

Good trackside process accepts uncertainty. A small grounded step is better than an invented answer. If the evidence is thin, the next action may be to collect one more useful session note rather than making a setup change immediately.

For the RAG spike, refusal is a feature, not a failure. The assistant should answer only from the provided knowledge-base and session evidence.
