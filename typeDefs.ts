import { gql } from 'apollo-server'

const typeDefinitions = gql`
  enum FilterMode {
    INCLUDE
    EXCLUDE
  }

  enum FileKind {
    ZIP
    RAR
    PNG
    JPG
    BLEND
    STL
    GLB
    OTHER
  }

  enum PriceModel {
    FREE
    FIXED
    NAME_YOUR_PRICE
    SUBSCRIPTION
    TEMPORARY
  }

  enum ScanStatus {
    PENDING
    CLEAN
    INFECTED
    SUSPICIOUS
    FAILED
  }

  enum CollectionVisibility {
    PUBLIC
    PRIVATE
  }

  enum CollectionType {
    DISCUSSIONS  # Only discussions
    COMMENTS     # Only comments
    DOWNLOADS    # Only downloads
    IMAGES       # Only images
    CHANNELS     # Only channels
  }

  enum CollectionItemType {
    DISCUSSION
    COMMENT
    DOWNLOAD
    IMAGE
    CHANNEL
  }

  extend schema @subscription

  scalar JSON

  union IssueCommentAuthor = User | ModerationProfile
  union CommentAuthor = User | ModerationProfile
  union IssueAuthor = User | ModerationProfile

  input RuleInput {
    summary: String!
    detail: String!
  }

  type Image {
    id: ID! @id
    url: String
    alt: String
    caption: String
    longDescription: String
    copyright: String
    createdAt: DateTime @timestamp(operations: [CREATE])
    hasSensitiveContent: Boolean
    hasSpoiler: Boolean
    scanStatus: ScanStatus! @default(value: PENDING)
    scanCheckedAt: DateTime

    Album:    Album @relationship(type: "HAS_IMAGE", direction: IN)
    Uploader: User  @relationship(type: "UPLOADED_IMAGE", direction: IN)
    RelatedIssues: [Issue!]! @relationship(type: "CITED_ISSUE", direction: IN)

    # Collection support
    InCollections: [Collection!]! @relationship(type: "CONTAINS_IMAGE", direction: IN)
  }

  """SPDX or custom content licence"""
  type License {
    id: ID! @id
    name:      String!  # human‑readable name ("Creative Commons BY 4.0")
    shortName: String   # SPDX‑style short code ("CC‑BY‑4.0")
    url:       String
    text:      String
  }

  """Single checkout / acquisition (free or paid)"""
  type Purchase {
    id: ID! @id
    createdAt: DateTime! @timestamp(operations: [CREATE])
    priceCents: Int
    priceCurrency: String

    file:   DownloadableFile! @relationship(type: "PURCHASED_FILE", direction: OUT)
    buyer:  User!             @relationship(type: "MADE_PURCHASE",   direction: IN)
  }

  """Older revision of a downloadable file"""
  type FileVersion {
    id: ID! @id
    createdAt: DateTime! @timestamp(operations: [CREATE])

    fileName: String!
    kind:     FileKind!
    size:     Int
    url:      String!
    changelog: String

    mainFile: DownloadableFile! @relationship(type: "HAS_VERSION", direction: IN)
  }


  type Collection {
    id: ID! @id
    name: String!
    description: String
    visibility: CollectionVisibility!
    collectionType: CollectionType!
    CreatedBy: User! @relationship(type: "CREATED_BY", direction: OUT)
    createdAt: DateTime! @timestamp(operations: [CREATE])
    updatedAt: DateTime! @timestamp(operations: [UPDATE])

    # Items in collection with ordering
    Discussions: [Discussion!]! @relationship(type: "CONTAINS_DISCUSSION", direction: OUT)
    Comments: [Comment!]! @relationship(type: "CONTAINS_COMMENT", direction: OUT)
    Downloads: [Discussion!]! @relationship(type: "CONTAINS_DOWNLOAD", direction: OUT)
    Images: [Image!]! @relationship(type: "CONTAINS_IMAGE", direction: OUT)
    Channels: [Channel!]! @relationship(type: "CONTAINS_CHANNEL", direction: OUT)

    # Ordered list of item IDs for maintaining custom order
    itemOrder: [ID!]!

    # Discussions that share this collection (reverse relationship)
    SharedInDiscussions: [Discussion!]! @relationship(type: "SHARES_COLLECTION", direction: IN)

    # Stats
    itemCount: Int! @cypher(statement: """
      MATCH (this)-[:CONTAINS_DISCUSSION|CONTAINS_COMMENT|CONTAINS_DOWNLOAD|CONTAINS_IMAGE|CONTAINS_CHANNEL]->()
      RETURN count(*) as itemCount
    """, columnName: "itemCount")

    shareCount: Int! @cypher(statement: """
      MATCH (this)<-[:SHARES_COLLECTION]-()
      RETURN count(*) as shareCount
    """, columnName: "shareCount")
  }

  type Album {
    id: ID! @id
    Owner: User @relationship(type: "HAS_ALBUM", direction: IN)
    Images: [Image!]! @relationship(type: "HAS_IMAGE", direction: OUT)
    imageOrder: [ID]
    Discussions: [Discussion!]! @relationship(type: "HAS_ALBUM", direction: IN)
  }

  type Notification {
    id: ID! @id
    createdAt: DateTime! @timestamp(operations: [CREATE])
    read: Boolean
    text: String
  }

  type Message {
    id: ID! @id
    createdAt: DateTime! @timestamp(operations: [CREATE])
    text: String
    Contact: Contact @relationship(type: "HAS_MESSAGE", direction: IN)
  }

  type Contact {
    id: ID! @id
    MessageAuthor: CommentAuthor
      @relationship(type: "AUTHORED_MESSAGE", direction: IN)
    createdAt: DateTime! @timestamp(operations: [CREATE])
    mostRecentMessageTimestamp: DateTime
    Messages: [Message!]! @relationship(type: "HAS_MESSAGE", direction: OUT)
  }

  type User {
    # media
    Albums:   [Album!]!  @relationship(type: "HAS_ALBUM", direction: OUT)
    Images:   [Image!]!  @relationship(type: "UPLOADED_IMAGE", direction: OUT)

    # identity
    username: String! @unique
    Email: Email  @relationship(type: "HAS_EMAIL", direction: IN)
    displayName: String
    pronouns: String
    location: String
    bio: String
    profilePicURL: String
    enableSensitiveContentByDefault: Boolean

    # karma
    commentKarma: Int
    discussionKarma: Int

    # content relationships
    Comments: [Comment!]!           @relationship(type: "AUTHORED_COMMENT", direction: OUT)
    Discussions: [Discussion!]!     @relationship(type: "POSTED_DISCUSSION", direction: OUT)
    Events:      [Event!]!          @relationship(type: "POSTED_BY", direction: OUT)

    # channel roles / admin
    AdminOfChannels: [Channel!]!    @relationship(type: "ADMIN_OF_CHANNEL", direction: OUT)
    ModOfChannels:   [Channel!]!    @relationship(type: "MODERATOR_OF_CHANNEL", direction: OUT)
    
    RecentlyVisitedChannels: [Channel!]! @relationship(type: "RECENTLY_VISITED_CHANNEL", direction: OUT)

    # votes
    UpvotedComments:           [Comment!]!           @relationship(type: "UPVOTED_COMMENT", direction: OUT)
    UpvotedDiscussionChannels: [DiscussionChannel!]! @relationship(type: "UPVOTED_DISCUSSION_IN_CHANNEL", direction: OUT)

    # notifications
    Notifications: [Notification!]! @relationship(type: "HAS_NOTIFICATION", direction: OUT)

    # moderation / suspensions
    ModerationProfile: ModerationProfile @relationship(type: "MODERATION_PROFILE", direction: OUT)
    Suspensions:        [Suspension!]!  @relationship(type: "SUSPENDED_AS_USER", direction: OUT)

    # wiki authorship
    AuthoredWikiPages:          [WikiPage!]!   @relationship(type: "AUTHORED_VERSION", direction: OUT)
    AuthoredWikiPageVersions:   [TextVersion!]! @relationship(type: "AUTHORED_VERSION", direction: OUT)

    # roles & perms
    ChannelRoles: [ChannelRole!]! @relationship(type: "HAS_CHANNEL_ROLE", direction: OUT)
    ServerRoles:  [ServerRole!]!  @relationship(type: "HAS_SERVER_ROLE", direction: OUT)
    ModChannelRoles: [ModChannelRole!]! @relationship(type: "HAS_MOD_ROLE", direction: OUT)
    ModServerRoles:  [ModServerRole!]!  @relationship(type: "HAS_MOD_ROLE", direction: OUT)

    # pending invites
    PendingModInvites:    [Channel!]! @relationship(type: "HAS_PENDING_MOD_INVITE", direction: IN)
    PendingOwnerInvites:  [Channel!]! @relationship(type: "HAS_PENDING_INVITE", direction: IN)

    # commerce
    stripeAccountId: String
    defaultLicense: License @relationship(type: "DEFAULT_LICENSE", direction: OUT)
    purchases: [Purchase!]! @relationship(type: "MADE_PURCHASE", direction: OUT)
    library: [DownloadableFile!]! @relationship(type: "PURCHASED_FILE", direction: IN)

    # collections
    Collections: [Collection!]! @relationship(type: "CREATED_BY", direction: IN)
    FavoriteDiscussions: [Discussion!]! @relationship(type: "DEFAULT_FAVORITES_DISCUSSIONS", direction: OUT)
    FavoriteComments: [Comment!]! @relationship(type: "DEFAULT_FAVORITES_COMMENTS", direction: OUT)
    FavoriteDownloads: [Discussion!]! @relationship(type: "DEFAULT_FAVORITES_DOWNLOADS", direction: OUT)
    FavoriteImages: [Image!]! @relationship(type: "DEFAULT_FAVORITES_IMAGES", direction: OUT)
    FavoriteChannels: [Channel!]! @relationship(type: "DEFAULT_FAVORITES_CHANNELS", direction: OUT)
    OwnedDownloads: [Discussion!]! @relationship(type: "OWNS_DOWNLOAD", direction: OUT)

    # misc
    defaultEmojiSkinTone: String
    
    preferredTimeZone: String

    # bookkeeping
    createdAt: DateTime! @timestamp(operations: [CREATE])
    deleted: Boolean

    # notification settings
    notifyOnReplyToCommentByDefault: Boolean @default(value: true)
    notifyOnReplyToDiscussionByDefault: Boolean @default(value: true)
    notifyOnReplyToEventByDefault: Boolean @default(value: true)
    notifyWhenTagged: Boolean @default(value: true)
    notifyOnFeedback: Boolean @default(value: true)
    notificationBundleInterval: String
    notificationBundleEnabled: Boolean @default(value: true)
    notificationBundleContent: String
  }

  type TextVersion {
    id: ID! @id
    body: String
    createdAt: DateTime! @timestamp(operations: [CREATE])
    updatedAt: DateTime @timestamp(operations: [UPDATE])
    Author: User @relationship(type: "AUTHORED_VERSION", direction: IN)
  }

  type WikiPage {
    id: ID! @id
    title: String!
    body: String
    slug: String!
    channelUniqueName: String
    createdAt: DateTime! @timestamp(operations: [CREATE])
    updatedAt: DateTime @timestamp(operations: [UPDATE])
    VersionAuthor: User @relationship(type: "AUTHORED_VERSION", direction: IN)
    PastVersions: [TextVersion!]!
      @relationship(type: "HAS_VERSION", direction: OUT)
    ProposedEdits: [TextVersion!]!
      @relationship(type: "PROPOSED_EDIT", direction: OUT)
    ChildPages: [WikiPage!]!
      @relationship(type: "HAS_CHILD_PAGE", direction: OUT)
  }

  type Suspension {
    id: ID! @id
    channelUniqueName: String!
    username: String
    modProfileName: String
    createdAt: DateTime! @timestamp(operations: [CREATE])
    suspendedUntil: DateTime
    suspendedIndefinitely: Boolean
    SuspendedUser: User @relationship(type: "SUSPENDED_AS_USER", direction: IN)
    SuspendedMod: ModerationProfile
      @relationship(type: "SUSPENDED_AS_MOD", direction: IN)
    RelatedIssue: Issue @relationship(type: "HAS_CONTEXT", direction: OUT)
  }

   type DownloadableFile {
    id: ID! @id
    fileName: String!
    kind:     FileKind!
    size:     Int
    url:      String!
    createdAt: DateTime! @timestamp(operations: [CREATE])

    # commerce fields
    priceModel: PriceModel! @default(value: FREE)
    priceCents: Int
    priceCurrency: String @default(value: "USD")
    paywallExpiresAt: DateTime
    stripeProductId: String
    stripePriceId:   String

    # analytics
    downloadCountTotal:  Int @default(value: 0)
    downloadCountUnique: Int @default(value: 0)

    # license & versions
    license: License @relationship(type: "USES_LICENSE", direction: OUT)
    versions: [FileVersion!]! @relationship(type: "HAS_VERSION", direction: OUT)

    # scanning
    scanStatus: ScanStatus! @default(value: PENDING)
    scanCheckedAt: DateTime

    # purchases back‑ref
    purchasers: [Purchase!]! @relationship(type: "PURCHASED_FILE", direction: IN)
  }

  type FilterGroup {
    id: ID! # Neo4j auto ID
    order: Int! # for manual re‑ordering
    key: String! # computer‑friendly, e.g. "lot_size"
    displayName: String! # human label, e.g. "Lot Size"
    mode: FilterMode! # INCLUDE or EXCLUDE
    # One channel owns many groups
    channel: Channel! @relationship(type: "HAS_FILTER_GROUP", direction: IN)

    # Each group owns many options
    options: [FilterOption!]!
      @relationship(type: "HAS_FILTER_OPTION", direction: OUT)
  }

  """
  A single checkbox inside a group, e.g. “10×20”.
  """
  type FilterOption {
    id: ID!
    order: Int!
    value: String! # computer‑friendly, e.g. "10x20"
    displayName: String! # human‑friendly, e.g. "10 × 20"
    group: FilterGroup! @relationship(type: "HAS_FILTER_OPTION", direction: IN)
  }

  type Channel {
    uniqueName: String! @unique
    createdAt: DateTime! @timestamp(operations: [CREATE])
    displayName: String
    description: String
    locked: Boolean
    deleted: Boolean
    channelIconURL: String
    channelBannerURL: String
    rules: JSON

    # Pinned content
    PinnedDiscussionChannels: [DiscussionChannel!]! @relationship(type: "PINNED_IN_CHANNEL", direction: OUT)
    PinnedWikiPages: [WikiPage!]! @relationship(type: "PINNED_IN_CHANNEL", direction: OUT)

    # Collection support
    InCollections: [Collection!]! @relationship(type: "CONTAINS_CHANNEL", direction: IN)

    # feature toggles
    eventsEnabled: Boolean @default(value: true)
    wikiEnabled: Boolean @default(value: true)
    feedbackEnabled: Boolean @default(value: true)
    downloadsEnabled: Boolean @default(value: true)
    emojiEnabled: Boolean @default(value: true)
    imageUploadsEnabled: Boolean @default(value: true)
    markdownImagesEnabled: Boolean @default(value: true)
    allowPaidDownloads: Boolean @default(value: false)
    allowPaywalledPosts: Boolean @default(value: false)
    requireVerifiedPhoneForUploads: Boolean @default(value: false)
    requireVerifiedEmailToPost: Boolean @default(value: false)
    markAsAnsweredEnabled: Boolean @default(value: true)

    allowedFileTypes: [String]
    payoutPercent: Int @default(value: 98)

    # tags & relationships (unchanged)
    Tags: [Tag!]! @relationship(type: "HAS_TAG", direction: OUT)

    Admins:     [User!]! @relationship(type: "ADMIN_OF_CHANNEL", direction: IN)
    Moderators: [ModerationProfile!]! @relationship(type: "MODERATOR_OF_CHANNEL", direction: IN)
    PendingOwnerInvites: [User!]! @relationship(type: "HAS_PENDING_INVITE", direction: OUT)
    PendingModInvites:   [User!]! @relationship(type: "HAS_PENDING_MOD_INVITE", direction: OUT)

    RelatedChannels: [Channel!]! @relationship(type: "RELATED_CHANNEL", direction: OUT)

    # content posting
    EventChannels:      [EventChannel!]!      @relationship(type: "POSTED_IN_CHANNEL", direction: IN)
    DiscussionChannels: [DiscussionChannel!]! @relationship(type: "POSTED_IN_CHANNEL", direction: IN)
    Comments:           [Comment!]!          @relationship(type: "HAS_COMMENT", direction: OUT)

    # default roles
    DefaultChannelRole:   ChannelRole  @relationship(type: "HAS_DEFAULT_CHANNEL_ROLE", direction: OUT)
    DefaultModRole:       ModChannelRole @relationship(type: "HAS_DEFAULT_MOD_ROLE", direction: OUT)
    ElevatedModRole:      ModChannelRole @relationship(type: "HAS_DEFAULT_ELEVATED_MOD_ROLE", direction: OUT)
    SuspendedRole:        ChannelRole    @relationship(type: "HAS_DEFAULT_SUSPENDED_ROLE", direction: OUT)
    SuspendedModRole:     ModChannelRole @relationship(type: "HAS_DEFAULT_SUSPENDED_ROLE", direction: OUT)

    # moderation
    Issues:         [Issue!]!       @relationship(type: "HAS_ISSUE", direction: OUT)
    SuspendedUsers: [Suspension!]!  @relationship(type: "SUSPENDED_AS_USER", direction: OUT)
    SuspendedMods:  [Suspension!]!  @relationship(type: "SUSPENDED_AS_MOD", direction: OUT)

    # wiki + filters
    WikiHomePage:  WikiPage   @relationship(type: "HAS_WIKI_HOME_PAGE", direction: OUT)
    FilterGroups: [FilterGroup!]! @relationship(type: "HAS_FILTER_GROUP", direction: OUT)

    # plugins
    EnabledPlugins: [PluginVersion!]! @relationship(type: "ENABLED", direction: OUT, properties: "ChannelPluginProperties")
  }

  type DiscussionChannel {
    id: ID! @id
    locked: Boolean
    discussionId: ID! # used for uniqueness constraint
    channelUniqueName: String! # used for uniqueness constraint
    createdAt: DateTime! @timestamp(operations: [CREATE])
    weightedVotesCount: Float
    Discussion: Discussion
      @relationship(type: "POSTED_IN_CHANNEL", direction: OUT)
    Channel: Channel @relationship(type: "POSTED_IN_CHANNEL", direction: OUT)
    UpvotedByUsers: [User!]!
      @relationship(type: "UPVOTED_DISCUSSION", direction: IN)
    Comments: [Comment!]!
      @relationship(type: "CONTAINS_COMMENT", direction: OUT)
    emoji: JSON
    archived: Boolean
    RelatedIssues: [Issue!]! @relationship(type: "CITED_ISSUE", direction: IN)
    answered: Boolean
    Answers: [Comment!]! @relationship(type: "IS_REPLY_TO", direction: IN)
    SubscribedToNotifications: [User!]!
      @relationship(type: "SUBSCRIBED_TO_NOTIFICATIONS", direction: IN)
    LabelOptions: [FilterOption!]! @relationship(type: "HAS_LABEL_OPTION", direction: OUT)
  }

  type Discussion {
    id: ID! @id
    Author: User @relationship(type: "POSTED_DISCUSSION", direction: IN)
    body: String
    title: String!
    createdAt: DateTime! @timestamp(operations: [CREATE])
    updatedAt: DateTime @timestamp(operations: [UPDATE])
    deleted: Boolean
    hasDownload: Boolean
    hasSensitiveContent: Boolean
    hasSpoiler: Boolean
    Tags: [Tag!]! @relationship(type: "HAS_TAG", direction: OUT)
    PastTitleVersions: [TextVersion!]!
      @relationship(type: "HAS_TITLE_VERSION", direction: OUT)
    PastBodyVersions: [TextVersion!]!
      @relationship(type: "HAS_BODY_VERSION", direction: OUT)
    DiscussionChannels: [DiscussionChannel!]!
      @relationship(type: "POSTED_IN_CHANNEL", direction: IN)
    FeedbackComments: [Comment!]!
      @relationship(type: "HAS_FEEDBACK_COMMENT", direction: IN)
    Album: Album @relationship(type: "HAS_ALBUM", direction: OUT)
    DownloadableFiles: [DownloadableFile!]!
      @relationship(type: "HAS_DOWNLOADABLE_FILE", direction: OUT)

    # Collection support
    InCollections: [Collection!]! @relationship(type: "CONTAINS_DISCUSSION", direction: IN)
    bookmarkCount: Int! @cypher(statement: "MATCH (this)<-[:BOOKMARKED]-() RETURN count(*)", columnName: "bookmarkCount")

    # Shared collections
    SharedCollection: Collection @relationship(type: "SHARES_COLLECTION", direction: OUT)
  }

  type EventChannel {
    id: ID! @id
    locked: Boolean
    eventId: ID! # used for uniqueness constraint
    channelUniqueName: String! # used for uniqueness constraint
    createdAt: DateTime! @timestamp(operations: [CREATE])
    Event: Event @relationship(type: "POSTED_IN_CHANNEL", direction: OUT)
    Channel: Channel @relationship(type: "POSTED_IN_CHANNEL", direction: OUT)
    Comments: [Comment!]!
      @relationship(type: "CONTAINS_COMMENT", direction: OUT)
    archived: Boolean @default(value: false)
    RelatedIssues: [Issue!]! @relationship(type: "CITED_ISSUE", direction: IN)
  }

  enum RepeatUnit {
    DAY
    WEEK
    MONTH
    YEAR
  }

  enum RepeatType {
    NEVER
    ON
    AFTER
  }

  type RepeatEvery {
    count: Int
    unit: RepeatUnit
  }

  type RepeatEnds {
    type: String
    count: Int
    unit: RepeatUnit
    until: DateTime
  }

  type RecurringEvent {
    id: ID! @id
    repeatEvery: RepeatEvery
    repeatEnds: RepeatEnds
    Events: [Event!]! @relationship(type: "HAS_RECURRING_EVENT", direction: OUT)
  }

  type Event {
    id: ID! @id
    title: String!
    description: String
    startTime: DateTime!
    startTimeDayOfWeek: String # only used for filtering events by day of week
    startTimeHourOfDay: Int # only used for filtering events by hour of day
    endTime: DateTime!
    locationName: String
    address: String
    virtualEventUrl: String
    updatedAt: DateTime @timestamp(operations: [UPDATE])
    createdAt: DateTime! @timestamp(operations: [CREATE])
    placeId: String
    isInPrivateResidence: Boolean
    cost: String
    free: Boolean
    location: Point
    canceled: Boolean!
    deleted: Boolean
    isHostedByOP: Boolean
    isAllDay: Boolean
    coverImageURL: String
    locked: Boolean
    Comments: [Comment!]! @relationship(type: "HAS_COMMENT", direction: OUT)
    RecurringEvent: RecurringEvent
      @relationship(type: "HAS_RECURRING_EVENT", direction: OUT)
    Poster: User @relationship(type: "POSTED_BY", direction: IN)
    Tags: [Tag!]! @relationship(type: "HAS_TAG", direction: OUT)
    EventChannels: [EventChannel!]!
      @relationship(type: "POSTED_IN_CHANNEL", direction: IN)
    RelatedIssues: [Issue!]! @relationship(type: "CITED_ISSUE", direction: IN)
    FeedbackComments: [Comment!]!
      @relationship(type: "HAS_FEEDBACK_COMMENT", direction: IN)
    SubscribedToNotifications: [User!]!
      @relationship(type: "SUBSCRIBED_TO_NOTIFICATIONS", direction: IN)
  }

  type Comment {
    id: ID! @id
    CommentAuthor: CommentAuthor
      @relationship(type: "AUTHORED_COMMENT", direction: IN)
    DiscussionChannel: DiscussionChannel
      @relationship(type: "CONTAINS_COMMENT", direction: IN)
    Event: Event @relationship(type: "HAS_COMMENT", direction: IN)
    Channel: Channel @relationship(type: "HAS_COMMENT", direction: IN)
    ParentComment: Comment @relationship(type: "IS_REPLY_TO", direction: OUT)
    text: String
    isRootComment: Boolean!
    isFeedbackComment: Boolean
    ChildComments: [Comment!]! @relationship(type: "IS_REPLY_TO", direction: IN)
    deleted: Boolean
    archived: Boolean
    updatedAt: DateTime @timestamp(operations: [UPDATE])
    createdAt: DateTime! @timestamp(operations: [CREATE])
    Tags: [Tag!]! @relationship(type: "HAS_TAG", direction: OUT)
    weightedVotesCount: Float
    UpvotedByUsers: [User!]!
      @relationship(type: "UPVOTED_COMMENT", direction: IN)
    PastVersions: [TextVersion!]!
      @relationship(type: "HAS_VERSION", direction: OUT)
    emoji: JSON
    GivesFeedbackOnDiscussion: Discussion
      @relationship(type: "HAS_FEEDBACK_COMMENT", direction: OUT)
    GivesFeedbackOnEvent: Event
      @relationship(type: "HAS_FEEDBACK_COMMENT", direction: OUT)
    GivesFeedbackOnComment: Comment
      @relationship(type: "HAS_FEEDBACK_COMMENT", direction: OUT)
    Issue: Issue @relationship(type: "ACTIVITY_ON_ISSUE", direction: OUT)
    FeedbackComments: [Comment!]!
      @relationship(type: "HAS_FEEDBACK_COMMENT", direction: IN)
    ModerationAction: ModerationAction
      @relationship(type: "MODERATED_COMMENT", direction: IN)
    RelatedIssues: [Issue!]! @relationship(type: "CITED_ISSUE", direction: IN)
    SubscribedToNotifications: [User!]!
      @relationship(type: "SUBSCRIBED_TO_NOTIFICATIONS", direction: IN)

    # Collection support
    InCollections: [Collection!]! @relationship(type: "CONTAINS_COMMENT", direction: IN)
  }

  type Emoji {
    id: ID! @id
    name: String! @unique
    PostedByUser: User @relationship(type: "POSTED_EMOJI", direction: IN)
    createdAt: DateTime! @timestamp(operations: [CREATE])
  }

  type Email {
    address: String! @unique
    User: User @relationship(type: "HAS_EMAIL", direction: OUT)
  }

  type ModerationProfile {
    createdAt: DateTime! @timestamp(operations: [CREATE])
    displayName: String @unique
    User: User @relationship(type: "MODERATION_PROFILE", direction: IN)
    AuthoredIssues: [Issue!]!
      @relationship(type: "AUTHORED_ISSUE", direction: IN)
    AuthoredComments: [Comment!]!
      @relationship(type: "AUTHORED_COMMENT", direction: OUT)
    ModChannelRoles: [ModChannelRole!]!
      @relationship(type: "HAS_MOD_ROLE", direction: OUT)
    ModServerRoles: [ModServerRole!]!
      @relationship(type: "HAS_MOD_ROLE", direction: OUT)
    ActivityFeed: [ModerationAction!]!
      @relationship(type: "ACTIVITY_ON_ISSUE", direction: OUT)
    Suspensions: [Suspension!]!
      @relationship(type: "SUSPENDED_AS_MOD", direction: OUT)
  }

  type ModerationAction {
    id: ID! @id
    ModerationProfile: ModerationProfile
      @relationship(type: "PERFORMED_MODERATION_ACTION", direction: IN)
    User: User @relationship(type: "PERFORMED_MODERATION_ACTION", direction: IN)
    Comment: Comment @relationship(type: "MODERATED_COMMENT", direction: OUT)
    createdAt: DateTime! @timestamp(operations: [CREATE])
    actionType: String
    actionDescription: String
  }

  type Issue {
    id: ID! @id
    channelUniqueName: String
    Channel: Channel @relationship(type: "HAS_ISSUE", direction: IN)
    authorName: String
    Author: IssueAuthor @relationship(type: "AUTHORED_ISSUE", direction: OUT)
    title: String
    body: String
    isOpen: Boolean!
    relatedDiscussionId: ID
    relatedCommentId: ID
    relatedEventId: ID
    relatedUsername: String
    relatedModProfileName: String
    createdAt: DateTime! @timestamp(operations: [CREATE])
    updatedAt: DateTime @timestamp(operations: [UPDATE])
    flaggedServerRuleViolation: Boolean
    ActivityFeed: [ModerationAction!]!
      @relationship(type: "ACTIVITY_ON_ISSUE", direction: OUT)
    SubscribedToNotifications: [User!]! @relationship(type: "SUBSCRIBED_TO_ISSUE", direction: IN)
  }

  type Feed {
    id: ID! @id
    title: String
    description: String
    Owner: User @relationship(type: "CREATED_FEED", direction: IN)
    Tags: [Tag!]! @relationship(type: "HAS_TAG", direction: OUT)
    deleted: Boolean
  }

  type Tag {
    text: String! @unique
    Channels: [Channel!]! @relationship(type: "HAS_TAG", direction: IN)
    Discussions: [Discussion!]! @relationship(type: "HAS_TAG", direction: IN)
    Events: [Event!]! @relationship(type: "HAS_TAG", direction: IN)
    Comments: [Comment!]! @relationship(type: "HAS_TAG", direction: IN)
  }

  type SignedURL {
    url: String
  }

  type DropDataResponse {
    success: Boolean
    message: String
  }

  type SeedDataResponse {
    success: Boolean
    message: String
  }

  input EventCreateInputWithChannels {
    eventCreateInput: EventCreateInput!
    channelConnections: [String!]!
  }

  input LabelFilterInput {
    groupKey: String!
    values: [String!]!
  }

  input DiscussionCreateInputWithChannels {
    discussionCreateInput: DiscussionCreateInput!
    channelConnections: [String!]!
  }

  input NewUserInput {
    emailAddress: String!
    username: String!
  }

  input AddToCollectionInput {
    collectionId: ID!
    itemId: ID!
    itemType: CollectionItemType!
    position: Int
  }

  type Mutation {
    # Collection custom mutations
    addToCollection(input: AddToCollectionInput!): Boolean!
    removeFromCollection(collectionId: ID!, itemId: ID!, itemType: CollectionItemType!): Boolean!
    reorderCollectionItem(collectionId: ID!, itemId: ID!, newPosition: Int!): Boolean!

    # Bookmarking shortcuts
    toggleBookmark(itemId: ID!, itemType: CollectionItemType!): Boolean!
    addToFavorites(itemId: ID!, itemType: CollectionItemType!): Boolean!

    # Share collection as discussion
    shareCollectionAsDiscussion(
      collectionId: ID!,
      serverId: ID!,
      title: String!,
      content: String,
      shareMessage: String
    ): Discussion!

    # Library management
    addToOwnedDownloads(pluginVersionId: ID!): Boolean!

    # Initialize user's default favorites collections
    initializeUserFavorites: Boolean!

    addEmojiToComment(
      commentId: ID!
      emojiLabel: String!
      unicode: String!
      username: String!
    ): Comment
    removeEmojiFromComment(
      commentId: ID!
      emojiLabel: String!
      username: String!
    ): Comment
    addEmojiToDiscussionChannel(
      discussionChannelId: ID!
      emojiLabel: String!
      unicode: String!
      username: String!
    ): DiscussionChannel
    removeEmojiFromDiscussionChannel(
      discussionChannelId: ID!
      emojiLabel: String!
      username: String!
    ): DiscussionChannel
    createDiscussionWithChannelConnections(
      input: [DiscussionCreateInputWithChannels!]!
    ): [Discussion!]!
    updateDiscussionWithChannelConnections(
      where: DiscussionWhere!
      discussionUpdateInput: DiscussionUpdateInput!
      channelConnections: [String!]
      channelDisconnections: [String]
    ): Discussion
    createEventWithChannelConnections(
      input: [EventCreateInputWithChannels!]!
    ): [Event!]!
    updateEventWithChannelConnections(
      where: EventWhere!
      eventUpdateInput: EventUpdateInput!
      channelConnections: [String!]
      channelDisconnections: [String]
    ): Event
    upvoteComment(commentId: ID!, username: String!): Comment
    undoUpvoteComment(commentId: ID!, username: String!): Comment
    upvoteDiscussionChannel(
      discussionChannelId: ID!
      username: String!
    ): DiscussionChannel
    undoUpvoteDiscussionChannel(
      discussionChannelId: ID!
      username: String!
    ): DiscussionChannel
    createSignedStorageURL(filename: String!, contentType: String!, channelConnections: [String!]): SignedURL
    createEmailAndUser(emailAddress: String!, username: String!): User
    dropDataForCypressTests: DropDataResponse
    seedDataForCypressTests(
      channels: [ChannelCreateInput!]!
      users: [NewUserInput!]!
      tags: [TagCreateInput!]!
      discussions: [DiscussionCreateInputWithChannels!]!
      events: [EventCreateInputWithChannels!]!
      comments: [CommentCreateInput!]!
      channelRoles: [ChannelRoleCreateInput!]!
      modChannelRoles: [ModChannelRoleCreateInput!]!
      serverRoles: [ServerRoleCreateInput!]!
      modServerRoles: [ModServerRoleCreateInput!]!
      serverConfigs: [ServerConfigCreateInput!]!
    ): SeedDataResponse
    inviteForumOwner(
      inviteeUsername: String!
      channelUniqueName: String!
    ): Boolean
    cancelInviteForumOwner(
      channelUniqueName: String!
      inviteeUsername: String!
    ): Boolean
    removeForumOwner(channelUniqueName: String!, username: String!): Boolean
    acceptForumOwnerInvite(channelUniqueName: String!): Boolean
    becomeForumAdmin(channelUniqueName: String!): Boolean
    inviteForumMod(
      inviteeUsername: String!
      channelUniqueName: String!
    ): Boolean
    cancelInviteForumMod(
      channelUniqueName: String!
      inviteeUsername: String!
    ): Boolean
    removeForumMod(channelUniqueName: String!, username: String!): Boolean
    acceptForumModInvite(channelUniqueName: String!): Boolean
    reportDiscussion(
      discussionId: ID!
      reportText: String!
      selectedForumRules: [String!]!
      selectedServerRules: [String!]!
      channelUniqueName: String!
    ): Issue
    reportComment(
      commentId: ID!
      reportText: String!
      selectedForumRules: [String!]!
      selectedServerRules: [String!]!
      channelUniqueName: String!
    ): Issue
    reportEvent(
      eventId: ID!
      reportText: String!
      selectedForumRules: [String!]!
      selectedServerRules: [String!]!
      channelUniqueName: String!
    ): Issue
    suspendUser(
      issueId: ID!
      suspendUntil: DateTime
      suspendIndefinitely: Boolean
      explanation: String
    ): Issue
    unsuspendUser(issueId: ID!, explanation: String): Issue
    suspendMod(
      issueId: ID!
      suspendUntil: DateTime
      suspendIndefinitely: Boolean
      explanation: String
    ): Issue
    unsuspendMod(issueId: ID!, explanation: String): Issue
    archiveComment(
      commentId: ID!
      selectedForumRules: [String!]!
      selectedServerRules: [String!]!
      reportText: String!
    ): Issue
    archiveDiscussion(
      discussionId: ID!
      selectedForumRules: [String!]!
      selectedServerRules: [String!]!
      reportText: String!
      channelUniqueName: String!
    ): Issue
    archiveEvent(
      eventId: ID!
      selectedForumRules: [String!]!
      selectedServerRules: [String!]!
      reportText: String!
      channelUniqueName: String!
    ): Issue
    unarchiveComment(commentId: ID!, explanation: String): Issue
    unarchiveDiscussion(
      discussionId: ID!
      channelUniqueName: String!
      explanation: String
    ): Issue
    unarchiveEvent(
      eventId: ID!
      channelUniqueName: String!
      explanation: String
    ): Issue
    subscribeToDiscussionChannel(discussionChannelId: ID!): DiscussionChannel
    unsubscribeFromDiscussionChannel(discussionChannelId: ID!): DiscussionChannel
    subscribeToEvent(eventId: ID!): Event
    unsubscribeFromEvent(eventId: ID!): Event
    subscribeToComment(commentId: ID!): Comment
    unsubscribeFromComment(commentId: ID!): Comment
    subscribeToIssue(issueId: ID!): Issue
    unsubscribeFromIssue(issueId: ID!): Issue
    sendBugReport(
      contactEmail: String!
      username: String
      text: String!
      subject: String!
    ): Boolean
    refreshPlugins: [Plugin!]!
    installPluginVersion(
      pluginId: String!
      version: String!
    ): InstalledPlugin!
    triggerDownloadableFilePluginRuns(
      downloadableFileId: ID!
      event: String!
    ): [PluginRun!]!
    enableServerPlugin(
      pluginId: String!
      version: String!
      enabled: Boolean!
      settingsJson: JSON
    ): InstalledPlugin!
    setServerPluginSecret(
      pluginId: String!
      key: String!
      value: String!
    ): Boolean!
    validateServerPluginSecret(
      pluginId: String!
      key: String!
    ): ValidationResult!
  }

  input SiteWideDiscussionSortOrder {
    weightedVotesCount: String
  }

  enum SortType {
    hot
    new
    top
  }

  enum TimeFrame {
    day
    week
    month
    year
    all
  }

  input DiscussionListOptions {
    offset: Int
    limit: Int
    sort: SortType
    timeFrame: TimeFrame
  }

  type SiteWideDiscussionListFormat {
    aggregateDiscussionCount: Int!
    discussions: [Discussion!]!
  }

  type DiscussionChannelListFormat {
    aggregateDiscussionChannelsCount: Int!
    discussionChannels: [DiscussionChannel!]!
  }

  type CommentSectionFormat {
    DiscussionChannel: DiscussionChannel
    Comments: [Comment!]!
  }

  type EventCommentsFormat {
    Event: Event
    Comments: [Comment!]!
  }

  type CommentRepliesFormat {
    ChildComments: [Comment!]!
    aggregateChildCommentCount: Int!
  }

  type LinkFlair {
    id: String
    text: String
    cssClass: String
  }

  type ServerRole {
    name: String @unique
    description: String
    canCreateChannel: Boolean
    canCreateDiscussion: Boolean
    canCreateEvent: Boolean
    canCreateComment: Boolean
    canUpvoteDiscussion: Boolean
    canUpvoteComment: Boolean
    canUploadFile: Boolean
    canGiveFeedback: Boolean
    showAdminTag: Boolean
  }

  type ChannelRole {
    name: String @unique
    channelUniqueName: String
    description: String
    canCreateDiscussion: Boolean
    canCreateEvent: Boolean
    canCreateComment: Boolean
    canUpvoteDiscussion: Boolean
    canUpvoteComment: Boolean
    canUploadFile: Boolean
    canUpdateChannel: Boolean
    showModTag: Boolean
  }

  type ModChannelRole {
    name: String @unique
    channelUniqueName: String
    description: String
    canHideComment: Boolean
    canHideEvent: Boolean
    canHideDiscussion: Boolean
    canGiveFeedback: Boolean
    canOpenSupportTickets: Boolean
    canCloseSupportTickets: Boolean
    canReport: Boolean
    canSuspendUser: Boolean
  }

  type ModServerRole {
    name: String @unique
    description: String
    canLockChannel: Boolean
    canHideComment: Boolean
    canHideEvent: Boolean
    canHideDiscussion: Boolean
    canGiveFeedback: Boolean
    canOpenSupportTickets: Boolean
    canCloseSupportTickets: Boolean
    canReport: Boolean
    canSuspendUser: Boolean
  }

  type Plugin {
    id: ID! @id
    name: String!
    displayName: String
    description: String
    authorName: String
    authorUrl: String
    homepage: String
    license: String
    tags: [String!]
    metadata: JSON
    Versions: [PluginVersion!]! @relationship(type: "HAS_VERSION", direction: OUT)
  }

  type PluginVersion {
    id: ID! @id
    version: String!
    repoUrl: String!
    tarballGsUri: String
    integritySha256: String
    entryPath: String!
    manifest: JSON
    settingsDefaults: JSON
    uiSchema: JSON
    documentationPath: String
    readmeMarkdown: String
    Plugin: Plugin! @relationship(type: "HAS_VERSION", direction: IN)
  }

  type InstallationProperties @relationshipProperties {
    enabled: Boolean!
    settingsJson: JSON
  }

  type ChannelPluginProperties @relationshipProperties {
    enabled: Boolean!
    settingsJson: JSON
  }

  type ServerSecret {
    id: ID! @id
    pluginId: String!
    key: String!
    ciphertext: String!
    isValid: Boolean @default(value: false)
    lastValidatedAt: DateTime
    validationError: String
    updatedAt: DateTime! @timestamp(operations: [UPDATE])
    createdAt: DateTime! @timestamp(operations: [CREATE])
  }

  type PluginRun {
    id: ID! @id
    pluginId: String!
    version: String!
    scope: String!
    channelId: String
    eventType: String!
    status: String!
    message: String
    durationMs: Int
    targetId: String
    targetType: String
    payload: JSON
    createdAt: DateTime! @timestamp(operations: [CREATE])
    updatedAt: DateTime! @timestamp(operations: [UPDATE])
  }

  type ServerConfig {
    serverName: String @unique
    serverDescription: String
    serverIconURL: String
    rules: JSON
    allowedFileTypes: [String]
    enableDownloads: Boolean
    enableEvents: Boolean
    DefaultServerRole: ServerRole
      @relationship(type: "HAS_DEFAULT_SERVER_ROLE", direction: OUT)
    DefaultModRole: ModServerRole
      @relationship(type: "HAS_DEFAULT_MOD_ROLE", direction: OUT)
    DefaultElevatedModRole: ModServerRole
      @relationship(type: "HAS_DEFAULT_ELEVATED_MOD_ROLE", direction: OUT)
    DefaultSuspendedRole: ServerRole
      @relationship(type: "HAS_DEFAULT_SUSPENDED_ROLE", direction: OUT)
    DefaultSuspendedModRole: ModServerRole
      @relationship(type: "HAS_DEFAULT_SUSPENDED_ROLE", direction: OUT)

    # plugins
    pluginRegistries: [String]
    AllowedPlugins: [Plugin!]! @relationship(type: "ALLOWS", direction: OUT)
    InstalledVersions: [PluginVersion!]! @relationship(type: "INSTALLED", direction: OUT, properties: "InstallationProperties")
  }

  type EnvironmentInfo {
    isTestEnvironment: Boolean
    currentDatabase: String
  }

  type SafetyCheckResponse {
    environment: EnvironmentInfo
  }

  type InstalledPlugin {
    plugin: Plugin!
    version: String!
    scope: String!
    enabled: Boolean!
    settingsJson: JSON
    manifest: JSON
    settingsDefaults: JSON
    uiSchema: JSON
    documentationPath: String
    readmeMarkdown: String
  }

  enum SecretValidationStatus {
    NOT_SET
    SET_UNTESTED
    VALID
    INVALID
  }

  type PluginSecretStatus {
    key: String!
    status: SecretValidationStatus!
    lastValidatedAt: DateTime
    validationError: String
  }

  type ValidationResult {
    isValid: Boolean!
    error: String
  }

  type GetSortedChannelsResponse {
    channels: [Channel]
    aggregateChannelCount: Int
  }

  type ChannelInfo {
    uniqueName: String
    displayName: String
    description: String
    channelIconURL: String
  }

  type EventChannelInfo {
    id: ID!
    Channel: ChannelInfo
  }

  type DiscussionChannelInfo {
    id: ID!
    Channel: ChannelInfo
  }

  type CommentInfo {
    id: ID!
    text: String
    createdAt: DateTime
    Channel: ChannelInfo
    CommentAuthor: User
    DiscussionChannel: DiscussionChannelInfo
    Event: EventInfo
  }

  type EventChannelInfo {
    id: ID
    eventId: String
    channelUniqueName: String
  }

  type DiscussionChannelInfo {
    id: ID
    discussionId: String
    channelUniqueName: String
  }

  type EventInfo {
    id: ID
    title: String
    createdAt: DateTime
    EventChannels: [EventChannelInfo]
    Poster: User
  }

  type DiscussionInfo {
    id: ID
    title: String
    createdAt: DateTime
    DiscussionChannels: [DiscussionChannelInfo]
    Author: User
  }

  type Activity {
    id: String!
    type: String!
    description: String!
    Comments: [CommentInfo!]!
    Discussions: [DiscussionInfo!]!
    Downloads: [DiscussionInfo!]!
    Events: [EventInfo!]!
  }

  type DayData {
    date: String!
    count: Int!
    activities: [Activity!]!
  }

  type UserContributionData {
    username: String!
    displayName: String
    profilePicURL: String
    totalContributions: Int!
    dayData: [DayData!]!
  }

  type Query {
    # Discovery
    publicCollectionsContaining(itemId: ID!, itemType: CollectionItemType!): [Collection!]!

    getDiscussionsInChannel(
      channelUniqueName: String!
      searchInput: String
      selectedTags: [String]
      showArchived: Boolean
      showUnanswered: Boolean
      hasDownload: Boolean
      labelFilters: [LabelFilterInput!]
      options: DiscussionListOptions
    ): DiscussionChannelListFormat
    getSiteWideDiscussionList(
      searchInput: String
      selectedChannels: [String]
      selectedTags: [String]
      showArchived: Boolean
      hasDownload: Boolean
      options: DiscussionListOptions
    ): SiteWideDiscussionListFormat
    getCommentSection(
      channelUniqueName: String!
      discussionId: ID!
      modName: String
      offset: Int
      limit: Int
      sort: String
      username: String
    ): CommentSectionFormat
    getEventComments(
      eventId: ID!
      offset: Int
      limit: Int
      sort: SortType
    ): EventCommentsFormat
    getCommentReplies(
      commentId: ID!
      modName: String
      offset: Int
      limit: Int
      sort: SortType
    ): CommentRepliesFormat
    getSortedChannels(
      offset: Int
      limit: Int
      tags: [String]
      searchInput: String
      countDownloads: Boolean
    ): GetSortedChannelsResponse
    getUserContributions(
      username: String!
      startDate: String
      endDate: String
      year: Int
    ): [DayData!]!
    getChannelContributions(
      channelUniqueName: String!
      startDate: String
      endDate: String
      year: Int
      limit: Int
    ): [UserContributionData!]!
    isOriginalPosterSuspended(issueId: String!): Boolean
    safetyCheck: SafetyCheckResponse
    getServerPluginSecrets(
      pluginId: String!
    ): [PluginSecretStatus!]!
    getInstalledPlugins: [InstalledPlugin!]!
    getPluginRunsForDownloadableFile(downloadableFileId: ID!): [PluginRun!]!
  }
`

export default typeDefinitions
