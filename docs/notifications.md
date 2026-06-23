# Comment Notification System

The platform implements a real-time notification system for comments that alerts users when:
- Someone comments on their discussion
- Someone comments on their event
- Someone replies to their comment

## Technical Implementation

The notification system is implemented using Neo4j GraphQL's subscription feature, which leverages Neo4j's Change Data Capture (CDC) capabilities. This approach offers several advantages over middleware-based approaches:

1. **Reliability**: The system uses Neo4j's native CDC mechanism to capture comment creation events directly from the database, ensuring no events are missed even during high loads.

2. **Decoupling**: The notification system operates independently from the HTTP request/response cycle, allowing the comment creation API to remain fast and responsive.

3. **Resilience**: The subscription-based approach can recover from temporary failures and automatically reconnect to the event stream.

4. **Maintainability**: With clear separation of concerns, the notification logic is isolated in a dedicated service that's easier to test and update.

## How It Works

1. **Enabling Subscriptions**: The Neo4j GraphQL schema is extended with the `@subscription` directive, enabling subscription capabilities.

2. **CommentNotificationService**: A dedicated service class subscribes to the `commentCreated` event stream from Neo4j.

3. **Event Processing**: When a new comment is created, the service:
   - Receives the event with the new comment's basic information
   - Queries the database for the full comment details and related entities
   - Determines the notification type based on the comment context (discussion comment, event comment, or reply)
   - Identifies the user who should receive the notification
   - Generates both email and in-app notifications with appropriate links

4. **Notification Delivery**:
   - Email notifications are sent via SendGrid
   - In-app notifications are stored in the database and made available to users when they log in

## Notification Content

Notifications include:
- Who created the comment
- The content being commented on (discussion, event, or parent comment)
- The comment text
- A direct link to view the comment using the permalink format

This approach ensures users are promptly notified of new interactions with their content while maintaining system performance and scalability.
