type Input = {
    driver: any;
};

const dropDataForCypressTestsResolver = (input: Input) => {
    const { driver } = input;
  
    return async (parent: any, args: any, context: any, resolveInfo: any) => {
      const session = driver.session();
  
      const tx = session.beginTransaction();
  
      try {
        const deleteQueries = [
          "MATCH (e:Event) DETACH DELETE e",
          "MATCH (em:Email) DETACH DELETE em",
          "MATCH (u:User) DETACH DELETE u",
          "MATCH (ch:Channel) DETACH DELETE ch",
          "MATCH (t:Tag) DETACH DELETE t",
          "MATCH (d:Discussion) DETACH DELETE d",
          "MATCH (c:Comment) DETACH DELETE c",
          "MATCH (ec:EventChannel) DETACH DELETE ec",
          "MATCH (dc:DiscussionChannel) DETACH DELETE dc",
          "MATCH (cr:ChannelRole) DETACH DELETE cr",
          "MATCH (mcr:ModChannelRole) DETACH DELETE mcr",
          "MATCH (sr:ServerRole) DETACH DELETE sr",
          "MATCH (msr:ModServerRole) DETACH DELETE msr",
          "MATCH (sc:ServerConfig) DETACH DELETE sc",
          "MATCH (mp:ModerationProfile) DETACH DELETE mp",
          "MATCH (i:Issue) DETACH DELETE i",
          "MATCH (counter:ChannelIssueCounter) DETACH DELETE counter",
          "MATCH (w:WikiPage) DETACH DELETE w",
          "MATCH (tx:TextVersion) DETACH DELETE tx",
        ];
  
        // Execute each delete query sequentially
        for (const query of deleteQueries) {
          await tx.run(query);
        }
  
        await tx.commit();
  
        return { success: true, message: "All test data has been dropped." };
      } catch (error) {
        if (tx) {
          try {
            await tx.rollback();
          } catch (rollbackError) {
            console.error("Failed to rollback transaction", rollbackError);
          }
        }
        console.error(error);
        throw new Error("Failed to drop test data.");
      } finally {
        if (session) {
          try {
            await session.close();
          } catch (sessionCloseError) {
            console.error("Failed to close session", sessionCloseError);
          }
        }
      }
    };
  };
  
  export default dropDataForCypressTestsResolver;
  
