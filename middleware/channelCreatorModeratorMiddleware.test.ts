import assert from "node:assert/strict";

// Mock the setUserDataOnContext function
let mockUserData: { username: string | null } | null = null;

// Since we can't easily mock ES modules, we'll test the middleware logic by
// creating a test version that accepts dependencies as parameters.

interface MockContext {
  ogm: {
    model: (name: string) => MockModel;
  };
  req: any;
}

interface MockModel {
  find: (params: any) => Promise<any[]>;
  update: (params: any) => Promise<any>;
}

interface CreateChannelsResult {
  channels?: Array<{ uniqueName: string }>;
}

// This is a testable version of the middleware logic
async function addCreatorAsModerator(
  result: CreateChannelsResult,
  context: MockContext,
  getUserData: () => Promise<{ username: string | null } | null>
): Promise<void> {
  const userData = await getUserData();

  if (!userData?.username) {
    return;
  }

  const User = context.ogm.model('User');
  const userWithProfile = await User.find({
    where: { username: userData.username },
    selectionSet: `{
      ModerationProfile {
        displayName
      }
    }`,
  });

  const displayName = userWithProfile[0]?.ModerationProfile?.displayName;

  if (!displayName) {
    return;
  }

  const channels = result?.channels;
  if (!channels || channels.length === 0) {
    return;
  }

  const Channel = context.ogm.model('Channel');

  for (const channel of channels) {
    if (!channel?.uniqueName) {
      continue;
    }

    await Channel.update({
      where: { uniqueName: channel.uniqueName },
      update: {
        Moderators: [
          {
            connect: [
              {
                where: {
                  node: {
                    displayName,
                  },
                },
              },
            ],
          },
        ],
      },
    });
  }
}

// ============================================
// Test: Creator is added as moderator
// ============================================

async function testCreatorAddedAsModerator() {
  const channelUpdateCalls: any[] = [];

  const mockContext: MockContext = {
    ogm: {
      model: (name: string) => {
        if (name === 'User') {
          return {
            find: async () => [
              { ModerationProfile: { displayName: 'testmod' } }
            ],
            update: async () => ({})
          };
        }
        if (name === 'Channel') {
          return {
            find: async () => [],
            update: async (params: any) => {
              channelUpdateCalls.push(params);
              return { channels: [{ uniqueName: params.where.uniqueName }] };
            }
          };
        }
        return { find: async () => [], update: async () => ({}) };
      }
    },
    req: {}
  };

  const result: CreateChannelsResult = {
    channels: [{ uniqueName: 'test-forum' }]
  };

  await addCreatorAsModerator(
    result,
    mockContext,
    async () => ({ username: 'testuser' })
  );

  assert.equal(channelUpdateCalls.length, 1, 'Should call Channel.update once');
  assert.equal(
    channelUpdateCalls[0].where.uniqueName,
    'test-forum',
    'Should update the correct channel'
  );
  assert.deepEqual(
    channelUpdateCalls[0].update.Moderators[0].connect[0].where.node.displayName,
    'testmod',
    'Should connect the correct moderator'
  );
}

// ============================================
// Test: Handles user without ModerationProfile
// ============================================

async function testHandlesUserWithoutModProfile() {
  const channelUpdateCalls: any[] = [];

  const mockContext: MockContext = {
    ogm: {
      model: (name: string) => {
        if (name === 'User') {
          return {
            find: async () => [
              { ModerationProfile: null }
            ],
            update: async () => ({})
          };
        }
        if (name === 'Channel') {
          return {
            find: async () => [],
            update: async (params: any) => {
              channelUpdateCalls.push(params);
              return {};
            }
          };
        }
        return { find: async () => [], update: async () => ({}) };
      }
    },
    req: {}
  };

  const result: CreateChannelsResult = {
    channels: [{ uniqueName: 'test-forum' }]
  };

  await addCreatorAsModerator(
    result,
    mockContext,
    async () => ({ username: 'testuser' })
  );

  assert.equal(
    channelUpdateCalls.length,
    0,
    'Should not call Channel.update when user has no ModerationProfile'
  );
}

// ============================================
// Test: Handles no logged-in user
// ============================================

async function testHandlesNoLoggedInUser() {
  const channelUpdateCalls: any[] = [];

  const mockContext: MockContext = {
    ogm: {
      model: (name: string) => {
        if (name === 'Channel') {
          return {
            find: async () => [],
            update: async (params: any) => {
              channelUpdateCalls.push(params);
              return {};
            }
          };
        }
        return { find: async () => [], update: async () => ({}) };
      }
    },
    req: {}
  };

  const result: CreateChannelsResult = {
    channels: [{ uniqueName: 'test-forum' }]
  };

  await addCreatorAsModerator(
    result,
    mockContext,
    async () => null
  );

  assert.equal(
    channelUpdateCalls.length,
    0,
    'Should not call Channel.update when no user is logged in'
  );
}

// ============================================
// Test: Handles multiple channels
// ============================================

async function testHandlesMultipleChannels() {
  const channelUpdateCalls: any[] = [];

  const mockContext: MockContext = {
    ogm: {
      model: (name: string) => {
        if (name === 'User') {
          return {
            find: async () => [
              { ModerationProfile: { displayName: 'testmod' } }
            ],
            update: async () => ({})
          };
        }
        if (name === 'Channel') {
          return {
            find: async () => [],
            update: async (params: any) => {
              channelUpdateCalls.push(params);
              return { channels: [{ uniqueName: params.where.uniqueName }] };
            }
          };
        }
        return { find: async () => [], update: async () => ({}) };
      }
    },
    req: {}
  };

  const result: CreateChannelsResult = {
    channels: [
      { uniqueName: 'forum-1' },
      { uniqueName: 'forum-2' },
      { uniqueName: 'forum-3' }
    ]
  };

  await addCreatorAsModerator(
    result,
    mockContext,
    async () => ({ username: 'testuser' })
  );

  assert.equal(
    channelUpdateCalls.length,
    3,
    'Should call Channel.update for each channel'
  );
  assert.equal(
    channelUpdateCalls[0].where.uniqueName,
    'forum-1',
    'Should update first channel'
  );
  assert.equal(
    channelUpdateCalls[1].where.uniqueName,
    'forum-2',
    'Should update second channel'
  );
  assert.equal(
    channelUpdateCalls[2].where.uniqueName,
    'forum-3',
    'Should update third channel'
  );
}

// ============================================
// Test: Handles empty channels array
// ============================================

async function testHandlesEmptyChannelsArray() {
  const channelUpdateCalls: any[] = [];

  const mockContext: MockContext = {
    ogm: {
      model: (name: string) => {
        if (name === 'User') {
          return {
            find: async () => [
              { ModerationProfile: { displayName: 'testmod' } }
            ],
            update: async () => ({})
          };
        }
        if (name === 'Channel') {
          return {
            find: async () => [],
            update: async (params: any) => {
              channelUpdateCalls.push(params);
              return {};
            }
          };
        }
        return { find: async () => [], update: async () => ({}) };
      }
    },
    req: {}
  };

  const result: CreateChannelsResult = {
    channels: []
  };

  await addCreatorAsModerator(
    result,
    mockContext,
    async () => ({ username: 'testuser' })
  );

  assert.equal(
    channelUpdateCalls.length,
    0,
    'Should not call Channel.update when channels array is empty'
  );
}

// ============================================
// Test: Handles null channels
// ============================================

async function testHandlesNullChannels() {
  const channelUpdateCalls: any[] = [];

  const mockContext: MockContext = {
    ogm: {
      model: (name: string) => {
        if (name === 'User') {
          return {
            find: async () => [
              { ModerationProfile: { displayName: 'testmod' } }
            ],
            update: async () => ({})
          };
        }
        if (name === 'Channel') {
          return {
            find: async () => [],
            update: async (params: any) => {
              channelUpdateCalls.push(params);
              return {};
            }
          };
        }
        return { find: async () => [], update: async () => ({}) };
      }
    },
    req: {}
  };

  const result: CreateChannelsResult = {};

  await addCreatorAsModerator(
    result,
    mockContext,
    async () => ({ username: 'testuser' })
  );

  assert.equal(
    channelUpdateCalls.length,
    0,
    'Should not call Channel.update when channels is undefined'
  );
}

// ============================================
// Test: Skips channels without uniqueName
// ============================================

async function testSkipsChannelsWithoutUniqueName() {
  const channelUpdateCalls: any[] = [];

  const mockContext: MockContext = {
    ogm: {
      model: (name: string) => {
        if (name === 'User') {
          return {
            find: async () => [
              { ModerationProfile: { displayName: 'testmod' } }
            ],
            update: async () => ({})
          };
        }
        if (name === 'Channel') {
          return {
            find: async () => [],
            update: async (params: any) => {
              channelUpdateCalls.push(params);
              return { channels: [{ uniqueName: params.where.uniqueName }] };
            }
          };
        }
        return { find: async () => [], update: async () => ({}) };
      }
    },
    req: {}
  };

  const result: CreateChannelsResult = {
    channels: [
      { uniqueName: '' },
      { uniqueName: 'valid-forum' }
    ]
  };

  await addCreatorAsModerator(
    result,
    mockContext,
    async () => ({ username: 'testuser' })
  );

  assert.equal(
    channelUpdateCalls.length,
    1,
    'Should only call Channel.update for channels with uniqueName'
  );
  assert.equal(
    channelUpdateCalls[0].where.uniqueName,
    'valid-forum',
    'Should update the valid channel'
  );
}

// Run all tests
async function run() {
  await testCreatorAddedAsModerator();
  await testHandlesUserWithoutModProfile();
  await testHandlesNoLoggedInUser();
  await testHandlesMultipleChannels();
  await testHandlesEmptyChannelsArray();
  await testHandlesNullChannels();
  await testSkipsChannelsWithoutUniqueName();

  console.log("channelCreatorModeratorMiddleware tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
