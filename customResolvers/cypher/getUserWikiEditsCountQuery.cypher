MATCH (u:User {username: $username})

OPTIONAL MATCH (u)-[:AUTHORED_VERSION]->(currentWikiPage:WikiPage)
WITH u, count(DISTINCT currentWikiPage) AS currentWikiEditsCount

OPTIONAL MATCH (u)-[:AUTHORED_VERSION]->(wikiRevision:TextVersion)<-[:HAS_VERSION]-(wikiPage:WikiPage)
WITH currentWikiEditsCount, count(DISTINCT wikiRevision) AS historicalWikiEditsCount
RETURN currentWikiEditsCount + historicalWikiEditsCount AS count
