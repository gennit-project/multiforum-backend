import type { Event, EventSeries, Discussion } from "../../src/generated/graphql.js";
import type { Selection, Projection } from "./selection.js";

// Fixed generated-operation projections, mirrored by the existing repository documents.
export const createdEventSelection = {
  "id": true,
  "title": true,
  "description": true,
  "startTime": true,
  "startTimeDayOfWeek": true,
  "startTimeHourOfDay": true,
  "endTime": true,
  "locationName": true,
  "address": true,
  "virtualEventUrl": true,
  "canceled": true,
  "cost": true,
  "isAllDay": true,
  "isHostedByOP": true,
  "coverImageURL": true,
  "Poster": {
    "username": true
  },
  "EventChannels": {
    "id": true,
    "createdAt": true,
    "channelUniqueName": true,
    "eventId": true,
    "archived": true,
    "Channel": {
      "uniqueName": true
    },
    "Event": {
      "id": true
    }
  },
  "SubscribedToNotifications": {
    "username": true
  },
  "SubscribedToEventUpdates": {
    "username": true
  },
  "createdAt": true,
  "updatedAt": true,
  "Tags": {
    "text": true
  }
} as const satisfies Selection<Event>;
export type CreatedEventProjection = Projection<Event, typeof createdEventSelection>;

export const eventUpdateSnapshotSelection = {
  "id": true,
  "title": true,
  "description": true,
  "startTime": true,
  "endTime": true,
  "locationName": true,
  "address": true,
  "virtualEventUrl": true,
  "canceled": true,
  "Poster": {
    "username": true
  },
  "DescriptionLastEditedBy": {
    "username": true
  },
  "EventChannels": {
    "channelUniqueName": true
  },
  "PastTitleVersions": {
    "id": true,
    "body": true,
    "createdAt": true
  },
  "PastDescriptionVersions": {
    "id": true,
    "body": true,
    "createdAt": true
  }
} as const satisfies Selection<Event>;
export type EventUpdateSnapshot = Projection<Event, typeof eventUpdateSnapshotSelection>;

export const updatedEventSelection = {
  "id": true,
  "title": true,
  "description": true,
  "startTime": true,
  "startTimeDayOfWeek": true,
  "startTimeHourOfDay": true,
  "endTime": true,
  "locationName": true,
  "address": true,
  "virtualEventUrl": true,
  "canceled": true,
  "cost": true,
  "isAllDay": true,
  "isHostedByOP": true,
  "coverImageURL": true,
  "Poster": {
    "username": true
  },
  "EventChannels": {
    "id": true,
    "channelUniqueName": true,
    "eventId": true,
    "Channel": {
      "uniqueName": true
    },
    "Event": {
      "id": true
    }
  },
  "SubscribedToNotifications": {
    "username": true
  },
  "SubscribedToEventUpdates": {
    "username": true,
    "Email": {
      "address": true
    }
  },
  "createdAt": true,
  "updatedAt": true,
  "Tags": {
    "text": true
  }
} as const satisfies Selection<Event>;
export type UpdatedEventProjection = Projection<Event, typeof updatedEventSelection>;

export const createdEventSeriesSelection = {
  "id": true,
  "title": true,
  "description": true,
  "locationName": true,
  "address": true,
  "virtualEventUrl": true,
  "cost": true,
  "free": true,
  "isHostedByOP": true,
  "coverImageURL": true,
  "canceled": true,
  "createdAt": true,
  "updatedAt": true,
  "repeatPattern": {
    "type": true,
    "count": true,
    "daysOfWeek": true,
    "endType": true,
    "endCount": true,
    "endDate": true
  },
  "Poster": {
    "username": true
  },
  "Tags": {
    "text": true
  },
  "Occurrences": {
    "id": true,
    "title": true,
    "startTime": true,
    "endTime": true,
    "canceled": true,
    "occurrenceIndex": true,
    "EventChannels": {
      "id": true,
      "channelUniqueName": true,
      "Channel": {
        "uniqueName": true
      }
    }
  },
  "EventChannels": {
    "id": true,
    "channelUniqueName": true,
    "Channel": {
      "uniqueName": true
    }
  }
} as const satisfies Selection<EventSeries>;
export type CreatedEventSeriesProjection = Projection<EventSeries, typeof createdEventSeriesSelection>;

export const seriesOccurrenceSnapshotSelection = {
  "id": true,
  "title": true,
  "startTime": true,
  "endTime": true,
  "locationName": true,
  "address": true,
  "virtualEventUrl": true,
  "canceled": true,
  "occurrenceIndex": true,
  "EventSeries": {
    "id": true,
    "title": true,
    "Occurrences": {
      "id": true,
      "occurrenceIndex": true
    }
  }
} as const satisfies Selection<Event>;
export type SeriesOccurrenceSnapshot = Projection<Event, typeof seriesOccurrenceSnapshotSelection>;

export const updatedSeriesOccurrenceSelection = {
  "id": true,
  "title": true,
  "description": true,
  "startTime": true,
  "startTimeDayOfWeek": true,
  "startTimeHourOfDay": true,
  "endTime": true,
  "locationName": true,
  "address": true,
  "virtualEventUrl": true,
  "canceled": true,
  "cost": true,
  "isAllDay": true,
  "isHostedByOP": true,
  "coverImageURL": true,
  "occurrenceIndex": true,
  "Poster": {
    "username": true
  },
  "EventSeries": {
    "id": true,
    "title": true
  },
  "EventChannels": {
    "id": true,
    "channelUniqueName": true,
    "eventId": true,
    "Channel": {
      "uniqueName": true
    }
  },
  "SubscribedToEventUpdates": {
    "username": true,
    "Email": {
      "address": true
    }
  },
  "Tags": {
    "text": true
  },
  "createdAt": true,
  "updatedAt": true
} as const satisfies Selection<Event>;
export type UpdatedSeriesOccurrenceProjection = Projection<Event, typeof updatedSeriesOccurrenceSelection>;

export const createdDiscussionSelection = {
  "id": true,
  "title": true,
  "body": true,
  "Author": {
    "username": true
  },
  "DiscussionChannels": {
    "id": true,
    "createdAt": true,
    "channelUniqueName": true,
    "discussionId": true,
    "archived": true,
    "Flairs": {
      "id": true,
      "channelUniqueName": true,
      "displayName": true,
      "color": true,
      "order": true,
      "archived": true
    },
    "Channel": {
      "uniqueName": true
    },
    "Discussion": {
      "id": true
    },
    "UpvotedByUsers": {
      "username": true
    }
  },
  "createdAt": true,
  "updatedAt": true,
  "Tags": {
    "text": true
  }
} as const satisfies Selection<Discussion>;
export type CreatedDiscussionProjection = Projection<Discussion, typeof createdDiscussionSelection>;

export const discussionUpdateSnapshotSelection = {
  "id": true,
  "title": true,
  "body": true,
  "Author": {
    "username": true
  },
  "BodyLastEditedBy": {
    "username": true
  },
  "DiscussionChannels": {
    "channelUniqueName": true
  },
  "PastTitleVersions": {
    "id": true,
    "body": true,
    "createdAt": true
  },
  "PastBodyVersions": {
    "id": true,
    "body": true,
    "createdAt": true
  }
} as const satisfies Selection<Discussion>;
export type DiscussionUpdateSnapshot = Projection<Discussion, typeof discussionUpdateSnapshotSelection>;

export const updatedDiscussionSelection = {
  "id": true,
  "title": true,
  "body": true,
  "Author": {
    "username": true
  },
  "DiscussionChannels": {
    "id": true,
    "channelUniqueName": true,
    "discussionId": true,
    "Flairs": {
      "id": true,
      "channelUniqueName": true,
      "displayName": true,
      "color": true,
      "order": true,
      "archived": true
    },
    "Channel": {
      "uniqueName": true
    },
    "Discussion": {
      "id": true
    }
  },
  "createdAt": true,
  "updatedAt": true,
  "Tags": {
    "text": true
  },
  "PastTitleVersions": {
    "id": true,
    "body": true,
    "createdAt": true,
    "Author": {
      "username": true
    }
  },
  "PastBodyVersions": {
    "id": true,
    "body": true,
    "createdAt": true,
    "Author": {
      "username": true
    }
  }
} as const satisfies Selection<Discussion>;
export type UpdatedDiscussionProjection = Projection<Discussion, typeof updatedDiscussionSelection>;

// CreateCrosspost intentionally fetches only the generated identity.
export const crosspostIdentitySelection = { id: true } as const satisfies Selection<Discussion>;
export type CrosspostIdentityProjection = Projection<Discussion, typeof crosspostIdentitySelection>;

export const attachedDiscussionFilesSelection = {id:true,DownloadableFiles:{id:true}} as const satisfies Selection<Discussion>;
export type AttachedDiscussionFilesProjection = Projection<Discussion, typeof attachedDiscussionFilesSelection>;
