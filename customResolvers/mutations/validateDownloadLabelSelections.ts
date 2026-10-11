import { GraphQLError } from "graphql";

export type SelectedLabel = {
  id: string;
  displayName?: string | null;
  value: string;
  group?: {
    id: string;
    key: string;
    displayName: string;
    uploadSelection?: "SINGLE" | "MULTIPLE" | null;
  } | null;
};

export const assertValidUploadSelections = (labels: SelectedLabel[]) => {
  const selectionsByGroup = new Map<string, { displayName: string; count: number }>();

  for (const label of labels) {
    const group = label.group;
    if (!group || group.uploadSelection !== "SINGLE") {
      continue;
    }

    const current = selectionsByGroup.get(group.id) ?? {
      displayName: group.displayName || group.key,
      count: 0,
    };
    current.count += 1;
    selectionsByGroup.set(group.id, current);
  }

  const invalidSelection = [...selectionsByGroup.values()].find(({ count }) => count > 1);
  if (invalidSelection) {
    throw new GraphQLError(
      `Filter group "${invalidSelection.displayName}" allows only one label per download`,
      { extensions: { code: "BAD_USER_INPUT" } }
    );
  }
};
