# Observed image costs

The AtlasCloud catalog's `price.actual.base_price` is not the billed price for every setting. Quote budgets from the observed column, and add a row when a model or setting is new.

| Date | Provider and model | Settings | Catalog base price | Observed billing | Source |
| --- | --- | --- | --- | --- | --- |
| 2026-11-10 | AtlasCloud `openai/gpt-image-2/edit` | 2048x1152, quality `high`, PNG, 1-3 reference images | $0.006 per image | About $0.20 per image (owner-reported: 4 images, about $0.80) | Owner-reported, one edit round |

Codex built-in image generation draws on the Codex plan's credits and does not expose a per-image price.
