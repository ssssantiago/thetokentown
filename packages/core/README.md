# @thetokentown/core

The formulas behind [The Token Town](https://thetokentown.dev): the `Snapshot`
v2 types, their zod validation, the model pricing table, the 90-day
aggregation, and floors / age / decay / lights.

```ts
import { floorsForCost, aggregate } from "@thetokentown/core";

floorsForCost(7); // 30  — round(10 * log2(1 + cost90d)), min 1
```

Every row of `pricing.json` cites the provider page it was read from and the
day it was checked. MIT.
