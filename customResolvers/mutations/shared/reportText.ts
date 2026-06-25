// Shared helper for composing the body text of a moderation report/issue from
// the selected rule violations and free-form report text. Lives in its own
// module so the various report*/archive* mutations can share it without creating
// an import cycle between reportComment.ts and reportDiscussion.ts.

type FinalCommentTextInput = {
  selectedForumRules: string[];
  selectedServerRules: string[];
  reportText: string;
};

export const getFinalCommentText = (input: FinalCommentTextInput) => {
  const { selectedForumRules, selectedServerRules, reportText } = input;
  return `
${
  selectedForumRules.length > 0
    ? `Server rule violations: ${selectedForumRules.join(", ")}
`
    : ""
}
${
  selectedServerRules.length > 0
    ? `Forum rule violations: ${selectedServerRules.join(", ")}
`
    : ""
}
${
  reportText
    ? `${reportText}
`
    : ""
}
`;
};
