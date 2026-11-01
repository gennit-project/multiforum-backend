import { DateTime } from "luxon";
import { User } from "../../src/generated/graphql.js";
import { log } from "mathjs";

export const getAccountAgeInMonths = (createdAt: Date) => {
  const now = DateTime.now();
  const accountCreated = DateTime.fromJSDate(new Date(createdAt)); 
  const diff = now.diff(accountCreated, ["months"]).months;

  // Rounding down to the nearest whole month
  const accountAgeInMonths = Math.floor(diff);

  return accountAgeInMonths;
};

// Some historical vote reads select karma without createdAt (and discussion
// voting selects discussionKarma, not commentKarma). Preserve those inputs and
// their existing zero age/comment bonus rather than silently expanding queries.
export type VoteWeightInput = {
  username?: User["username"];
  createdAt?: User["createdAt"];
  commentKarma?: User["commentKarma"];
};
export const getWeightedVoteBonus = (user: VoteWeightInput) => {
  let weightedVoteBonus = 0;
  let accountAgeInMonths = getAccountAgeInMonths(user.createdAt);
  let commentKarma = 1;

  // Votes count more if the account has more comment karma.
  if (user.commentKarma && user.commentKarma > 0) {
    commentKarma = user.commentKarma;
    weightedVoteBonus += parseFloat(log(commentKarma, 10).toFixed(5));
  }

  // Votes count more if the account is older.
  if (accountAgeInMonths > 0) {
    weightedVoteBonus += parseFloat(
      log(accountAgeInMonths, 10).toFixed(5)
    );
  }

  return weightedVoteBonus;
};
