# Site-wide Discussion Ranking: Depth Without Rewarding Spray

This document describes a possible change to how discussions are ranked across
all forums. It is a product and algorithm proposal, not a committed
implementation.

## Current behavior

Each copy of a discussion posted to a forum is represented by a
`DiscussionChannel` and has its own `weightedVotesCount`. The site-wide query
currently adds the non-negative vote counts from every copy:

```text
score = sum(max(0, submission.weightedVotesCount))
```

The **top** sort orders directly by that score. The **hot** sort applies an age
penalty to the same score.

This makes the rule easy to understand: every additional weighted vote is worth
the same amount, regardless of the forum in which it was cast or how many
forums received the discussion.

## Problem 1: raw votes favor large forums

A vote total measures both content quality and audience opportunity. A
submission in a large or highly active forum can collect more votes than a
submission that was received enthusiastically by nearly everyone in a small
forum. The site-wide score therefore tends to reward access to a large audience,
not just strength of response.

Dividing votes by a forum's total member count is a tempting correction, but it
has important weaknesses:

- Membership does not equal exposure. Many members may be inactive or may never
  have seen the submission.
- Very small denominators are noisy. One or two votes could make a tiny forum
  look more enthusiastic than a much larger body of evidence.
- Tiny or inactive forums would become attractive targets for ranking
  manipulation.
- Forums naturally differ in voting behavior, so the same raw participation
  rate may not mean the same thing everywhere.

### Proposed solution: normalize response by opportunity

Score each forum submission according to how strongly it performed relative to
its opportunity and its forum's normal behavior. In order of preference, the
opportunity measure could be:

1. actual impressions or unique viewers;
2. recent active members who were eligible to see the submission;
3. the normal vote distribution for similarly aged submissions in that forum;
4. total forum membership, only as a rough fallback.

A simple engagement rate is not sufficient on its own because small samples
produce extreme results. The normalized score should use confidence smoothing,
such as a Bayesian prior:

```text
normalizedQuality =
  (weightedEngagement + priorStrength * forumBaseline)
  / (opportunity + priorStrength)
```

The prior pulls submissions with little evidence toward the forum's normal
result. As exposure accumulates, the observed response matters more. This means
that a strong response in a small forum can count meaningfully without allowing
one vote from one viewer to dominate the ranking.

An alternative when reliable exposure data is unavailable is to rank a
submission by its percentile among similarly aged submissions in the same
forum. This is less precise than impression-based scoring, but it compares each
submission with an appropriate local baseline rather than with the largest
forums on the site.

## Problem 2: breadth currently pays linearly

Because the site-wide score is a sum, posting the same discussion to another
forum creates another source of ranking points. Five mediocre submissions can
outscore one excellent submission simply because there are five of them. This
creates a "breadth spraying" incentive: submitting to every available forum can
be rational even when most of those forums are only weakly relevant.

Some breadth should still matter. A discussion that genuinely performs well in
several distinct communities has broader demonstrated appeal than one that
performs well in only one. The problem is not rewarding breadth; it is rewarding
each additional submission at full value.

### Proposed solution: diminishing returns for additional submissions

After calculating a normalized quality score for each forum submission, sort
the scores from strongest to weakest and discount each additional contribution:

```text
siteWideScore =
  quality[1]
  + 0.5   * quality[2]
  + 0.25  * quality[3]
  + 0.125 * quality[4]
  + ...
```

The exact decay factor is a product-tuning choice. A factor near `0.5` makes the
best result dominant while still recognizing genuine cross-forum appeal. The
calculation can also stop after a small number of forums so that the query has a
clear upper bound.

This expresses the intended ranking policy:

- Depth of response is the primary signal.
- Strong performance in another relevant community still helps.
- Weak additional submissions quickly become negligible.
- Adding more destinations without earning engagement does not pay linearly.

Applying `log` or `sqrt` only to the final sum is not enough. A monotonic
transformation preserves the same ordering when this is the only score, so it
does not actually change who beats whom. Likewise, summing the square root of
each submission's score can reward splitting engagement across more
submissions. The diminishing return must apply specifically to the second,
third, and later forum contributions.

## Combined proposal

For every site-wide discussion:

1. Calculate a confidence-adjusted, forum-relative quality score for each
   `DiscussionChannel`.
2. Clamp or otherwise handle negative values consistently with the current
   ranking policy.
3. Sort the per-forum quality scores from strongest to weakest.
4. Aggregate them with positional decay.
5. For the **hot** view, apply the existing time decay to the resulting
   site-wide score.

In compact form:

```text
quality_i = confidenceAdjustedResponse(submission_i, forum_i)

siteWideScore = sum(decay^(position_i - 1) * quality_i)

hotRank = timeDecay(siteWideScore, discussionAge)
```

The normalized quality calculation and the breadth decay solve different
problems and should be evaluated separately. Normalization limits large-forum
dominance; positional decay limits the benefit of spraying.

## Risks and open questions

- **Exposure data:** Does Multiforum record trustworthy impressions or unique
  viewers? If not, which activity measure is the least misleading proxy?
- **Cold start:** What baseline should a new forum use before it has enough
  history of its own?
- **Manipulation:** What minimum evidence is required before a small forum can
  contribute an above-baseline score?
- **Weighted votes:** Should super-upvotes and any role-based vote bonuses be
  normalized as engagement, or should they remain a separate ranking signal?
- **Negative response:** The current site-wide query clamps negative
  `weightedVotesCount` values to zero. Should strong negative response in one
  forum reduce the aggregate score, or merely contribute nothing?
- **Explainability:** Can the UI communicate why something is ranked highly
  without exposing a formula that encourages gaming?
- **Performance:** Computing forum baselines and confidence adjustments inside
  the feed query may be expensive. Periodically materialized statistics or
  precomputed per-submission quality scores may be preferable.

## Suggested rollout

1. Instrument impressions or choose and document an activity proxy.
2. Replay the proposed ranking against historical discussions and compare it
   with the current order.
3. Inspect edge cases manually: tiny forums, new forums, very large forums,
   heavily cross-posted discussions, and super-upvoted discussions.
4. Run the new score in shadow mode before using it for ordering.
5. Tune the confidence prior and breadth-decay factor using observed outcomes,
   not only hypothetical examples.

Useful evaluation measures include the share of top-ranked discussions that
were broadly sprayed, representation of small and large forums, engagement with
ranked results, hides or reports, and whether authors increasingly choose
relevant forums rather than every forum.
