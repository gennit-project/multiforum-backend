import neo4j from "neo4j-driver";

const uri = process.env.NEO4J_URI ?? "bolt://127.0.0.1:7688";
const username = process.env.NEO4J_USER ?? "neo4j";
const password = process.env.NEO4J_PASSWORD ?? "playwright-ci-password";
const serverName = process.env.SERVER_CONFIG_NAME ?? "Playwright Test Server";
const adminUsername = process.env.CYPRESS_ADMIN_TEST_USERNAME ?? "cluse";

const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));

const session = driver.session();
try {
  await session.run(
    `MATCH (node { e2eAdminModerationScenario: true })
     DETACH DELETE node`
  );

  await session.run(
    `MATCH (server:ServerConfig { serverName: $serverName })
     MATCH (admin:User { username: $adminUsername })

     CREATE (channel:Channel {
       uniqueName: 'e2e_admin_moderation',
       displayName: 'Admin Moderation E2E',
       createdAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (admin)-[:ADMIN_OF_CHANNEL]->(channel)

     CREATE (target:User {
       username: 'e2e_suspended_user',
       displayName: 'Suspended User',
       profilePicURL: '',
       createdAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (discussion:Discussion {
       id: 'e2e-reported-discussion',
       title: 'Reported discussion attached to a server suspension',
       body: 'Server suspension end-to-end fixture.',
       createdAt: datetime(),
       hasSensitiveContent: false,
       e2eAdminModerationScenario: true
     })
     CREATE (discussionChannel:DiscussionChannel {
       id: 'e2e-reported-discussion-channel',
       discussionId: discussion.id,
       channelUniqueName: channel.uniqueName,
       archived: false,
       createdAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (target)-[:POSTED_DISCUSSION]->(discussion)
     CREATE (discussionChannel)-[:POSTED_IN_CHANNEL]->(discussion)
     CREATE (discussionChannel)-[:POSTED_IN_CHANNEL]->(channel)
     CREATE (userIssue:Issue {
       id: 'e2e-server-user-issue',
       issueNumber: 9101,
       channelUniqueName: '',
       relatedDiscussionId: discussion.id,
       relatedUsername: target.username,
       title: 'Server report against e2e_suspended_user',
       body: 'Review the attached reported discussion.',
       isOpen: true,
       flaggedServerRuleViolation: true,
       createdAt: datetime(),
       updatedAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (userSuspension:Suspension {
       id: 'e2e-server-user-suspension',
       serverName: $serverName,
       username: target.username,
       suspendedIndefinitely: true,
       createdAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (server)-[:SUSPENDED_AS_USER]->(userSuspension)
     CREATE (target)-[:SUSPENDED_AS_USER]->(userSuspension)
     CREATE (userSuspension)-[:HAS_CONTEXT]->(userIssue)

     CREATE (modUser:User {
       username: 'e2e_suspended_mod_user',
       displayName: 'Suspended Moderator User',
       createdAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (modProfile:ModerationProfile {
       displayName: 'E2E Suspended Mod',
       createdAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (modUser)-[:MODERATION_PROFILE]->(modProfile)
     CREATE (modDiscussion:Discussion {
       id: 'e2e-mod-comment-discussion',
       title: 'Discussion containing a reported moderator comment',
       body: 'Moderator suspension end-to-end fixture.',
       createdAt: datetime(),
       hasSensitiveContent: false,
       e2eAdminModerationScenario: true
     })
     CREATE (modDiscussionChannel:DiscussionChannel {
       id: 'e2e-mod-comment-discussion-channel',
       discussionId: modDiscussion.id,
       channelUniqueName: channel.uniqueName,
       archived: false,
       createdAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (modComment:Comment {
       id: 'e2e-reported-mod-comment',
       text: 'Reported comment authored through a moderation profile.',
       isRootComment: true,
       archived: false,
       createdAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (modDiscussionChannel)-[:POSTED_IN_CHANNEL]->(modDiscussion)
     CREATE (modDiscussionChannel)-[:POSTED_IN_CHANNEL]->(channel)
     CREATE (modDiscussionChannel)-[:CONTAINS_COMMENT]->(modComment)
     CREATE (modProfile)-[:AUTHORED_COMMENT]->(modComment)
     CREATE (modIssue:Issue {
       id: 'e2e-server-mod-issue',
       issueNumber: 9102,
       channelUniqueName: '',
       relatedCommentId: modComment.id,
       relatedModProfileName: modProfile.displayName,
       title: 'Server report against E2E Suspended Mod',
       body: 'Review the attached reported moderator comment.',
       isOpen: true,
       flaggedServerRuleViolation: true,
       createdAt: datetime(),
       updatedAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (modSuspension:Suspension {
       id: 'e2e-server-mod-suspension',
       serverName: $serverName,
       username: modUser.username,
       modProfileName: modProfile.displayName,
       suspendedIndefinitely: true,
       createdAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (server)-[:SUSPENDED_AS_MOD]->(modSuspension)
     CREATE (modProfile)-[:SUSPENDED_AS_MOD]->(modSuspension)
     CREATE (modSuspension)-[:HAS_CONTEXT]->(modIssue)

     CREATE (targetModUser:User {
       username: 'e2e_target_mod_user',
       displayName: 'Target Moderator User',
       createdAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (targetModProfile:ModerationProfile {
       displayName: 'E2E Target Mod',
       createdAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (targetModUser)-[:MODERATION_PROFILE]->(targetModProfile)
     CREATE (targetOriginalComment:Comment {
       id: 'e2e-target-mod-original-comment',
       text: 'Original moderator comment reported by the issue.',
       isRootComment: true,
       archived: false,
       createdAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (targetModProfile)-[:AUTHORED_COMMENT]->(targetOriginalComment)
     CREATE (channel)-[:HAS_COMMENT]->(targetOriginalComment)
     CREATE (targetModIssue:Issue {
       id: 'e2e-target-mod-issue',
       issueNumber: 9103,
       channelUniqueName: channel.uniqueName,
       relatedCommentId: targetOriginalComment.id,
       relatedModProfileName: targetModProfile.displayName,
       title: 'Channel report against E2E Target Mod',
       body: 'Exercise suspension from a target moderator activity comment.',
       isOpen: true,
       flaggedServerRuleViolation: false,
       createdAt: datetime(),
       updatedAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (channel)-[:HAS_ISSUE]->(targetModIssue)
     CREATE (targetActivityComment:Comment {
       id: 'e2e-target-mod-activity-comment',
       text: 'Target moderator activity comment for suspension workflow.',
       isRootComment: false,
       archived: false,
       createdAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (targetModProfile)-[:AUTHORED_COMMENT]->(targetActivityComment)
     CREATE (channel)-[:HAS_COMMENT]->(targetActivityComment)
     CREATE (targetActivityComment)-[:ACTIVITY_ON_ISSUE]->(targetModIssue)
     CREATE (targetActivity:ModerationAction {
       id: 'e2e-target-mod-activity',
       actionType: 'comment',
       actionDescription: 'commented on the issue',
       createdAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (targetModIssue)-[:ACTIVITY_ON_ISSUE]->(targetActivity)
     CREATE (targetModProfile)-[:PERFORMED_MODERATION_ACTION]->(targetActivity)
     CREATE (targetActivity)-[:MODERATED_COMMENT]->(targetActivityComment)

     CREATE (removableAdmin:User {
       username: 'e2e_removable_admin',
       displayName: 'Removable Admin',
       createdAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (removableAdmin)-[:ADMIN_OF_SERVER]->(server)

     CREATE (currentModUser:User {
       username: 'e2e_current_mod_user',
       displayName: 'Current Moderator User',
       createdAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (currentMod:ModerationProfile {
       displayName: 'E2E Current Mod',
       createdAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (currentModUser)-[:MODERATION_PROFILE]->(currentMod)
     CREATE (currentMod)-[:MODERATOR_OF_SERVER]->(server)

     CREATE (pendingAdmin:User {
       username: 'e2e_pending_admin',
       displayName: 'Pending Admin',
       createdAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (server)-[:HAS_PENDING_SERVER_ADMIN_INVITE]->(pendingAdmin)

     CREATE (pendingMod:User {
       username: 'e2e_pending_mod',
       displayName: 'Pending Moderator',
       createdAt: datetime(),
       e2eAdminModerationScenario: true
     })
     CREATE (server)-[:HAS_PENDING_SERVER_MOD_INVITE]->(pendingMod)

     CREATE (:User {
       username: 'e2e_valid_invitee',
       displayName: 'Valid Invitee',
       createdAt: datetime(),
       e2eAdminModerationScenario: true
     })`,
    { adminUsername, serverName }
  );

  console.log(`Seeded admin moderation scenario for ${serverName}.`);
} finally {
  await session.close();
  await driver.close();
}
