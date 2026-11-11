// Common selected boundary regressions are compile-only, never runtime coverage.
import type { Selection, Projection, SelectedResolver } from "../../customResolvers/contracts/selection.js";
import type { AgeGateCheckStatus, ResolverFn } from "../../src/generated/graphql.js";

type Model = { values: string[]; statuses: AgeGateCheckStatus[]; child: { count: number }; nullable: string | null };
const selected = { values: true, statuses: true, child: { count: true }, nullable: true } as const satisfies Selection<Model>;
type Result = Projection<Model, typeof selected>;
const good: Result = { values: ["id"], statuses: ["ALLOWED"], child: { count: 1 }, nullable: null };
// @ts-expect-error scalar arrays retain element types
const badArray: Result = { ...good, values: [1] };
// @ts-expect-error enum normalization preserves the exact generated values
const badEnum: Result = { ...good, statuses: ["anything"] };
// @ts-expect-error nonnullable scalar list items remain nonnullable
const badNull: Result = { ...good, values: [null] };
// @ts-expect-error object selections must name fields rather than bypassing them
const badObject = { child: true } as const satisfies Selection<Model>;
// @ts-expect-error nested selected number is not a string
const badNested: Result = { ...good, child: { count: "one" } };
type ScalarListResolver = SelectedResolver<ResolverFn<string[], unknown, unknown, { count: number }>, true>;
const list: ScalarListResolver = () => ["one"];
// @ts-expect-error scalar-list output must not lose its array wrapper
const badList: ScalarListResolver = () => "one";
void [good, badArray, badEnum, badNull, badObject, badNested, list, badList];
